// invocation.test.ts
//
// Actual native caller COP, run-boundary and liveness-window qualification.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {ArtifactCompiler,instantiateProgram,type ActiveStyleSnapshot} from '../live/render/layer-artifact';
import {Context,Layer,s2} from '../runtime/s2runtime';
import {scalarPV,legacyText,isNativeExecutionStop} from '../runtime/native-scalar';
import {recoverActiveLayer} from '../live/render/recovery';
import {createNativeOutput} from '../live/render/native-output';
const native=JSON.parse(execFileSync('/usr/bin/prlimit',['--as=268435456','--cpu=10','--','perl',resolve('../../tests/js-invocation/native.pl')],
    {encoding:'utf8',timeout:15000,maxBuffer:1048576})) as {id:number;code:string;source:string;marks:{label:string;line:number}[];output:string;instrumentationUnchanged:number};

test('actual emitter COP phases through source-proven and original-byte recovery',async()=>{
    assert.equal(native.instrumentationUnchanged,1);
    const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:[{id:native.id,ownerId:1,parentId:0,type:'core',compiledTime:1,
        sourceBytes:Buffer.from(native.source,'base64'),activeCompiledBytes:Buffer.from(native.code,'base64')}]};
    const directory=mkdtempSync(join(tmpdir(),'gn-phases-'));
    try {
        const launcher=join(directory,'compiler-isolation');execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
        const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
        const compiled=await compiler.compile(snapshot);assert.equal(compiled.kind,'compiled');if(compiled.kind!=='compiled')throw Error('source correspondence');
        const recovery=recoverActiveLayer({id:native.id,ownerId:1,systemUserId:1,parentId:0,type:'core',activeBytes:Buffer.from(native.code,'base64')},1);
        assert.equal(recovery.kind,'recovered');if(recovery.kind!=='recovered')throw Error('recovery');
        const recovered=runInNewContext(recovery.code+';recovered_layer;',{s2},{timeout:5000}) as Layer;recovered.scalarProfile=compiler.scalarProfile;
        for(const [route,layers] of [['source',instantiateProgram(compiled.program)],['recovered',[recovered]]] as const) {
            const marks:{label:string;line:number}[]=[];const sites=new WeakMap<object,number>();
            const original=s2.runtime.nativeCOP;
            // Trusted test observation of the ACTUAL private frame register; never an
            // alternate location/brand adapter or a production JS-stack inspection.
            const top=(context:Context)=>(context as unknown as {callFrames:{cop:object}[]}).callFrames.at(-1)!.cop;
            s2.runtime.nativeCOP=(context,layer,line)=>{original(context,layer,line);sites.set(top(context),line);};
            try {
                let output='';const context=new Context([...layers],value=>output+=value,undefined,{_mark:(ctx,label)=>{
                    const text=legacyText(scalarPV(label));const line=sites.get(top(ctx));assert.ok(line,route+': missing COP '+text);
                    marks.push({label:text,line});return s2.runtime.numericLiteral(text.startsWith('false')?'0':'1');
                }},undefined,500,undefined,{nowMilliseconds:()=>0});
                context.runFunction('main()');
                assert.deepEqual(marks,native.marks,route);
                assert.deepEqual(Buffer.from(output),Buffer.from(native.output,'base64'));
            } finally {s2.runtime.nativeCOP=original;}
        }
    } finally {rmSync(directory,{recursive:true,force:true});}
});

test('explicit runs reset entries and window while retaining host frames and outer deadline',()=>{
    let now=0;const layer=new Layer();
        type RunState={functionCalls:number;nativeHostFrames:object[];lastDepthCheck:number};
    layer.registerFunction(['leaf()'],()=>()=>undefined,10);
    // Context builds its function table at construction; use a fresh instance.
    const ctx=new Context([layer],()=>{},undefined,undefined,undefined,8,undefined,{nowMilliseconds:()=>now});
    const actual=ctx as unknown as RunState;
    ctx.runBoundary(()=>{
        assert.equal(actual.nativeHostFrames.length,3);
        for(let n=0;n<7;n++)ctx.getFunction('leaf()')(ctx);
        assert.equal(actual.functionCalls,7);
        now=200;ctx.recoveryCheckpoint();assert.equal(actual.lastDepthCheck,0);
        ctx.runBoundary(()=>{
            assert.equal(actual.nativeHostFrames.length,6);
            assert.equal(actual.functionCalls,0);assert.equal(actual.lastDepthCheck,200);
            ctx.getFunction('leaf()')(ctx);assert.equal(actual.functionCalls,1);
        },'plural');
        assert.equal(actual.nativeHostFrames.length,3);
        now=4001;
        assert.throws(()=>ctx.runBoundary(()=>ctx.checkExecutionDeadline(),'ordinal'),isNativeExecutionStop);
    });
    assert.equal(actual.nativeHostFrames.length,0);
    ctx.checkExecutionDeadline(); // outer unwind cancels only the program deadline
});

test('nested unknown failures remain infrastructure and COP rejects unloaded layers',()=>{
    const layer=new Layer();const failure=new RangeError('bounded host failure');
    layer.registerFunction(['fail()'],()=>()=>{throw failure;},12);
    layer.registerFunction(['probe()'],()=>ctx=>{
        assert.throws(()=>ctx.setNativeCOP(new Layer(),12),/active loaded/);
        assert.throws(()=>ctx.setNativeCOP(layer,0),/Invalid native COP/);
    },11);
    const ctx=new Context([layer],()=>{},undefined,undefined,undefined,500,undefined,{nowMilliseconds:()=>0});
    assert.throws(()=>ctx.runBoundary(()=>ctx.runNativeFunction('fail()',[],'plural')),error=>error===failure);
    ctx.runFunction('probe()');
});

test('native recursive physical-line families agree across both actual routes',async()=>{
    const rows=JSON.parse(execFileSync('/usr/bin/prlimit',['--as=268435456','--cpu=10','--','perl',resolve('../../tests/js-invocation/recursion.pl')],
        {encoding:'utf8',timeout:15000,maxBuffer:1048576})) as {case:string;sources:string[];compiled:string[];ids:number[];output:string;samples:{counter?:number;beforeHost?:number;afterHost?:number}[]}[];
    const directory=mkdtempSync(join(tmpdir(),'gn-recursion-'));
    try {
        const launcher=join(directory,'isolation');execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
        const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
        for(const row of rows){
            const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:row.ids.map((id,index)=>({id,ownerId:1,parentId:index?row.ids[0]!:0,type:index?'layout':'core',compiledTime:1,
                sourceBytes:Buffer.from(row.sources[index]!,'base64'),activeCompiledBytes:Buffer.from(row.compiled[index]!,'base64')}))};
            const result=await compiler.compile(snapshot);assert.equal(result.kind,'compiled',row.case);if(result.kind!=='compiled')throw Error(row.case);
            const recovered=snapshot.layers.map(layer=>{
                const result=recoverActiveLayer({id:layer.id,ownerId:1,systemUserId:1,parentId:layer.parentId,type:layer.type,activeBytes:layer.activeCompiledBytes},1);
                assert.equal(result.kind,'recovered',row.case);if(result.kind!=='recovered')throw Error(row.case);
                const value=runInNewContext(result.code+';recovered_layer;',{s2},{timeout:5000}) as Layer;value.scalarProfile=compiler.scalarProfile;return value;
            });
            const sourceLayers=instantiateProgram(result.program);
            const routes:[string,readonly Layer[]][]=[['source',sourceLayers],['recovered',recovered]];
            if(sourceLayers.length>1)routes.push(['mixed',[sourceLayers[0]!,recovered[1]!]]);
            for(const [route,layers] of routes){
                let output='';const checkpoints:number[]=[];
                const hostSamples:{beforeHost?:number;afterHost?:number}[]=[];
                const ctx=new Context([...layers],value=>output+=value,undefined,{_host:(context,value)=>{
                    hostSamples.push({beforeHost:(context as unknown as {functionCalls:number}).functionCalls});
                    const result=context.runNativeFunction('helper(int)',[value],'plural');
                    hostSamples.push({afterHost:(context as unknown as {functionCalls:number}).functionCalls});return result;
                }},undefined,8,undefined,{nowMilliseconds:()=>0});
                const original=ctx.recoveryCheckpoint.bind(ctx);ctx.recoveryCheckpoint=()=>{
                    checkpoints.push((ctx as unknown as {functionCalls:number}).functionCalls);original();
                };
                if(row.case==='reentry'){ctx.runFunction('main()');assert.deepEqual(hostSamples,row.samples,row.case+route);}
                else assert.throws(()=>ctx.runFunction('main()'),isNativeExecutionStop,row.case+route);
                assert.equal(output,row.output,row.case+route);
                assert.deepEqual(checkpoints,row.samples.filter(sample=>sample.counter!==undefined).map(sample=>sample.counter),row.case+route);
            }
        }
    } finally {rmSync(directory,{recursive:true,force:true});}
});

test('lapsed depth window does not translate nested host stack exhaustion into program output',()=>{
    let now=0;const ctx=new Context([],()=>{throw Error('unexpected output');},undefined,undefined,undefined,2,undefined,{nowMilliseconds:()=>now});
    const recurse=():unknown=>{ctx.recoveryCheckpoint();return recurse();};
    assert.throws(()=>ctx.runBoundary(()=>ctx.runBoundary(()=>{now=151;return recurse();},'plural')),
        error=>error instanceof RangeError && !isNativeExecutionStop(error));
    // Stack restoration must still permit an unrelated later run.
    ctx.runBoundary(()=>ctx.checkExecutionDeadline());
});

test('passing depth check refreshes window; lapse persists until explicit reentry',()=>{
    let now=0;const ctx=new Context([],()=>{},undefined,undefined,undefined,500,undefined,{nowMilliseconds:()=>now});
    const state=ctx as unknown as {lastDepthCheck:number};
    ctx.runBoundary(()=>{
        now=150;ctx.recoveryCheckpoint();assert.equal(state.lastDepthCheck,150);
        now=301;ctx.recoveryCheckpoint();assert.equal(state.lastDepthCheck,150);
        now=302;ctx.recoveryCheckpoint();assert.equal(state.lastDepthCheck,150);
        ctx.runBoundary(()=>{assert.equal(state.lastDepthCheck,302);now=303;ctx.recoveryCheckpoint();assert.equal(state.lastDepthCheck,303);},'ordinal');
    });
});

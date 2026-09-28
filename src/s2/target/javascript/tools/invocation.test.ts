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
import {ArtifactCompiler,instantiateProgram,type ActiveStyleSnapshot} from '../live/render/layer-artifact';
import {Context,Layer,s2} from '../runtime/s2runtime';
import {scalarPV,legacyText,isNativeExecutionStop,isNativeProgramError,raiseNativeExecutionStop} from '../runtime/native-scalar';
import {createNativeOutput} from '../live/render/native-output';
const native=JSON.parse(execFileSync('/usr/bin/prlimit',['--as=268435456','--cpu=10','--','perl',resolve('../../tests/js-invocation/native.pl')],
    {encoding:'utf8',timeout:15000,maxBuffer:1048576})) as {id:number;source:string;output:string;nestedError:string;divideError:string};

test('current source preserves native visible control-flow output',async()=>{
    const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:[{id:native.id,ownerId:1,parentId:0,type:'core',
        sourceBytes:Buffer.from(native.source,'base64')}]};
    const directory=mkdtempSync(join(tmpdir(),'gn-phases-'));
    try {
        const launcher=join(directory,'compiler-isolation');execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
        const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
        const compiled=await compiler.compile(snapshot);assert.equal(compiled.kind,'compiled');
        if(compiled.kind!=='compiled')throw Error('S2 source compilation required');
        const seen:string[]=[];let output='';
        const context=new Context(instantiateProgram(compiled.program),value=>output+=value,undefined,
            {_mark:(_ctx,label)=>{const text=legacyText(scalarPV(label));seen.push(text);
                return s2.runtime.numericLiteral(text.startsWith('false')?'0':'1');}},
            undefined,500,undefined,{nowMilliseconds:()=>0});
        context.runFunction('main()');
        assert.ok(seen.includes('print'));
        assert.deepEqual(Buffer.from(output),Buffer.from(native.output,'base64'));
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

test('source-compiled recursion stays within the private execution boundary',async()=>{
    const source='layerinfo type=core; function f(int n):int { if($n==0){return 0;} return f($n-1); } function main(){print f(100);}';
    const directory=mkdtempSync(join(tmpdir(),'gn-recursion-'));
    try {
        const launcher=join(directory,'isolation');execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
        const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
        const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:[{id:701,ownerId:1,parentId:0,type:'core',sourceBytes:Buffer.from(source)}]};
        const result=await compiler.compile(snapshot);assert.equal(result.kind,'compiled');
        if(result.kind!=='compiled')throw Error('S2 source compilation required');
        let output='';const ctx=new Context(instantiateProgram(result.program),value=>output+=value,
            undefined,undefined,undefined,8,undefined,{nowMilliseconds:()=>0});
        assert.throws(()=>ctx.runFunction('main()'),isNativeExecutionStop);
        assert.equal(output,'');
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


test('nested program errors alone gain native run signature wrapping',()=>{
    const prefix='Died in S2::run_code running outer(): Died in S2::run_code running plural(): ';
    assert.ok(native.nestedError.startsWith(prefix+'Method called on null Thing object'),native.nestedError);
    const layer=new Layer();
    layer.registerFunction(['plural()'],()=>ctx=>ctx.getMethod(null,'missing()',layer,7)(ctx),20);
    layer.registerFunction(['outer()'],()=>ctx=>ctx.runNativeFunction('plural()',[],'plural'),21);
    let stop:unknown;try {raiseNativeExecutionStop('recursion');} catch(error) {stop=error;}
    layer.registerFunction(['stop()'],()=>()=>{throw stop;},22);
    const ctx=new Context([layer],()=>{},undefined,undefined,undefined,500,undefined,{nowMilliseconds:()=>0});
    assert.throws(()=>ctx.runNativeFunction('outer()'),error=>isNativeProgramError(error) &&
        error.message==='Died in S2::run_code running outer(): Died in S2::run_code running plural(): <unknown S2 layer>:7: method missing() called on null object');
    assert.throws(()=>ctx.runNativeFunction('stop()'),error=>error===stop && isNativeExecutionStop(error) && !isNativeProgramError(error));
    for(const error of [new Error('Died in S2::run_code running plural(): fake'),Object.assign(new Error('fake'),{programError:true}),new RangeError('fake')]) {
        assert.equal(isNativeProgramError(error),false);
        layer.functions.set('hostile()',()=>{throw error;});
        // A newly assembled real Context uses the actual registered function.
        const actual=new Context([layer],()=>{});
        assert.throws(()=>actual.runNativeFunction('hostile()'),caught=>caught===error);
    }
});


test('native arithmetic and array semantic dies share the private program-error authority',()=>{
    const prefix='Died in S2::run_code running outerdivide(): Died in S2::run_code running faildivide(): ';
    assert.ok(native.divideError.startsWith(prefix+'Illegal division by zero'),native.divideError);
    const layer=new Layer();
    layer.registerFunction(['faildivide()'],()=>()=>s2.runtime.scalarBinary('/',s2.runtime.numericLiteral('1'),s2.runtime.numericLiteral('0')),30);
    layer.registerFunction(['outerdivide()'],()=>ctx=>ctx.runNativeFunction('faildivide()',[],'plural'),31);
    const ctx=new Context([layer],()=>{});
    assert.throws(()=>ctx.runNativeFunction('outerdivide()'),error=>isNativeProgramError(error) && error.message===prefix+'Illegal division by zero');
    assert.throws(()=>s2.runtime.scalarBinary('%',s2.runtime.numericLiteral('1'),s2.runtime.numericLiteral('0')),isNativeProgramError);
    assert.throws(()=>s2.runtime.memberSlot([],s2.runtime.numericLiteral('-1'),'array').set!(s2.runtime.numericLiteral('1')),isNativeProgramError);
});


test('shared program-error authority initializes in either scalar/number module import order',()=>{
    const number=resolve('dist/runtime/native-number.js');
    const scalar=resolve('dist/runtime/native-scalar.js');
    for(const first of [number,scalar]){
        const script=`require(${JSON.stringify(first)});const n=require(${JSON.stringify(number)});const s=require(${JSON.stringify(scalar)});try{n.divide(n.NativeNumber.literal('1'),n.NativeNumber.literal('0'));process.exit(2);}catch(e){if(!s.isNativeProgramError(e))throw e;}`;
        execFileSync(process.execPath,['-e',script],{timeout:5000,maxBuffer:65536});
    }
});

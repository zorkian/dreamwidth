// native-output.test.ts
//
// Actual Context byte bridge and native cadence qualification.
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
import {recoverActiveLayer} from '../live/render/recovery';
import {isNativeExecutionStop} from '../runtime/native-scalar';
import {createNativeOutput, type NativeOutputOptions} from '../live/render/native-output';
import {Context,Layer,s2} from '../runtime/s2runtime';
import {NativeString} from '../runtime/native-string';
const bytes=(text:string)=>NativeString.hostUtf8Bytes(text);
function options(checkDepth=()=>{}): NativeOutputOptions {
    return {contentType:'text/html', limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
        stylesheet:{domain:'example.org',webDomain:'www.example.org',statPrefix:'https://static.example.org',trustedHosts:{'trusted.test':true},cssCleanerEnabled:true,cssProxy:null},
        checkDepth,transformCss:chunk=>chunk,expandEmbed:chunk=>chunk};
}
const rows=JSON.parse(execFileSync('bash',['-c','ulimit -v 131072; ulimit -t 5; exec perl "$1"','native',resolve('../../../content/tests/page-output-native.pl')],{encoding:'utf8',timeout:10000,maxBuffer:1048576})) as {id:string;ctype:string;flag:number;base64:string;trace:[string,string|null,number][]}[];
for(const id of ['raw_between_attr','active_attrs','css_nested','flagged_raw','mixed_raw']) test(`actual Context/native ${id}`,()=>{
    const row=rows.find(row=>row.id===id); assert.ok(row, id);
    const page=createNativeOutput({...options(),contentType:row.ctype});
    const ctx=new Context([],()=>{throw new Error('legacy sink used');},undefined,undefined,undefined,500,page.sink);
    for(const [op,value,flag] of row.trace) {
        const pv=NativeString.fromFrame({bytes:Buffer.from(value??'','base64'),utf8:!!flag});
        if(op==='safe')ctx.safePrint(pv); else if(op==='raw')ctx.print(pv); else if(op==='start')page.startCss(); else page.endCss();
    }
    const result=page.finish(); assert.deepEqual(Buffer.from(result.bytes),Buffer.from(row.base64,'base64')); assert.equal(result.utf8,!!row.flag);
});
test('page owns exactly eight-print cadence and excludes CSS buffering',()=>{
    let checks=0; let ctx:Context;
    const page=createNativeOutput(options(()=>ctx.recoveryCheckpoint()));
    ctx=new Context([],()=>{},undefined,undefined,undefined,500,page.sink);
    ctx.recoveryCheckpoint=()=>{checks++;};
    page.startCss(); for(let n=0;n<16;n++)ctx.safePrint(bytes('a')); assert.equal(checks,0);
    page.endCss(); for(let n=0;n<7;n++)ctx.print(bytes('x')); assert.equal(checks,1);
    page.finish(); assert.equal(checks,1);
});
test('infrastructure failure cannot return partial output',()=>{
    const page=createNativeOutput({...options(),expandEmbed:()=>{throw new Error('hook failure');},limits:{maxInputBytes:10,maxOutputBytes:2,timeoutMs:1000}});
    page.sink.raw(bytes('a')); assert.throws(()=>page.sink.raw(bytes('bbb')));
    assert.throws(()=>page.finish(),/terminal/); assert.throws(()=>page.runtimeError(bytes('error')),/terminal/);
});
test('runtime error omits eof and terminalizes open CSS',()=>{
    const page=createNativeOutput(options()); page.startCss(); page.sink.safe(bytes('hidden'));
    assert.deepEqual(Buffer.from(page.runtimeError(bytes('error')).bytes),Buffer.alloc(0));
    assert.throws(()=>page.finish(),/terminal/);
});

interface Oracle {recursive:{ok:number;base64:string};sources:string[];codes:string[];ok:number;base64:string;flag:number;
    errors:{id:string;ctype:string;ok:number;base64:string;flag:number}[];}
const oracle=JSON.parse(execFileSync('/usr/bin/prlimit',['--as=268435456','--cpu=10','--','perl',resolve('../../tests/js-native-output/native.pl')],
    {encoding:'utf8',timeout:15000,maxBuffer:1048576})) as Oracle;
test('native program error completion preserves pending marker/CSS ordering without eof',()=>{
    for(const row of oracle.errors) {
        assert.equal(row.ok,0);
        const page=createNativeOutput({...options(),contentType:row.ctype});
        if(row.id==='pending')page.sink.safe(bytes('<a href="tail'));
        else if(row.id==='nested'){page.startCss();page.startCss();page.sink.safe(bytes('p{color:red}'));}
        else if(row.id==='css')page.sink.safe(bytes('p{color:red}'));
        else {
            let ctx:Context;const layer=new Layer();
            layer.functions.set('main()',()=>{for(let n=0;n<8;n++)ctx.print(bytes('x'));});
            const checkpointPage=createNativeOutput(options(()=>ctx.recoveryCheckpoint()));
            ctx=new Context([layer],()=>{},undefined,undefined,undefined,1,checkpointPage.sink);
            assert.throws(()=>ctx.runFunction('main()'),isNativeExecutionStop);
            const result=checkpointPage.runtimeError(bytes('<b>Error running style:</b> fixed failure<br />\n'));
            assert.deepEqual(Buffer.from(result.bytes),Buffer.from(row.base64,'base64'));
            continue;
        }
        const result=page.runtimeError(bytes('<b>Error running style:</b> fixed failure<br />\n'));
        assert.deepEqual(Buffer.from(result.bytes),Buffer.from(row.base64,'base64'),row.id);
        assert.equal(result.utf8,!!row.flag);assert.throws(()=>page.sink.raw(bytes('late')),/terminal/);
    }
});
test('separate sessions, abort and returned frame copies cannot leak pending state',()=>{
    const first=createNativeOutput(options());first.sink.safe(bytes('<script>pending'));first.abort();
    assert.throws(()=>first.finish(),/terminal/);
    const second=createNativeOutput(options());second.sink.raw(NativeString.bytes(Buffer.from([255,0,128])));
    const result=second.finish();assert.deepEqual(Buffer.from(result.bytes),Buffer.from([255,0,128]));
    result.bytes.fill(0);assert.throws(()=>second.finish(),/terminal/);
    const third=createNativeOutput(options());third.sink.safe(bytes('<b>clean</b>'));
    assert.deepEqual(Buffer.from(third.finish().bytes),Buffer.from('<b>clean</b>'));
});
test('source-proven and recovered actual program preserves defining-layer safe/raw trust',async()=>{
    assert.equal(oracle.ok,1);
    const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:oracle.codes.map((code,i)=>({
        id:101+i,ownerId:i?2:1,parentId:i?101:0,type:i?'layout':'core',compiledTime:1,
        sourceBytes:Buffer.from(oracle.sources[i]!,'base64'),activeCompiledBytes:Buffer.from(code,'base64')}))};
    const directory=mkdtempSync(join(tmpdir(),'gb-program-'));
    try {
        const launcher=join(directory,'compiler-isolation');
        execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
        const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
        const compiled=await compiler.compile(snapshot);assert.equal(compiled.kind,'compiled');
        if(compiled.kind!=='compiled')throw Error('source correspondence missing');
        const recovered=oracle.codes.map((code,i)=>{
            const result=recoverActiveLayer({id:101+i,ownerId:i?2:1,systemUserId:1,parentId:i?101:0,type:i?'layout':'core',activeBytes:Buffer.from(code,'base64')},1);
            assert.equal(result.kind,'recovered');if(result.kind!=='recovered')throw Error('recovery missing');
            const layer=runInNewContext(result.code+';recovered_layer;',{s2},{timeout:5000}) as Layer;
            layer.scalarProfile=compiler.scalarProfile;return layer;
        });
        for(const [route,layers] of [instantiateProgram(compiled.program),recovered].entries()) {
            let ctx:Context;const page=createNativeOutput(options(()=>ctx.recoveryCheckpoint()));
            ctx=new Context(layers,()=>{throw Error('legacy output used');},undefined,undefined,undefined,500,page.sink);
            ctx.runFunction('main()');const output=page.finish();
            assert.deepEqual(Buffer.from(output.bytes),Buffer.from(oracle.base64,'base64'));
            assert.equal(output.utf8,!!oracle.flag);
            let recursiveContext:Context;
            const recursivePage=createNativeOutput(options(()=>recursiveContext.recoveryCheckpoint()));
            recursiveContext=new Context(layers,()=>{},undefined,undefined,undefined,50,recursivePage.sink);
            let stopped:unknown;try{recursiveContext.runFunction('recursive()');}catch(error){stopped=error;}
            assert.equal(isNativeExecutionStop(stopped),true);
            const diagnostic=bytes('<b>Error running style:</b> Died in S2::run_code running recursive(): Excessive recursion detected and stopped.<br />\n<br />\n');
            assert.equal(oracle.recursive.ok,0);
            const partial=Buffer.from(recursivePage.runtimeError(diagnostic).bytes);
            const nativePartial=Buffer.from(oracle.recursive.base64,'base64');
            // Existing Context function-name recursion differs from native caller-location
            // counting. Preserve the exact independent discrepancy, not normalized parity.
            assert.equal(nativePartial.length,277);
            console.log(JSON.stringify({proof:'actual-recursion-count-gap',route:route===0?'source':'recovered',configuredRecursion:50,actualBase64:partial.toString('base64'),nativeBase64:nativePartial.toString('base64'),actualBytes:partial.length,nativeBytes:nativePartial.length}));
            assert.deepEqual(partial.subarray(partial.indexOf(60)),nativePartial.subarray(nativePartial.indexOf(60)));
            assert.equal(partial.subarray(0,partial.indexOf(60)).every(byte=>byte===120),true);
            const capture=createNativeOutput(options(()=>recursiveContext.recoveryCheckpoint()));
            capture.startCss();
            recursiveContext=new Context(layers,()=>{},undefined,undefined,undefined,50,capture.sink);
            assert.throws(()=>recursiveContext.runFunction('recursive()'),isNativeExecutionStop);
            assert.deepEqual(Buffer.from(capture.runtimeError(diagnostic).bytes),Buffer.alloc(0));
        }
    } finally {rmSync(directory,{recursive:true,force:true});}
});
test('CSS hook and depth failures remain terminal infrastructure failures',()=>{
    const hook=createNativeOutput({...options(),transformCss:()=>{throw Error('hook failed');}});
    hook.startCss();hook.sink.raw(bytes('p{color:red}'));
    assert.throws(()=>hook.endCss(),/hook failed/);assert.throws(()=>hook.runtimeError(bytes('diagnostic')),/terminal/);
    const depth=createNativeOutput(options(()=>{throw Error('deadline');}));
    for(let n=0;n<7;n++)depth.sink.raw(bytes('x'));
    assert.throws(()=>depth.sink.raw(bytes('x')),/deadline/);assert.throws(()=>depth.finish(),/terminal/);
});
test('legacy/default sink cadence remains Context-owned; declaration captured once',()=>{
    let checks=0;const ctx=new Context([],()=>{});ctx.recoveryCheckpoint=()=>{checks++;};
    for(let n=0;n<8;n++)ctx.print(bytes('x'));assert.equal(checks,1);
    for(let n=0;n<8;n++)ctx.safePrint(bytes('x'));assert.equal(checks,2);
    const sink:{ownsPrintCheckpoints?:true;raw:()=>void;safe:()=>void}={raw:()=>{},safe:()=>{}};
    const ordinary=new Context([],()=>{},undefined,undefined,undefined,500,sink);
    ordinary.recoveryCheckpoint=()=>{checks++;};sink.ownsPrintCheckpoints=true;
    for(let n=0;n<8;n++)ordinary.print(bytes('x'));assert.equal(checks,3);
});

test('private execution-stop authority cannot be forged by author-like error data',()=>{
    for(const error of [new Error('Excessive S2 recursion'),new Error('S2 execution timed out'),
        Object.assign(new Error('stop'),{nativeExecutionStop:true}),Object.create(Error.prototype)]) {
        assert.equal(isNativeExecutionStop(error),false);
        const page=createNativeOutput(options(()=>{throw error;}));
        for(let n=0;n<7;n++)page.sink.raw(bytes('x'));
        assert.throws(()=>page.sink.raw(bytes('x')));
        assert.throws(()=>page.runtimeError(bytes('diagnostic')),/terminal/);
    }
});
test('actual Context deadline cancels before diagnostic eighth-print checkpoint',{timeout:10000},()=>{
    const layer=new Layer();let ctx:Context;
    layer.functions.set('main()',()=>{
        for(let n=0;n<7;n++)ctx.print(bytes('x'));
        const until=performance.now()+4100;while(performance.now()<until){}
        ctx.recoveryCheckpoint();
    });
    const page=createNativeOutput(options(()=>ctx.recoveryCheckpoint()));
    ctx=new Context([layer],()=>{},undefined,undefined,undefined,500,page.sink);
    assert.throws(()=>ctx.runFunction('main()'),isNativeExecutionStop);
    // This raw diagnostic is print eight and must not revive the cancelled alarm.
    assert.deepEqual(Buffer.from(page.runtimeError(bytes('diagnostic')).bytes),Buffer.from('xxxxxxxdiagnostic'));
});

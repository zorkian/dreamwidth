// compile-active.test.ts
//
// Independent general compiler, runtime and private cache qualification.
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
import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,readdirSync,readFileSync,rmSync,openSync,closeSync,symlinkSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler,CompilerFailure,instantiateProgram,type ActiveStyleSnapshot,type ProgramArtifact} from "../live/render/layer-artifact";
import {ArtifactCache} from "../live/render/artifact-cache";
import {Context} from "../runtime/s2runtime";

const root=path.resolve(__dirname,"../../../..");
const tools=path.join(root,"target/javascript/tools");
const env={PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",TZ:"UTC",PERL_HASH_SEED:"0",PERL_PERTURB_KEYS:"0"};
function native():{snapshot:ActiveStyleSnapshot;output:string;safe:string[];enumerations:any[];
    recursion:{maxRecursion:number;value:number|null;refused:boolean}[]} {
    const result=JSON.parse(execFileSync("/usr/bin/perl",[path.join(tools,"active-native.pl")],{env,encoding:"utf8"}));
    result.snapshot.layers=result.snapshot.layers.map((layer:any)=> {
        const {sourceBase64,activeBase64,...identity}=layer;
        return {...identity,sourceBytes:Buffer.from(sourceBase64,"base64"),activeCompiledBytes:Buffer.from(activeBase64,"base64")};
    });
    return result;
}
function fixture(callback:(directory:string,launcher:string)=>Promise<void>):Promise<void> {
    const directory=mkdtempSync(path.join(tmpdir(),"s2-g1-"));
    const launcher=path.join(directory,"compiler-isolation");
    execFileSync("/usr/bin/cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",path.join(tools,"compiler-isolation.c"),"-o",launcher],{env});
    return callback(directory,launcher).finally(()=>rmSync(directory,{recursive:true,force:true}));
}
function compiler(launcher:string):ArtifactCompiler {
    return new ArtifactCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:launcher});
}

test("arbitrary custom stack: native function/alias/inheritance/composites/trust and enums",()=>fixture(async(_directory,launcher)=> {
    const oracle=native();
    const expected="<b>custom</b>user:21:blue:custom|base:child|base:child|6|literal|data|&lt;i&gt;layout&lt;/i&gt;|stored|value|computed|2|new|constructor";
    assert.equal(oracle.output,expected);
    assert.deepEqual(oracle.safe,["<b>custom</b>"]);
    const result=await compiler(launcher).compile(oracle.snapshot);
    assert.equal(result.kind,"compiled");if(result.kind!=="compiled")throw Error("compile required");
    assert.deepEqual(result.program.layers.map(layer=>layer.untrusted),[false,true,true]);
    const layers=instantiateProgram(result.program);let output="";const safe:string[]=[];
    const ctx=new Context(layers,value=>output+=value,undefined,undefined,value=>{safe.push(value);return value;});
    ctx.runFunction("main()");assert.equal(output,expected);assert.deepEqual(safe,oracle.safe);
    assert.deepEqual(oracle.recursion,[{maxRecursion:500,value:120,refused:false},
        {maxRecursion:50,value:null,refused:true}]);
    for(const row of oracle.recursion) {
        const bounded:Context=new Context(instantiateProgram(result.program),()=>{},undefined,undefined,undefined,row.maxRecursion);
        if(row.refused)assert.throws(()=>bounded.getFunction("depth(int)")(bounded,120),/Excessive S2 recursion/);
        else assert.equal(bounded.getFunction("depth(int)")(bounded,120),row.value);
    }
    assert.equal(ctx.getFunction("depth(int)")(ctx,120),120); // legacy config DW default500
    assert.equal(layers[0]!.declarations.get("_matrix")?.type,"int[][]");
    assert.equal(layers[0]!.declarations.get("_labels")?.type,"string{}");
    for(const row of oracle.enumerations) {
        layers[2]!.setProperty("_tone",row.input);
        const current=new Context(layers,()=>{});
        assert.equal(Object.hasOwn(current.prop,"_tone"),row.present);
        assert.equal(current.prop._tone??null,row.value);
        assert.equal(current.prop._other,"outside");assert.equal(current.prop._zero,"0");
    }
    const first=new Context(instantiateProgram(result.program),()=>{});
    (first.prop._matrix as number[][])[0]![0]=999;
    assert.equal((new Context(instantiateProgram(result.program),()=>{}).prop._matrix as number[][])[0]![0],2);
    assert.throws(()=>instantiateProgram({...result.program} as ProgramArtifact),CompilerFailure);
    for(const negative of ["delete-array","delete-scalar"]) {
        const failure=spawnSync("/usr/bin/perl",[path.join(tools,"active-native.pl"),negative],{env,encoding:"utf8"});
        assert.notEqual(failure.status,0);
        assert.match(failure.stderr,/Delete statement argument is not a hash/);
    }
}));

test("source/active mismatch and ownership never execute wrong version",()=>fixture(async(_directory,launcher)=> {
    const oracle=native();const producer=compiler(launcher);
    const changed={...oracle.snapshot,layers:oracle.snapshot.layers.map(layer=>layer.type==="user"?
        {...layer,sourceBytes:Buffer.from(Buffer.from(layer.sourceBytes!).toString().replace("user:","new:"))}:layer)};
    assert.deepEqual(await producer.compile(changed),{kind:"recovery",layerId:103,reason:"active-source-correspondence"});
    const missing={...oracle.snapshot,layers:oracle.snapshot.layers.map(layer=>layer.type==="user"?{...layer,sourceBytes:null}:layer)};
    assert.deepEqual(await producer.compile(missing),{kind:"recovery",layerId:103,reason:"missing-source"});
    const trusted={...oracle.snapshot,layers:oracle.snapshot.layers.map(layer=>layer.type==="layout"?{...layer,ownerId:11}:layer)};
    assert.deepEqual(await producer.compile(trusted),{kind:"recovery",layerId:102,reason:"active-source-correspondence"});
    const attack={...oracle.snapshot,layers:oracle.snapshot.layers.map(layer=>layer.type==="user"?
        {...layer,sourceBytes:Buffer.from('BEGIN { system("touch /tmp/S2_G1_SIDE_EFFECT"); }')}:layer)};
    assert.deepEqual(await producer.compile(attack),{kind:"recovery",layerId:103,reason:"active-source-correspondence"});
}));

test("cache coalesces, authenticates producer output and invalidates every dependency",()=>fixture(async(directory,launcher)=> {
    const snapshot=native().snapshot;
    class CountingCompiler extends ArtifactCompiler {
        calls=0;
        override async compile(input:ActiveStyleSnapshot) {this.calls++;return super.compile(input);}
    }
    const producer=new CountingCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:launcher});
    const cacheRoot=path.join(directory,"cache");const cache=new ArtifactCache(cacheRoot,producer);
    const results=await Promise.all([cache.getOrCompile(snapshot),cache.getOrCompile(snapshot)]);
    assert.equal(producer.calls,1);assert.deepEqual(results[0],results[1]);
    await cache.getOrCompile(snapshot);assert.equal(producer.calls,1);
    await new ArtifactCache(cacheRoot,producer).getOrCompile(snapshot);assert.equal(producer.calls,1);
    const key=producer.key(snapshot);
    for(const changed of [
        {...snapshot,styleId:78},
        {...snapshot,layers:snapshot.layers.map(layer=>({...layer,compiledTime:2}))},
        {...snapshot,layers:snapshot.layers.map(layer=>layer.id===103?{...layer,ownerId:11}:layer)},
        {...snapshot,layers:snapshot.layers.map(layer=>layer.id===103?{...layer,activeCompiledBytes:Buffer.concat([Buffer.from(layer.activeCompiledBytes),Buffer.from("# change")])}:layer)},
        {...snapshot,layers:snapshot.layers.map(layer=>layer.id===103?{...layer,parentId:101}:layer)},
    ])assert.notEqual(producer.key(changed),key);
    const artifact=path.join(cacheRoot,key+".json");
    const original=readFileSync(artifact,"utf8");const tampered=JSON.parse(original);
    const payload=JSON.parse(tampered.payload);payload.layers[0].code="process.exit(0)";
    tampered.payload=JSON.stringify(payload);writeFileSync(artifact,JSON.stringify(tampered));
    await assert.rejects(cache.getOrCompile(snapshot),CompilerFailure);
    writeFileSync(artifact,original);
    assert.equal((await cache.getOrCompile(snapshot)).kind,"compiled");
    assert.equal(readdirSync(cacheRoot).filter(name=>name.startsWith(".pending")).length,0);
    const alternate=path.join(directory,"alternate-launcher");
    writeFileSync(alternate,Buffer.concat([readFileSync(launcher),Buffer.from("compiler-version-change")]),{mode:0o700});
    assert.notEqual(compiler(alternate).key(snapshot),key);
    const bad=path.join(directory,"symlink-cache");symlinkSync(cacheRoot,bad);
    assert.throws(()=>new ArtifactCache(bad,producer),CompilerFailure);
}));

test("compiler isolation denies private reads, writes, sockets, children and inherited descriptors",()=>fixture(async(directory,launcher)=> {
    const secret=path.join(directory,"private-config");writeFileSync(secret,"NEVER RELEASE");
    const probe=path.join(directory,"probe.pl");
    const target=path.join(directory,"unexpected-output");
    writeFileSync(probe,`use strict;use warnings;\n`+
        `open(my $s,'<','${secret}') and die 'private read';\n`+
        `open(my $w,'>','${target}') and die 'write';\n`+
        `socket(my $n,2,1,0) and die 'network';\n`+
        `defined(fork()) and die 'child';\n`+
        `open(my $fd,'<&=3') and die 'inherited fd';print "denied\\n";\n`);
    const fd=openSync(secret,"r");
    try{
        const denied=spawnSync(launcher,["/usr/bin/perl",probe,path.join(root,"S2"),path.join(root,"S2.pm")],
            {env,stdio:["pipe","pipe","pipe",fd]});
        assert.equal(denied.status,0,denied.stderr?.toString());assert.equal(denied.stdout?.toString(),"denied\n");
        const control=spawnSync("/usr/bin/perl",[probe],{env,stdio:["pipe","pipe","pipe",fd]});
        assert.notEqual(control.status,0);assert.match(control.stderr!.toString(),/private read/);
    }finally{closeSync(fd);}
}));

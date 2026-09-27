// program-coordinator.test.ts
//
// Actual compiler/recovery, private transfer and queued-cache qualification.
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
import {createHash} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,cpSync,mkdirSync,openSync,closeSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler,CompilerFailure,type ActiveStyleSnapshot} from "../live/render/layer-artifact";
import {ProgramCoordinator,type PreparedProgram} from "../live/render/program-coordinator";
import {admitProgram,instantiateAdmittedProgram} from "../live/render/program";
import {CompilerQueue,CompilerCancelled} from "../live/render/compiler-queue";
import {Context} from "../runtime/s2runtime";
import {NativeOutput} from "../runtime/native-string";
const root=path.resolve("../..");
const tools=path.resolve("tools");
function native(){
    const oracle=JSON.parse(execFileSync("perl",[path.join(root,"tests/js-recovery/native.pl")],{encoding:"utf8",timeout:15000}));
    const snapshot:ActiveStyleSnapshot={styleId:98765,systemUserId:1,layers:oracle.codes.map((bytes:string,index:number)=>({
        id:101+index,ownerId:index?22:1,parentId:index?101:0,type:index?"layout":"core",compiledTime:1,
        sourceBytes:Buffer.from(oracle.sources[index],"base64"),activeCompiledBytes:Buffer.from(bytes,"base64")}))};
    return {oracle,snapshot};
}
async function fixture(run:(directory:string,compiler:ArtifactCompiler,sandbox:string)=>Promise<void>){
    const directory=mkdtempSync(path.join(tmpdir(),"s2-g2b-"));
    try {
        const launcher=path.join(directory,"compiler-isolation");const sandbox=path.join(directory,"sandbox");
        for(const [source,output] of [[path.join(tools,"compiler-isolation.c"),launcher],
            [path.resolve("live/render/sandbox.c"),sandbox]])
            execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
        const compiler=new ArtifactCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:launcher});
        await run(directory,compiler,sandbox);
    }finally{rmSync(directory,{recursive:true,force:true});}
}
function execute(coordinator:ProgramCoordinator,prepared:PreparedProgram){
    const transfer=coordinator.transfer(prepared);
    const admitted=admitProgram(JSON.parse(JSON.stringify(transfer.program)),transfer.admission);
    const output=new NativeOutput();
    const ctx=new Context(instantiateAdmittedProgram(admitted),()=>{throw Error("legacy sink");},undefined,undefined,undefined,500,
        {raw:value=>output.append(value),safe:value=>output.append(value)});
    ctx.runFunction("main()");const frame=output.frame();
    return {base64:Buffer.from(frame.bytes).toString("base64"),utf8:frame.utf8};
}

test("actual sourceA/activeA, sourceB/activeA and missing source share authoritative native bytes",()=>fixture(async(directory,compiler,sandbox)=>{
    const {oracle,snapshot}=native();
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
    const source=await coordinator.prepare(snapshot);
    assert.equal(source.program.route,"source");
    assert.equal(execute(coordinator,source).base64,oracle.outputs[1].base64);
    const saved={...snapshot,layers:snapshot.layers.map((row,index)=>({...row,sourceBytes:index?row.sourceBytes:
        Buffer.from(Buffer.from(row.sourceBytes!).toString().replace('set label = "A"','set label = "B"'))}))};
    const recovery=await coordinator.prepare(saved);
    assert.equal(recovery.program.route,"recovery");
    assert.equal(execute(coordinator,recovery).base64,oracle.outputs[1].base64);
    const absent={...snapshot,layers:snapshot.layers.map(row=>({...row,sourceBytes:null}))};
    const missing=await coordinator.prepare(absent);
    assert.equal(missing.program.route,"recovery");
    assert.equal(execute(coordinator,missing).base64,oracle.outputs[1].base64);
    const metadata={...absent,layers:absent.layers.map((row,index)=>index?row:{...row,parentId:777,type:"theme" as const})};
    const changed=await coordinator.prepare(metadata);
    assert.equal(changed.program.layers[0]!.type,"theme");
    assert.equal(execute(coordinator,changed).base64,oracle.outputs[1].base64);
    const empty=await coordinator.prepare({...snapshot,layers:[]});
    assert.deepEqual(empty.program.layers,[]);
    assert.deepEqual(instantiateAdmittedProgram(admitProgram(empty.program,coordinator.transfer(empty).admission)),[]);
    assert.throws(()=>coordinator.transfer({...source}),CompilerFailure);
    const transfer=coordinator.transfer(source),forged=JSON.parse(JSON.stringify(transfer.program));
    forged.layers[0].code="throw Error('forged')";
    forged.layers[0].codeSha256=createHash("sha256").update(forged.layers[0].code).digest("hex");
    assert.throws(()=>admitProgram(forged,transfer.admission),/Invalid private/);
    const admitted=admitProgram(transfer.program,transfer.admission);
    assert.throws(()=>instantiateAdmittedProgram({...admitted}),/Invalid private/);
    assert.throws(()=>coordinator.transfer({program:forged} as PreparedProgram),CompilerFailure);
    const file=path.join(directory,"cache",coordinator.key(snapshot)+".json");
    writeFileSync(file,"corrupt",{mode:0o600});
    const regenerated=await coordinator.prepare(snapshot);
    assert.equal(execute(coordinator,regenerated).base64,oracle.outputs[1].base64);
    assert.equal(readdirSync(path.join(directory,"cache")).some(name=>name.startsWith(".pending")),false);
}));

test("two compiler slots queue ordinary third jobs, coalesce shared waiters and cancel without cache publication",()=>fixture(async(directory,compiler,sandbox)=>{
    const {snapshot}=native();
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
    const result=await Promise.all([coordinator.prepare(snapshot),coordinator.prepare(snapshot),
        coordinator.prepare({...snapshot,styleId:98766}),coordinator.prepare({...snapshot,styleId:98767})]);
    assert.equal(result.length,4);
    assert.equal(result[0]!.program,result[1]!.program);
    assert.equal(readdirSync(path.join(directory,"cache")).filter(name=>name.endsWith(".json")).length,3);
    const control=new AbortController();
    const cancelled={...snapshot,styleId:123456};
    const promise=coordinator.prepare(cancelled,{signal:control.signal});
    control.abort();await assert.rejects(promise);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(readdirSync(path.join(directory,"cache")).includes(coordinator.key(cancelled)+".json"),false);
    const shared={...snapshot,styleId:123457},one=new AbortController();
    const cancelledWaiter=coordinator.prepare(shared,{signal:one.signal});
    const surviving=coordinator.prepare(shared);one.abort();
    await assert.rejects(cancelledWaiter,CompilerCancelled);assert.equal((await surviving).program.route,"source");
    await assert.rejects(coordinator.prepare({...snapshot,styleId:123458},{deadline:Date.now()-1}),CompilerCancelled);
}));

test("queue holds slots until completion and does not execute cancelled queued work",async()=>{
    const queue=new CompilerQueue(2,1000);const releases:(()=>void)[]=[];let active=0,max=0,started=0;
    const task=(signal:AbortSignal)=>new Promise<number>((resolve,reject)=>{
        started++;max=Math.max(max,++active);
        const finish=()=>{active--;resolve(started);};releases.push(finish);
        signal.addEventListener("abort",()=>{active--;reject(new CompilerCancelled());},{once:true});
    });
    const first=queue.run(task),second=queue.run(task),control=new AbortController();
    const third=queue.run(task,{signal:control.signal});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(started,2);control.abort();
    await assert.rejects(third,CompilerCancelled);releases.splice(0).forEach(release=>release());
    await Promise.all([first,second]);assert.equal(max,2);assert.equal(started,2);
});


test("recovery launcher denies network, private files, writes, subprocesses and inherited descriptors",()=>fixture(async(directory,_compiler,sandbox)=>{
    const probe=path.join(directory,"probe.cjs"),secret=path.join(directory,"private");
    writeFileSync(secret,"private-only");
    writeFileSync(probe,`const fs=require("node:fs");const result={};
const deny=(name,operation)=>{try{operation();result[name]=false}catch{result[name]=true}};
deny("file",()=>fs.readFileSync(process.argv[2]));deny("write",()=>fs.writeFileSync(process.argv[2]+".out","x"));
deny("spawn",()=>require("node:child_process").spawnSync("/bin/true"));
deny("fd",()=>fs.readFileSync(3));result.environment=Object.keys(process.env).sort();
const socket=require("node:net").connect(9,"127.0.0.1");socket.on("error",error=>{result.network=error.code==="EPERM";console.log(JSON.stringify(result))});`);
    const fd=openSync(secret,"r");
    try {
        const result=spawnSync("/usr/bin/prlimit",["--cpu=60","--",sandbox,process.execPath,"--permission","--no-addons",
            "--disable-proto=throw","--max-old-space-size=512","--allow-fs-read="+probe,probe,secret],
            {cwd:"/",env:{LANG:"C",TZ:"UTC"},stdio:["pipe","pipe","pipe",fd],encoding:"utf8",timeout:10000});
        assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{
            file:true,write:true,spawn:true,fd:true,environment:["LANG","TZ"],network:true});
    } finally {closeSync(fd);}
}));

test("actual installed recovery and scalar-profile producer changes invalidate authenticated caches",()=>fixture(async(directory,compiler,sandbox)=>{
    const {snapshot}=native();
    // Copy only the coordinator's relative JS graph. No old artifacts/cache,
    // node_modules, secrets or repository tree enter this test installation.
    const installation=path.join(directory,"installation"),original=path.resolve("dist");
    const copied=new Set<string>();
    function copy(file:string):void {
        if(copied.has(file))return;copied.add(file);
        const bytes=readFileSync(file,"utf8"),target=path.join(installation,"dist",path.relative(original,file));
        mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);
        for(const match of bytes.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
            let dependency=path.resolve(path.dirname(file),match[1]!);
            if(!dependency.endsWith(".js"))dependency+=".js";copy(dependency);
        }
    }
    copy(path.resolve("dist/live/render/program-coordinator.js"));
    for(const name of ["ast","lexer","parser","execute","index"])copy(path.resolve("dist/live/render/recovery",name+".js"));
    copy(path.resolve("dist/live/render/recover-job.js"));
    writeFileSync(path.join(installation,"package.json"),readFileSync("package.json"));
    const Installed=require(path.join(installation,"dist/live/render/program-coordinator.js")).ProgramCoordinator as typeof ProgramCoordinator;
    const first=new Installed(compiler,path.join(directory,"cache"),{sandbox});
    const key=first.key(snapshot);await first.prepare(snapshot);
    const adapter=path.join(installation,"dist/live/render/recovery/execute.js");
    writeFileSync(adapter,readFileSync(adapter,"utf8")+"\n// Harmless installed adapter revision.\n");
    assert.throws(()=>first.key(snapshot),/S2 compiler unavailable/);
    const revised=new Installed(compiler,path.join(directory,"cache"),{sandbox});
    assert.notEqual(revised.key(snapshot),key);await revised.prepare(snapshot);
    // A genuinely re-extracted producer profile binds a different compiler key.
    const s2Root=path.join(directory,"s2"),js=path.join(s2Root,"target/javascript");
    mkdirSync(path.join(js,"tools"),{recursive:true});mkdirSync(path.join(js,"runtime"));mkdirSync(path.join(js,"dist/runtime"),{recursive:true});
    cpSync(path.join(root,"S2"),path.join(s2Root,"S2"),{recursive:true});cpSync(path.join(root,"S2.pm"),path.join(s2Root,"S2.pm"));
    cpSync(path.join(tools,"compile-active.pl"),path.join(js,"tools/compile-active.pl"));
    for(const name of ["s2runtime","native-string","native-number","native-scalar","native-profile"]){
        cpSync(path.resolve("runtime",name+".ts"),path.join(js,"runtime",name+".ts"));
        cpSync(path.resolve("dist/runtime",name+".js"),path.join(js,"dist/runtime",name+".js"));
    }
    const extraction=path.join(js,"tools/compile-active.pl");
    const before=new ArtifactCompiler({s2Root,perl:"/usr/bin/perl",isolationExecutable:path.join(directory,"compiler-isolation")});
    const code=readFileSync(extraction,"utf8");
    assert.match(code,/unicodeVersion/);
    writeFileSync(extraction,code.replace("Unicode::UCD::UnicodeVersion()",'"qualified-profile-test"'));
    // Source extractor bytes are identity even if the resulting tables agree.
    writeFileSync(extraction,readFileSync(extraction,"utf8")+"\n# Trusted extraction revision.\n");
    const after=new ArtifactCompiler({s2Root,perl:"/usr/bin/perl",isolationExecutable:path.join(directory,"compiler-isolation")});
    assert.notEqual(before.scalarProfile.unicodeVersion,after.scalarProfile.unicodeVersion);
    assert.notEqual(before.digest,after.digest);assert.throws(()=>before.key(snapshot),CompilerFailure);
    // Trusted test-only installed job consumes CPU without executing input code.
    const job=path.join(installation,"dist/live/render/recover-job.js");
    writeFileSync(job,"require('node:fs').readFileSync(0);while(true){}\n");
    const busy=new Installed(compiler,path.join(directory,"busy-cache"),{sandbox});
    const missing={...snapshot,layers:snapshot.layers.map(row=>({...row,sourceBytes:null}))};
    async function runningPid():Promise<number>{
        for(let attempt=0;attempt<100;attempt++){
            const children=readFileSync(`/proc/${process.pid}/task/${process.pid}/children`,"utf8").trim().split(/\s+/).filter(Boolean);
            for(const child of children){try{
                const command=readFileSync(`/proc/${child}/cmdline`,"utf8");
                if(command.includes(job)&&require("node:fs").readlinkSync(`/proc/${child}/exe`)===process.execPath)return Number(child);
            }catch{}}
            await new Promise(resolve=>setTimeout(resolve,10));
        }throw Error("recovery Node PID not observed");
    }
    for(const deadline of [false,true]){
        const control=new AbortController();
        const pending=busy.prepare({...missing,styleId:deadline?55502:55501},deadline?
            {deadline:Date.now()+500}:{signal:control.signal});
        const pid=await runningPid();
        assert.equal(readFileSync(`/proc/${pid}/task/${pid}/children`,"utf8").trim(),"");
        if(!deadline)control.abort();
        await assert.rejects(pending,/S2 compiler job cancelled/);
        for(let attempt=0;attempt<100;attempt++){
            try{process.kill(pid,0)}catch{break}
            await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.throws(()=>process.kill(pid,0));
        assert.equal(readdirSync(path.join(directory,"busy-cache")).filter(name=>name.endsWith(".json")).length,0);
    }
}));


test("source and recovered layer metadata preserve native unflagged UTF8 byte views",()=>fixture(async(directory,compiler,sandbox)=>{
    const nativeRoot=path.join(root,"tests/js-recovery"),oracleFile=path.join(directory,"native.pl");
    for(const name of ["program.s2","override.s2"])cpSync(path.join(nativeRoot,name),path.join(directory,name));
    writeFileSync(path.join(directory,"override.s2"),readFileSync(path.join(directory,"override.s2"))+ '\nlayerinfo name = "猫é";\n');
    let script=readFileSync(path.join(nativeRoot,"native.pl"),"utf8");
    script=script.replace('use lib "$FindBin::Bin/../..";',"use lib "+JSON.stringify(root)+";");
    script=script.replace("codesUtf8=>", "metadata=>encode_base64(octets(S2::get_layer_info(102,'name')),''), codesUtf8=>");
    writeFileSync(oracleFile,script);
    const oracle=JSON.parse(execFileSync("perl",[oracleFile],{encoding:"utf8",timeout:15000}));
    const snapshot:ActiveStyleSnapshot={styleId:13579,systemUserId:1,layers:oracle.codes.map((bytes:string,index:number)=>({
        id:101+index,ownerId:index?22:1,parentId:index?101:0,type:index?"layout":"core",compiledTime:1,
        sourceBytes:Buffer.from(oracle.sources[index],"base64"),activeCompiledBytes:Buffer.from(bytes,"base64")}))};
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
    for(const source of [true,false]){
        const prepared=await coordinator.prepare({...snapshot,layers:snapshot.layers.map(row=>({...row,sourceBytes:source?row.sourceBytes:null}))});
        assert.equal(prepared.program.route,source?"source":"recovery");
        const transfer=coordinator.transfer(prepared);
        const layers=instantiateAdmittedProgram(admitProgram(transfer.program,transfer.admission));
        assert.equal(Buffer.from(layers[1]!.info.name!,"latin1").toString("base64"),oracle.metadata);
        assert.equal(execute(coordinator,prepared).base64,oracle.outputs[1].base64);
    }
}));


test("pure private admission closure cannot import compiler, filesystem, process or credential machinery",()=>{
    const seen=new Set<string>();
    function inspect(file:string):void {
        if(seen.has(file))return;seen.add(file);
        const code=readFileSync(file,"utf8");
        for(const match of code.matchAll(/require\(["']([^"']+)["']\)/g)){
            const dependency=match[1]!;
            if(dependency.startsWith(".")){
                assert.doesNotMatch(dependency,/layer-artifact|coordinator|artifact-cache|recovery/);
                inspect(path.resolve(path.dirname(file),dependency+".js"));
            }else assert.equal(dependency,"node:crypto");
        }
        assert.doesNotMatch(code,/process\.env|child_process|node:fs|\.spawn\(/);
    }
    inspect(path.resolve("dist/live/render/program.js"));assert.ok(seen.size>=6);
});

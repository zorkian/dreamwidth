// program-coordinator.test.ts
//
// Source compilation, private transfer and authenticated cache qualification.
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
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync,readdirSync,readFileSync,renameSync,statSync,utimesSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler,CompilerFailure,type ActiveStyleSnapshot} from "../live/render/layer-artifact";
import {ProgramCoordinator,type PreparedProgram} from "../live/render/program-coordinator";
import {admitProgram,instantiateAdmittedProgram} from "../live/render/program";
import {pinInstalled,checkInstalled} from "../live/render/installed-files";
import {CompilerCancelled} from "../live/render/compiler-queue";
import {Context} from "../runtime/s2runtime";
import {NativeOutput} from "../runtime/native-string";

const root=path.resolve("../..");
const tools=path.resolve("tools");
function sourceFixture():{snapshot:ActiveStyleSnapshot;output:string} {
    const oracle=JSON.parse(execFileSync("perl",[path.join(root,"tests/js-recovery/native.pl")],
        {encoding:"utf8",timeout:15000}));
    return {snapshot:{styleId:98765,systemUserId:1,layers:oracle.sources.map((base64:string,index:number)=>({
        id:101+index,ownerId:index?22:1,parentId:index?101:0,type:index?"layout":"core",
        sourceBytes:Buffer.from(base64,"base64")}))},output:oracle.outputs[1].base64};
}
async function fixture(run:(directory:string,compiler:ArtifactCompiler)=>Promise<void>):Promise<void> {
    const directory=mkdtempSync(path.join(tmpdir(),"s2-source-cache-"));
    try {
        const launcher=path.join(directory,"compiler-isolation");
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",
            path.join(tools,"compiler-isolation.c"),"-o",launcher]);
        const compiler=new ArtifactCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:launcher});
        await run(directory,compiler);
    }finally{rmSync(directory,{recursive:true,force:true});}
}
function execute(coordinator:ProgramCoordinator,prepared:PreparedProgram):string {
    const transfer=coordinator.transfer(prepared);
    const admitted=admitProgram(JSON.parse(JSON.stringify(transfer.program)),transfer.admission);
    const output=new NativeOutput();
    const ctx=new Context(instantiateAdmittedProgram(admitted),()=>{throw Error("Legacy sink used");},
        undefined,undefined,undefined,500,{raw:value=>output.append(value),safe:value=>output.append(value)});
    ctx.runFunction("main()");return output.bytes().toString("base64");
}

test("latest selected source executes; edits invalidate cache and absent source fails",()=>fixture(async(directory,compiler)=>{
    const {snapshot,output}=sourceFixture();
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    const first=await coordinator.prepare(snapshot);
    assert.equal(execute(coordinator,first),output);
    const edited={...snapshot,layers:snapshot.layers.map((row,index)=>index?{...row,
        sourceBytes:Buffer.from(Buffer.from(row.sourceBytes!).toString().replace(
            'set label = "custom"','set label = "changed"'))}:row)};
    assert.notEqual(coordinator.key(snapshot),coordinator.key(edited));
    const current=await coordinator.prepare(edited);
    assert.notEqual(execute(coordinator,current),output);
    assert.notEqual(current.program.layers[1]!.sourceSha256,first.program.layers[1]!.sourceSha256);
    const absent={...snapshot,layers:snapshot.layers.map(row=>({...row,sourceBytes:null}))};
    await assert.rejects(coordinator.prepare(absent),CompilerFailure);
    assert.equal(readdirSync(path.join(directory,"cache")).filter(name=>name.endsWith(".json")).length,2);
}));

test("private transfer and authenticated cache reject forged code",()=>fixture(async(directory,compiler)=>{
    const {snapshot,output}=sourceFixture();
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    const prepared=await coordinator.prepare(snapshot);
    assert.throws(()=>coordinator.transfer({...prepared}),CompilerFailure);
    const transfer=coordinator.transfer(prepared),forged=JSON.parse(JSON.stringify(transfer.program));
    forged.layers[0].code="throw Error('forged')";
    assert.throws(()=>admitProgram(forged,transfer.admission),/Invalid private/);
    const admitted=admitProgram(transfer.program,transfer.admission);
    assert.throws(()=>instantiateAdmittedProgram({...admitted}),/Invalid private/);
    assert.throws(()=>coordinator.transfer({program:forged} as PreparedProgram),CompilerFailure);
    const file=path.join(directory,"cache",coordinator.key(snapshot)+".json");
    writeFileSync(file,"corrupt",{mode:0o600});
    assert.equal(execute(coordinator,await coordinator.prepare(snapshot)),output);
    assert.equal(readdirSync(path.join(directory,"cache")).some(name=>name.startsWith(".pending")),false);
}));

test("two compiler slots coalesce shared waiters and cancellation publishes no artifact",()=>fixture(async(directory,compiler)=>{
    const {snapshot}=sourceFixture();
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    const result=await Promise.all([coordinator.prepare(snapshot),coordinator.prepare(snapshot),
        coordinator.prepare({...snapshot,styleId:98766})]);
    assert.equal(result[0]!.program,result[1]!.program);
    assert.equal(readdirSync(path.join(directory,"cache")).filter(name=>name.endsWith(".json")).length,2);
    const control=new AbortController(),cancelled={...snapshot,styleId:123456};
    const pending=coordinator.prepare(cancelled,{signal:control.signal});control.abort();
    await assert.rejects(pending,CompilerCancelled);
    assert.equal(readdirSync(path.join(directory,"cache")).includes(coordinator.key(cancelled)+".json"),false);
    await assert.rejects(coordinator.prepare({...snapshot,styleId:123458},
        {deadline:Date.now()-1}),CompilerCancelled);
}));

test("installed producer identity detects same-size edits and inode replacement",()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"s2-installed-")),file=path.join(directory,"producer");
    try {
        writeFileSync(file,"original");const pin=pinInstalled(file),before=statSync(file);
        checkInstalled([pin]);checkInstalled([pin],true);
        writeFileSync(file,"mutated!");utimesSync(file,before.atime,before.mtime);
        assert.throws(()=>checkInstalled([pin]),/changed/);
        writeFileSync(file,"original");const same=pinInstalled(file),replacement=path.join(directory,"replacement");
        writeFileSync(replacement,"original");renameSync(replacement,file);
        assert.throws(()=>checkInstalled([same]),/changed/);
        checkInstalled([pinInstalled(file)],true);
    }finally{rmSync(directory,{recursive:true,force:true});}
});

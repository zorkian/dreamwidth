// general-model-worker.test.ts
//
// Actual sandboxed custom Recent/Entry execution with installed public models.
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
import {request as httpRequest} from "node:http";
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler,type ActiveStyleSnapshot} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralRenderer} from "../live/render/general-child";
import {verifyGeneralRuntime} from "../live/render/manifest";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import {GeneralMlRequestContext} from "../live/domain/public-translation";
import {GeneralUserAuthority} from "../live/domain/general-user-authority";
import {parentLoadUser} from "../live/render/general-user-host";
import {encodeGeneralModel} from "../live/render/general-model-wire";
import {NativeString} from "../runtime/native-string";
import type {PublicUserFacts} from "../live/data/public-users";
import {config} from "../live/tests/fixtures";
import {withSelectedFixture} from "./selected-fixture";
import {MysqlActivePrograms} from "../live/data/active-program";
import {MysqlPublicUsers} from "../live/data/public-users";
import {GeneralRequestPipeline} from "../live/render/general-request";
import {generalSelectedProjection} from "../live/render/general-selected-projector";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";

import {nativePageResponse} from "../live/render/general-response";
import {createLiveApp} from "../live/server/app";

test("closed real worker preserves native models and private UserLite across initialization/resume",async()=>{
    const native=JSON.parse(execFileSync("perl",["../../tests/js-recovery/general-model-native.pl"],
        {encoding:"utf8",timeout:15000}));
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-model-worker-"));
    const sandbox=path.join(directory,"sandbox"),isolation=path.join(directory,"compiler-isolation");
    for(const [source,output] of [["live/render/sandbox.c",sandbox],["tools/compiler-isolation.c",isolation]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:path.resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:isolation});
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    const compiled=path.join(directory,"compiled");cpSync(path.resolve("dist"),compiled,{recursive:true});
    // Fixed driver is transplanted to the installation entry for this test only.
    // The stager follows its exact imports; no test tools or parent SQL enter the closure.
    const driver=readFileSync(path.join(compiled,"tools/general-model-worker-child.js"),"utf8")
        .replaceAll('require("../live/render/','require("./')
        .replaceAll('require("../live/domain/','require("../domain/')
        .replaceAll('require("../runtime/','require("../../runtime/');
    mkdirSync(path.join(compiled,"live/render"),{recursive:true});
    writeFileSync(path.join(compiled,"live/render/general-worker.js"),driver);
    const descriptor=path.join(directory,"installation.json");
    writeFileSync(descriptor,JSON.stringify({schema:1,kind:"general-s2-worker",entry:"app/dist/live/render/general-worker.js"}));
    execFileSync(process.execPath,["--input-type=module","-e",
        "import {stageGeneralRuntime} from '../../../content/tools/stage-runtime.mjs';stageGeneralRuntime(process.argv[1],{s2Dist:process.argv[2]});",
        descriptor,compiled],{timeout:120000});
    const runtime=verifyGeneralRuntime(descriptor);
    const renderer=new GeneralRenderer(sandbox,runtime,{maxOutputBytes:1048576,maxHeapMiB:128,timeoutMs:10000});
    const user:PublicUserFacts={userid:111,username:"public_name",clusterid:0,status:"V",statusvis:"X",journaltype:"P",
        dversion:1,caps:"0",name:NativeString.hostUtf8Bytes("Public"),identity:null};
    const snapshot:ActiveStyleSnapshot={styleId:1,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,type:"core",
        sourceBytes:Buffer.from(native.source,"base64")}]};
    try {
            const prepared=await coordinator.prepare(snapshot);
            for(const kind of ["recent","entry"] as const) {
                const events:string[]=[];
                const publicSession=new GeneralPublicSession({async snapshot(name){events.push("user:"+name);return {requestedName:name,user,fingerprint:"fixed"};},
                    async revalidate(){events.push("revalidate-user");return true;}},
                    {async snapshot():Promise<never>{throw Error("No translation in fixed model fixture");},async revalidate(){return true;}},
                    compiler.scalarProfile,25);
                const authority=new GeneralUserAuthority(publicSession,{displayName:()=>NativeString.hostUtf8Bytes("Public & Name"),
                    journalBase:()=>NativeString.hostUtf8Bytes("https://public.example.invalid/base"),tellFriend:false});
                const frame=await renderer.render("a".repeat(64),{
                    start:{version:1,transfer:coordinator.transfer(prepared),config,kind},
                    async host(operation,parameters,phase){assert.equal(operation,"user-lite");events.push("host:"+phase);
                        return parentLoadUser(parameters,authority);},
                    async select(count){events.push("select");assert.equal(count,3);return {kind,page:encodeGeneralModel({
                        title:NativeString.hostUtf8Bytes("selected"),username:NativeString.hostUtf8Bytes("public_name")})};},
                });
                assert.deepEqual({base64:Buffer.from(frame.bytes).toString("base64"),utf8:frame.utf8},native.outputs[kind]);
                assert.deepEqual(events.slice(0,3),["host:initialize","user:public_name","select"]);
                assert.ok(events.includes("host:render"));
                assert.equal(await publicSession.finish(async()=>{events.push("final-authority");return true;}),true);
                assert.equal(events.at(-1),"final-authority");
                // Real HTTP serialization of the actual worker result; fixed provider
                // data is explicit and is not ordinary main/SQL acceptance.
                const serve=async(request:{method:"GET"|"HEAD"})=>({ok:true as const,...nativePageResponse(frame,request.method),setCookie:null});
                const app=createLiveApp(config,{serve,serveEntry:serve,async close(){}});
                try {
                    const url=kind==="recent"?"/users/public_name/":"/users/public_name/257.html";
                    for(const method of ["GET","HEAD"] as const) {
                        const response=await app.inject({method,url,headers:{host:"localhost:8081"}});
                        assert.equal(response.statusCode,200);
                        assert.equal(response.rawPayload.toString("base64"),method==="HEAD"?"":native.outputs[kind].base64);
                    }
                }finally{await app.close();}
            }
        if(process.env.S2_SELECTED_FIXTURE==="1") await withSelectedFixture(async({admin,store,g,c,table,request,startup})=>{
            const [systems]=await admin.query(`SELECT userid FROM ${table(g,"user")} WHERE user='system'`);
            const systemId=(systems as {userid:number}[])[0]!.userid;
            await admin.query(`INSERT INTO ${table(g,"user")} (userid,user,clusterid,status,statusvis,journaltype,name,dversion,caps)
                VALUES (111,'public_name',0,'V','X','P','Public',10,0)`);
            await admin.query(`INSERT INTO ${table(g,"useridmap")} (userid,user) VALUES (111,'public_name')`);
            await admin.query(`DELETE FROM ${table(c,"s2stylelayers2")} WHERE userid=900001 AND styleid=44`);
            await admin.query(`INSERT INTO ${table(g,"s2layers")} (s2lid,userid,b2lid,type) VALUES (101,?,0,'core')`,[systemId]);
            await admin.query(`INSERT INTO ${table(g,"s2source_inno")} (s2lid,s2code) VALUES (101,?)`,[Buffer.from(native.source,"base64")]);
            await admin.query(`INSERT INTO ${table(g,"s2compiled")} (s2lid,comptime,compdata) VALUES (101,1,?)`,
                [Buffer.from(native.code,"base64")]);
            await admin.query(`INSERT INTO ${table(c,"s2stylelayers2")} (userid,styleid,type,s2lid) VALUES (900001,44,'core',101)`);
            await admin.query(`INSERT INTO ${table(g,"s2layers")} (s2lid,userid,b2lid,type) VALUES (102,?,101,'layout')`,[systemId]);
            await admin.query(`INSERT INTO ${table(g,"s2source_inno")} (s2lid,s2code) VALUES (102,?)`,[Buffer.from(native.layoutSource,"base64")]);
            await admin.query(`INSERT INTO ${table(g,"s2compiled")} (s2lid,comptime,compdata) VALUES (102,1,?)`,
                [Buffer.from(native.layoutCode,"base64")]);
            await admin.query(`INSERT INTO ${table(c,"s2stylelayers2")} (userid,styleid,type,s2lid) VALUES (900001,44,'layout',102)`);
            await admin.query(`UPDATE ${table(c,"logtext2")} SET subject='selected' WHERE journalid=900001`);
            const programs=new MysqlActivePrograms(startup),users=new MysqlPublicUsers(startup.database);
            let mutateUser=false,selectedReads=0;
            const pipeline=new GeneralRequestPipeline({...{
                loadNativeJournalAuthority:store.loadNativeJournalAuthority.bind(store),
                revalidateNativeJournalAuthority:store.revalidateNativeJournalAuthority.bind(store),
                revalidateNativeSelectedFingerprint:store.revalidateNativeSelectedFingerprint.bind(store),
                async loadNativeSelectedSnapshot(bound:Parameters<typeof store.loadNativeSelectedSnapshot>[0]){
                    selectedReads++;return store.loadNativeSelectedSnapshot(bound);
                },
            }},programs,coordinator,renderer,config,{
                helpers(){
                    const session=new GeneralPublicSession(users,{async snapshot():Promise<never>{throw Error("No fixed model translation");},
                        async revalidate(){return true;}},compiler.scalarProfile,25,undefined,
                        new GeneralMlRequestContext(NativeString.hostUtf8Bytes("en"),NativeString.hostUtf8Bytes("en"),undefined));
                    const authority=new GeneralUserAuthority(session,{displayName:()=>NativeString.hostUtf8Bytes("Public & Name"),
                        journalBase:()=>NativeString.hostUtf8Bytes("https://public.example.invalid/base"),tellFriend:false});
                    return {session,bindSelectedCommentPosters:page=>authority.bindSelectedCommentPosters(page),
                        async host(operation,parameters,phase){
                        assert.equal(operation,"user-lite");const result=await parentLoadUser(parameters,authority);
                        if(mutateUser&&phase==="render"){
                            mutateUser=false;await admin.query(`UPDATE ${table(g,"user")} SET name='Changed' WHERE userid=111`);
                        }
                        return result;
                    }};
                },
                async project(selected,helpers){
                    return generalSelectedProjection(selected,helpers,{
                        commentSettings:startup.commentSettings,capabilities:startup.capabilities},{
                        encoding:()=>({async item(){throw Error("Unexpected charset conversion");}} as
                            unknown as GeneralTextEncoding),
                        navigation:()=>({permalink:NativeString.hostUtf8Bytes("/257.html"),styleArgument:undefined}),
                        page(facts,prepared){
                            const entry=facts.entries[0];assert.ok(entry);
                            const title=prepared.entry(entry).subject;assert.ok(title);
                            return {title,username:NativeString.hostUtf8Bytes("public_name")};
                        },
                    });
                },
            });
            const serve=async(input:{method:"GET"|"HEAD";username:string;skip:number})=>{
                const raw=request(input.username,{kind:"recent",skip:input.skip,itemshow:20});
                return pipeline.render(raw,{username:input.username,view:"recent",selection:"journal"},input.method);
            };
            const serveEntry=async(input:{method:"GET"|"HEAD";username:string;ditemid:number})=>
                pipeline.render(request(input.username,{kind:"entry",ditemid:input.ditemid}),
                    {username:input.username,view:"entry",selection:"journal"},input.method);
            const app=createLiveApp(config,{serve,serveEntry,async close(){}});
            try {
                const address=await app.listen({host:"127.0.0.1",port:0});
                for(const missing of [false,true]) {
                    if(missing)await admin.query(`DELETE FROM ${table(g,"s2source_inno")} WHERE s2lid=101`);
                    for(const [kind,url] of [["recent","/users/ordinary6/"],["entry","/users/ordinary6/257.html"]] as const) {
                        for(const method of ["GET","HEAD"] as const) {
                            const response=await app.inject({method,url,headers:{host:"localhost:8081"}});
                            assert.equal(response.statusCode,200);
                            assert.equal(response.rawPayload.toString("base64"),method==="HEAD"?"":native.outputs[kind].base64);
                        }
                    }
                }
                // Node fetch controls Host itself; the native HTTP client sends
                // the exact admitted authority without changing listener config.
                const tcp=(target:string,method:"GET"|"HEAD")=>new Promise<{status:number;body:Buffer;length:string|undefined}>((resolve,reject)=>{
                    const call=httpRequest(address+target,{method,headers:{host:"localhost:8081"}},response=>{
                        const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(Buffer.from(chunk)));
                        response.once("end",()=>resolve({status:response.statusCode!,body:Buffer.concat(chunks),
                            length:response.headers["content-length"]}));response.once("error",reject);
                    });call.once("error",reject);call.end();
                });
                // Actual owning-container TCP routes on the same service/app,
                // not only Fastify injection. No ordinary main claim.
                for(const [kind,url] of [["recent","/users/ordinary6/"],["entry","/users/ordinary6/257.html"]] as const) {
                    const response=await tcp(url,"GET");assert.equal(response.status,200);
                    assert.equal(response.body.toString("base64"),native.outputs[kind].base64);
                    const head=await tcp(url,"HEAD");assert.equal(head.status,200);assert.equal(head.body.length,0);
                    assert.equal(head.length,String(Buffer.from(native.outputs[kind].base64,"base64").length));
                }
                mutateUser=true;
                const changed=await app.inject({method:"GET",url:"/users/ordinary6/257.html",headers:{host:"localhost:8081"}});
                assert.equal(changed.statusCode,409);assert.ok(!changed.rawPayload.includes(Buffer.from("entry:selected")));
                await admin.query(`UPDATE ${table(g,"user")} SET name='Public' WHERE userid=111`);
                const recovered=await app.inject({method:"GET",url:"/users/ordinary6/257.html",headers:{host:"localhost:8081"}});
                assert.equal(recovered.statusCode,200);assert.equal(recovered.rawPayload.toString("base64"),native.outputs.entry.base64);
                await admin.query(`DELETE FROM ${table(c,"logtext2")} WHERE journalid=900001 AND jitemid=301`);
                const hidden=await app.inject({method:"GET",url:"/users/ordinary6/77057.html",headers:{host:"localhost:8081"}});
                assert.equal(hidden.statusCode,404);assert.ok(!hidden.rawPayload.includes(Buffer.from("entry:selected")));
                assert.ok(selectedReads>=10);
            }finally{await app.close();await programs.close();await users.close();}
        },false,true);
    }finally{renderer.close();}
    console.log("Closed model-worker/native evidence retained: "+directory);
});

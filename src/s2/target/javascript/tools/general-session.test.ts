// general-session.test.ts
//
// Actual native initialization and same-context source/recovery resume.
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
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler,type ActiveStyleSnapshot} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralProgramSession} from "../live/render/general-session";
import {decodeScalar,scalarPV,NativeString,NativeNumber,nativeProgramError,raiseNativeExecutionStop} from "../runtime/native-scalar";
import type {NativeOutputOptions} from "../live/render/native-output";
import {initializedRecentCount} from "../live/render/general-selection";
import {config} from "../live/tests/fixtures";

const outputOptions:Omit<NativeOutputOptions,"checkDepth"|"initialization">={
    contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
    stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},
    transformCss:chunk=>chunk,expandEmbed:chunk=>chunk};

test("native init count drives data resume in the same source/recovered Context",async()=>{
    const oracle=JSON.parse(execFileSync("perl",["../../tests/js-recovery/general-session-native.pl"],{encoding:"utf8",timeout:15000}));
    const root=path.resolve("../..");
    const directory=mkdtempSync(path.join(tmpdir(),"s2-general-session-"));
    try {
        const isolation=path.join(directory,"compiler-isolation"),sandbox=path.join(directory,"sandbox");
        for(const [source,output] of [["tools/compiler-isolation.c",isolation],["live/render/sandbox.c",sandbox]])
            execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
        const compiler=new ArtifactCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:isolation});
        const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
        const snapshot:ActiveStyleSnapshot={styleId:1,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,type:"core",compiledTime:1,
            sourceBytes:Buffer.from(oracle.source,"base64"),activeCompiledBytes:Buffer.from(oracle.code,"base64")}]};
        for(const missing of [false,true]) {
            const prepared=await coordinator.prepare({...snapshot,layers:snapshot.layers.map(layer=>({...layer,sourceBytes:missing?null:layer.sourceBytes}))});
            assert.equal(prepared.program.route,missing?"recovery":"source");
            const session=new GeneralProgramSession(coordinator.transfer(prepared),config,{},outputOptions);
            const context=session.context;
            const result=session.initialize({clean(){throw Error("Unexpected nonplain property");}});
            assert.equal(result.kind,"initialized");
            assert.equal(scalarPV(decodeScalar(result.recentCount)).bytes().toString(),String(oracle.count));
            assert.equal(initializedRecentCount(result.recentCount),oracle.count);
            assert.throws(()=>session.initialize({clean(){throw Error("unreachable");}}),/already initialized/);
            const output=session.beginRender();
            const frame=session.completePage({".type":"RecentPage",_title:NativeString.hostUtf8Bytes("resume")},"recent",()=>{
                throw Error("Positive fixture must not request a diagnostic");
            });
            assert.equal(session.context,context);
            assert.equal(Buffer.from(frame.bytes).toString("base64"),oracle.output);
            const byteSession=new GeneralProgramSession(coordinator.transfer(prepared),config,{},outputOptions);
            byteSession.initialize({clean(){throw Error("Unexpected nonplain property");}});
            byteSession.beginRender();
            const raw=byteSession.completePage({".type":"RecentPage",_title:NativeString.bytes(Buffer.from([255,0,97]))},
                "recent",()=>{throw Error("Byte fixture must not need diagnostic");});
            assert.equal(Buffer.from(raw.bytes).toString("base64"),oracle.bytesOutput);

            let cssSession:GeneralProgramSession;
            cssSession=new GeneralProgramSession(coordinator.transfer(prepared),config,{
                _start_css:()=>cssSession.startCss(),_end_css:()=>cssSession.endCss(),
            },outputOptions);
            cssSession.context.prop._init_css=NativeNumber.integer(1n);
            assert.equal(cssSession.initialize({clean(){throw Error("Unexpected CSS fixture property clean");}}).kind,"initialized");
            cssSession.beginRender();
            const css=cssSession.completePage({".type":"RecentPage",_title:NativeString.hostUtf8Bytes("unused")},"recent",
                ()=>{throw Error("Native init CSS fixture must not need a diagnostic");});
            assert.equal(Buffer.from(css.bytes).toString("base64"),oracle.cssOutput);
            assert.equal(Buffer.from(css.bytes).toString(),"DIRECT");

            assert.throws(()=>output.finish(),/terminal/);
            // The neutral helper set effect is a native scalar, not JS Error
            // truthiness. These are installed-adapter unit controls.
            for(const message of ["","0","helper failure"]) {
                const control=new GeneralProgramSession(coordinator.transfer(prepared),config,{},outputOptions);
                control.layers[0]!.registerProperty("_rich","string",{string_mode:"html"});
                control.context.prop._rich=NativeString.hostUtf8Bytes("rich");
                const result=control.initialize({clean(_mode,value){
                    control.setInitializationException(NativeString.hostUtf8Bytes(message));
                    return {value,clearsException:false};
                }});
                assert.equal(result.kind,message&&message!=="0"?"program-error":"initialized");
                if(result.kind==="program-error") {
                    assert.ok(NativeString.is(result.error));
                    assert.equal(result.error.bytes().toString(),message);
                }
                assert.throws(()=>control.setInitializationException(undefined),/No initialization/);
            }
            // Trusted consumer unit controls exercise classification, separately
            // from the independent actual-native fixture equality above.
            for(const failure of ["program","recursion","deadline","unknown"] as const) {
                const control=new GeneralProgramSession(coordinator.transfer(prepared),config,{},outputOptions);
                assert.equal(control.initialize({clean(){throw Error("Unexpected clean");}}).kind,"initialized");
                const capture=control.beginRender();
                const unknown=new Error("S2 execution timed out");
                control.context.runNativeFunction=()=>{
                    capture.sink.raw(NativeString.hostUtf8Bytes("partial:"));
                    if(failure==="unknown")throw unknown;
                    if(failure==="program")throw nativeProgramError("semantic error");
                    raiseNativeExecutionStop(failure);
                };
                const finish=()=>control.completePage({},"entry",error=>{
                    assert.equal(error.kind,failure);
                    assert.equal(error.signature,"EntryPage::print()");
                    return NativeString.hostUtf8Bytes("encoded:"+error.kind);
                });
                if(failure==="unknown") {
                    assert.throws(finish,error=>error===unknown);
                    assert.throws(()=>capture.finish(),/terminal/);
                }else {
                    assert.equal(Buffer.from(finish().bytes).toString(),"partial:encoded:"+failure);
                }
                assert.throws(finish,/not rendering/);
            }
        }
    }finally{rmSync(directory,{recursive:true,force:true});}
});

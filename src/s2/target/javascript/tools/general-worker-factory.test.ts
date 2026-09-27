// general-worker-factory.test.ts
//
// Installed constructor/callback identity and approved source adapter boundary.
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
import {cpSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {verifyGeneralRuntime} from "../live/render/manifest";
import {generalWorkerFactory,type GeneralWorkerPublicBindings} from "../live/render/general-worker-factory";
import {GeneralWorkerChannel} from "../live/render/general-worker-channel";
import type {GeneralWorkerStart} from "../live/render/general-worker-execution";
import type {GeneralProgramSession} from "../live/render/general-session";
import {NativeString,scalarPV} from "../runtime/native-scalar";
const pv=NativeString.hostUtf8Bytes;

test("installed factory retains one private navigation authority and requires source validation",()=>{
    const boundary=new Error("Invalid approved descriptor");
    const prepared=new Error("Prepared operations captured");
    let bindings:GeneralWorkerPublicBindings|undefined;
    let inputBindings:GeneralWorkerPublicBindings|undefined;
    let inputSession:GeneralProgramSession|undefined;
    let inputStart:GeneralWorkerStart|undefined;
    const factory=generalWorkerFactory(new GeneralWorkerChannel("a".repeat(64)),{
        propertyCleaner(){throw Error("No cleaner substitution");},
        output(){throw Error("No output substitution");},seesControlStrip:()=>false,
        recentInput(){throw boundary;},entryInput(_value,value,session,start){
            inputBindings=value;inputSession=session;inputStart=start;return {page:{}} as never;},
        recentOperations(){throw Error("Invalid descriptor must not prepare operations");},
        entryOperations(_session,_start,value){bindings=value;throw prepared;},
    });
    // Only the adapter boundary is exercised here; no admitted program executes.
    const session={context:{prop:{}}} as unknown as GeneralProgramSession;
    assert.throws(()=>factory.preparePage(session,{kind:"recent"} as GeneralWorkerStart,{}),error=>error===boundary);
    const start={kind:"entry"} as GeneralWorkerStart;
    assert.throws(()=>factory.preparePage(session,start,{}),error=>error===prepared);
    assert.ok(bindings);
    assert.equal(inputBindings,bindings);
    assert.equal(inputSession,session);
    assert.equal(inputStart,start);
    assert.equal(typeof bindings.loadUser,"function");
    const lite={".type":"UserLite",_user:pv("owner")},picture={".type":"Image",".isnull":true};
    bindings.users.bind(lite,"b".repeat(64));
    const owner=bindings.prepareUser(lite,picture,pv("/site?x&y"),pv("<site>"));
    assert.equal(owner[".type"],"User");
    assert.equal(bindings.users.account(owner),bindings.users.account(lite));
    assert.equal(bindings.users.account({...owner}),undefined);
    assert.throws(()=>bindings!.prepareUser({...lite},picture,undefined,undefined));
    const range=bindings.navigation.itemRange({_current:1,_total:2},n=>pv("page="+
        scalarPV(n).bytes().toString("ascii")));
    const registry=factory.builtins({kind:"entry"} as GeneralWorkerStart,()=>undefined,()=>session);
    const result=registry._ItemRange__url_of!(undefined!,range,2);
    assert.equal(scalarPV(result).bytes().toString(),"page=2");
    assert.equal(scalarPV(registry._ItemRange__url_of!(undefined!,{...range},2)).bytes().length,0);
    assert.equal(Object.isFrozen(bindings),true);
});

test("actual installed factory has a closed pure-model dependency graph",()=>{
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-installed-factory-"));
    const compiled=path.join(directory,"compiled");cpSync(path.resolve("dist"),compiled,{recursive:true});
    // Admission-only entry: no stored code or request execution is claimed.
    writeFileSync(path.join(compiled,"live/render/general-worker.js"),
        '"use strict";const factory=require("./general-worker-factory");module.exports=factory;\n');
    const descriptor=path.join(directory,"installation.json");
    writeFileSync(descriptor,JSON.stringify({schema:1,kind:"general-s2-worker",
        entry:"app/dist/live/render/general-worker.js"}));
    execFileSync(process.execPath,["--input-type=module","-e",
        "import {stageGeneralRuntime} from '../../../content/tools/stage-runtime.mjs';stageGeneralRuntime(process.argv[1],{s2Dist:process.argv[2]});",
        descriptor,compiled],{timeout:120000});
    const verified=verifyGeneralRuntime(descriptor);
    const manifest=JSON.parse(readFileSync(path.join(verified.root,"manifest.json"),"utf8"));
    const paths=manifest.files.map((file:{path:string})=>file.path) as string[];
    assert.ok(paths.includes("app/dist/live/domain/general-page-assembly.js"));
    assert.ok(paths.includes("app/dist/live/domain/general-comment-navigation.js"));
    assert.equal(paths.some(file=>/\/live\/data\/|general-selected-text|general-recent-selection|layer-artifact/.test(file)),false);
    console.log("Factory admission-only closed-stage evidence: "+directory);
});

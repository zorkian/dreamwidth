// general-subject-adapter.test.ts
//
// Installed scalar/profile bridge for the accepted source subject cleaner.
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
import path from "node:path";
import {Layer,Context} from "../runtime/s2runtime";
import {NativeString} from "../runtime/native-string";
import type {NativeProfile} from "../runtime/native-profile";
import {generalSubjectAdapter,type GeneralSubjectHelpers} from "../live/render/general-subject-adapter";

test("accepted cleaner uses installed character classes and ordered eval effects",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const layer=new Layer();layer.scalarProfile=profile;
    const context=new Context([layer],()=>{throw Error("Unexpected print");});
    const unused=():never=>{throw Error("Unreached named public helper");};
    const helpers:GeneralSubjectHelpers={normalizeImageUrl:unused,rewriteBlockedHref:unused,
        expandSiteUrl:unused,expandUser:unused,templateError:unused,videoError:unused,
        markupError:unused,validStylesheet:unused};
    const effects:string[]=[];
    const cleaner=generalSubjectAdapter(context,{maxInputBytes:4096,maxOutputBytes:4096,timeoutMs:1000},
        helpers,effect=>effects.push(effect.kind));
    const plain=cleaner.clean(NativeString.bytes(Buffer.from("plain")),"subject");
    assert.equal(plain.bytes().toString(),"plain");
    assert.deepEqual(effects,["none"]);
    const formatted=cleaner.clean(NativeString.bytes(Buffer.from("<b>y</b>")),"subject");
    assert.equal(formatted.bytes().toString(),"<b>y</b>");
    assert.deepEqual(effects,["none","cleared"]);
    const failure=new RangeError("installed helper failed");
    const broken=generalSubjectAdapter(context,{maxInputBytes:4096,maxOutputBytes:4096,timeoutMs:1000},
        {...helpers,expandUser(){throw failure;}},effect=>effects.push(effect.kind));
    assert.throws(()=>broken.clean(NativeString.bytes(Buffer.from("<lj user=\"a\">")),"all"),
        error=>error===failure);
    assert.deepEqual(effects,["none","cleared"]);
    assert.throws(()=>generalSubjectAdapter(new Context([],()=>{}),
        {maxInputBytes:1,maxOutputBytes:1,timeoutMs:1},helpers,()=>{}));
});

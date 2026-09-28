// general-selected-projector.test.ts
//
// Parent selected-page and poster authority assembly over isolated SQL.
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
import {NativeString} from "../runtime/native-scalar";
import {generalSelectedProjection,generalSelectedCommentInfo} from "../live/render/general-selected-projector";
import type {GeneralRequestHelpers} from "../live/render/general-request";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {withSelectedFixture} from "./selected-fixture";

test("parent projector shares one selected Comment tree with the approved page",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async fixture=>{
    await fixture.admin.query(`INSERT INTO ${fixture.table(fixture.c,"talk2")}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await fixture.admin.query(`INSERT INTO ${fixture.table(fixture.c,"talktext2")}
        (journalid,jtalkid,subject,body) VALUES (900001,77,'Public subject','Public body')`);
    const request=fixture.request("ordinary6",{kind:"entry",ditemid:300*256+1});
    const snapshot=await fixture.store.loadNativeSelectedSnapshot(request);
    assert.ok(snapshot);
    const encoding={async item(){throw Error("Unexpected charset conversion");}} as unknown as GeneralTextEncoding;
    const helpers={session:{}} as GeneralRequestHelpers;
    let pageTree:unknown;
    const projected=await generalSelectedProjection(snapshot,helpers,{
        commentSettings:fixture.startup.commentSettings,
        capabilities:fixture.startup.capabilities}, {
        encoding:()=>encoding,
        navigation:()=>({permalink:NativeString.hostUtf8Bytes("/300.html"),styleArgument:undefined}),
        page(facts,prepared,comments){
            pageTree=comments;
            const entry=facts.entries[0]!;
            const url=NativeString.hostUtf8Bytes("/300.html");
            const info=generalSelectedCommentInfo(snapshot,prepared,entry,url,undefined,
                fixture.startup.capabilities);
            assert.equal(info[".type"],"CommentInfo");
            assert.throws(()=>generalSelectedCommentInfo(snapshot,prepared,entry,url,undefined,
                {...fixture.startup.capabilities,maxComments:undefined}));
            const cap=fixture.startup.capabilities.maxComments;
            assert.ok(cap);
            assert.throws(()=>generalSelectedCommentInfo(snapshot,prepared,entry,url,undefined,
                {...fixture.startup.capabilities,maxComments:{...cap,hookConfigured:true}}));
            return {publicCommentIds:comments?.roots.map(node=>node.id)};
        },
    });
    assert.equal(projected.selectedComments,pageTree);
    assert.deepEqual(projected.selectedComments?.roots.map(node=>node.id),[77]);
    assert.deepEqual(projected.page,{publicCommentIds:[77]});
    assert.equal(JSON.stringify(projected.page).includes("Public body"),false);
    assert.equal(await fixture.store.revalidateNativeSelectedFingerprint(snapshot),true);
    const recent=await fixture.store.loadNativeSelectedSnapshot(
        fixture.request("ordinary6",{kind:"recent",skip:0,itemshow:1}));
    assert.ok(recent);
    let navigationCalls=0;
    const recentPage=await generalSelectedProjection(recent,helpers,{
        commentSettings:fixture.startup.commentSettings,
        capabilities:fixture.startup.capabilities}, {
        encoding:()=>encoding,
        navigation(){navigationCalls++;throw Error("Recent has no Comment navigation");},
        page(_facts,_prepared,comments){assert.equal(comments,undefined);return {view:"recent"};},
    });
    assert.equal(navigationCalls,0);
    assert.deepEqual(recentPage,{page:{view:"recent"}});
}));

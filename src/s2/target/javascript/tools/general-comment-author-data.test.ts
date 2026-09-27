// general-comment-author-data.test.ts
//
// Missing public Comment author source and final authority reread.
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
import {withSelectedFixture} from "./selected-fixture";

test("general byte-view retains absent poster fallback and revokes it on public identity changes",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async f=>{
    const talks=f.table(f.c,"talk2"),texts=f.table(f.c,"talktext2");
    await f.admin.query(`INSERT INTO ${talks}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await f.admin.query(`INSERT INTO ${texts}(journalid,jtalkid,subject,body)
        VALUES (900001,77,'Missing author','VISIBLE_MISSING_AUTHOR')`);
    const request=f.request("ordinary6",{kind:"entry",ditemid:300*256+1});
    // The existing retained API remains on its prior strict branch.
    await assert.rejects(f.store.loadRawSnapshot(request));
    const issued=await f.store.loadNativeSelectedSnapshot(request);assert.ok(issued?.facts.comments);
    assert.equal(issued.facts.comments.headers.find(row=>row.jtalkid===77)?.posterid,900999);
    assert.equal(issued.facts.comments.authors.some(row=>row.userid===900999),false);
    assert.equal(issued.facts.comments.texts.find(row=>row.jtalkid===77)?.body,"VISIBLE_MISSING_AUTHOR");
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(issued),true);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"user")}
        (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,
        opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
        VALUES (900999,'restoredauthor',0,'A','V','P','Restored public','Y','all','N',1,NULL,10,2)`);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"useridmap")}(userid,user)
        VALUES (900999,'restoredauthor')`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(issued),false);
    const registered=await f.store.loadNativeSelectedSnapshot(request);assert.ok(registered?.facts.comments);
    assert.equal(registered.facts.comments.authors.some(row=>row.userid===900999),true);
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET statusvis='S',clusterid=7
        WHERE userid=900999`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userproplite2")}(userid,upropid,value)
        VALUES (900999,?,'UTC')`,[f.prop('timezone')]);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(registered),false);
    const suspended=await f.store.loadNativeSelectedSnapshot(request);assert.ok(suspended?.facts.comments);
    assert.equal(suspended.facts.comments.authors.find(row=>row.userid===900999)?.timezone,'UTC');
    assert.equal(suspended.facts.comments.authors.find(row=>row.userid===900999)?.name,'');
    assert.equal(suspended.facts.comments.texts.some(row=>row.jtalkid===77),false);
    assert.ok(!JSON.stringify(suspended).includes("VISIBLE_MISSING_AUTHOR"));
    // The same page-loaded suspended poster can have the public timezone in
    // global userprop instead. Both sides of the global bracket must read it.
    await f.admin.query(`DELETE FROM ${f.table(f.c,"userproplite2")}
        WHERE userid=900999 AND upropid=?`,[f.prop('timezone')]);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"userprop")}(userid,upropid,value)
        VALUES (900999,?,'Europe/London')`,[f.prop('timezone')]);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(suspended),false);
    const globalZone=await f.store.loadNativeSelectedSnapshot(request);assert.ok(globalZone?.facts.comments);
    assert.equal(globalZone.facts.comments.authors.find(row=>row.userid===900999)?.timezone,'Europe/London');
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(globalZone),true);
}));

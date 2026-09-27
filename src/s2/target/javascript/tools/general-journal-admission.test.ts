// general-journal-admission.test.ts
//
// Pre-init anonymous journal authority without selected content reads.
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
import {generalJournalPrivacy} from "../live/domain/general-journal-admission";

test("pre-init journal privacy needs no entry/comment tables and binds owner/settings",()=>
    withSelectedFixture(async({admin,store,g,c,table})=>{
        // These fixture tables are deliberately absent. Any selected header,
        // body or comment read would fail, including a merely speculative read.
        for(const name of ["log2","logtext2","talk2","talktext2"])await admin.query(`DROP TABLE ${table(c,name)}`);
        const original=await store.loadNativeJournalAuthority("ordinary6");
        assert.ok(original);assert.equal(generalJournalPrivacy(original),undefined);
        assert.equal(await store.revalidateNativeJournalAuthority(original),true);
        assert.equal(await store.revalidateNativeJournalAuthority({...original}),false);
        await admin.query(`UPDATE ${table(g,"user")} SET status='V',statusvis='L' WHERE userid=900001`);
        assert.equal(await store.revalidateNativeJournalAuthority(original),false);
        assert.equal(generalJournalPrivacy((await store.loadNativeJournalAuthority("ordinary6"))!),undefined);
        for(const [status,reason] of [["D","deleted"],["S","suspended"],["X","purged"]] as const){
            await admin.query(`UPDATE ${table(g,"user")} SET statusvis=? WHERE userid=900001`,[status]);
            assert.equal(generalJournalPrivacy((await store.loadNativeJournalAuthority("ordinary6"))!),reason);
        }
        await admin.query(`UPDATE ${table(g,"user")} SET statusvis='V',journaltype='I' WHERE userid=900001`);
        assert.equal(generalJournalPrivacy((await store.loadNativeJournalAuthority("ordinary6"))!),"identity-view");
        await admin.query(`UPDATE ${table(g,"user")} SET journaltype='P',clusterid=0 WHERE userid=900001`);
        const purged=(await store.loadNativeJournalAuthority("ordinary6"))!;
        assert.equal(purged.publicSettings,null);assert.equal(generalJournalPrivacy(purged),"purged");
        await admin.query(`UPDATE ${table(g,"user")} SET clusterid=7 WHERE userid=900001`);
        assert.equal(await store.revalidateNativeJournalAuthority(purged),false);
        await admin.query(`INSERT INTO ${table(g,"userprop")} (userid,upropid,value)
            SELECT 900001,upropid,'explicit' FROM ${table(g,"userproplist")} WHERE name='adult_content'`);
        assert.equal(generalJournalPrivacy((await store.loadNativeJournalAuthority("ordinary6"))!),"adult-content");
        assert.equal(await store.loadNativeJournalAuthority("not_an_enrolled_account"),null);
    }));

// selected-loader.test.ts
//
// Real configured-schema qualification for bounded public page snapshots.
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
import {SnapshotError} from "../live/data/errors";
import {approveSnapshot} from "../live/policy/cohort";
import {approveEntrySnapshot} from "../live/policy/entry";
import {Unsupported} from "../live/policy/content";
import {config as publicConfig,capabilities} from "../live/tests/fixtures";
import {withSelectedFixture} from "./selected-fixture";

test("configured schemas select public windows and distant Entry without history caps or marker enrollment", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async () => withSelectedFixture(async ({store,admin,g,c,other,table,request,logProp}) => {
        const first = await store.loadRawSnapshot(request()); assert.ok(first);
        assert.equal(first.entries.length,20); assert.equal(first.selection.kind,"recent");
        if (first.selection.kind!=="recent") throw Error("Unexpected page");
        assert.equal(first.selection.window.length,21);
        assert.deepEqual(first.selection.window.slice(0,3).map(row=>row.jitemid),[298,299,300]);
        assert.deepEqual(first.entries.slice(0,3).map(row=>row.jitemid),[300,299,298]);
        assert.equal(first.entries[19]!.jitemid,281);
        assert.equal(first.calendar.days[0]!.count,300);
        assert.equal(approveSnapshot(first,publicConfig,capabilities).entries.length,20);
        assert.equal(await store.revalidateFingerprint(first),true);
        for (const skip of [79,80,81,200,100000]) {
            const snapshot = await store.loadRawSnapshot(request("ordinary6",{kind:"recent",skip,itemshow:20})); assert.ok(snapshot);
            assert.equal(snapshot.selection.kind,"recent");
            if (snapshot.selection.kind==="recent") {
                assert.equal(snapshot.selection.pageSkip,Math.min(skip,80));
                assert.equal(snapshot.selection.loadSkip,79);
                assert.equal(snapshot.entries.length,20);
                approveSnapshot(snapshot,publicConfig,capabilities);
            }
        }
        const target = await store.loadRawSnapshot(request("ordinary6",{kind:"entry",ditemid:17*256+1})); assert.ok(target);
        assert.equal(target.entries.length,1); assert.equal(target.entries[0]!.eventText,"Public body 17");
        const approvedTarget = approveEntrySnapshot(target,17*256+1,publicConfig,capabilities);
        assert.ok(approvedTarget); assert.equal(approvedTarget.entries.length,1);
        for (const ditemid of [17*256+2,301*256+1,302*256+1,999*256+1]) {
            assert.equal(await store.loadRawSnapshot(request("ordinary6",{kind:"entry",ditemid})),null);
        }
        assert.equal(await store.loadRawSnapshot(request("missing6")),null);
        const second = await store.loadRawSnapshot(request("second6")); assert.ok(second);
        assert.equal(second.entries[0]!.eventText,"Foreign same ID");
        assert.equal(second.style!.origin,"default");
        assert.deepEqual(second.calendar.current,{year:2026,month:0});
        approveSnapshot(second,publicConfig,capabilities);
        await admin.query(`UPDATE ${table(other,"logtext2")} SET event='Different foreign content' WHERE journalid=900002`);
        assert.equal(await store.revalidateFingerprint(first),true);
        const lookahead = first.selection.window.find(row=>!first.entries.some(entry=>entry.jitemid===row.jitemid))!.jitemid;
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event=CONVERT(? USING latin1)
            WHERE journalid=900001 AND jitemid=?`,[Buffer.from([255]),lookahead]);
        assert.equal(await store.revalidateFingerprint(first),true);
        const lookaheadHeader = first.selection.window.find(row=>row.jitemid===lookahead)!;
        await admin.query(`UPDATE ${table(c,"log2")} SET eventtime='2025-12-01 00:00:00',year=2025,month=12,day=1
            WHERE journalid=900001 AND jitemid=?`,[lookahead]);
        const outsideLookahead = await store.loadRawSnapshot(request()); assert.ok(outsideLookahead);
        assert.ok(!outsideLookahead.entries.some(entry=>entry.jitemid===lookahead));
        approveSnapshot(outsideLookahead,publicConfig,capabilities);
        assert.equal(outsideLookahead.calendar.days[0]!.count,299);
        await admin.query(`INSERT INTO ${table(c,"logprop2")} VALUES (900001,?,?,'S')`,[lookahead,logProp("statusvis")]);
        const hiddenLookahead = await store.loadRawSnapshot(request()); assert.ok(hiddenLookahead);
        assert.equal(await store.revalidateFingerprint(outsideLookahead),false);
        assert.throws(()=>approveSnapshot(hiddenLookahead,publicConfig,capabilities),Unsupported);
        await admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=? AND propid=?`,
            [lookahead,logProp("statusvis")]);
        await admin.query(`UPDATE ${table(c,"log2")} SET posterid=900002 WHERE journalid=900001 AND jitemid=?`,[lookahead]);
        const foreignLookahead = await store.loadRawSnapshot(request()); assert.ok(foreignLookahead);
        assert.throws(()=>approveSnapshot(foreignLookahead,publicConfig,capabilities),Unsupported);
        await admin.query(`UPDATE ${table(c,"log2")} SET eventtime=?,year=?,month=?,day=?,posterid=900001
            WHERE journalid=900001 AND jitemid=?`,[lookaheadHeader.eventtime,lookaheadHeader.year,
                lookaheadHeader.month,lookaheadHeader.day,lookahead]);
        assert.equal(await store.revalidateFingerprint(first),true);
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event='Changed selected' WHERE journalid=900001 AND jitemid=300`);
        assert.equal(await store.revalidateFingerprint(first),false);
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event='Public body 300' WHERE journalid=900001 AND jitemid=300`);
        assert.equal(await store.revalidateFingerprint(first),true);
        await admin.query(`INSERT INTO ${table(c,"logprop2")} VALUES (900001,100,?,'S')`,[logProp("statusvis")]);
        const suspended = await store.loadRawSnapshot(request()); assert.ok(suspended);
        assert.equal(await store.revalidateFingerprint(first),false);
        assert.throws(()=>approveSnapshot(suspended,publicConfig,capabilities),Unsupported);
        await admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=100 AND propid=?`,[logProp("statusvis")]);
        assert.equal(await store.revalidateFingerprint(first),true);
        await admin.query(`UPDATE ${table(g,"useridmap")} SET user='incomplete6' WHERE userid=900001`);
        assert.equal(await store.revalidateFingerprint(first),false);
        await assert.rejects(store.loadRawSnapshot(request()),SnapshotError);
        await admin.query(`UPDATE ${table(g,"useridmap")} SET user='ordinary6' WHERE userid=900001`);
        assert.equal(await store.revalidateFingerprint(first),true);
        await admin.query(`UPDATE ${table(g,"user")} SET clusterid=19 WHERE userid=900001`);
        assert.equal(await store.revalidateFingerprint(first),false);
        await admin.query(`UPDATE ${table(g,"user")} SET clusterid=7 WHERE userid=900001`);
        assert.equal(await store.revalidateFingerprint(first),true);
}));

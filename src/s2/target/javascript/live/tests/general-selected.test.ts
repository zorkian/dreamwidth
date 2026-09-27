// general-selected.test.ts
//
// Selected public data authority independent of active program representation.
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
import {test} from "node:test";
import {withSelectedFixture} from "../../tools/selected-fixture";

test("actual selected count3/lookahead/freshness reads no former catalog program tables", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async () => withSelectedFixture(async ({store,admin,g,c,table,request}) => {
    // Only disposable cloned schemas are changed. These tables are irrelevant
    // to the selected-data operation; program authority has its own reader.
    for (const name of ["s2styles","s2layers","s2compiled","s2source_inno","s2info"]) {
        await admin.query(`DROP TABLE ${table(g,name)}`);
    }
    await admin.query(`DROP TABLE ${table(c,"s2stylelayers2")}`);
    const input = request("ordinary6", {kind:"recent",skip:0,itemshow:3});
    const selected = await store.loadSelectedSnapshot(input); assert.ok(selected);
    assert.equal(selected.style,null); assert.equal(selected.entries.length,3);
    assert.equal(selected.selection.kind,"recent");
    if (selected.selection.kind !== "recent") throw new Error("Unexpected selection");
    assert.equal(selected.selection.window.length,4);
    assert.deepEqual(selected.entries.map(entry=>entry.jitemid),[300,299,298]);
    assert.equal(await store.revalidateSelectedFingerprint(selected),true);
    await admin.query(`UPDATE ${table(c,"logtext2")} SET event='Changed selected body'
        WHERE journalid=900001 AND jitemid=300`);
    assert.equal(await store.revalidateSelectedFingerprint(selected),false);
    const next = await store.loadSelectedSnapshot(input); assert.ok(next);
    assert.equal(next.entries[0]!.eventText,"Changed selected body");
    assert.equal(await store.revalidateSelectedFingerprint(next),true);
    const missing = await store.loadSelectedSnapshot(request("ordinary6",{kind:"entry",ditemid:256*300+255}));
    assert.equal(missing,null);
}));

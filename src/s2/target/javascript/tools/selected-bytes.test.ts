// selected-bytes.test.ts
//
// Actual SELECT-only public language witnesses and MyISAM qualification.
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
import {MysqlLiveStore} from "../live/data/mysql";
import {withSelectedFixture} from "./selected-fixture";

test("native selected bytes preserve invalid UTF8 and native undef without private reads", () =>
    withSelectedFixture(async ({admin, store, g, c, table, request, startup}) => {
        const entryRequest = request("ordinary6", {kind: "entry", ditemid: 257});
        const payload = Buffer.from([0xff, 0x00, 0x61]);
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=1`, [payload]);
        await assert.rejects(store.loadSelectedSnapshot(entryRequest));
        const native = await store.loadNativeSelectedSnapshot(entryRequest);
        assert.ok(native);
        const event = native.sources.find(cell => cell.key === "entry:1:event")!.value!;
        assert.equal(event.utf8, false);
        assert.deepEqual(Buffer.from(event.base64, "base64"), payload);
        const oracle = JSON.parse(execFileSync("perl", ["tools/selected-bytes-native.pl", c], {encoding: "utf8"}));
        assert.equal(oracle[1].base64, event.base64);
        assert.equal(oracle[1].utf8, 0);
        assert.equal(await store.revalidateNativeSelectedFingerprint(native), true);
        assert.equal(await store.revalidateNativeSelectedFingerprint({...native}), false);
        const independent = await MysqlLiveStore.open(startup);
        try {assert.equal(await independent.revalidateNativeSelectedFingerprint(native), false);}
        finally {await independent.close();}
        const changedProjection = await store.loadNativeSelectedSnapshot(entryRequest);
        assert.ok(changedProjection);
        Object.assign(changedProjection.facts, {entries: []});
        assert.equal(await store.revalidateNativeSelectedFingerprint(changedProjection), false);
        await admin.query(`UPDATE ${table(g,"user")} SET oldenc=? WHERE userid=900001`, [native.oldEncoding === 0 ? 1 : 0]);
        assert.equal(await store.revalidateNativeSelectedFingerprint(native), false);
        const changedEncoding = await store.loadNativeSelectedSnapshot(entryRequest);
        assert.equal(changedEncoding!.oldEncoding, native.oldEncoding === 0 ? 1 : 0);
        await admin.query(`UPDATE ${table(g,"user")} SET oldenc=? WHERE userid=900001`, [native.oldEncoding]);
        assert.equal(await store.loadNativeSelectedSnapshot(request("ordinary6", {kind: "entry", ditemid: 301*256+1})), null);
        assert.equal(await store.loadNativeSelectedSnapshot(request("ordinary6", {kind: "entry", ditemid: 302*256+1})), null);
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event='Changed after render' WHERE journalid=900001 AND jitemid=1`);
        assert.equal(await store.revalidateNativeSelectedFingerprint(native), false);
        await admin.query(`UPDATE ${table(c,"logtext2")} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=1`, [Buffer.from([0x1f,0x8b,0x00])]);
        const corrupt = await store.loadNativeSelectedSnapshot(entryRequest);
        assert.deepEqual(corrupt!.undefinedEntryEvents, [1]);
        assert.equal(corrupt!.sources.find(cell => cell.key === "entry:1:event")!.value, null);
        const corruptOracle = JSON.parse(execFileSync("perl", ["tools/selected-bytes-native.pl", c], {encoding: "utf8"}));
        assert.equal(corruptOracle[1], null);
    }));

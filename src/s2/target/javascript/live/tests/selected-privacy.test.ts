// selected-privacy.test.ts
//
// Actual isolated-primary bracket and buffered-response revocation adversaries.
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
import {withSelectedFixture, type SelectedFixture} from "../../tools/selected-fixture";
import {PrimaryDatabases} from "../data/primary";
import {SnapshotError} from "../data/errors";
import {createAnonymousRecentService} from "../policy/service";
import {Renderer} from "../render/child";
import type {RenderInput} from "../render/types";
import type {RawPageRequest} from "../contracts";
import {config, capabilities, limits} from "./fixtures";

interface Mutation {
    readonly name: string;
    readonly change: () => Promise<unknown>;
    readonly restore: () => Promise<unknown>;
}
function globalMutations(f: SelectedFixture): Mutation[] {
    const {admin, table, g} = f;
    const update = (column: string, value: string | number) =>
        admin.query(`UPDATE ${table(g,"user")} SET ${column}=? WHERE userid=900001`, [value]);
    return [
        {name: "rename", change: async () => {
            await update("user", "renamed6");
            await admin.query(`UPDATE ${table(g,"useridmap")} SET user='renamed6' WHERE userid=900001`);
        }, restore: async () => {
            await update("user", "ordinary6");
            await admin.query(`UPDATE ${table(g,"useridmap")} SET user='ordinary6' WHERE userid=900001`);
        }},
        {name: "one-sided-map", change: () => admin.query(`UPDATE ${table(g,"useridmap")}
            SET user='incomplete6' WHERE userid=900001`), restore: () => admin.query(`UPDATE ${table(g,"useridmap")}
            SET user='ordinary6' WHERE userid=900001`)},
        {name: "cluster-move", change: () => update("clusterid",19), restore: () => update("clusterid",7)},
        {name: "move-bit", change: () => update("caps",32770), restore: () => update("caps",2)},
        {name: "owner-hidden", change: () => update("statusvis","S"), restore: () => update("statusvis","V")},
        {name: "global-setting", change: () => admin.query(`INSERT INTO ${table(g,"userprop")}
            (userid,upropid,value) VALUES (900001,?,'Changed title')`,[f.prop("journaltitle")]),
            restore: () => admin.query(`DELETE FROM ${table(g,"userprop")} WHERE userid=900001 AND upropid=?`,
                [f.prop("journaltitle")])},
        {name: "style-header", change: () => admin.query(`UPDATE ${table(g,"s2styles")} SET modtime=2 WHERE styleid=44`),
            restore: () => admin.query(`UPDATE ${table(g,"s2styles")} SET modtime=1 WHERE styleid=44`)},
    ];
}

// The primary reads/transactions, mapping/style logic and MySQL commits are
// real. A wrapper schedules the commit at a deterministic completed-snapshot
// boundary; it does not fabricate results or bypass primary checks.
test("global bracket rejects persistent changes committed after the selected cluster snapshot", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async t => withSelectedFixture(async fixture => {
    const baseline = await fixture.store.loadRawSnapshot(fixture.request());
    assert.ok(baseline);
    const snapshot = PrimaryDatabases.prototype.snapshot;
    for (const mutation of globalMutations(fixture)) {
        let clusterReads = 0, fired = false;
        const hook = t.mock.method(PrimaryDatabases.prototype, "snapshot", async function<T>(
            this: PrimaryDatabases, ...args: Parameters<typeof snapshot<T>>): Promise<T> {
            const result = await snapshot.call(this, ...args) as T;
            if (args[0] === 7 && ++clusterReads === 2) {
                await mutation.change(); fired = true;
            }
            return result;
        });
        try {
            await assert.rejects(fixture.store.loadRawSnapshot(fixture.request()),
                (error: unknown) => error instanceof SnapshotError && error.kind === "unsupported", mutation.name);
            assert.equal(fired, true, mutation.name);
        } finally {
            hook.mock.restore();
            await mutation.restore();
            assert.equal(await fixture.store.revalidateFingerprint(baseline), true,
                mutation.name + " exact baseline restored");
        }
    }
}));

// Actual store + service + SQL changes; Renderer.render alone is replaced with
// a buffered result to isolate the final-read decision. This is NOT actual
// child/stage evidence. Isolated fixture cleanup never targets ordinary data.
test("real primary selected changes withhold buffered HTML; restored requests recover", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async t => withSelectedFixture(async fixture => {
    const {store,admin,g,c,table} = fixture;
    const target = 17*256+1;
    const page: RawPageRequest["page"] = {kind: "entry", ditemid: target};
    const stamp = new Date();
    const request = {...fixture.request("ordinary6",page), calendarNow: {
        year: stamp.getUTCFullYear(), month: stamp.getUTCMonth()+1}};
    const baseline = await store.loadRawSnapshot(request); assert.ok(baseline);
    const mutations: (Mutation & {next: "not-found" | "unsupported" | "ok"})[] = [
        ...globalMutations(fixture).filter(row => row.name !== "one-sided-map").map(row => ({...row,
            next: (["rename","cluster-move"].includes(row.name) ? "not-found" :
                ["move-bit","owner-hidden"].includes(row.name) ? "unsupported" : "ok") as "not-found"|"unsupported"|"ok"})),
        {name:"target-private", next:"not-found", change:()=>admin.query(`UPDATE ${table(c,"log2")}
            SET security='private' WHERE journalid=900001 AND jitemid=17`),
            restore:()=>admin.query(`UPDATE ${table(c,"log2")} SET security='public' WHERE journalid=900001 AND jitemid=17`)},
        {name:"target-edited", next:"ok", change:()=>admin.query(`UPDATE ${table(c,"logtext2")}
            SET event='New public content' WHERE journalid=900001 AND jitemid=17`),
            restore:()=>admin.query(`UPDATE ${table(c,"logtext2")} SET event='Public body 17' WHERE journalid=900001 AND jitemid=17`)},
        {name:"crossjournal-poster", next:"unsupported", change:()=>admin.query(`UPDATE ${table(c,"log2")}
            SET posterid=900002 WHERE journalid=900001 AND jitemid=17`),
            restore:()=>admin.query(`UPDATE ${table(c,"log2")} SET posterid=900001 WHERE journalid=900001 AND jitemid=17`)},
        {name:"shown-calendar-status", next:"unsupported", change:()=>admin.query(`INSERT INTO ${table(c,"logprop2")}
            (journalid,jitemid,propid,value) VALUES (900001,100,?,'S')`,[fixture.logProp("statusvis")]),
            restore:()=>admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=100 AND propid=?`,
                [fixture.logProp("statusvis")])},
    ];
    for (const mutation of mutations) {
        let changed = false, renders = 0;
        const render = t.mock.method(Renderer.prototype,"render",async (input: RenderInput) => {
            renders++;
            assert.equal(input.journal.userid,900001);
            assert.equal(input.journal.entries.length,1);
            assert.equal(input.journal.entries[0]!.id,target);
            const serialized = JSON.stringify(input);
            for (const forbidden of [g,c,fixture.other,"Foreign same ID","fingerprint","publicSettings"])
                assert.ok(!serialized.includes(forbidden), forbidden);
            if (!changed) {await mutation.change(); changed=true;}
            return "<html>COMPLETE_BUFFERED_PUBLIC_RESPONSE</html>";
        });
        const service = await createAnonymousRecentService({repository:store,secretSource:store,
            capabilities,config,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
        const incoming = {method:"GET" as const, username:"ordinary6",ditemid:target,uniqCookie:null};
        try {
            assert.deepEqual(await service.serveEntry(incoming),{ok:false,reason:"changed"},mutation.name);
            assert.equal(changed,true);
            assert.equal(renders,1);
            const next = await service.serveEntry({...incoming,method:"HEAD"});
            if (mutation.next === "ok") assert.equal(next.ok,true,mutation.name);
            else assert.deepEqual(next,{ok:false,reason:mutation.next},mutation.name);
        } finally {
            render.mock.restore();
            await service.close();
            await mutation.restore();
            assert.equal(await store.revalidateFingerprint(baseline),true,mutation.name+" restored");
        }
    }
}));

test("Recent window changes recheck membership and never include private or other-journal bodies", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async t => withSelectedFixture(async fixture => {
    const {store,admin,c,other,table} = fixture;
    const baseline = await store.loadRawSnapshot(fixture.request()); assert.ok(baseline);
    const old = await store.loadRawSnapshot(fixture.request("ordinary6",{kind:"entry",ditemid:257})); assert.ok(old);
    const mutations: Mutation[] = [
        {name:"selected-private",change:()=>admin.query(`UPDATE ${table(c,"log2")} SET security='private'
            WHERE journalid=900001 AND jitemid=300`),restore:()=>admin.query(`UPDATE ${table(c,"log2")}
            SET security='public' WHERE journalid=900001 AND jitemid=300`)},
        {name:"window-shift",change:()=>admin.query(`UPDATE ${table(c,"log2")} SET revttime=0
            WHERE journalid=900001 AND jitemid=1`),restore:()=>admin.query(`UPDATE ${table(c,"log2")}
            SET revttime=? WHERE journalid=900001 AND jitemid=1`,[old.entries[0]!.revttime])},
    ];
    for (const mutation of mutations) {
        let changed = false;
        const seen: number[][] = [];
        const render = t.mock.method(Renderer.prototype,"render",async (input: RenderInput) => {
            assert.equal(input.journal.username,"ordinary6");
            assert.equal(input.journal.entries.length,20);
            const ids = input.journal.entries.map(entry=>Math.floor(entry.id/256)); seen.push(ids);
            assert.ok(!ids.includes(301) && !ids.includes(302));
            assert.ok(!JSON.stringify(input).includes("Foreign same ID"));
            if (!changed) {await mutation.change(); changed=true;}
            return "<html>BUFFERED_SELECTED_RECENT</html>";
        });
        const service = await createAnonymousRecentService({repository:store,secretSource:store,
            capabilities,config,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
        const incoming = {method:"GET" as const,username:"ordinary6",skip:0,skipPresent:false,uniqCookie:null};
        try {
            assert.deepEqual(await service.serve(incoming),{ok:false,reason:"changed"},mutation.name);
            assert.equal((await service.serve(incoming)).ok,true,mutation.name);
            assert.equal(seen.length,2);
            assert.notDeepEqual(seen[0],seen[1]);
            if (mutation.name === "selected-private") assert.ok(!seen[1]!.includes(300));
            else assert.ok(seen[1]!.includes(1));
        } finally {
            render.mock.restore(); await service.close(); await mutation.restore();
            assert.equal(await store.revalidateFingerprint(baseline),true,mutation.name+" restored");
        }
    }
    // Matching item IDs in a different journal are not this request's content
    // authority. A foreign text edit cannot change this journal's fingerprint.
    try {
        await admin.query(`UPDATE ${table(other,"logtext2")} SET event='CROSSJOURNAL_SECRET_SENTINEL' WHERE journalid=900002`);
        assert.equal(await store.revalidateFingerprint(baseline),true);
    } finally {
        await admin.query(`UPDATE ${table(other,"logtext2")} SET event='Foreign same ID' WHERE journalid=900002`);
    }
}));

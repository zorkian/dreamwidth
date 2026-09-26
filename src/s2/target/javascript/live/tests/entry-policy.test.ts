// entry-policy.test.ts
//
// Anonymous entry identity, admission and full-snapshot revocation checks.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {approveEntrySnapshot as approveRawEntrySnapshot, validEntryId} from "../policy/entry";
import {approveSnapshot as approveRawSnapshot} from "../policy/cohort";
import {createRedirectAdmission} from "../policy/redirects";
import {createAnonymousRecentService} from "../policy/service";
import {Renderer} from "../render/child";
import type {RenderInput} from "../render/types";
import type {RawJournalSnapshot, RawRecentRepository, RedirectAdmissionRequest, RepositoryError} from "../contracts";
import {Unsupported} from "../policy/content";
import {snapshot, selectFixture, config, capabilities, limits} from "./fixtures";

const approveSnapshot = (data: RawJournalSnapshot) => approveRawSnapshot(data, config, capabilities);
const approveEntrySnapshot = (data: RawJournalSnapshot, id: number) =>
    approveRawEntrySnapshot(data, id, config, {...capabilities,maxComments:{defaultValue:5000,byBit:[],hookConfigured:false}});

const request: RedirectAdmissionRequest = {method: "GET", rawTarget: "/users/s2js_slice3/384.html",
    host: "localhost:8081", origin: null, hasForwardedHeaders: false,
    hasAuthorization: false, cookieHeader: null};

test("entry admission owns exact canonical uint32 identity and finite controls", () => {
    const decide = createRedirectAdmission(config);
    for (const method of ["GET", "HEAD"] as const) {
        for (const ditemid of [1, 255, 256, 384, 4294967295]) {
            assert.deepEqual(decide({...request, method, rawTarget: `/users/s2js_slice3/${ditemid}.html`}),
                {kind: "entry", request: {method, username: "s2js_slice3", ditemid, uniqCookie: null}});
        }
    }
    for (const value of [0, -1, 1.5, 4294967296, Infinity, NaN, "384"]) assert.equal(validEntryId(value), false);
    for (const rawTarget of ["/users/s2js_slice3/0.html", "/users/s2js_slice3/0384.html",
        "/users/s2js_slice3/+384.html", "/users/s2js_slice3/3e2.html", "/users/s2js_slice3/4294967296.html",
        "/users/s2js_slice3/384.HTML", "/users/s2js_slice3/384.html/", "/~s2js_slice3/384.html",
        "/users/s2js_slice3/384.html?", "/users/s2js_slice3/384.html?mode=reply",
        "/users/s2js_slice3/384.html?style=mine",
        "/users/s2js_slice3/384.html?viewall=1",
        "/users/s2js_slice3/384.html?nohtml=1", "/users/s2js_slice3/384.html?skip=0",
        "/users/s2js_slice3/384.html?mode=reply&mode=reply", "/users/s2js_slice3/384.html??",
        "/users/s2js_slice3/%33%38%34.html", "/users/s2js_slice3/../384.html",
        "/users/s2js_slice3/%2e%2e/384.html", "/users//s2js_slice3/384.html",
        "/users/s2js_slice3/384.html#comments", "/users/s2js_slice3/384.html\u0000"]) {
        assert.equal(decide({...request, rawTarget}).kind, "reject", rawTarget);
    }
    for (const change of [{method: "POST"}, {origin: "http://evil.test"}, {host: "localhost:8080"},
        {hasAuthorization: true}, {hasForwardedHeaders: true}, {cookieHeader: "ljsession=SECRET"}]) {
        assert.equal(decide({...request, ...change}).kind, "reject");
    }
    for (const rawTarget of ["/go?dir=prev&itemid=384&journal=s2js_slice3",
        "/go?dir=next&itemid=4294967295&journal=s2js_slice3",
        "/openid/?returnto=http://localhost:8080/users/s2js_slice3/384.html"]) {
        for (const method of ["GET", "HEAD"]) assert.deepEqual(decide({...request, rawTarget, method}),
            {kind: "redirect", status: 307, location: config.canonicalAppOrigin + rawTarget});
        assert.equal(decide({...request, rawTarget, method: "POST", origin: config.listenOrigin}).kind, "reject");
    }
    for (const rawTarget of ["/go?dir=prev&itemid=0384&journal=s2js_slice3",
        "/go?itemid=384&dir=prev&journal=s2js_slice3", "/go?dir=prev&itemid=384&journal=UPPER",
        "/go?dir=prev&itemid=384&journal=s2js_slice3&dir=next",
        "/go?dir=next&itemid=4294967296&journal=s2js_slice3",
        "/openid/?returnto=http://localhost:8080/users/s2js_slice3/384.html?mode=reply",
        "/openid/?returnto=http://localhost:8080/~s2js_slice3/384.html"]) {
        assert.equal(decide({...request, rawTarget}).kind, "reject", rawTarget);
    }
});

test("target privacy/identity404 precedes unsupported cohort; exact public keeps selected-data422", () => {
    const data = snapshot({kind: "entry", ditemid: 384});
    const broken = {...data, owner: {...data.owner, statusvis: "S"}};
    const selection = data.selection;
    if (selection.kind !== "entry") throw new Error("fixture selection");
    assert.equal(approveEntrySnapshot({...broken, selection: {...selection, target: {
        ...selection.target, anum: 129}}}, 384), null);
    for (const security of ["private", "usemask"]) {
        assert.equal(approveEntrySnapshot({...broken, entries: [], selection: {...selection,
            target: {...selection.target, security}}}, 384), null);
    }
    assert.throws(() => approveEntrySnapshot(broken, 384));
    assert.throws(() => approveEntrySnapshot({...data, selection: {...selection,
        target: {...selection.target, security: "unknown"}}}, 384));
    assert.throws(() => approveEntrySnapshot({...data, entries: [{...data.entries[0]!,
        props: {...data.entries[0]!.props, statusvis: "S"}}]}, 384));
    for (const spamreportBans of [1, 3, -1, NaN]) {
        assert.throws(() => approveEntrySnapshot({...data, features: {...data.features, spamreportBans}}, 384));
        const recent = snapshot();
        assert.deepEqual(approveSnapshot({...recent, features: {...recent.features, spamreportBans}}),
            approveSnapshot(recent));
    }
    // Comment presence is supported now; header/body identity must still agree.
    assert.equal(approveEntrySnapshot({...data,features:{...data.features,comments:1}},384)?.entries[0]!.id,384);
    assert.throws(()=>approveEntrySnapshot({...data,entries:[{...data.entries[0]!,replycount:1}]},384));
    assert.equal(approveEntrySnapshot({...data,entries:[{...data.entries[0]!,replycount:1}],
        selection:{...selection,target:{...selection.target,replycount:1}}},384)?.entries[0]!.id,384);
    assert.equal(approveEntrySnapshot(data, 384)?.entries[0]!.id, 384);
});

// This test injects the repository generation and renderer completion only.
// The service, token path, full-snapshot handoff and final recheck ordering are
// real. It is not an actual DB mutation, HTTP or staged worker rendering proof.
test("entry outside the recent window rechecks its complete selected dependency snapshot before release", async t => {
    const seed = snapshot();
    const rows = Array.from({length: 80}, (_, i) => ({...seed.entries[0]!, jitemid: i + 1,
        revttime: seed.entries[0]!.revttime + i, eventText: `<p>public ${i + 1}</p>`}));
    const target = 80 * 256 + rows[79]!.anum;
    let latest: RawJournalSnapshot = selectFixture({...seed, entries: rows}, {kind: "entry", ditemid: target});
    let revoked = false;
    assert.ok(!approveSnapshot(selectFixture({...seed, entries: rows})).entries.some(row => row.id === target));
    let rechecks = 0, renders = 0, loaded: RawJournalSnapshot | null = null;
    const repository: RawRecentRepository = {
        async loadRawSnapshot(request) {
            if (revoked) return null;
            latest = {...latest, request}; loaded = latest; return latest;
        },
        async revalidateFingerprint(original) {
            rechecks++;
            assert.equal(original, loaded);
            assert.equal(original.entries.length, 1);
            assert.equal(original.entries[0]!.jitemid, 80);
            return !revoked && original === latest;
        },
        async close() {},
    };
    const seen: RenderInput[] = [];
    t.mock.method(Renderer.prototype, "render", async (input: RenderInput) => {
        renders++; seen.push(input);
        assert.deepEqual(input.page, {kind: "entry", ditemid: target});
        assert.equal(input.skip, 0); assert.equal(input.skipPresent, false);
        revoked = true;
        latest = {...latest, fingerprint: "new-primary-generation", entries: latest.entries.map(row =>
            row.jitemid === 80 ? {...row, security: "private", eventText: "PRIVATE_AFTER_REVOCATION"} : row)};
        return "<html>BUFFERED_PUBLIC_HTML</html>";
    });
    const service = await createAnonymousRecentService({repository, config, capabilities, limits,
        artifact: {path: process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice4-h1-worker/slice3-stock.json"},
        secretSource: {async loadLatestSecret(now) {return {stime: now - now % 3600,
            secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};}}});
    try {
        const request = {method: "GET" as const, username: "s2js_slice3", ditemid: target, uniqCookie: null};
        assert.deepEqual(await service.serveEntry(request), {ok: false, reason: "changed"});
        assert.deepEqual(await service.serveEntry(request), {ok: false, reason: "not-found"});
        assert.equal(renders, 1); assert.equal(rechecks, 1);
        assert.ok(!JSON.stringify(seen).includes("PRIVATE_AFTER_REVOCATION"));
    } finally {await service.close();}
});

test("entry service keeps fixed typed failures and target privacy ordering before tokens/render", async t => {
    const sentinel = "PRIVATE_SQL_KEY_SENTINEL";
    class InjectedRepositoryError extends Error implements RepositoryError {
        readonly name = "RepositoryError";
        constructor(readonly kind: "unsupported" | "unavailable") {super(sentinel);}
    }
    const matrix = [
        {name: "missing-owner", reason: "not-found", render: false, recheck: false},
        {name: "missing-entry", reason: "not-found", render: false, recheck: false},
        {name: "wrong-anum", reason: "not-found", render: false, recheck: false},
        {name: "private-before-cohort", reason: "not-found", render: false, recheck: false},
        {name: "usemask-before-cohort", reason: "not-found", render: false, recheck: false},
        {name: "unknown-security", reason: "unsupported", render: false, recheck: false},
        {name: "public-suspended", reason: "unsupported", render: false, recheck: false},
        {name: "spamreport-ban", reason: "unsupported", render: false, recheck: false},
        {name: "load-unsupported", reason: "unsupported", render: false, recheck: false},
        {name: "load-unavailable", reason: "unavailable", render: false, recheck: false},
        {name: "render-unsupported", reason: "unsupported", render: true, recheck: false},
        {name: "render-unavailable", reason: "unavailable", render: true, recheck: false},
        {name: "recheck-error", reason: "unavailable", render: true, recheck: true},
        {name: "revoked", reason: "changed", render: true, recheck: true},
    ] as const;
    for (const row of matrix) {
        let renders = 0, secrets = 0, rechecks = 0;
        let data = snapshot({kind: "entry", ditemid: 384});
        const render = t.mock.method(Renderer.prototype, "render", async () => {
            renders++;
            if (row.name === "render-unsupported") throw new Unsupported();
            if (row.name === "render-unavailable") throw new Error(sentinel);
            return "<html>BUFFERED_PUBLIC_HTML</html>";
        });
        const repository: RawRecentRepository = {
            async loadRawSnapshot(request) {
                data = {...data, request};
                if (row.name === "missing-owner" || row.name === "missing-entry" || row.name === "wrong-anum") return null;
                if (row.name === "load-unsupported") throw new InjectedRepositoryError("unsupported");
                if (row.name === "load-unavailable") throw new InjectedRepositoryError("unavailable");
                if (row.name === "spamreport-ban") return {...data, features: {...data.features, spamreportBans: 1}};
                if (row.name === "public-suspended") return {...data, owner: {...data.owner, statusvis: "S"}};
                const selection = data.selection;
                if (selection.kind !== "entry") throw new Error("fixture selection");
                if (row.name === "private-before-cohort" || row.name === "usemask-before-cohort") {
                    return {...data, owner: {...data.owner, statusvis: "S"}, entries: [], selection: {...selection,
                        target: {...selection.target,
                            security: row.name === "private-before-cohort" ? "private" : "usemask"}}};
                }
                if (row.name === "unknown-security") return {...data, entries: [], selection: {...selection,
                    target: {...selection.target, security: "unknown"}}};
                return data;
            },
            async revalidateFingerprint(loaded) {
                rechecks++;
                assert.equal(loaded, data);
                if (row.name === "recheck-error") throw new InjectedRepositoryError("unavailable");
                assert.equal(row.name, "revoked");
                return false;
            },
            async close() {},
        };
        const service = await createAnonymousRecentService({repository, config, capabilities, limits,
            artifact: {path: process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice4-h1-worker/slice3-stock.json"},
            secretSource: {async loadLatestSecret(now) {secrets++; return {stime: now - now % 3600,
                secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};}}});
        try {
            for (const method of ["GET", "HEAD"] as const) {
                const result = await service.serveEntry({method, username: "s2js_slice3",
                    ditemid: row.name === "wrong-anum" ? 385 : 384, uniqCookie: null});
                assert.deepEqual(result, {ok: false, reason: row.reason}, row.name + ":" + method);
                assert.ok(!JSON.stringify(result).includes(sentinel));
            }
            assert.equal(renders, row.render ? 2 : 0, row.name);
            assert.equal(secrets, row.render ? 2 : 0, row.name);
            assert.equal(rechecks, row.recheck ? 2 : 0, row.name);
            await service.close();
            assert.deepEqual(await service.serveEntry({method: "GET", username: "s2js_slice3",
                ditemid: 384, uniqCookie: null}), {ok: false, reason: "unavailable"});
        } finally {await service.close(); render.mock.restore();}
    }
});

test("entry parent policy and service do not load content, DOM or CSS implementation modules", () => {
    const forbidden = Object.keys(require.cache).filter(path =>
        /\/node_modules\/(?:@dreamwidth\/content|jsdom|dompurify|css-tree|parse5)(?:\/|$)/.test(path) ||
        /\/src\/content\/dist\//.test(path));
    assert.deepEqual(forbidden, []);
});

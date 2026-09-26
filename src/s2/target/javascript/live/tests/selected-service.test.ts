// selected-service.test.ts
//
// Parent request binding and selected-data revocation boundary adversaries.
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
import type {RawJournalSnapshot, RawPageRequest, RawRecentRepository} from "../contracts";
import type {RenderInput} from "../render/types";
import {createComparisonRecentService} from "../policy/comparison";
import {createRedirectAdmission} from "../policy/redirects";
import {Renderer} from "../render/child";
import {capabilities, config, limits, now, snapshot} from "./fixtures";

const artifact = {path: process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"};
const entropy = {purpose: "offline-perl-comparison" as const,
    clock: {nowSeconds: () => now}, random: {randomBytes: (size: number) => new Uint8Array(size)}};
const secret = Buffer.from("0123456789abcdefghijklmnopqrstuv");
function selected(request: RawPageRequest): RawJournalSnapshot {
    const data = snapshot(request.page);
    const owner = {...data.owner, user: request.username};
    return {...data, request, owner, posters: [owner]};
}
const recent = {method: "GET" as const, username: "7_real", skip: 0, skipPresent: false, uniqCookie: null};

// Only the repository and render completion are injected. The actual parent
// factory, admission, token construction, input projection and last-await logic
// run here. Actual primary races and sandbox execution are separate evidence.
test("service binds exact source request before tokens and renderer inputs", async t => {
    const mutations: readonly ((value: RawJournalSnapshot) => RawJournalSnapshot)[] = [
        value => ({...value, request: {...value.request, username: "another"}}),
        value => ({...value, request: {...value.request, calendarNow: {year: 2025, month: 9}}}),
        value => ({...value, request: {...value.request, calendarNow: {year: 2026, month: 8}}}),
        value => ({...value, request: {...value.request, page: {kind: "recent", skip: 1, itemshow: 20}}}),
        value => ({...value, request: {...value.request, page: {kind: "recent", skip: 0, itemshow: 19}}}),
        value => ({...value, request: {...value.request, page: {kind: "entry", ditemid: 384}}}),
    ];
    let renders = 0, keys = 0, rechecks = 0;
    t.mock.method(Renderer.prototype, "render", async () => {renders++; return "<html>not reached</html>";});
    for (const mutate of mutations) {
        const repository: RawRecentRepository = {
            async loadRawSnapshot(request) {
                assert.deepEqual(request.calendarNow, {year: 2026, month: 9});
                assert.ok(Object.isFrozen(request) && Object.isFrozen(request.page) && Object.isFrozen(request.calendarNow));
                return mutate(selected(request));
            },
            async revalidateFingerprint() {rechecks++; return true;}, async close() {},
        };
        const service = await createComparisonRecentService({repository, config, capabilities, limits, artifact,
            secretSource: {async loadLatestSecret() {keys++; return {stime: now, secret};}}}, entropy);
        try {assert.deepEqual(await service.serve(recent), {ok: false, reason: "unsupported"});}
        finally {await service.close();}
    }
    assert.equal(keys, 0); assert.equal(renders, 0); assert.equal(rechecks, 0);
});

test("persistent relevant changes discard buffered HTML and final reread remains last await", async t => {
    for (const change of ["private", "rename", "move", "window", "style", "settings", "calendar", "spamreport", "none"]) {
        const order: string[] = [];
        let data: RawJournalSnapshot | null = null;
        let current: RawJournalSnapshot | null = null;
        const repository: RawRecentRepository = {
            async loadRawSnapshot(request) {order.push("load"); data = selected(request); current = data; return data;},
            async revalidateFingerprint(value) {
                order.push("recheck");
                assert.equal(value, data);
                assert.equal(value.entries.length, 1);
                assert.equal(value.selection.kind, "entry");
                assert.deepEqual(value.request.page, {kind: "entry", ditemid: 384});
                return JSON.stringify(value) === JSON.stringify(current);
            }, async close() {throw new Error("repository remains server-owned");},
        };
        const render = t.mock.method(Renderer.prototype, "render", async (input: RenderInput) => {
            order.push("render");
            assert.equal(input.journal.username, "7_real");
            assert.equal(input.journal.baseUrl, "http://localhost:8080/~7_real");
            assert.equal(input.journal.entries.length, 1);
            assert.equal(input.journal.entries[0]!.id, 384);
            assert.equal(input.skip, 0); assert.equal(input.skipPresent, false);
            for (const forbidden of ["fingerprint", "publicSettings", "spamreportBans", "moveInProgressMask", "database", secret.toString()]) {
                assert.ok(!JSON.stringify(input).includes(forbidden), forbidden);
            }
            assert.ok(current);
            switch (change) {
                case "private": current = {...current, entries: [{...current.entries[0]!, security: "private"}]}; break;
                case "rename": current = {...current, owner: {...current.owner, user: "renamed"}}; break;
                case "move": current = {...current, owner: {...current.owner, clusterid: 19}}; break;
                case "window": current = {...current, entries: []}; break;
                case "style": current = {...current, style: {...current.style!, modtime: now + 1}}; break;
                case "settings": current = {...current, owner: {...current.owner, publicSettings: {
                    ...current.owner.publicSettings, adult_content: "explicit"}}}; break;
                case "calendar": current = {...current, calendar: {...current.calendar, days: [{day: 24, count: 3}]}}; break;
                case "spamreport": current = {...current, features: {...current.features, spamreportBans: 1}}; break;
            }
            return "<html>BUFFERED_PUBLIC_HTML</html>";
        });
        const service = await createComparisonRecentService({repository, config, capabilities, limits, artifact,
            secretSource: {async loadLatestSecret() {order.push("secret"); return {stime: now, secret};}}}, entropy);
        try {
            const result = await service.serveEntry({method: "HEAD", username: "7_real", ditemid: 384, uniqCookie: null});
            assert.deepEqual(order, ["load", "secret", "render", "recheck"]);
            if (change === "none") {assert.equal(result.ok, true);}
            else assert.deepEqual(result, {ok: false, reason: "changed"}, change);
        } finally {await service.close(); render.mock.restore();}
    }
});

test("configured private listener admits multiple canonical journals and finite source destinations", () => {
    const app = {...config, listenOrigin: "http://viewer.example.test:8081", canonicalAppOrigin: "https://app.example.test",
        siteRoot: "/dw", statPrefix: "/assets/css", jsPrefix: "/assets/js", imgPrefix: "/assets/img",
        entryContent: {...config.entryContent, imagePlaceholder: {...config.entryContent.imagePlaceholder,
            src: "/assets/img/imageplaceholder2.png"}}};
    const decide = createRedirectAdmission(app);
    const request = {method: "GET", rawTarget: "", host: "viewer.example.test:8081", origin: null,
        hasForwardedHeaders: false, hasAuthorization: false, cookieHeader: null};
    for (const username of ["ordinary", "7_real", "_real", "a".repeat(25)]) {
        for (const skip of [0, 79, 80, 81, 200, 201, Number.MAX_SAFE_INTEGER]) {
            assert.deepEqual(decide({...request, rawTarget: `/users/${username}/?skip=${skip}`}),
                {kind: "recent", request: {method: "GET", username, skip, skipPresent: true, uniqCookie: null}});
        }
        assert.deepEqual(decide({...request, rawTarget: `/users/${username}/384.html`}),
            {kind: "entry", request: {method: "GET", username, ditemid: 384, uniqCookie: null}});
        for (const rawTarget of [`/dw/tools/memories?user=${username}`,
            `/dw/tools/memadd?journal=${username}&itemid=384`,
            `/dw/openid/?returnto=https://app.example.test/users/${username}/?skip=201`]) {
            assert.deepEqual(decide({...request, rawTarget}), {kind: "redirect", status: 307,
                location: app.canonicalAppOrigin + rawTarget});
        }
    }
    for (const rawTarget of ["/assets/css/??lj_base.css?v=1790294400", "/assets/js/??jquery/a.js?v=1790294400",
        "/assets/img/silk/identity/user.png", "/dw/support/faq"]) {
        assert.equal(decide({...request, rawTarget}).kind, "redirect", rawTarget);
    }
    for (const rawTarget of ["/dw/login", "/dw/multisearch"]) {
        assert.equal(decide({...request, rawTarget, method: "POST", origin: app.listenOrigin}).kind, "redirect");
    }
    for (const rawTarget of ["/users/UPPER/", "/users/with-hyphen/", "/users/a%2fb/", "/users/é/",
        "/users/" + "a".repeat(26) + "/", "/users/ordinary/?skip=9007199254740992",
        "/users/ordinary/384.html?mode=reply", "/assets/img/../config.pl", "/stc/lj_base.css",
        "/dw/openid/?returnto=https://evil.test/users/ordinary/", "/dw/tools/memadd?journal=a&itemid=384&url=x"]) {
        assert.equal(decide({...request, rawTarget}).kind, "reject", rawTarget);
    }
});

test("Recent selected bodies are not sliced again and original canonical skip stays separate", async t => {
    let expectedSkip = 0;
    let rendered: RenderInput | null = null;
    const repository: RawRecentRepository = {
        async loadRawSnapshot(request) {
            assert.deepEqual(request.page, {kind: "recent", skip: expectedSkip, itemshow: 20});
            return selected(request);
        }, async revalidateFingerprint(value) {
            assert.equal(value.request.page.kind, "recent");
            return true;
        }, async close() {},
    };
    t.mock.method(Renderer.prototype, "render", async (input: RenderInput) => {
        rendered = input;
        assert.equal(input.skip, expectedSkip);
        assert.equal(input.skipPresent, true);
        assert.deepEqual(input.page, {kind: "recent", pageSkip: Math.min(expectedSkip, 80),
            itemshow: 20, maxScrollback: 100, hasPrevious: false});
        assert.equal(input.journal.entries.length, expectedSkip === 0 ? 2 : 0);
        return "<html>COMPLETE_SELECTED_PAGE</html>";
    });
    const service = await createComparisonRecentService({repository, config, capabilities, limits, artifact,
        secretSource: {async loadLatestSecret() {return {stime: now, secret};}}}, entropy);
    try {
        for (const skip of [0, 79, 80, 81, 200, 201, Number.MAX_SAFE_INTEGER]) {
            expectedSkip = skip; rendered = null;
            assert.equal((await service.serve({...recent, skip, skipPresent: true})).ok, true);
            assert.notEqual(rendered, null);
        }
        assert.deepEqual(await service.serve({...recent, skip: 1, skipPresent: false}),
            {ok: false, reason: "unsupported"});
    } finally {await service.close();}
});

// render.test.ts
//
// Real child isolation and privacy decision adversarial tests.
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
import {readFileSync, openSync, closeSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {validateArtifact, instantiate} from "../render/artifact";
import {Context} from "../../runtime/s2runtime";
import {prepare} from "../render/prepare";
import {Renderer, childArguments} from "../render/child";
import {loadResourceTimes} from "../render/resources";
import {approveSnapshot} from "../policy/cohort";
import {createComparisonRecentService} from "../policy/comparison";
import {createAnonymousRecentService} from "../policy/service";
import {config, limits, now, snapshot} from "./fixtures";
import type {AnonymousRecentServiceDeps, RawJournalSnapshot} from "../contracts";

const path = process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice3-stock.json";
const artifact = validateArtifact(JSON.parse(readFileSync(path, "utf8")));
const inputs = {purpose: "offline-perl-comparison" as const, clock: {nowSeconds: () => now},
    random: {randomBytes: (n: number) => new Uint8Array(n)}};
const request = {method: "GET" as const, username: "s2js_slice3", skip: 0, skipPresent: false,
    uniqCookie: "AAAAAAAAAAAAAAA:1790294400:x"};
function dependencies(data: () => RawJournalSnapshot): AnonymousRecentServiceDeps {
    return {repository: {loadRawSnapshot: async () => structuredClone(data()),
        revalidateFingerprint: async old => JSON.stringify(old) === JSON.stringify(data()),
        close: async () => {}}, secretSource: {loadLatestSecret: async () => ({stime: now,
            secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")})},
        config, limits, artifact: {path}};
}

test("real isolated child initializes source defaults and prints live Unicode", async () => {
    const renderer = new Renderer(artifact, path + ".sandbox", limits);
    const input = {journal: approveSnapshot(snapshot()), config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "public-test-challenge", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
    try {
        const html = await renderer.render(input);
        assert.ok(html.startsWith("<!DOCTYPE"));
        assert.ok(html.includes("Live sample 2 café"));
        assert.ok(html.includes("<p>Fixture 1: café &amp; tea 😀</p>"));
        assert.ok(html.includes('action="/login"'));
        assert.ok(html.includes("id='statistics'"));
        assert.ok(html.includes("</html>"));
        assert.ok(!html.includes("undefined"));
        const updated = await renderer.render({...input, journal: {...input.journal, entries: [
            {...input.journal.entries[0]!, subject: "New public edit"}]}});
        assert.ok(updated.includes("New public edit"));
        assert.ok(!updated.includes("Live sample 1"));
    } finally {await renderer.close();}
});
test("artifact executable bytes cannot be changed by retaining source provenance", () => {
    const edited = {...artifact, layers: artifact.layers.map((v, i) => i ? v : {...v, code: v.code + "\n"})};
    assert.throws(() => validateArtifact(edited));
});
test("real child denies credential files, writes, subprocesses, threads and network", () => {
    const script = resolve(__dirname, "sandbox-probe.js");
    const args = childArguments(limits, script);
    args.splice(args.length - 1, 0, "--allow-fs-read=" + script);
    const descriptor = openSync(path, "r");
    const result = spawnSync(path + ".sandbox", args, {env: {LANG: "C.UTF-8", TZ: "UTC"},
        stdio: ["ignore", "pipe", "pipe", descriptor], timeout: 5000, encoding: "utf8"});
    closeSync(descriptor);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TCP\/Unix\/listen\/UDP denied/);
});
test("real child fails on output and deadline limits, and close stops active render", async () => {
    const input = {journal: approveSnapshot(snapshot()), config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
    for (const changedLimits of [{...limits, maxOutputBytes: 20}, {...limits, timeoutMs: 1}]) {
        const renderer = new Renderer(artifact, path + ".sandbox", changedLimits);
        try {await assert.rejects(renderer.render(input));} finally {await renderer.close();}
    }
    const renderer = new Renderer(artifact, path + ".sandbox", limits);
    const result = renderer.render(input);
    const rejected = assert.rejects(result);
    await renderer.close();
    await rejected;
    await assert.rejects(renderer.render(input));
});
test("revocation during real child rendering prevents all HTML; next request sees private state", async () => {
    let current = snapshot();
    const deps = dependencies(() => current);
    let mutationRan = false;
    let rechecked = false;
    const service = await createComparisonRecentService({...deps, repository: {
        ...deps.repository,
        loadRawSnapshot: async () => {
            const raw = structuredClone(current);
            setImmediate(() => {
                current = {...current, entries: current.entries.map(e => ({...e, security: "private"}))};
                mutationRan = true;
            });
            return raw;
        },
        revalidateFingerprint: async old => {
            assert.equal(mutationRan, true); rechecked = true;
            return JSON.stringify(old) === JSON.stringify(current);
        },
    }}, inputs);
    try {
        assert.deepEqual(await service.serve(request), {ok: false, reason: "changed"});
        assert.equal(rechecked, true);
        const next = await service.serve(request);
        assert.equal(next.ok, true);
        if (next.ok) assert.ok(!next.html.includes("Live sample"));
    } finally {await service.close();}
});
test("fresh recheck I/O failure, unsupported snapshot, absent key and closed service fail safely", async () => {
    const data = snapshot();
    const deps = dependencies(() => data);
    const variants = [
        {...deps, repository: {...deps.repository, revalidateFingerprint: async () => {throw new Error("SECRET_SQL");}}},
        {...deps, secretSource: {loadLatestSecret: async () => null}},
        {...deps, repository: {...deps.repository, loadRawSnapshot: async () => ({...data, owner: {...data.owner, statusvis: "S"}})}},
    ];
    for (const variant of variants) {
        const service = await createComparisonRecentService(variant, inputs);
        const result = await service.serve(request);
        assert.equal(result.ok, false);
        assert.ok(!JSON.stringify(result).includes("SECRET_SQL"));
        await service.close();
        assert.deepEqual(await service.serve(request), {ok: false, reason: "unavailable"});
    }
});
test("ordinary entrypoint refuses injected entropy and uses wallclock/random", async () => {
    const deps = dependencies(snapshot);
    await assert.rejects(createAnonymousRecentService({...deps, clock: inputs.clock} as any));
    let observedNow = 0;
    const live = await createAnonymousRecentService({...deps, secretSource: {loadLatestSecret: async t => {
        observedNow = t;
        return {stime: t - t % 3600, secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};
    }}});
    try {
        assert.deepEqual(await live.serve({...request, skip: 1, skipPresent: false}),
            {ok: false, reason: "unsupported"});
        const a = await live.serve(request), b = await live.serve(request);
        assert.ok(Math.abs(observedNow - Date.now() / 1000) < 10);
        assert.ok(a.ok && b.ok);
        if (a.ok && b.ok) assert.notEqual(a.html, b.html);
    } finally {await live.close();}
});

test("explicit skip zero preserves canonical request echoes without changing selection", async () => {
    const service = await createComparisonRecentService(dependencies(snapshot), inputs);
    try {
        const result = await service.serve({...request, skipPresent: true});
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.ok(result.html.includes('value="http://localhost:8080/users/s2js_slice3/?skip=0"'));
            assert.ok(result.html.includes('args=skip%3D0&view='));
            assert.ok(result.html.includes('Live sample 2'));
        }
    } finally {await service.close();}
});

test("retained page80/loader79 clamps preserve mixed-public selection and request echoes", async () => {
    const data = snapshot();
    const rows = Array.from({length: 180}, (_, i) => {
        const n = i + 1;
        const time = new Date((now - 86400 + n) * 1000).toISOString().slice(0, 19).replace("T", " ");
        return {...data.entries[0]!, jitemid: n, anum: 0, eventtime: time, logtime: time,
            revttime: 2147483647 - (now - 86400 + n), security: n % 3 === 0 ? "private" : "public",
            subjectText: `Row ${n}`, eventText: n % 3 === 0 ? "PRIVATE_SENTINEL" : `Public ${n}`};
    });
    const journal = approveSnapshot({...data, entries: rows});
    assert.equal(journal.entries.length, 120);
    for (const skip of [79, 80, 81, 200]) {
        const input = {journal, config, skip, skipPresent: true, nowSeconds: now,
            formChallenge: "public-test", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
        const page = prepare(input, new Context(instantiate(artifact), () => {}));
        assert.equal(page.entries.length, 20);
        assert.equal(page.entries[0].itemid, 61 * 256);
        assert.equal(page.entries[19].itemid, 32 * 256);
        assert.equal(page.nav.skip, skip === 79 ? 79 : 80);
        assert.equal(page.nav._forward_url, `http://localhost:8080/~s2js_slice3/?skip=${skip === 79 ? 59 : 60}`);
        assert.equal(page.nav._backward_url, skip === 79
            ? "http://localhost:8080/~s2js_slice3/?skip=99"
            : "http://localhost:8080/~s2js_slice3/2026/09/24");
        const renderer = new Renderer(artifact, path + ".sandbox", limits);
        try {
            const html = await renderer.render(input);
            assert.ok(html.includes(`value="http://localhost:8080/users/s2js_slice3/?skip=${skip}"`));
            assert.ok(!html.includes("PRIVATE_SENTINEL"));
        } finally {await renderer.close();}
    }
});

test("exactly full final page retains the empty previous-link corner", () => {
    const data = snapshot();
    const journal = approveSnapshot({...data, entries: Array.from({length: 20}, (_, i) => ({
        ...data.entries[0]!, jitemid: i + 1,
    }))});
    const page = prepare({journal, config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()},
        new Context(instantiate(artifact), () => {}));
    assert.equal(page.nav._backward_count, 20);
    assert.equal(page.nav._backward_url, undefined);
});

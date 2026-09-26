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
import {calendar} from "../render/calendar";
import {Renderer, childArguments} from "../render/child";
import {verifyRuntime} from "../render/manifest";
import {loadResourceTimes} from "../render/resources";
import {approveSnapshot as approveRawSnapshot} from "../policy/cohort";
import {rawBody, Unsupported} from "../policy/content";
import {createComparisonRecentService} from "../policy/comparison";
import {createAnonymousRecentService} from "../policy/service";
import {config, capabilities, limits, now, snapshot, selectFixture} from "./fixtures";
import type {AnonymousRecentServiceDeps, RawJournalSnapshot} from "../contracts";
import type {RenderContentPreparation, RenderPage} from "../render/types";

const approveSnapshot = (data: RawJournalSnapshot) =>
    approveRawSnapshot(selectFixture(data, data.request.page), config, capabilities);
const recentPage: RenderPage = {kind: "recent", pageSkip: 0, itemshow: 20, maxScrollback: 100, hasPrevious: false};
const path = process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice3-stock.json";
const runtime = verifyRuntime(path);
const artifact = validateArtifact(JSON.parse(readFileSync(path, "utf8")));
const inputs = {purpose: "offline-perl-comparison" as const, clock: {nowSeconds: () => now},
    random: {randomBytes: (n: number) => new Uint8Array(n)}};
const request = {method: "GET" as const, username: "s2js_slice3", skip: 0, skipPresent: false,
    uniqCookie: "AAAAAAAAAAAAAAA:1790294400:x"};
// Existing direct Recent model tests inspect pagination only. Actual rendering
// tests below still exercise the real worker's shared cleaner, never this helper.
const rawRecentContent: RenderContentPreparation = {
    subject: entry => ({html:entry.subject,recentHtml:entry.subject,all:entry.subject}) as
        import("@dreamwidth/content/contracts").SubjectPreparation,
    body: entry => entry.rawBody,
    metadata() {throw new Error("Recent preparation must not request metadata");},
};
function dependencies(data: () => RawJournalSnapshot): AnonymousRecentServiceDeps {
    return {repository: {loadRawSnapshot: async request => ({...selectFixture(structuredClone(data()), request.page), request}),
        revalidateFingerprint: async old => JSON.stringify(old) === JSON.stringify({...selectFixture(data(), old.request.page), request: old.request}),
        close: async () => {}}, secretSource: {loadLatestSecret: async () => ({stime: now,
            secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")})},
        config, capabilities, limits, artifact: {path}};
}

test("real isolated child initializes source defaults and prints live Unicode", async () => {
    const renderer = new Renderer(artifact, path + ".sandbox", limits, runtime);
    const input = {page: recentPage, journal: approveSnapshot(snapshot()), config, skip: 0, skipPresent: false, nowSeconds: now,
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
test("one actual isolated worker cleans raw rich text before stock rendering and recovers after refusal", async () => {
    const data = snapshot();
    const body = '<p id="source-id" class="entry-positive" style="position:relative;color:red">' +
        '<a target="_blank" href="/body-destination">link</a>' +
        '<span style="--p:\\66 ixed;position:var(--p)">static</span></p>' +
        '<lj-cut text="More">HIDDEN_CUT_PAYLOAD</lj-cut>';
    assert.equal(rawBody(body), body, "parent keeps tainted markup; no parser or sanitation");
    const journal = approveSnapshot({...data, entries: [
        {...data.entries[0]!, eventText: body},
        {...data.entries[1]!, security: "private", eventText: '<video>PRIVATE_UNSUPPORTED</video>'},
    ]});
    assert.equal(journal.entries[0]!.rawBody, body);
    assert.ok(!JSON.stringify(journal).includes("PRIVATE_UNSUPPORTED"));
    const input = {page: recentPage, journal, config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "public-test-challenge", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
    const renderer = new Renderer(artifact, path + ".sandbox", limits, runtime);
    const withBody = (value: string) => ({...input, journal: {...journal,
        entries: [{...journal.entries[0]!, rawBody: value}]}});
    try {
        const rich = await renderer.render(input);
        for (const marker of ['class="entry-positive"', 'position:relative;color:red',
            'target="_blank" href="http://localhost:8080/body-destination"',
            '--p:66 ixed;position:var(--p)', 'cut-wrapper', '#cutid1']) assert.ok(rich.includes(marker), marker);
        for (const marker of ['id="source-id"', 'HIDDEN_CUT_PAYLOAD', 'PRIVATE_UNSUPPORTED', '\\66']) {
            assert.ok(!rich.includes(marker), marker);
        }
        for (const value of ['<video>unsupported</video>', '<div>'.repeat(17) + 'deep' + '</div>'.repeat(17),
            '<br>'.repeat(4097), '<head><p>HEAD_PRIVATE_SENTINEL</p>',
            '<p>visible</p><head title="<td>decoy</td>"><p>HEAD_PRIVATE_SENTINEL</p>']) {
            await assert.rejects(renderer.render(withBody(value)), Unsupported);
            assert.ok((await renderer.render(withBody('<p>recovery</p>'))).includes('<p>recovery</p>'));
        }
        for (const [raw, clean] of [['<p>unterminated', '<p>unterminated</p>'],
            ['<a href="javascript:alert(1)">link</a>', '<a>link</a>'],
            ['<script>UNSAFE_SCRIPT_SENTINEL</script>', '']]) {
            const page = await renderer.render(withBody(raw!));
            assert.ok(page.includes(data.entries[0]!.subjectText));
            if (clean) assert.ok(page.includes(clean));
            assert.ok(!page.includes('UNSAFE_SCRIPT_SENTINEL') && !page.includes('javascript:alert(1)'));
        }
    } finally {await renderer.close();}
});

test("parent raw-text admission retains UTF8 bounds independently of child parsing", () => {
    for (const value of ['<script>tainted</script>', '<p>unterminated', '😀'.repeat(16384)]) {
        assert.equal(rawBody(value), value);
    }
    for (const value of ['x'.repeat(65537), '😀'.repeat(16385), '\ud800', '\udc00']) {
        assert.throws(() => rawBody(value), Unsupported);
    }
});
test("real child denies credential files, writes, subprocesses, threads and network", () => {
    const script = resolve(__dirname, "sandbox-probe.js");
    const args = childArguments(limits, runtime, script);
    args.splice(args.length - 1, 0, "--allow-fs-read=" + script);
    const descriptor = openSync(path, "r");
    const result = spawnSync(path + ".sandbox", args, {env: {LANG: "C.UTF-8", TZ: "UTC"},
        stdio: ["ignore", "pipe", "pipe", descriptor], timeout: 5000, encoding: "utf8"});
    closeSync(descriptor);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TCP\/Unix\/listen\/UDP denied/);
});
test("real child fails on output and deadline limits, and close stops active render", async () => {
    const input = {page: recentPage, journal: approveSnapshot(snapshot()), config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
    for (const changedLimits of [{...limits, maxOutputBytes: 20}, {...limits, timeoutMs: 1}]) {
        const renderer = new Renderer(artifact, path + ".sandbox", changedLimits, runtime);
        try {await assert.rejects(renderer.render(input));} finally {await renderer.close();}
    }
    const renderer = new Renderer(artifact, path + ".sandbox", limits, runtime);
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
        loadRawSnapshot: async captured => {
            const raw = {...selectFixture(structuredClone(current), captured.page), request: captured};
            setImmediate(() => {
                current = {...current, entries: current.entries.map(e => ({...e, security: "private"}))};
                mutationRan = true;
            });
            return raw;
        },
        revalidateFingerprint: async old => {
            assert.equal(mutationRan, true); rechecked = true;
            return JSON.stringify(old) === JSON.stringify({...selectFixture(current, old.request.page), request: old.request});
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
    for (const skip of [79, 80, 81, 200]) {
        const selected = selectFixture({...data, entries: rows}, {kind: "recent", skip, itemshow: 20});
        const journal = approveRawSnapshot(selected, config, capabilities);
        assert.equal(journal.entries.length, 20);
        if (selected.selection.kind !== "recent") throw new Error("fixture selection");
        const selection = selected.selection;
        const input = {page: {kind: "recent" as const, pageSkip: selection.pageSkip, itemshow: selection.itemshow,
            maxScrollback: selection.maxScrollback, hasPrevious: selection.window.length > selection.itemshow}, journal, config, skip, skipPresent: true, nowSeconds: now,
            formChallenge: "public-test", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
        const page = prepare(input, new Context(instantiate(artifact), () => {}), rawRecentContent);
        assert.equal(page.entries.length, 20);
        assert.equal(page.entries[0].itemid, 61 * 256);
        assert.equal(page.entries[19].itemid, 32 * 256);
        assert.equal(page.nav.skip, skip === 79 ? 79 : 80);
        assert.equal(page.nav._forward_url, `http://localhost:8080/~s2js_slice3/?skip=${skip === 79 ? 59 : 60}`);
        assert.equal(page.nav._backward_url, skip === 79
            ? "http://localhost:8080/~s2js_slice3/?skip=99"
            : "http://localhost:8080/~s2js_slice3/2026/09/24");
        const renderer = new Renderer(artifact, path + ".sandbox", limits, runtime);
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
    const page = prepare({page: recentPage, journal, config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()},
        new Context(instantiate(artifact), () => {}), rawRecentContent);
    assert.equal(page.nav._backward_count, 20);
    assert.equal(page.nav._backward_url, undefined);
});

test("future-only current-year calendar retains the source month-zero edge", () => {
    const journal = approveSnapshot(snapshot());
    const future = {...journal, calendar: {year: 2026, month: 0, days: [], previous: null,
        next: {year: 2026, month: 11}}, entries: journal.entries.map(e => ({...e,
        eventtime: "2026-11-01 00:00:00", year: 2026, month: 11, day: 1}))};
    const base = "http://localhost:8080/~s2js_slice3";
    const month = calendar({page: recentPage, journal: future, config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "", uniq: "AAAAAAAAAAAAAAA", resourceTimes: {}}, base, false);
    // Independently probed S2::Builtin::LJ::Page__get_latest_month + YearMonth
    // with synthetic November counts and the September comparison clock.
    assert.equal(month.year, 2026);
    assert.equal(month.month, 0);
    assert.equal(month.weeks.length, 0);
    assert.equal(month.url, base + "/2026/00/");
    assert.equal(month._next_url, base + "/2026/11/");
});


test("48KiB of discarded wrapper starts produces typed refusal before worker deadline", async t => {
    const data = snapshot();
    const body = '<body>'.repeat(8000);
    assert.equal(Buffer.byteLength(body), 48000);
    const journal = approveSnapshot({...data, entries: [{...data.entries[0]!, eventText: body}]});
    const input = {page: recentPage, journal, config, skip: 0, skipPresent: false, nowSeconds: now,
        formChallenge: "public-test-challenge", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
    const renderer = new Renderer(artifact, path + ".sandbox", limits, runtime);
    const started = performance.now();
    try {
        // Timeout/output/protocol failures are Error, not Unsupported. Merely
        // killing this expensive job at its deadline cannot satisfy this test.
        await assert.rejects(renderer.render(input), Unsupported);
        t.diagnostic(`typed wrapper-work refusal in ${Math.round(performance.now() - started)}ms`);
        const recovered = await renderer.render({...input, journal: {...journal,
            entries: [{...journal.entries[0]!, rawBody: '<p>after bounded refusal</p>'}]}});
        assert.ok(recovered.includes('<p>after bounded refusal</p>'));
    } finally { await renderer.close(); }
});

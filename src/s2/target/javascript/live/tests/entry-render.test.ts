// entry-render.test.ts
//
// Entry body/metadata preparation and revocation through the actual render child.
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
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Renderer} from "../render/child";
import {verifyRuntime} from "../render/manifest";
import {validateArtifact} from "../render/artifact";
import {loadResourceTimes} from "../render/resources";
import {approveSnapshot as approveRawSnapshot} from "../policy/cohort";
import {Unsupported} from "../policy/content";
import {createComparisonRecentService} from "../policy/comparison";
import type {RenderInput, RenderPage} from "../render/types";
import type {RawJournalSnapshot} from "../contracts";
import {snapshot, selectFixture, config, capabilities, limits, now} from "./fixtures";

const approveSnapshot = (data: RawJournalSnapshot) =>
    approveRawSnapshot(selectFixture(data, data.request.page), config, capabilities);
const recentPage: RenderPage = {kind: "recent", pageSkip: 0, itemshow: 20, maxScrollback: 100, hasPrevious: false};
const {JSDOM} = require(resolve(__dirname, "../../../../../../content/node_modules/jsdom"));
const path = process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice5-stock.json";
const runtime = verifyRuntime(path);
const artifact = validateArtifact(JSON.parse(readFileSync(path, "utf8")));
const input = (body: string, page: RenderPage = {kind: "entry", ditemid: 384}): RenderInput => {
    const data = snapshot();
    return {page, journal: approveSnapshot({...data, request: {...data.request, page: page.kind === "entry" ? page :
        {kind: "recent", skip: 0, itemshow: 20}}, entries: [
        {...data.entries[0]!, subjectText: "Selected café 😀", eventText: body},
        {...data.entries[1]!, subjectText: "OTHER_PUBLIC_SUBJECT", eventText: "OTHER_PUBLIC_BODY"},
    ]}), config, skip: 0, skipPresent: false, nowSeconds: now,
    formChallenge: "public-test-challenge", uniq: "AAAAAAAAAAAAAAA", resourceTimes: loadResourceTimes()};
};
const renderer = () => new Renderer(artifact, path + ".sandbox", limits, runtime);

test("one actual child prepares full selected body and independent inert OG metadata", async () => {
    const child = renderer();
    const raw = '<p class="entry-positive">A &amp; B</p><lj-cut><p>CUT_BODY</p></lj-cut>';
    try {
        const html = await child.render(input(raw));
        const dom = new JSDOM(html);
        try {
            const document = dom.window.document;
            assert.equal(document.querySelectorAll('.entry-content').length, 1);
            assert.equal(document.querySelector('.entry-content').innerHTML,
                '<p class="entry-positive">A &amp; B</p><a name="cutid1"></a><p>CUT_BODY</p>');
            assert.equal(document.querySelector('meta[property="og:description"]').content,
                '<p class="entry-positive">A &amp; B</p><p>CUT_BODY</p>');
            assert.equal(document.querySelector('meta[property="og:title"]').content, 'Selected café 😀');
            assert.equal(document.querySelector('meta[property="og:type"]').content, 'article');
            assert.equal(document.querySelectorAll('.entry-content script,.entry-content [id]').length, 0);
            assert.ok(document.querySelector('#comments'));
            assert.ok(document.querySelector('#ljqrttopcomment[data-quickreply-container="topcomment"]'));
            assert.ok(html.includes('LJ_cmtinfo'));
            assert.ok(!html.includes('OTHER_PUBLIC_SUBJECT') && !html.includes('OTHER_PUBLIC_BODY'));
        } finally {dom.window.close();}
        const recent = await child.render(input(raw, recentPage));
        assert.ok(!recent.includes('CUT_BODY'));
        assert.ok(recent.includes('OTHER_PUBLIC_SUBJECT'));
        assert.ok(recent.includes('cut-wrapper'));
    } finally {await child.close();}
});

test("Entry and Recent body URLs use the canonical journal base while metadata stays literal", async () => {
    const child = renderer();
    const raw = '<p class="origin-probe"><a href="notes">notes</a>' +
        '<a href="../archive">archive</a><img src="pic.png">' +
        '<a href="#local">local</a></p>';
    try {
        for (const page of [{kind: "entry", ditemid: 384}, recentPage] as const) {
            const dom = new JSDOM(await child.render(input(raw, page)));
            try {
                const document = dom.window.document;
                const body = document.querySelector('.entry-content .origin-probe');
                assert.ok(body, page.kind);
                assert.deepEqual([...body.querySelectorAll('a')].map((a: Element) => a.getAttribute('href')), [
                    'http://localhost:8080/~s2js_slice3/notes',
                    'http://localhost:8080/archive', '#local',
                ], page.kind);
                assert.equal(body.querySelector('img').getAttribute('src'),
                    'http://localhost:8080/~s2js_slice3/pic.png', page.kind);
                if (page.kind === "entry") {
                    const metadata = document.querySelector('meta[property="og:description"]').content;
                    for (const literal of ['href="notes"', 'href="../archive"', 'src="pic.png"', 'href="#local"']) {
                        assert.ok(metadata.includes(literal), literal);
                    }
                    assert.ok(!metadata.includes(config.canonicalAppOrigin));
                }
            } finally {dom.window.close();}
        }
    } finally {await child.close();}
});

test("body or metadata refusal sends no partial page and next actual child request recovers", async () => {
    const child = renderer();
    try {
        for (const raw of [
            '<p>safe</p><lj-cut><template>HIDDEN_UNSUPPORTED</template></lj-cut>',
            'Hello @person', '<textarea>\n<b>t</b></textarea>',
        ]) {
            await assert.rejects(child.render(input(raw)), Unsupported);
            const recovered = await child.render(input('<p>RECOVERED</p>'));
            assert.ok(recovered.includes('<p>RECOVERED</p>'));
        }
        // The metadata-only mention limitation must not narrow html_raw0 Recent.
        assert.ok((await child.render(input('Hello @person', recentPage))).includes('Hello @person'));
        const safe = await child.render(input('<p>&lt;/meta&gt;&lt;script&gt;OG_INERT&lt;/script&gt;</p>'));
        const dom = new JSDOM(safe);
        try {
            const document = dom.window.document;
            assert.equal(document.querySelectorAll('.entry-content script').length, 0);
            assert.ok(document.querySelector('meta[property="og:description"]').content.includes('OG_INERT'));
            assert.equal(document.querySelector('.entry-content').textContent, '</meta><script>OG_INERT</script>');
        } finally {dom.window.close();}
    } finally {await child.close();}
});

test("worker rejects inconsistent entry page identity and Recent pagination fields", async () => {
    const child = renderer();
    try {
        const base = input('<p>selected</p>');
        for (const changed of [
            {...base, skip: 1, skipPresent: true}, {...base, skipPresent: true},
            ...[0, 1, 385, -1, 4294967296, 384.5].map(ditemid => ({...base, page: {kind: "entry" as const, ditemid}})),
            {...base, page: {kind: "unknown"}}, {...base, page: undefined},
        ]) await assert.rejects(child.render(changed as RenderInput), Unsupported);
        assert.ok((await child.render(base)).includes('<p>selected</p>'));
    } finally {await child.close();}
});

test("positive typed spamreport count refuses entry before render and leaves actual Recent rendering available", async () => {
    const data = snapshot();
    const withBan = {...data, features: {...data.features, spamreportBans: 1}};
    let secrets = 0, rechecks = 0;
    let loadedSnapshot: RawJournalSnapshot | null = null;
    const service = await createComparisonRecentService({config, capabilities, limits, artifact: {path},
        repository: {async loadRawSnapshot(request) {
                loadedSnapshot = {...selectFixture(withBan, request.page), request}; return loadedSnapshot;},
            async revalidateFingerprint(loaded) {rechecks++; assert.equal(loaded, loadedSnapshot); return true;},
            async close() {}},
        secretSource: {async loadLatestSecret() {secrets++; return {stime: now,
            secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};}},
    }, {purpose: "offline-perl-comparison", clock: {nowSeconds: () => now},
        random: {randomBytes: n => new Uint8Array(n)}});
    try {
        const common = {method: "GET" as const, username: "s2js_slice3", uniqCookie: "AAAAAAAAAAAAAAA:1790294400:x"};
        assert.deepEqual(await service.serveEntry({...common, ditemid: 384}), {ok: false, reason: "unsupported"});
        assert.equal(secrets, 0, "Entry refusal precedes token and renderer");
        assert.equal(rechecks, 0);
        const recent = await service.serve({...common, skip: 0, skipPresent: false});
        assert.equal(recent.ok, true);
        if (recent.ok) assert.ok(recent.html.includes('Live sample 1 café'));
        assert.equal(secrets, 1);
        assert.equal(rechecks, 1);
    } finally {await service.close();}
});

test("selected nonrecent entry mutation during actual child render blocks release", async () => {
    const data = snapshot();
    const baseline: RawJournalSnapshot = {...data, entries: Array.from({length: 80}, (_, i) => ({...data.entries[0]!,
        jitemid: i + 1, revttime: data.entries[0]!.revttime + i, subjectText: `Public ${i + 1}`}))};
    const target = 80 * 256 + data.entries[0]!.anum;
    assert.ok(!approveSnapshot(baseline).entries.some(entry => entry.id === target));
    // Real child and service; repository generations are injected. Actual DB
    // status mutations and HTTP checks are separate acceptance evidence.
    for (const change of ["security", "anum", "cohort", "talk2", "replycount", "spamreport"] as const) {
        let current = baseline;
        let mutated = false, rechecks = 0, secrets = 0;
        const service = await createComparisonRecentService({config, capabilities, limits, artifact: {path},
            repository: {
                async loadRawSnapshot(request) {
                    const selected = selectFixture(current, request.page);
                    if (selected.entries.length === 0) return null;
                    const loaded = structuredClone({...selected, request});
                    if (!mutated) setImmediate(() => {
                        if (change === "cohort") current = {...current, owner: {...current.owner, statusvis: "S"}};
                        else if (change === "talk2") current = {...current, features: {...current.features, comments: 1}};
                        else if (change === "spamreport") current = {...current, features: {...current.features, spamreportBans: 1}};
                        else current = {...current, entries: current.entries.map(entry => entry.jitemid !== 80 ? entry :
                            change === "security" ? {...entry, security: "private", eventText: "PRIVATE_AFTER_REVOCATION"} :
                            change === "anum" ? {...entry, anum: (entry.anum + 1) % 256} : {...entry, replycount: 1})};
                        mutated = true;
                    });
                    return loaded;
                },
                async revalidateFingerprint(loaded) {
                    rechecks++;
                    assert.equal(mutated, true);
                    assert.equal(loaded.entries.length, 1);
                    return JSON.stringify(loaded) === JSON.stringify({...selectFixture(current, loaded.request.page), request: loaded.request});
                },
                async close() {},
            },
            secretSource: {async loadLatestSecret() {secrets++; return {stime: now,
                secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")};}},
        }, {purpose: "offline-perl-comparison", clock: {nowSeconds: () => now},
            random: {randomBytes: n => new Uint8Array(n)}});
        try {
            const request = {method: "GET" as const, username: "s2js_slice3", ditemid: target,
                uniqCookie: "AAAAAAAAAAAAAAA:1790294400:x"};
            assert.deepEqual(await service.serveEntry(request), {ok: false, reason: "changed"}, change);
            const second = await service.serveEntry(request);
            if (change === "talk2") {
                // Unrelated header inventory now supports ordinary comments;
                // the first persistent dependency change still revoked output.
                assert.equal(second.ok, true);
            } else assert.deepEqual(second, {ok: false,
                reason: change === "security" || change === "anum" ? "not-found" : "unsupported"}, change);
            assert.equal(rechecks, change === "talk2" ? 2 : 1, change);
            assert.equal(secrets, change === "talk2" ? 2 : 1, change);
        } finally {await service.close();}
    }
});

test("configured journal base governs child body URLs without exposing private startup facts", async () => {
    const child = renderer();
    const raw = '<p class="configured-origin"><a href="notes">notes</a>' +
        '<a href="../archive">archive</a><img src="pic.png"><a href="#local">local</a></p>';
    const pages: readonly RenderPage[] = [{kind: "entry", ditemid: 384}, recentPage];
    try {
        for (const baseUrl of ["https://ordinary.example.test", "https://app.example.test/users/_real"]) {
            for (const page of pages) {
                const original = input(raw, page);
                const username = baseUrl.includes("_real") ? "_real" : "ordinary";
                const html = await child.render({...original, journal: {...original.journal, username, baseUrl}});
                const dom = new JSDOM(html);
                try {
                    const body = dom.window.document.querySelector('.entry-content .configured-origin');
                    assert.ok(body);
                    const documentUrl: string = baseUrl + (page.kind === "entry" ? "/384.html" : "/");
                    assert.deepEqual([...body.querySelectorAll('a')].map((node: Element) => node.getAttribute('href')),
                        [new URL("notes", documentUrl).href, new URL("../archive", documentUrl).href, "#local"]);
                    assert.equal(body.querySelector('img').getAttribute('src'), new URL("pic.png", documentUrl).href);
                    if (page.kind === "entry") {
                        const description = dom.window.document.querySelector('meta[property="og:description"]').content;
                        assert.ok(description.includes('href="notes"') && !description.includes(baseUrl));
                    }
                    for (const forbidden of ["moveInProgressMask", "clusterPairActive", "saltFilePath", "password"])
                        assert.ok(!body.innerHTML.includes(forbidden));
                } finally {dom.window.close();}
            }
        }
    } finally {await child.close();}
});

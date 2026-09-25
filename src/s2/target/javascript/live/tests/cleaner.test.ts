// cleaner.test.ts
//
// Actual shared cleaner boundary, formatting and failure/recovery checks.
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
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import type {EntryContentContext, EntryContentResult, EntryContentInput} from "@dreamwidth/content/contracts";
import {config} from "./fixtures";

// Offline tests deliberately load the actual compiled shared package. Production
// parents import declarations only; their isolated child loads the same module.
const {createEntryCleaner} = require(resolve(__dirname, "../../../../../../content/dist")) as
    typeof import("@dreamwidth/content");
const limits = {maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096,
    maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096, maxImageCandidates: 256, maxCuts: 16};
const context: EntryContentContext = {
    policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow",
    documentUrl: "http://localhost:8080/~s2js_slice3/?skip=0",
    entryUrl: "http://localhost:8080/~s2js_slice3/436.html",
    journalUsername: "s2js_slice3", journalId: 6, entryId: 436,
    reader: {removeColors: false, removeSizes: false, removeFonts: false,
        maxImageWidth: null, maxImageHeight: null, placeholderUndefinedImageSize: false, extractImages: false},
    ...config.entryContent, cuts: "source-compatible-recent",
};
function html(result: EntryContentResult): string {
    assert.equal(result.kind, "ok", JSON.stringify(result));
    if (result.kind !== "ok") throw new Error("Not a fragment");
    return result.fragment.html;
}
function input(body: string, changed: Partial<EntryContentContext> = {}): EntryContentInput {
    return {body, format: "html_raw0", context: {...context, ...changed}};
}

test("actual cleaner preserves rich formatting, classes, names and broad inline CSS", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const output = html(cleaner.clean(input('<div id="source" class="foo bar"><a name="anchor" href="#anchor">go</a><font face="serif" color="red" size="4">old</font><table><tbody><tr><td>cell</td></tr></tbody></table><ruby>字<rt>reading</rt></ruby><details><summary>more</summary>text</details><p style="position:relative;left:2px;z-index:4;transform:rotate(2deg);display:grid;gap:1em;--brand:red;color:var(--brand)">café 😀</p></div>')));
        assert.ok(output.includes('class="foo bar"'));
        assert.ok(output.includes('name="anchor" href="#anchor"'));
        assert.ok(!output.includes('id="source"'));
        for (const marker of ['face="serif"', '<table>', '<ruby>', '<details>', 'position:relative',
            'left:2px', 'z-index:4', 'display:grid', '--brand:red', 'café 😀']) assert.ok(output.includes(marker), marker);
    } finally { cleaner.close(); }
});

test("three retired tiny-grammar refusals have exact safe modern outcomes", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        assert.equal(html(cleaner.clean(input('<p>unterminated'))), '<p>unterminated</p>');
        assert.equal(html(cleaner.clean(input('<a href="javascript:alert(1)">text</a>'))), '<a>text</a>');
        assert.equal(html(cleaner.clean(input('<script>alert(1)</script>'))), '');
        assert.equal(html(cleaner.clean(input('<p>after</p>'))), '<p>after</p>');
    } finally { cleaner.close(); }
});

test("relative navigation/images/CSS resolve at the retained document; fragments stay local", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const output = html(cleaner.clean(input('<a href="?next=1">next</a><a href="irc://irc.example.test/chat">irc</a><map name="m"><area href="/dest" shape="rect" coords="0,0,1,1"></map><img src="/img/a.png" usemap="#m"><p style="--pic:url(/img/b.png);background-image:var(--pic)">x</p>')));
        for (const marker of ['href="http://localhost:8080/~s2js_slice3/?next=1"',
            'irc://irc.example.test/chat', 'href="http://localhost:8080/dest"',
            'src="http://localhost:8080/img/a.png"', 'usemap="#m"', 'url(http://localhost:8080/img/b.png)']) {
            assert.ok(output.includes(marker), marker);
        }
        const css = html(cleaner.clean(input('<p style="background:u\\72l(/x)">x</p>')));
        assert.ok(css.includes('url(http://localhost:8080/x)'));
        const unproxied = html(cleaner.clean(input('<p style="background:url(http://other.test/x)">x</p>',
            {urls: {...context.urls, imageProxy: "host-resolved"}})));
        assert.ok(unproxied.includes('url(http://other.test/x)'));
    } finally { cleaner.close(); }
});

test("form destination checks precede adaptation and password input becomes ordinary text", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const output = html(cleaner.clean(input('<form action="https://blocked.test:8080/post"><input type="password" name="secret"><button formaction="https://blocked.test:8080/post">go</button></form>',
            {urls: {...context.urls, formDomainBanned: ["blocked.test:8080"]}})));
        assert.equal(output, '<form><input name="secret"><button>go</button></form>');
        assert.equal(html(cleaner.clean(input('<form action="/post"><button formaction="/post">go</button></form>'))),
            '<form><button>go</button></form>');
        assert.equal(html(cleaner.clean(input('<form action="http:/host.test/post">ambiguous</form>'))),
            '<form>ambiguous</form>');
        assert.ok(html(cleaner.clean(input('<form action="https://blocked.test/post">allowed other port</form>',
            {urls: {...context.urls, formDomainBanned: ["blocked.test:8080"]}}))).includes('action="https://blocked.test/post"'));
    } finally { cleaner.close(); }
});

test("flat cuts retain full generated controls and omit hidden bodies; ambiguous cuts refuse", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const output = html(cleaner.clean(input('before<cut text="More">HIDDEN_1</cut>between<div class="ljcut">HIDDEN_2</div>after')));
        assert.ok(!output.includes('HIDDEN'));
        for (const marker of ['cut-wrapper', 'span-cuttag_s2js_slice3_436_1', 'div-cuttag_s2js_slice3_436_2',
            '#cutid1', '#cutid2', 'aria-live="assertive"', 'More', 'Read more...']) assert.ok(output.includes(marker), marker);
        for (const body of ['<lj-cut>HIDDEN', '<lj-cut><cut>HIDDEN</cut></lj-cut>',
            '<table><lj-cut>HIDDEN</lj-cut></table>', '<p><cut>HIDDEN</cut></p>']) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"});
        }
    } finally { cleaner.close(); }
});

test("reader options use the actual public placeholder descriptor and remove only requested formatting", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const output = html(cleaner.clean(input('<h2><font face="serif" color="red" size="4">heading</font></h2><p style="color:red;font-size:large;font-family:serif;font-weight:bold">text</p><img src="https://img.test/p" width="640" height="480">',
            {reader: {...context.reader, removeColors: true, removeSizes: true, removeFonts: true, extractImages: true}})));
        assert.ok(!output.includes('<h2>') && !output.includes('color:red') && !output.includes('face='));
        assert.ok(output.includes('font-weight:bold'));
        assert.ok(output.includes('class="ljimgplaceholder" href="https://img.test/p"'));
        assert.ok(output.includes('src="http://localhost:8080/img/imageplaceholder2.png" width="35" height="35" alt="Image" title="Image"'));
    } finally { cleaner.close(); }
});

test("configured image exchange binds source spans and context; empty domain never upgrades", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const source = input('<img src="http://img.test/a?x=1&amp;y=2">', {urls: {...context.urls, imageProxy: "host-resolved"}});
        const pending = cleaner.clean(source);
        assert.equal(pending.kind, "image-resolution-required");
        if (pending.kind !== "image-resolution-required") throw new Error("Missing image exchange");
        const request = pending.images.requests[0]!;
        assert.equal(request.url, 'http://img.test/a?x=1&y=2');
        assert.equal(source.body.slice(request.sourceStart, request.sourceEnd), request.sourceText);
        assert.equal(request.sourceText, 'http://img.test/a?x=1&amp;y=2');
        assert.ok(html(cleaner.clean(source, {inputSha256: pending.images.inputSha256,
            images: [{ordinal: 0, url: "https://proxy.test/synthetic/6-436/img.test/a"}]})).includes('https://proxy.test/synthetic/'));
        assert.deepEqual(cleaner.clean(source, {inputSha256: "wrong", images: []}),
            {kind: "failure", reason: "unsupported"});
        const plain = html(cleaner.clean(input('<img src="http://img.test/a">')));
        assert.ok(plain.includes('src="http://img.test/a"'));
        const upgraded = html(cleaner.clean(input('<img src="http://img.example.org/a">',
            {urls: {...context.urls, knownHttpsSites: ["example.org"]}})));
        assert.ok(upgraded.includes('src="https://img.example.org/a"'));
    } finally { cleaner.close(); }
});

test("bounds and unsupported media fail without fragments and do not contaminate the next job", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        for (const body of ['x'.repeat(65537), '<div>'.repeat(17)+'x'+'</div>'.repeat(17),
            '<br>'.repeat(4097), '<video src="/v"></video>', '<audio src="/a"></audio>',
            '<p style="--x:var(;background:var(--x)">bad</p>']) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"});
            assert.equal(html(cleaner.clean(input('<p>clean</p>'))), '<p>clean</p>');
        }
    } finally { cleaner.close(); }
    assert.deepEqual(cleaner.clean(input('after close')), {kind: "failure", reason: "unavailable"});
});

test("actual second pass is stable for ordinary flow but re-entry loses generated cut provenance", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const first = html(cleaner.clean(input('<p class="ok" style="color:red"><a href="/x">one</a></p>')));
        assert.equal(html(cleaner.clean(input(first))), first);
        const cut = html(cleaner.clean(input('a<lj-cut>HIDDEN</lj-cut>b')));
        const reentered = html(cleaner.clean(input(cut)));
        assert.notEqual(reentered, cut);
        assert.ok(cut.includes('id="span-cuttag_'));
        assert.ok(!reentered.includes('id="span-cuttag_') && !reentered.includes('id="div-cuttag_'));
        assert.ok(!reentered.includes('HIDDEN') && reentered.includes('#cutid1'));
        assert.equal(html(cleaner.clean(input(reentered))), reentered);
    } finally { cleaner.close(); }
});

test("extract-images applies again to re-entered placeholder HTML; this is not idempotence", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const options = {reader: {...context.reader, extractImages: true}};
        const first = html(cleaner.clean(input('<img src="https://image.test/a">', options)));
        const second = html(cleaner.clean(input(first, options)));
        assert.notEqual(second, first);
        assert.equal((first.match(/class="ljimgplaceholder"/g) ?? []).length, 1);
        assert.equal((second.match(/class="ljimgplaceholder"/g) ?? []).length, 2);
        assert.ok(second.includes('href="https://image.test/a"'));
        assert.ok(second.includes('href="http://localhost:8080/img/imageplaceholder2.png"'));
    } finally { cleaner.close(); }
});


test("retained Perl also strips generated IDs and repeats extract-images on actual second pass", () => {
    const probe = spawnSync("perl", [resolve(__dirname, "../../../live/tests/cleaner-second-pass.pl")],
        {encoding: "utf8", timeout: 10000, env: {...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0"}});
    assert.equal(probe.status, 0, probe.stderr);
    const [cut, placeholder] = JSON.parse(probe.stdout) as {id: string; raw: string; first: string; second: string}[];
    assert.equal(cut!.id, "cut-raw-reentry");
    assert.notEqual(cut!.first, cut!.second);
    assert.ok(cut!.first.includes('id="span-cuttag_'));
    assert.ok(!cut!.second.includes('id="span-cuttag_') && !cut!.second.includes('id="div-cuttag_'));
    assert.ok(!cut!.first.includes('HIDDEN') && !cut!.second.includes('HIDDEN'));
    assert.ok(cut!.second.includes('#cutid1'));
    assert.equal(placeholder!.id, "placeholder-raw-reentry");
    assert.notEqual(placeholder!.first, placeholder!.second);
    assert.equal((placeholder!.first.match(/class="ljimgplaceholder"/g) ?? []).length, 1);
    assert.equal((placeholder!.second.match(/class="ljimgplaceholder"/g) ?? []).length, 2);
});

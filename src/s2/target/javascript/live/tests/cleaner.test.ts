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
import {sourceCases} from "./source-cases";
import {formattingCases} from "./formatting-cases";

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
function retained(bodies: readonly string[]): string[] {
    const probe = spawnSync("perl", [resolve(__dirname, "../../../live/tests/cleaner-retained.pl")],
        {input: JSON.stringify(bodies), encoding: "utf8", timeout: 10000,
            env: {...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0"}});
    assert.equal(probe.status, 0, probe.stderr);
    return JSON.parse(probe.stdout) as string[];
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
        assert.equal(css, '<p style="background:u72l(/x)">x</p>');
        const unproxied = html(cleaner.clean(input('<p style="background:url(http://other.test/x)">x</p>',
            {urls: {...context.urls, imageProxy: "host-resolved"}})));
        assert.ok(unproxied.includes('url(http://other.test/x)'));
    } finally { cleaner.close(); }
});

test("entry inventory preserves ordinary legacy attributes and refuses uncovered representations explicitly", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const body = '<a href="https://example.test/" target="_blank" rel="nofollow">go</a>' +
            '<img src="https://example.test/p" hspace="3" vspace="2">' +
            '<p accesskey="k" contenteditable="true" data-note="kept" aria-label="entry">text</p>' +
            '<marquee scrollamount="2">moving</marquee><blink>blink</blink><nobr>one two</nobr>' +
            '<acronym title="Long">short</acronym><big>big</big><dir><li>item</li></dir>';
        assert.equal(html(cleaner.clean(input(body))), body);
        assert.equal(html(cleaner.clean(input(html(cleaner.clean(input(body)))))), body);
        const native = retained([body, '<xmp>visible text</xmp>', '<custom-el>visible text</custom-el>']);
        for (const marker of ['target="_blank"', 'hspace="3"', 'vspace="2"', 'accesskey="k"',
            'contenteditable="true"', '<xmp>visible text</xmp>', '<custom-el>visible text</custom-el>']) {
            assert.ok(native.join('').includes(marker), marker);
        }
        for (const raw of ['<xmp>visible text</xmp>', '<listing>visible text</listing>',
            '<plaintext>visible text', '<custom-el>visible text</custom-el>',
            '<p unexamined="value">visible text</p>',
            '<button form="trusted-control">cross-fragment control</button>']) {
            assert.deepEqual(cleaner.clean(input(raw)), {kind: "failure", reason: "unsupported"}, raw);
        }
        // Named DOM-clobbering collisions are the sanitizer's security exception;
        // ordinary author-provided names remain usable anchors.
        assert.equal(html(cleaner.clean(input('<a name="location">x</a><a name="ordinary">y</a>'))),
            '<a>x</a><a name="ordinary">y</a>');
    } finally { cleaner.close(); }
});

test("navigation uses the retained dangerous-scheme removal, not a small protocol allowlist", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const bodies = ['gopher://g.test/', 'magnet:?xt=urn:x', 'spotify:track:1',
            'ftp://ftp.test/path', 'irc://irc.test/channel'].map(url => `<a href="${url}">go</a>`);
        assert.deepEqual(retained(bodies), bodies);
        for (const body of bodies) {
            assert.equal(html(cleaner.clean(input(body))), body);
        }
        for (const url of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x',
            'about:blank', 'livescript:x', 'jscript:x', 'jAvA&#x09;script:alert(1)']) {
            assert.equal(html(cleaner.clean(input(`<a href="${url}">go</a>`))), '<a>go</a>');
        }
        assert.equal(html(cleaner.clean(input('<form action="gopher://g.test/"><button>go</button></form>'))),
            '<form><button>go</button></form>');
    } finally { cleaner.close(); }
});

test("head/rawtext contexts cannot silently swallow or escape visible entry content", () => {
    const cleaner = createEntryCleaner(limits);
    const cases = ['<noframes><b>bold</b></noframes>',
        '<p>x</p><noframes><b>bold</b> tail</noframes>',
        '<template><b>visible template text</b></template><p>after</p>',
        '<p>before</p><template><b>visible template text</b></template>'];
    try {
        const native = retained(cases.slice(0, 2));
        assert.ok(native[0]!.includes('<b>bold</b>'));
        assert.ok(native[1]!.includes('<b>bold</b> tail'));
        for (const body of cases) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"}, body);
            assert.equal(html(cleaner.clean(input('<p>after refusal</p>'))), '<p>after refusal</p>');
        }
        for (const prefix of ['<title>removed</title>', '<style>removed</style>', '<script>removed</script>',
            '<meta name="x" content="removed">', '<link href="/removed">', '<base href="https://other.test/">']) {
            assert.equal(html(cleaner.clean(input(prefix + '<p>visible</p>'))), '<p>visible</p>');
        }
        assert.equal(html(cleaner.clean(input('<noscript><b>bold</b> tail</noscript>'))), '<b>bold</b> tail');
        assert.equal(html(cleaner.clean(input('<noscript><meta name="x" content="y"></noscript><p>after</p>'))),
            '<p>after</p>');
        const comments = 'before<!-- source comment --><p>visible<!-- another --> text</p>after';
        assert.equal(html(cleaner.clean(input(comments))), 'before<p>visible text</p>after');
        assert.equal(retained([comments])[0], 'before<p>visible text</p>after');
    } finally {cleaner.close();}
});

test("additional sanitizer attribute removals refuse explicitly without weakening defenses", () => {
    const cleaner = createEntryCleaner(limits);
    const cases = [
        '<a href="applescript://com.apple.scripteditor?action=new">visible</a>',
        '<a href="ecmascript:foo">visible</a>', '<a href="xscript:foo">visible</a>',
        '<table><tbody><tr><td abbr="ecmascript:x">visible</td></tr></tbody></table>',
        '<p title="a]>b">visible</p>', '<p title="x --> y">visible</p>',
        '<p title="</textarea>">visible</p>', '<img src="https://image.test/x" alt="-->">',
        '<p data-x:y="1">visible</p>', '<p aria-x:y="2">visible</p>',
        '<p aria-x.y="3">visible</p>',
        '<p data-x:y="1" aria-x:y="2">visible</p>',
    ];
    try {
        const native = retained(cases);
        for (const [index, marker] of ['href=', 'href=', 'href=', 'abbr=', 'title=', 'title=',
            'title=', 'alt=', 'data-x:y=', 'aria-x:y='].entries()) {
            assert.ok(native[index]!.includes(marker), cases[index]);
        }
        assert.ok(native[10]!.includes('ljparseerror'), 'retained dotted aria name is a parse failure');
        for (const body of cases) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"}, body);
            assert.equal(html(cleaner.clean(input('<p title="ordinary" data-x="1" aria-label="entry">visible</p>'))),
                '<p title="ordinary" data-x="1" aria-label="entry">visible</p>');
        }
    } finally {cleaner.close();}
});

test("SANITIZE_DOM collision exception removes only names and preserves form/text content", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const names = ['location', 'cookie', 'body', 'submit', 'title', 'attributes', 'nodeName'];
        for (const name of names) {
            assert.equal(html(cleaner.clean(input(`<a name="${name}"><b>visible ${name}</b></a>`))),
                `<a><b>visible ${name}</b></a>`);
        }
        const form = '<form action="https://app.test/post"><input type="submit" name="submit" value="send">' +
            '<p>VISIBLE_FORM_TEXT</p><a name="ordinary">VISIBLE_ANCHOR_TEXT</a></form>';
        const expected = form.replace(' name="submit"', '');
        assert.ok(retained([form])[0]!.includes('name="submit"'));
        assert.equal(html(cleaner.clean(input(form))), expected);
        assert.equal(html(cleaner.clean(input(expected))), expected);
        assert.equal(html(cleaner.clean(input(''))), '');
        assert.equal(html(cleaner.clean(input('<b>before</b><i>after</i>'))), '<b>before</b><i>after</i>');
        const textarea = '<textarea>&lt;/textarea&gt;VISIBLE</textarea><p>after</p>';
        assert.equal(html(cleaner.clean(input(textarea))), textarea);
        assert.equal(html(cleaner.clean(input(html(cleaner.clean(input(textarea)))))), textarea);
    } finally {cleaner.close();}
});

test("CSS screening, parsing and emission all use the retained backslash-stripped value", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const cases = [
            ['position:\\66 ixed;top:0;left:0', 'position:66 ixed;top:0;left:0'],
            ['position:\\61 bsolute;top:0', 'position:61 bsolute;top:0'],
            ['--p:\\66 ixed;position:var(--p)', '--p:66 ixed;position:var(--p)'],
            ['--p:\\61 bsolute;position:var(--p)', '--p:61 bsolute;position:var(--p)'],
            ['background:u\\72l(/x)', 'background:u72l(/x)'],
            ['width:e\\78pression(1)', 'width:e78pression(1)'],
            ['posit\\69 on:fixed', null], ['position:fixed', null], ['position:absolute', null],
            ['width:expres\\sion(1)', null],
        ] as const;
        const raw = cases.map(([style]) => `<p style="${style}">x</p>`);
        const native = retained(raw);
        for (const [i, [, style]] of cases.entries()) {
            const expected = style === null ? '<p>x</p>' : `<p style="${style}">x</p>`;
            assert.equal(native[i], expected, raw[i]);
            assert.equal(html(cleaner.clean(input(raw[i]!))), expected, raw[i]);
            assert.equal(html(cleaner.clean(input(expected))), expected, "actual second pass");
        }
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


test("source-proven formatting repair retains all 98 raw/native classifications", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        assert.equal(formattingCases.length, 98);
        assert.deepEqual(retained(formattingCases.map(row => row.raw)), formattingCases.map(row => row.perl));
        for (const row of formattingCases) {
            const result = cleaner.clean(input(row.raw));
            if (row.classification === "unsupported") {
                assert.deepEqual(result, {kind: "failure", reason: "unsupported"}, row.id);
                assert.equal(html(cleaner.clean(input("<p>recovery</p>"))), "<p>recovery</p>");
            } else {
                assert.equal(html(result), row.html, row.id);
                assert.equal(html(cleaner.clean(input(html(result)))), row.html, row.id + " second pass");
                if (row.classification === "exact") assert.equal(row.html, row.perl, row.id);
                else assert.notEqual(row.html, row.perl, row.id + " raw difference retained");
            }
        }
    } finally { cleaner.close(); }
});

test("basefont refuses in every position; private BODY sanitation discards wrapper attributes", () => {
    const cleaner = createEntryCleaner(limits);
    const cases = [
        '<basefont size="3">text',
        '<p>before</p><basefont size="3">text',
        '<embed src="https://example.test/x"><basefont size="3">text',
        '<iframe></iframe><basefont size="3"><p>after</p>',
        '<head><basefont size="3"></head><body>text</body>',
    ];
    try {
        const native = retained(cases);
        assert.deepEqual(native, ['<basefont size="3">text', '<p>before</p><basefont size="3">text',
            '<basefont size="3">text', '<basefont size="3"><p>after</p>', 'text']);
        for (const body of cases) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"}, body);
        }
        const wrapper = '<body onload="alert(1)" class="wrapper" title="a]>b"><p>visible</p></body>';
        const output = html(cleaner.clean(input(wrapper)));
        assert.equal(output, '<p>visible</p>');
        assert.equal(output, retained([wrapper])[0]);
        assert.equal(html(cleaner.clean(input(output))), output);
    } finally { cleaner.close(); }
});

test("legacy formatting and nested well-formed tables retain their original scopes", () => {
    const cleaner = createEntryCleaner(limits);
    const cases = [
        ...["big", "nobr", "s", "small", "strike", "tt"].map(tag => `<p><${tag}>one</p><p>two</p>`),
        '<table><tbody><tr><td><table><tbody><tr><td><b>one</b></td></tr></tbody></table></td></tr></tbody></table>',
        '<p><b>one</p><p><em>two</em></p>',
        '<p><b>one</p><p><span title="kept">two</span></p>',
    ];
    try {
        const native = retained(cases);
        for (const [index, body] of cases.entries()) {
            const output = html(cleaner.clean(input(body)));
            assert.equal(output, native[index], body);
            assert.equal(html(cleaner.clean(input(output))), output);
        }
    } finally { cleaner.close(); }
});


test("removed wrappers cannot prove formatting closure and merged form extents refuse", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const bodies = ['<p>a</p><noscript><b>x</noscript>y',
            '<form action="https://app.test/f"><b>x</form>y'];
        const native = retained(bodies);
        assert.ok(native[0]!.includes('<b>xy</b>'));
        assert.ok(native[1]!.includes('<b>x</b></form>y'));
        for (const body of bodies) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"});
        }
    } finally { cleaner.close(); }
});

test("outside-form controls preserve only explicit source closing-token text", () => {
    const cleaner = createEntryCleaner(limits);
    const bodies = ['<select><option>hello</option><option>bye</option></select>',
        '<select><option>hello', '<select><option>hello</select>',
        '<form><select><option>hello</option><option>bye</option></select></form>'];
    try {
        const native = retained(bodies);
        for (const [index, body] of bodies.entries()) {
            const result = html(cleaner.clean(input(body)));
            assert.equal(result, native[index]);
            assert.equal(html(cleaner.clean(input(result))), result);
        }
        assert.ok(native[0]!.includes('&lt;/option&gt;'));
        assert.ok(native[0]!.endsWith('&lt;/select&gt;'));
        assert.ok(!native[1]!.includes('&lt;/'));
    } finally { cleaner.close(); }
});

test("ordinary omitted paragraph/list ends remain supported without reconstructed formatting", () => {
    const cleaner = createEntryCleaner(limits);
    const bodies = ['<p>one<p>two', '<p>one<p>two</p>', '<ul><li>one<li>two</ul>',
        '<ol><li>a<li>b<li>c</ol><p>after</p>'];
    const expected = ['<p>one</p><p>two</p>', '<p>one</p><p>two</p>',
        '<ul><li>one</li><li>two</li></ul>', '<ol><li>a</li><li>b</li><li>c</li></ol><p>after</p>'];
    try {
        for (const [index, body] of bodies.entries()) {
            assert.equal(html(cleaner.clean(input(body))), expected[index]);
            assert.equal(html(cleaner.clean(input(expected[index]!))), expected[index]);
        }
        for (const body of ['<p><b>bold<p>next</p>', '<ul><li><b>x<li>y</ul>']) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"});
        }
    } finally { cleaner.close(); }
});


test("source-consumption audit detects lost tokens and preserves classified inert contexts", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        assert.deepEqual(retained(sourceCases.map(row => row.raw)), sourceCases.map(row => row.perl));
        for (const row of sourceCases) {
            const result = cleaner.clean(input(row.raw));
            if (row.supported) {
                const output = html(result);
                assert.equal(html(cleaner.clean(input(output))), output, row.raw + " second pass");
            } else assert.deepEqual(result, {kind: "failure", reason: "unsupported"}, row.raw);
        }
        for (const raw of ['<svg><![CDATA[<b>]]></svg>x', '<math><![CDATA[<b>]]></math>x',
            '<script>var s="<td>not markup</td>";</script>x', '<iframe><td>ignored</td></iframe>x',
            '<!-- <td>not markup</td> -->x']) assert.equal(html(cleaner.clean(input(raw))), 'x');
        assert.equal(html(cleaner.clean(input('a &lt;table&gt; b'))), 'a &lt;table&gt; b');
        assert.equal(html(cleaner.clean(input('<p>intro</p><body title="<td>decoy</td>"><p>kept</p></body>'))),
            '<p>intro</p><p>kept</p>');
    } finally { cleaner.close(); }
});

test("wrapper assistance has cumulative byte and parse-count work ceilings", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const work = '<body>'.repeat(8000);
        assert.equal(Buffer.byteLength(work), 48000);
        assert.deepEqual(cleaner.clean(input(work)), {kind: "failure", reason: "unsupported"});
        assert.deepEqual(cleaner.clean(input('<p>x</p>' + '<body><p>x</p>'.repeat(33))),
            {kind: "failure", reason: "unsupported"});
        for (const wrapper of ['<BODY title="> <td>" >', '<body\n title="> <td>">',
            '<html title="> <td>"/>']) {
            const raw = '<p>before</p>' + wrapper + '<p>after</p>';
            assert.equal(html(cleaner.clean(input(raw))), '<p>before</p><p>after</p>');
        }
        assert.equal(html(cleaner.clean(input('<p>recovery</p>'))), '<p>recovery</p>');
    } finally { cleaner.close(); }
});

test("source-open head cannot expose content relocated into BODY", () => {
    const cleaner = createEntryCleaner(limits);
    // Keep exact native results, including the retained html wrapper bytes.
    const refused: readonly (readonly [string, string])[] = [
        ['<head><p>b</p>', ''],
        ['<head><p>b</p></head><p>c</p>', '<p>c</p>'],
        ['<head>text</head><p>c</p>', '<p>c</p>'],
        ['<html><head><p>b</p>', '<html></html>'],
        ['<html><head><p>b</p></head><p>c</p></html>', '<html><p>c</p></html>'],
        ['<html><head>text</head><body><p>c</p></body></html>', '<html><p>c</p></html>'],
        ['<head>text', ''],
        ['<HEAD title="> <td>"><p>b</p></HEAD><p>c</p>', '<p>c</p>'],
        ['<head><title>x</title><p>b</p></head><p>c</p>', '<p>c</p>'],
        ['<head><noscript><p>b</p></noscript></head><p>c</p>', '<p>c</p>'],
        ['<head><p>b</p><body><p>c</p>', ''],
        ['<p>a</p><head><p>b</p>', '<p>a</p>'],
        ['<p>a</p><head><p>b</p></head><p>c</p>', '<p>a</p><p>c</p>'],
        ['<p>a</p><head>text</head><p>c</p>', '<p>a</p><p>c</p>'],
        ['<p>a</p><head></head><p>c</p>', '<p>a</p><p>c</p>'],
        ['<p>a</p><head><title>title</title></head><p>c</p>', '<p>a</p><p>c</p>'],
        ['<p>a</p><head title="> <td>decoy</td>"><p>b</p></head><p>c</p>', '<p>a</p><p>c</p>'],
        ['<p>a</p><head title="> <td>decoy</td>">', '<p>a</p>'],
        ['<p>a</p><head title="<td>incomplete', '<p>a</p>&lt;head title=&quot;&lt;td&gt;incomplete'],
    ];
    const supported: readonly (readonly [string, string])[] = [
        ['<head><title>title</title><meta charset="utf-8"></head><p>c</p>', '<p>c</p>'],
        ['<head><title>title</title><meta charset="utf-8">', ''],
        ['<head></head><p>c</p>', '<p>c</p>'],
        ['<head title="> <td>"><title>title</title></head><p>c</p>', '<p>c</p>'],
        ['<head><script>const x="</head><p>decoy</p>";</script></head><p>c</p>', '<p>c</p>'],
        ['<head><!-- </head><p>decoy</p> --><meta charset="utf-8"></head><p>c</p>', '<p>c</p>'],
        ['<head>\n  </head><p>c</p>', '<p>c</p>'],
        ['<head><style>p{color:red}</style></head><p>c</p>', '<p>c</p>'],
        ['<head><title>x</title> \n<!-- c -->', ''],
        ['<p>headless</p>', '<p>headless</p>'],
        ['<body onload="alert(1)"><p>body</p></body>', '<p>body</p>'],
    ];
    try {
        for (const cases of [refused, supported]) {
            assert.deepEqual(retained(cases.map(row => row[0])), cases.map(row => row[1]));
        }
        for (const [body] of refused) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"}, body);
        }
        for (const [body, expected] of supported) {
            assert.equal(html(cleaner.clean(input(body))), expected, body);
            assert.equal(html(cleaner.clean(input(expected))), expected, body + " second pass");
        }
        const document = '<html><head><title>title</title><meta charset="utf-8"></head><body><p>c</p></body></html>';
        assert.equal(retained([document])[0], '<html><p>c</p></html>');
        assert.equal(html(cleaner.clean(input(document))), '<p>c</p>');
        // An explicit unclosed HEAD with only BODY comments/whitespace adds no
        // visible content. Do not turn that harmless case into blanket refusal.
        const whitespace = '<head><body><!-- c --> \n';
        assert.equal(retained([whitespace])[0], '');
        assert.equal(html(cleaner.clean(input(whitespace))).trim(), '');
    } finally { cleaner.close(); }
});

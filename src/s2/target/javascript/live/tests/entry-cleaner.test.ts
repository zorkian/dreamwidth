// entry-cleaner.test.ts
//
// Full-entry body and independent inert metadata source/security differentials.
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
import {writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import type {EntryContentContext, EntryContentInput, EntryContentResult} from "@dreamwidth/content/contracts";
import {config} from "./fixtures";

const {createEntryCleaner} = require(resolve(__dirname, "../../../../../../content/dist")) as
    typeof import("@dreamwidth/content");
const {JSDOM, VirtualConsole} = require(resolve(__dirname,
    "../../../../../../content/node_modules/jsdom"));
const limits = {maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096,
    maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096, maxImageCandidates: 256, maxCuts: 16};
const context: EntryContentContext = {
    policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow",
    documentUrl: "http://localhost:8080/~s2js_slice3/384.html",
    entryUrl: "http://localhost:8080/~s2js_slice3/384.html",
    journalUsername: "s2js_slice3", journalId: 6, entryId: 384,
    reader: {removeColors: false, removeSizes: false, removeFonts: false,
        maxImageWidth: null, maxImageHeight: null, placeholderUndefinedImageSize: false, extractImages: false},
    ...config.entryContent, cuts: "source-compatible-entry",
};
const input = (body: string, recent = false): EntryContentInput => ({body, format: "html_raw0",
    context: {...context, cuts: recent ? "source-compatible-recent" : "source-compatible-entry"}});
function html(result: EntryContentResult): string {
    assert.equal(result.kind, "ok", JSON.stringify(result));
    if (result.kind !== "ok") throw new Error("Not a fragment");
    return result.fragment.html;
}
interface Native {full: string; subjectText: string; eventText: string; og: string}
function retained(bodies: readonly string[]): Native[] {
    const probe = spawnSync("perl", [resolve(__dirname, "../../../live/tests/entry-retained.pl")],
        {input: JSON.stringify(bodies.map(body => ({body, subject: "café 😀 & tea"}))),
            encoding: "utf8", timeout: 10000,
            env: {...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0"}});
    assert.equal(probe.status, 0, probe.stderr);
    return JSON.parse(probe.stdout) as Native[];
}
const cases: readonly [string, string][] = [
    ["plain", "one café 😀 & tea"],
    ["leading-lf", "\n<p>one</p>"],
    ["leading-lf-space", "\n  <p>one</p>"],
    ["whitespace-only", " \n \r\n "],
    ["leading-text", " \n one"],
    ["empty", ""],
    ["head-gap", '<head><title>x</title></head>\n<p>one</p>'],
    ["implicit-head-space", '<title>x</title>\n<title>y</title>\n<p>one</p>'],
    ["pasted-document", '<html><head><title>x</title></head>\n<body>one</body>\n</html>'],
    ["pasted-body", '<body onload="BAD">one &amp; two</body>\n'],
    ["pasted-attrs", '<html lang="en" onclick="BAD"><body>one &amp; two</body></html>'],
    ["decoder-entity", 'x &lt;/textarea&gt; y'],
    ["decoder-rcdata", '<textarea>x&lt;/textarea&gt;y</textarea>'],
    ["quoted-angle", '<p title="x > y &amp; z">text</p>'],
    ["rich", '<p class="x" style="color:red">one &amp; two</p><p>three<br>four</p>'],
    ["lines", "one\ntwo\n\nthree\r\nfour"],
    ["block-lines", "<p>one\ntwo</p>\n<p>three</p>\n"],
    ["pre", "<pre>one\ntwo &amp; tea</pre><textarea>x\ny</textarea>"],
    ["pre-initial-lf", "<pre>\none</pre>"],
    ["textarea-initial-lf", "<textarea>\none</textarea>"],
    ["pre-double-lf", "<pre>\n\none</pre>"],
    ["textarea-double-lf", "<textarea>\n\none</textarea>"],
    ["pre-crlf", "<pre>\r\none</pre>"],
    ["textarea-crlf", "<textarea>\r\none</textarea>"],
    ["pre-newline-only", "<pre>\n</pre>"],
    ["textarea-newline-only", "<textarea>\r\n</textarea>"],
    ["pre-later-lf", "<pre>one\ntwo</pre>"],
    ["pre-comment-before-lf", "<pre><!-- comment -->\none</pre>"],
    ["pre-tag-before-lf", "<pre><b>x</b>\none</pre>"],
    ["pre-entities", "<pre>&amp; &#10; one</pre>"],
    ["code", "<code>https://example.test/path\nnext @person</code>"],
    ["url", "See https://example.org/a?x=1&y=2 now"],
    ["url-entity", "https://example.test/path&quot; next"],
    ["email", "Mail a@example.org now"],
    ["anchor", '<a href="/relative">https://example.org/a\nnext</a> https://outside.example/z'],
    ["image", '<img src="/x" alt="A &amp; B" title="q">'],
    ["css-relative", '<p style="background:url(/x);--brand:red;color:var(--brand)">x</p>'],
    ["table", '<table>\n<tr><td>one\ntwo</td></tr>\n</table>'],
    ["cut", 'before<lj-cut text="More"><b>inside</b></lj-cut>after'],
    ["alias", 'before<cut text="More"><b>inside</b></cut>after'],
    ["div-cut", 'before<div class="ljcut" text="More"><b>inside</b></div>after'],
    ["names-before", '<a name="cutid1">source</a><lj-cut>inside</lj-cut>'],
    ["names-inside", '<lj-cut><a name="cutid1">source</a>inside</lj-cut>'],
    ["source-id", '<a id="cutid1">source</a><lj-cut>inside</lj-cut>'],
    ["two-cuts", '<lj-cut>A</lj-cut><div class="ljcut">B</div>'],
    ["inert-quote", '<p title="&quot;><script>bad</script>">safe</p>'],
    ["eaten", '<script>@person BAD</script><style>p{color:red}</style>safe'],
    ["unicode", 'café\u00a0tea 😀 &amp; &#160;'],
    ["limit", "x".repeat(298) + "😀YZ"],
    ["entity-limit", "x".repeat(297) + "&amp;Z"],
    ["form", '<form action="https://example.test/post"><input type="password" value="q"><input disabled></form>'],
    ["outside-control", '<select><option>hello</option><option>bye</option></select>'],
];

test("independent inert helper matches retained common rich/text/full-cut semantics", () => {
    const cleaner = createEntryCleaner(limits);
    const native = retained(cases.map(row => row[1]));
    const rows: unknown[] = [];
    try {
        for (const [[id, raw], index] of cases.map((row, i) => [row, i] as const)) {
            const result = cleaner.metadata({subject: "café 😀 & tea", entry: input(raw)});
            rows.push({id, raw, rawSha256: createHash("sha256").update(raw).digest("hex"),
                perl: native[index], candidate: result});
        }
        if (process.env.SLICE5_METADATA_REPORT) {
            writeFileSync(process.env.SLICE5_METADATA_REPORT, JSON.stringify(rows, null, 2) + "\n");
        }
        for (const [[id, raw], index] of cases.map((row, i) => [row, i] as const)) {
            const result = cleaner.metadata({subject: "café 😀 & tea", entry: input(raw)});
            assert.equal(result.kind, "ok", id + " " + JSON.stringify(result));
            if (result.kind !== "ok") continue;
            assert.equal(result.metadata.kind, "inert-entry-metadata");
            assert.equal(result.metadata.subjectText, native[index]!.subjectText, id);
            assert.equal(result.metadata.eventText, native[index]!.eventText, id);
        }
    } finally { cleaner.close(); }
});

test("named omitted-end metadata adaptations preserve order and expose their 300-character effect", () => {
    const cleaner = createEntryCleaner(limits);
    const bodies = ['<p>one<p>two', '<ul><li>one<li>two</ul>',
        '<table><tr><td>one<td>two</table>'];
    const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const og = (value: string): string => escape([...value.replace(/[\t\n\v\f\r ]+/g, " ").replace(/^ +| +$/g, "")]
        .slice(0, 300).join("").replace(/^ +| +$/g, ""));
    const rows: unknown[] = [];
    try {
        for (const prefix of ["", "x".repeat(280)]) {
            for (const body of bodies) {
                const raw = prefix + body;
                const native = retained([raw])[0]!;
                const result = cleaner.metadata({subject: "subject", entry: input(raw)});
                assert.equal(result.kind, "ok");
                if (result.kind !== "ok") continue;
                const actual = result.metadata.eventText;
                assert.notEqual(actual, native.eventText);
                assert.ok(actual.indexOf("one") < actual.indexOf("two"));
                assert.equal(actual.split("one").length, 2);
                assert.equal(actual.split("two").length, 2);
                assert.notEqual(og(actual), native.og, "metadata-visible, including truncation budget");
                assert.equal(html(cleaner.clean(input(raw))), html(cleaner.clean(input(raw, true))),
                    "displayed html_raw0 behavior is unchanged");
                rows.push({raw, perlHelper: native.eventText, tsHelper: actual,
                    perlOg: native.og, tsOg: og(actual), displayed: html(cleaner.clean(input(raw)))});
            }
        }
        if (process.env.SLICE5_METADATA_REPORT) writeFileSync(process.env.SLICE5_METADATA_REPORT +
            ".adaptations.json", JSON.stringify(rows, null, 2) + "\n");
    } finally { cleaner.close(); }
});

test("full cuts expose cleaned body while Recent omission is preserved", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const bodies = ['<lj-cut>A</lj-cut>', '<cut text="é 😀">A</cut>',
            '<div class="ljcut">B</div>', '<a name="cutid1">source</a><lj-cut>A</lj-cut>',
            '<lj-cut><a name="cutid1">source</a>A</lj-cut>'];
        const native = retained(bodies);
        bodies.forEach((raw, i) => assert.equal(html(cleaner.clean(input(raw))), native[i]!.full));
        const raw = '<lj-cut><p id="forged" onclick="BAD">CUTPAYLOAD</p><script>BAD</script></lj-cut>';
        const recent = html(cleaner.clean(input(raw, true)));
        assert.ok(!recent.includes("CUTPAYLOAD"));
        const full = html(cleaner.clean(input(raw)));
        assert.equal(full, '<a name="cutid1"></a><p>CUTPAYLOAD</p>');
        const unsupported = '<lj-cut><template>hidden</template></lj-cut>';
        assert.equal(cleaner.clean(input(unsupported, true)).kind, "ok");
        assert.deepEqual(cleaner.clean(input(unsupported)), {kind: "failure", reason: "unsupported"});
        assert.equal(cleaner.clean(input('<lj-cut>x</lj-cut>'.repeat(16))).kind, "ok");
        for (const body of ['<lj-cut>x</lj-cut>'.repeat(17), '<lj-cut>unclosed',
            '<lj-cut><cut>x</cut></lj-cut>', '<table><lj-cut>x</lj-cut></table>']) {
            assert.deepEqual(cleaner.clean(input(body)), {kind: "failure", reason: "unsupported"});
        }
    } finally { cleaner.close(); }
});

test("actual full-cut raw re-entry matches the explicit native exception", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        for (const raw of ['<lj-cut>A</lj-cut>', '<div class="ljcut">B</div>']) {
            const once = html(cleaner.clean(input(raw)));
            const twice = html(cleaner.clean(input(once)));
            assert.equal(twice, retained([retained([raw])[0]!.full])[0]!.full);
            if (raw.startsWith('<div')) assert.notEqual(twice, once);
            else assert.equal(twice, once);
        }
    } finally { cleaner.close(); }
});

test("metadata refuses contextual unsupported helpers, never plain email or inert examples", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        for (const body of ["!markdown\n**bold**", " \r\n!MARKDOWN\r\ntext", "@person",
            "hello @person", "hello \\@person", '<lj user="person">', '<user name="person">',
            'x</b>y', 'x</textarea>y', 'x</span title=">">y',
            '<head><p>body exposure</p>', '<body><head>lost head</head>body']) {
            assert.deepEqual(cleaner.metadata({subject: "subject", entry: input(body)}),
                {kind: "failure", reason: "unsupported"}, body);
        }
        for (const body of ["a@example.test", '<pre>@person</pre>', '<code>@person</code>',
            '<p title="@person">safe</p>', '<!-- @person --><script>@person</script>safe']) {
            assert.equal(cleaner.metadata({subject: "subject", entry: input(body)}).kind, "ok", body);
        }
        assert.deepEqual(cleaner.metadata({subject: "", entry: input("x")}), {kind: "failure", reason: "unsupported"});
        assert.deepEqual(cleaner.metadata({subject: "subject", entry: input("x", true)}), {kind: "failure", reason: "unsupported"});
        cleaner.close();
        assert.deepEqual(cleaner.metadata({subject: "subject", entry: input("x")}), {kind: "failure", reason: "unavailable"});
    } finally { cleaner.close(); }
});

test("unprovable initial newline/entity locations refuse with retained raw evidence", () => {
    const cleaner = createEntryCleaner(limits);
    const bodies = ['<pre>\n&amp; &#10; one</pre>', '<pre>\rone</pre>', '<textarea>&#10;one</textarea>',
        '<textarea>\n<b>t</b></textarea>'];
    const native = retained(bodies);
    try {
        const rows = bodies.map((raw, index) => {
            const actual = cleaner.metadata({subject: "subject", entry: input(raw)});
            assert.deepEqual(actual, {kind: "failure", reason: "unsupported"}, raw);
            // Record the actual locked-parser source proof, not just the
            // resulting refusal. This is offline diagnostic data for fixed
            // fixtures, never author markup logged by the production worker.
            const dom = new JSDOM(raw, {includeNodeLocations: true, virtualConsole: new VirtualConsole()});
            let sourceProof: unknown;
            try {
                const node = dom.window.document.body.firstChild.firstChild;
                const location = dom.nodeLocation(node);
                sourceProof = {location, parsedText: node.textContent,
                    failingSlice: raw.slice(location.startOffset, location.endOffset)};
            } finally { dom.window.close(); }
            return {raw, perl: native[index], candidate: actual,
                sourceProof,
                classification: "ambiguous-helper-source-proof"};
        });
        if (process.env.SLICE5_METADATA_REPORT) writeFileSync(process.env.SLICE5_METADATA_REPORT +
            ".refusals.json", JSON.stringify(rows, null, 2) + "\n");
    } finally { cleaner.close(); }
});

test("metadata input/output/depth limits fail atomically and the next operation recovers", () => {
    const cleaner = createEntryCleaner({...limits, maxOutputBytes: 32});
    try {
        for (const raw of ["x".repeat(33), "x".repeat(65537),
            "<div>".repeat(17) + "x" + "</div>".repeat(17)]) {
            const result = cleaner.metadata({subject: "subject", entry: input(raw)});
            assert.deepEqual(result, {kind: "failure", reason: "unsupported"});
            assert.equal("metadata" in result, false);
        }
        const result = cleaner.metadata({subject: "subject", entry: input("safe")});
        assert.equal(result.kind, "ok");
        if (result.kind === "ok") assert.equal(result.metadata.eventText, "safe");
    } finally { cleaner.close(); }
});

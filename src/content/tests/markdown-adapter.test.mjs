// markdown-adapter.test.mjs
//
// Focused maintained Markdown rule and resource-boundary assertions.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {convertMarkdown} = require("../dist/markdown.js");
const MarkdownIt = require("markdown-it");
const {UnsupportedContent} = require("../dist/policy/errors.js");
const {createEntryCleaner} = require("../dist/index.js");
const limits = {maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,
    maxCssBytes:65536,maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const context = {policy:"dreamwidth-entry-html-raw0-v1",insertionContext:"html-div-flow",
    documentUrl:"https://app.invalid/~synthetic/384.html",entryUrl:"https://app.invalid/~synthetic/384.html",
    journalUsername:"synthetic",journalId:11,entryId:384,cuts:"source-compatible-entry",
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,
        maxImageHeight:null,placeholderUndefinedImageSize:false,extractImages:false},
    imagePlaceholder:{src:"/img/imageplaceholder2.png",width:35,height:35,alt:"Image",title:"Image"},
    urls:{siteDomain:"",knownHttpsSites:[],formDomainBanned:[],imageProxy:"not-configured"}};

test("matched code span provenance does not reject ordinary paragraph newlines", () => {
    const result = convertMarkdown("ordinary paragraph\nwith `code`", 65536);
    assert.equal(result.html, "<p>ordinary paragraph\nwith <code>code</code></p>\n");
    assert.equal(result.converter, "markdown-it@15.0.2");
    assert.ok(Object.isFrozen(result));
    assert.throws(() => convertMarkdown("`line\ncode`", 65536), UnsupportedContent);
    assert.throws(() => convertMarkdown("`\nedge\n`", 65536), UnsupportedContent);
    // A separately created maintained parser still renders its usual semantics.
    assert.equal(new MarkdownIt("commonmark").render("`line\ncode`"),
        "<p><code>line code</code></p>\n");
});

test("list start, intermediate bytes and token budgets are explicit", () => {
    assert.equal(convertMarkdown("3. item", 65536).html,
        '<ol>\n<li>item</li>\n</ol>\n');
    assert.throws(() => convertMarkdown("**many** tokens", 65536, 1),
        UnsupportedContent);
    assert.throws(() => convertMarkdown("text", 4), UnsupportedContent);
    assert.throws(() => convertMarkdown("> ".repeat(17) + "depth marker", 65536), UnsupportedContent);
    const unguarded = new MarkdownIt("commonmark", {maxNesting:20});
    const deep = "> ".repeat(21) + "depth marker";
    assert.ok(!unguarded.render(deep).includes("depth marker"), "maintained parser silently truncates");
    assert.throws(() => convertMarkdown(deep,65536), UnsupportedContent);
});

test("display and inert helper independently select original Markdown context", () => {
    const cleaner = createEntryCleaner(limits);
    try {
        const source = "**bold**\nnext";
        const display = cleaner.clean({body:source,format:"markdown0",context});
        assert.equal(display.kind,"ok");
        assert.equal(display.fragment.html,"<p><strong>bold</strong>\nnext</p>\n");
        assert.equal(display.provenance.markdown.converter,"markdown-it@15.0.2");
        assert.match(display.provenance.markdown.optionsSha256,/^[a-f0-9]{64}$/);
        const plainHelper = cleaner.metadata({subject:"Title",entry:{body:source,format:"markdown0",context}});
        assert.equal(plainHelper.kind,"ok");
        assert.equal(plainHelper.metadata.eventText,"**bold**<br />next");
        const magic = "!markdown\n" + source;
        const magicHelper = cleaner.metadata({subject:"Title",entry:{body:magic,format:"html_raw0",context}});
        assert.equal(magicHelper.kind,"ok");
        assert.equal(magicHelper.metadata.eventText,"<p><strong>bold</strong>\nnext</p>\n");
        assert.deepEqual(cleaner.clean({body:"x @name",format:"markdown0",context}),
            {kind:"failure",reason:"unsupported"});
        assert.equal(cleaner.clean({body:"`@name`",format:"markdown0",context}).kind,"ok");
        for (const [source,expected] of [["x \\@name","<p>x @name</p>\n"],
            ["\\@name at start","<p>@name at start</p>\n"]]) {
            const displayed=cleaner.clean({body:source,format:"markdown0",context});
            assert.equal(displayed.kind,"ok");assert.equal(displayed.fragment.html,expected);
            const helper=cleaner.metadata({subject:"Title",entry:{body:"!markdown\n"+source,
                format:"html_raw0",context}});
            assert.equal(helper.kind,"ok");assert.equal(helper.metadata.eventText,expected);
        }
    } finally { cleaner.close(); }
});

test("nine retained Markdown account-capability source records remain refusals", () => {
    // Source-indexed records 1,11-16,19,20 of the retained 28-call suite.
    const sources = ["@system", "[link from @system](https://medium.com/@username/title-of-page)",
        "hi @system.", "hi @system.ao3.", "hi @system.github.com.",
        "hi @username.example.com.bsky",
        '<a href="https://medium.com/@username/title-of-page">link from @system</a>',
        "@system", "@system"];
    const cleaner = createEntryCleaner(limits);
    try {
        for (const source of sources) assert.deepEqual(cleaner.clean({body:source,format:"markdown0",context}),
            {kind:"failure",reason:"unsupported"});
        const hidden = cleaner.clean({body:'<div class="ljcut">@system</div>',format:"markdown0",
            context:{...context,cuts:"source-compatible-recent"}});
        assert.equal(hidden.kind,"ok");
        assert.ok(!hidden.fragment.html.includes("@system"));
    } finally { cleaner.close(); }
});

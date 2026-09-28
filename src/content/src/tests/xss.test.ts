// xss.test.ts
//
// Nothing that can run script survives any cleaner, from t/cleaner-xss.t.
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
import {
    cleanAndTrimSubject, cleanComment, cleanEmbed, cleanEvent, cleanSubject, cleanSubjectAll, cleanUserbio,
} from "../index";
import { site } from "./site";

// Entities that can hide a URL scheme, decoded once as a browser would.
const NAMED: Record<string, string> = { colon: ":", tab: "\t", newline: "\n" };
function decodeOnce(text: string): string {
    return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));?/gi, (whole, hex, dec, name) =>
        hex !== undefined ? String.fromCodePoint(parseInt(hex, 16))
            : dec !== undefined ? String.fromCodePoint(Number(dec))
                : NAMED[name.toLowerCase()] ?? `&${name};`);
}

// The ways the output could still run script. Empty means safe.
function unsafe(html: string, allowMedia = false): string[] {
    const bad = new Set<string>();
    if (/<\s*script/i.test(html)) bad.add("script-tag");
    if (!allowMedia) {
        if (/<\s*iframe/i.test(html)) bad.add("iframe");
        if (/<\s*object\b/i.test(html)) bad.add("object");
        if (/<\s*embed\b/i.test(html)) bad.add("embed");
    }
    if (/<\s*base\b/i.test(html)) bad.add("base");
    if (/<\s*meta[^>]*http-equiv/i.test(html)) bad.add("meta-http-equiv");
    for (const [tag] of html.matchAll(/<[a-z!/][^>]*>/gi)) {
        const bare = tag.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
        if (/[\s"'/]on[a-z]+\s*=/i.test(bare)) bad.add("event-handler");
        if (/[\s"'/]srcdoc\s*=/i.test(bare)) bad.add("srcdoc");
        const decoded = decodeOnce(tag).replace(/[\x00-\x20]+/g, "");
        if (/(?:href|src|action|formaction|xlink:href|poster|background|data|to|values|from)=["']?(?:javascript|vbscript|livescript|mocha):/i.test(decoded)) {
            bad.add("js-uri");
        }
        if (/=["']?data:text\/html/i.test(decoded)) bad.add("data-html");
    }
    const css = [
        ...[...html.matchAll(/<style[^>]*>(.*?)<\/style>/gis)].map(m => m[1]!),
        ...[...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map(m => m[1]!),
        ...[...html.matchAll(/\bstyle\s*=\s*'([^']*)'/gi)].map(m => m[1]!),
    ];
    for (const raw of css) {
        const decoded = decodeOnce(raw);
        if (/expression\s*\(/i.test(decoded)) bad.add("css-expression");
        if (/-moz-binding/i.test(decoded) || /\bbehaviou?r\s*:/i.test(decoded)) bad.add("css-binding");
        if (/@import/i.test(decoded)) bad.add("css-import");
        if (/url\(["']?(?:javascript|vbscript):/i.test(decoded.replace(/[\x00-\x20]+/g, ""))) bad.add("css-url-js");
    }
    return [...bad].sort();
}

const surfaces: Record<string, (text: string) => string> = {
    "event/default": text => cleanEvent(text, {}, site),
    "event/preformatted": text => cleanEvent(text, { preformatted: true }, site),
    "event/markdown": text => cleanEvent(text, { editor: "markdown0" }, site),
    "event/syndicated": text => cleanEvent(text, { isSyndicated: true, preformatted: true }, site),
    "comment/default": text => cleanComment(text, {}, site),
    "comment/anon": text => cleanComment(text, { anonymous: true }, site),
    "comment/markdown": text => cleanComment(text, { editor: "markdown0" }, site),
    "comment/preformatted": text => cleanComment(text, { preformatted: true }, site),
    "subject": text => cleanSubject(text, site),
    "subject_all": text => cleanSubjectAll(text, site),
    "subject_trim": text => cleanAndTrimSubject(text, site, 200),
    "userbio": text => cleanUserbio(text, site),
};

const corpus: [string, string][] = [
    ["script-plain", "<script>alert(1)</script>"],
    ["script-src", '<script src="//evil.test/x.js"></script>'],
    ["script-nested-break", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
    ["script-uppercase", "<SCRIPT>alert(1)</SCRIPT>"],
    ["script-null", "<scri\x00pt>alert(1)</script>"],
    ["img-onerror", "<img src=x onerror=alert(1)>"],
    ["img-onerror-quotes", '<img src="x" onerror="alert(1)">'],
    ["img-onerror-backtick", "<img src=x onerror=alert`1`>"],
    ["img-onerror-tab", "<img src=x on\terror=alert(1)>"],
    ["img-onerror-formfeed", "<img src=x\x0conerror=alert(1)>"],
    ["body-onload", "<body onload=alert(1)>"],
    ["input-autofocus", "<input autofocus onfocus=alert(1)>"],
    ["details-ontoggle", "<details open ontoggle=alert(1)>"],
    ["div-onmouseover", '<div onmouseover="alert(1)">x</div>'],
    ["onpointerrawupdate", "<div onpointerrawupdate=alert(1)>x</div>"],
    ["onbeforetoggle", "<div popover onbeforetoggle=alert(1)>x</div>"],
    ["onscrollend", "<div onscrollend=alert(1)>x</div>"],
    ["attr-newline-handler", '<a href="x"\nonclick="alert(1)">y</a>'],
    ["marquee-onstart", "<marquee onstart=alert(1)>x</marquee>"],
    ["video-source-onerror", "<video><source onerror=alert(1)></video>"],
    ["a-js-href", '<a href="javascript:alert(1)">x</a>'],
    ["a-js-href-entity", '<a href="javascript&#58;alert(1)">x</a>'],
    ["a-js-href-entity-hex", '<a href="javascript&#x3a;alert(1)">x</a>'],
    ["a-js-href-tab", '<a href="java\tscript:alert(1)">x</a>'],
    ["a-js-href-newline", '<a href="java\nscript:alert(1)">x</a>'],
    ["a-js-href-leading-space", '<a href=" javascript:alert(1)">x</a>'],
    ["a-js-href-mixedcase", '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ["a-js-href-uppercase-key", '<a HREF="javascript:alert(1)">x</a>'],
    ["a-js-entity-tab-scheme", '<a href="javasc&Tab;ript:alert(1)">x</a>'],
    ["a-vbscript", '<a href="vbscript:msgbox(1)">x</a>'],
    ["a-data-html", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
    ["img-data-html", '<img src="data:text/html,<script>alert(1)</script>">'],
    ["iframe-js", '<iframe src="javascript:alert(1)"></iframe>'],
    ["iframe-srcdoc", '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
    ["object-data-js", '<object data="javascript:alert(1)"></object>'],
    ["embed-src-js", '<embed src="javascript:alert(1)">'],
    ["form-action-js", '<form action="javascript:alert(1)"><input type=submit></form>'],
    ["button-formaction-js", '<button formaction="javascript:alert(1)">x</button>'],
    ["isindex-formaction", "<isindex type=image formaction=javascript:alert(1)>"],
    ["base-href-js", '<base href="javascript:alert(1)//">'],
    ["meta-refresh-js", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ["bgsound-js", '<bgsound src="javascript:alert(1)">'],
    ["style-attr-expression", '<div style="width:expression(alert(1))">x</div>'],
    ["style-attr-expr-comment", '<div style="width:expr/**/ession(alert(1))">x</div>'],
    ["style-attr-moz-binding", '<div style="-moz-binding:url(//evil.test/x.xml#x)">x</div>'],
    ["style-attr-behavior", '<div style="behavior:url(#default#time2)">x</div>'],
    ["style-attr-bg-js", '<div style="background:url(javascript:alert(1))">x</div>'],
    ["style-tag-import", '<style>@import "//evil.test/x.css";</style>'],
    ["style-tag-expr", "<style>*{width:expression(alert(1))}</style>"],
    ["link-stylesheet", '<link rel="stylesheet" href="//evil.test/x.css">'],
    ["mxss-noscript", '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
    ["mxss-style-img", "<style><style/><img src=x onerror=alert(1)>"],
    ["mxss-style-comment", "<style><!--</style><img src=x onerror=alert(1)>--></style>"],
    ["mxss-listing", "<listing>&lt;img src=x onerror=alert(1)&gt;</listing>"],
    ["mxss-xmp", "<xmp><img src=x onerror=alert(1)></xmp>"],
    ["mxss-textarea", "<textarea><img src=x onerror=alert(1)></textarea>"],
    ["mxss-title", "<title><img src=x onerror=alert(1)></title>"],
    ["mxss-template", "<template><img src=x onerror=alert(1)></template>"],
    ["comment-conditional-ie", "<!--[if gte IE 4]><script>alert(1)</script><![endif]-->"],
];

const markdownCorpus: [string, string][] = [
    ["md-image-js", "![x](javascript:alert(1))"],
    ["md-link-js", "[x](javascript:alert(1))"],
    ["md-link-bracket-js", "[x](<javascript:alert(1)>)"],
    ["md-ref-link-js", "[x][1]\n\n[1]: javascript:alert(1)"],
    ["md-autolink-js", "<javascript:alert(1)>"],
    ["md-raw-img-onerror", "<img src=x onerror=alert(1)>"],
    ["md-raw-script", "<script>alert(1)</script>"],
    ["md-raw-svg-onload", "<svg onload=alert(1)></svg>"],
    ["md-html-block", "<div>\n<img src=x onerror=alert(1)>\n</div>"],
    ["md-code-span-html", "`<img src=x onerror=alert(1)>`"],
    ["md-link-title-quote", '[x](http://ok.test "a) onmouseover=alert(1) b")'],
];

const embedCorpus: [string, string][] = [
    ["embed-script", "<script>alert(1)</script>"],
    ["embed-object-script", "<object><script>alert(1)</script></object>"],
    ["embed-iframe-js", '<iframe src="javascript:alert(1)"></iframe>'],
    ["embed-iframe-onload", '<iframe src="https://www.youtube.com/embed/x" onload="alert(1)"></iframe>'],
    ["embed-iframe-srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["embed-object-data-js", '<object data="javascript:alert(1)"></object>'],
    ["embed-embed-src-js", '<embed src="javascript:alert(1)">'],
    ["embed-embed-onmouse", '<embed src="https://ok.test/v" onmouseover="alert(1)">'],
    ["embed-object-onclick", '<object onclick="alert(1)"><param name="movie" value="javascript:alert(1)"></object>'],
    ["embed-embed-data-html", '<embed src="data:text/html,<script>alert(1)</script>">'],
];

for (const [label, clean] of Object.entries(surfaces)) {
    test(`${label} neutralizes script vectors`, () => {
        for (const [name, payload] of corpus) assert.deepEqual(unsafe(clean(payload)), [], name);
    });
}

for (const label of ["event/markdown", "comment/markdown"]) {
    test(`${label} neutralizes markdown vectors`, () => {
        for (const [name, payload] of markdownCorpus) assert.deepEqual(unsafe(surfaces[label]!(payload)), [], name);
    });
}

test("clean_embed keeps media but neutralizes script", () => {
    for (const [name, payload] of embedCorpus) assert.deepEqual(unsafe(cleanEmbed(payload, site), true), [], name);
});

// SVG and MathML children that entries let through; comments already strip them.
const foreign: [string, string, RegExp][] = [
    ["svg-set-onload", "<svg><set attributeName=onload to=alert(1)></set></svg>", /<\s*set\b/i],
    ["svg-handler", '<svg><handler ev:event="load">alert(1)</handler></svg>', /<\s*handler\b/i],
    ["svg-animate-href", "<svg><a><animate attributeName=href to=javascript:alert(1)></animate></a></svg>", /<\s*animate\b/i],
    ["math-annotation-html",
        '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>', /annotation-xml/i],
];

test("entries strip SVG and MathML foreign content", { todo: "clean_event lets foreign content through" }, () => {
    for (const [name, payload, pattern] of foreign) assert.doesNotMatch(surfaces["event/default"]!(payload), pattern, name);
});

test("comments strip SVG and MathML foreign content", () => {
    for (const [name, payload, pattern] of foreign) assert.doesNotMatch(surfaces["comment/default"]!(payload), pattern, name);
});

test("the detector sees obfuscated vectors and ignores inert ones", () => {
    assert.notDeepEqual(unsafe('<a href="javasc&Tab;ript:alert(1)">x</a>'), []);
    assert.notDeepEqual(unsafe('<a href="javascript&#X3A;alert(1)">x</a>'), []);
    assert.notDeepEqual(unsafe("<img src=x onerror=alert(1)>"), []);
    assert.deepEqual(unsafe('<a href="javasc&amp;Tab;ript:alert(1)">x</a>'), []);
    assert.deepEqual(unsafe('<p title="javascript:not-a-link onerror=text">hi</p>'), []);
});

test("benign content is kept", () => {
    assert.match(surfaces["event/default"]!("<b>hi</b> <em>there</em>"), /<b>hi<\/b>.*<em>there<\/em>/);
    assert.match(surfaces["comment/default"]!("<b>hi</b> <em>there</em>"), /<b>hi<\/b>.*<em>there<\/em>/);
    assert.match(surfaces["event/default"]!('<a href="http://example.com/">link</a>'), /<a[^>]*>link<\/a>/);
    assert.match(surfaces["event/default"]!("hello world"), /hello world/);
});

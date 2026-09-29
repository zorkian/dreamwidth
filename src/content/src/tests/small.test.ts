// small.test.ts
//
// Subjects, tables, links, forms and invalid markup, from t/cleaner-subject.t,
// t/cleaner-tables.t, t/cleaner-link.t, t/cleaner-forms.t and t/cleaner-invalid.t.
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
import { cleanEvent, cleanStylesheet, cleanSubjectAll, ehtml, htmlCleaner } from "../index";
import { hooks, site, userTag } from "./site";

const event = (text: string) => cleanEvent(text, {}, site, hooks);

test("subjects as text keep only the text", () => {
    assert.equal(cleanSubjectAll("<span class='ljuser' lj:user='burr86' style='white-space: nowrap;'><a href=''>" +
        "<img src='http://www.henry.lj/img/userinfo.gif' alt='[info]' width='17' height='17' " +
        "style='vertical-align: bottom; border: 0;' /></a><a href='http://www.henry.lj/userinfo.bml?user=burr86'>" +
        "<b>burr86</b></a></span> kicks butt", site), "burr86 kicks butt");
    assert.equal(cleanSubjectAll("This is a <b>test</b>", site), "This is a test");
});

test("complete tables are kept", () => {
    for (const table of [
        "<table><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></table>",
        "<table><tr><td>Cell 1<td>Cell 2<tr><td>Cell 3<td>Cell 4</table>",
    ]) assert.equal(event(table), table);
});

test("table parts outside a table are shown as text", () => {
    for (const html of ["<tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></table>",
        "<td></td></table>", "<tr></tr></table>", "<td></td>", "<tr></tr>"]) {
        assert.doesNotMatch(event(html), /<t/, html);
    }
    const cells = event("<table><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td><td>Cell 4</td></table>");
    assert.doesNotMatch(cells, /<td/);
    assert.match(cells, /<table/);
    assert.ok(["<table><tbody><tr><td>foo</td></tr></table>", "<table><tbody><tr><td>foo</td></tr></tbody></table>"]
        .includes(event("<table><tbody><tr><td>foo</td></tr></table>")));
});

test("link tags", () => {
    const settings = { ...site, validStylesheet: (href: string) => href === "http://www.example.com/valid.css" };
    const kept = [
        '<link rel="alternate" href="http://www.livejournal.com">',
        '<link rel="shortcut" href="http://www.livejournal.com/favicon.ico">',
        '<link rel="shortcut icon" href="http://www.livejournal.com/favicon.ico">',
        "<link>http://example.com/foo.html</link>",
        '<link href="http://example.com/foo.html" />',
        '<link rel="stylesheet" href="http://www.example.com/valid.css">',
    ];
    for (const html of kept) assert.equal(htmlCleaner(html, settings), html);
    const removed = [
        '<link rel="stylesheet" href="http://www.example.com/bar.css">',
        '<link rel="alternate fox" href="http://www.example.com/bar.css">',
        '<link rel="script">',
    ];
    for (const html of removed) assert.equal(htmlCleaner(html, settings), "");
});

test("form inputs", () => {
    assert.match(event("<form><input name='foo' value='plain'></form>"), /<input/);
    assert.doesNotMatch(event("<form><input name='foo' type='password'></form>"), /password/);
    assert.doesNotMatch(event("<form><input name='foo' type='PASSWORD'></form>"), /PASSWORD/);
    assert.match(event("<form><input name='foo' type='foobar'></form>"), /foobar/);
    assert.doesNotMatch(event("<form><input name='foo' type='some space'></form>"), /some space/);
    assert.doesNotMatch(event("raw: <input name='foo' type='this_is_raw'> end"), /this_is_raw/);
});

test("invalid markup stops cleaning and shows the source", () => {
    assert.equal(event("<b>bold text</b>"), "<b>bold text</b>");
    const invalid = '<marquee><font size="24"><color="FF0000">blah blah';
    const error = (post: string) => "<div class='ljparseerror'>[<strong>Error:</strong> Irreparable invalid markup " +
        "('color=&quot;ff0000&quot;') in entry. Owner must fix manually. Raw contents below.]<br /><br />" +
        `<div style="width: 95%; overflow: auto">${ehtml(post)}</div></div>`;
    assert.equal(event(invalid), '<marquee><font size="24"></font></marquee>' + error(invalid));
    assert.equal(event('<lj user="test_user">'), userTag("test_user"));
    const withUser = `<lj user="test_user"> and some text ${invalid}`;
    assert.equal(event(withUser), `${userTag("test_user")} and some text <marquee><font size="24"></font></marquee>` +
        error(withUser));
});

// DW::Hooks::ProxyCSSLinks quotes every url() in cleaned stylesheets.
test("stylesheet urls are quoted", () => {
    assert.equal(cleanStylesheet("#h { background: url(/img/x.jpg) no-repeat; }\n#g { background: url('a.png'); }\n", site),
        "#h { background: url(\"/img/x.jpg\") no-repeat; }\n#g { background: url('a.png'); }\n");
});

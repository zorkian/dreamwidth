// template.test.ts
//
// The Template Toolkit engine gives what Perl's Template gives for the
// constructs Dreamwidth's views and site schemes use.
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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Template } from "../template";
import { parse } from "../template/parser";

const render = (main: string, vars = {}, files: Record<string, string> = {}) =>
    new Template({ load: name => name === "main" ? main : files[name] }).process("main", vars);

test("every view and site scheme template parses", () => {
    const home = path.resolve(__dirname, "../../../../../..");
    const files = execFileSync("find", ["views", "schemes", "ext", "-name", "*.tt"], { cwd: home, encoding: "utf8" })
        .trim().split("\n");
    assert.ok(files.length > 300);
    for (const file of files) assert.doesNotThrow(() => parse(readFileSync(path.join(home, file), "utf8")), file);
});

test("operators bind as in Perl's Template, with == comparing strings", () => {
    assert.equal(render("[% 1 + 2 * 3 %] [% 1 _ 2 + 3 %] [% 1 _ 2 * 3 %] [% 7 div 2 %] [% -7 mod 3 %] [% 7 / 2 %]"),
        "7 15 16 3 2 3.5");
    assert.equal(render("[% x == 1.0 ? 'y' : 'n' %] [% 1 || 0 && 0 %] [% !a == b %] [% a || 'default' %]",
        { x: "1", a: "", b: "" }), "y 1  default");
});

test("chomp flags trim the text around a directive", () => {
    assert.equal(render("a\n  [%- x -%]  \n b", { x: "X" }), "aX b");
    assert.equal(render("a\n  [%~ x ~%]  \n b", { x: "X" }), "aXb");
    assert.equal(render("a  [%= x =%]  b", { x: "X" }), "a X b");
    assert.equal(render("[% FOREACH i IN [1..2] -%]\n  row [% i %]\n[% END -%]\nend"), "  row 1\n  row 2\nend");
});

test("variables: dotted lookups, methods, private members and assignment", () => {
    const vars = { h: { a: { b: 2 }, _p: 3, list: [1, 2, 3] }, k: "list", f: (x: number) => x * 2 };
    assert.equal(render("[% h.a.b %]|[% h._p %]|[% h.list.-1 %]|[% h.$k.0 %]|[% h.missing.deep %]|[% f(4) %]", vars),
        "2||3|1||8");
    assert.equal(render("[% x.y.z = 1; x.y.keys.join %] [% DEFAULT x.y.z = 5, w = 6 %][% x.y.z %][% w %]"), "z 16");
    assert.equal(render('[% x = "a" | upper %][% x %] [% IF (m = s.match("(b)(c)")) %][% m.1 %][% END %]', { s: "abc" }),
        "A c");
});

test("text, list and hash methods", () => {
    assert.equal(render("[% s.length %]|[% s.split(' ').join('-') %]|[% s.replace('(o)', '[$1]') %]|[% s.substr(1, 3) %]",
        { s: " hello world " }), "13|-hello-world| hell[o] w[o]rld |hel");
    assert.equal(render("[% l.sort.join %]|[% l.nsort.join %]|[% l.unique.join %]|[% l.max %]|[% l.first(2).join %]",
        { l: ["b", "10", "a", "B", "2", "a"] }), "10 2 a a b B|b a B a 2 10|b 10 a B 2|5|b 10");
    assert.equal(render("[% FOREACH p IN h %][% p.key %]=[% p.value %];[% END %][% h.sort.join %]", { h: { b: "x", a: "Y" } }),
        "a=Y;b=x;b a");
});

test("loops set loop, and NEXT and LAST keep the output before them", () => {
    assert.equal(render("[% FOREACH i IN [1..5] %]<[% NEXT IF i == 2 %][% LAST IF i == 4 %][% i %]:[% loop.count %]/" +
        "[% loop.size %][% loop.last ? 'L' : '' %]>[% END %]"), "<1:1/5><<3:3/5><");
    assert.equal(render("[% FOREACH l %][% name %];[% END %][% x FOREACH x IN [4,5] %]", { l: [{ name: "a" }, { name: "b" }] }),
        "a;b;45");
    assert.equal(render("[% i = 0 %][% WHILE (i = i + 1) < 4 %][% i %][% END %]"), "123");
});

// Site schemes are layers of files that PROCESS each other and override BLOCKs.
test("PROCESS shares variables and BLOCKs; INCLUDE keeps them local", () => {
    assert.equal(render("[% BLOCK b %]B[% v %][% END %][% v = 1 %][% PROCESS b %] [% INCLUDE b v = 2 %] [% v %] " +
        "[% x = PROCESS b v = 3 %]<[% x %]>[% v %]"), "B1 B2 1 <B3>3");
    const files = { "one.tt": "[% BLOCK block.x %]one[% END %]", "two.tt": "[% BLOCK block.x %]two[% END %]",
        "inc.tt": "[% h.a = 2; x = 3 %]" };
    assert.equal(render("[% FOREACH s IN ['one.tt', 'two.tt'] %][% PROCESS $s %][% END %][% PROCESS block.x %]", {}, files),
        "two");
    // INCLUDE copies only the top level, so nested changes show outside.
    assert.equal(render("[% INCLUDE inc.tt %][% h.a %][% x %]", { h: { a: 1 } }, files), "2");
});

test("MACRO, WRAPPER, SWITCH, RETURN and STOP", () => {
    assert.equal(render("[% MACRO m(a, b) BLOCK %][% a %]-[% b %]-[% c %][% END %][% m(1, 2) %] [% m(3, 5, c => 4) %]"),
        "1-2- 3-5-4");
    assert.equal(render("[% WRAPPER w.tt title = 'T' %]body[% END %]", {}, { "w.tt": "<[% title %]:[% content %]>" }),
        "<T:body>");
    assert.equal(render("[% SWITCH x %][% CASE 'a' %]A[% CASE ['b', 'c'] %]BC[% CASE %]D[% END %]", { x: "c" }), "BC");
    assert.equal(render("a[% PROCESS r.tt %]c[% STOP %]d", {}, { "r.tt": "b[% RETURN %]x" }), "abc");
});

test("filters, with arguments and in blocks", () => {
    assert.equal(render("[% FILTER html %]<a & 'b'>[% END %] [% 'a b&c/d?e' | uri %] [% 'a b&c/d?e' | url %] " +
        "[% ' x  y ' | trim | upper %] [% t | replace ('a', 'b') %] [% t | truncate(5) %]", { t: "banana" }),
    "&lt;a &amp; &#39;b&#39;&gt; a%20b%26c%2Fd%3Fe a%20b&c/d?e X  Y bbnbnb ba...");
});

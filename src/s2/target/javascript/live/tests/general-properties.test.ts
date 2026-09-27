// general-properties.test.ts
//
// Native recursive plain-property semantics and metadata preparation controls.
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
import assert from "node:assert/strict";
import {test} from "node:test";
import {execFileSync} from "node:child_process";
import {Context, Layer} from "../../runtime/s2runtime";
import {NativeString, scalarPV} from "../../runtime/native-scalar";
import {escapeGeneralProperties} from "../render/general-properties";

test("actual native plain property bytes, recursion, false scalar and no eval clearing", () => {
    const native = execFileSync("perl", ["-I/workspaces/dreamwidth/cgi-bin", "-e", `
        BEGIN {require DBI; no warnings 'redefine';
            *DBI::connect=sub {die "DB forbidden"}; *DBI::connect_cached=sub {die "DB forbidden"};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl'; require LJ::S2;
        my $value=[pack('H*','ff3c783e0a'), {a=>'&quot;',b=>0,c=>undef}];
        LJ::S2::escape_prop_value($value,'plain');
        print unpack('H*',$value->[0]),'|',unpack('H*',$value->[1]{a}),'|',
            unpack('H*',$value->[1]{b}),'|',defined($value->[1]{c})?'defined':'undef';
    `], {timeout: 10000}).toString();
    const layer = new Layer(); layer.registerProperty("_nested", "string[]", {});
    layer.setProperty("_nested", [NativeString.bytes(Buffer.from("ff3c783e0a", "hex")),
        {a: NativeString.hostUtf8Bytes("&quot;"), b: 0, c: undefined}]);
    layer.registerProperty("_false", "string", {}); layer.setProperty("_false", NativeString.hostUtf8Bytes("0"));
    const ctx = new Context([layer], () => {throw new Error("Unexpected print");});
    let clears = 0;
    escapeGeneralProperties(ctx, [layer], {clean: () => {throw new Error("Unexpected nonplain cleaner");}}, () => clears++);
    const value = ctx.prop._nested as [unknown, Record<string, unknown>];
    const actual = [scalarPV(value[0]).bytes().toString("hex"), scalarPV(value[1].a).bytes().toString("hex"),
        scalarPV(value[1].b).bytes().toString("hex"), value[1].c === undefined ? "undef" : "defined"].join("|");
    assert.equal(actual, native); assert.equal(clears, 0);
    assert.equal(scalarPV(ctx.prop._false).bytes().toString(), "0");
});

test("property cleaner eval effects are reached per declaring layer, not guessed from HTML mode", () => {
    const first = new Layer(), second = new Layer();
    first.registerProperty("_rich", "string", {string_mode: "html"});
    second.registerProperty("_rich", "string", {string_mode: "simple-html-oneline"});
    first.setProperty("_rich", NativeString.hostUtf8Bytes("<b>first</b>"));
    const ctx = new Context([first, second], () => {}), modes: string[] = [];
    let clears = 0;
    escapeGeneralProperties(ctx, [first, second], {clean: (mode, value) => {
        modes.push(mode); return {value, clearsException: mode === "html"};
    }}, () => clears++);
    assert.deepEqual(modes, ["html", "simple-html-oneline"]); assert.equal(clears, 1);
});

test("recursive class properties retain the private object discriminator and null marker", () => {
    const layer = new Layer(); layer.registerClass("Box");
    layer.registerProperty("_box", "Box", {});
    layer.setProperty("_box", {".type":"Box", ".isnull":false, _text:NativeString.hostUtf8Bytes("<x>")});
    const ctx = new Context([layer], () => {});
    escapeGeneralProperties(ctx, [layer], {clean: () => {throw new Error("Unexpected cleaner");}}, () => {});
    assert.equal(ctx.objectIsa(ctx.prop._box,"Box"),true);
    const box = ctx.prop._box as Record<string,unknown>;
    assert.equal(box[".isnull"],false);
    assert.equal(scalarPV(box._text).bytes().toString(),"&lt;x&gt;");
});

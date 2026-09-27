// general-builtins.test.ts
//
// Actual source pure hosts and encoded diagnostic authority controls.
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
import test from "node:test";
import {execFileSync} from "node:child_process";
import {Context} from "../runtime/s2runtime";
import {NativeString, nativeProgramError, raiseNativeExecutionStop} from "../runtime/native-scalar";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {preparationDiagnostic, renderDiagnostic} from "../live/render/general-diagnostics";

test("installed pure hosts retain actual native byte and false-value behavior", () => {
    const oracle = JSON.parse(execFileSync("perl", ["tools/general-builtins-native.pl"], {encoding: "utf8"}));
    const callbacks = generalScalarCallbacks({page: () => undefined, seesControlStrip: () => false});
    const context = new Context([], () => {throw Error("Unexpected output");}, undefined, callbacks);
    const pv = (value: string) => NativeString.hostUtf8Bytes(value);
    const input = NativeString.bytes(Buffer.from([255,38,34,60,62,39]));
    const values = [callbacks._ehtml!(context,input),callbacks._etags!(context,input),
        callbacks._htmlattr!(context,pv("WIDTH"),input),callbacks._htmlattr!(context,pv("width"),pv("0")),
        callbacks._striphtml!(context,pv("a<b>x</b><tag\nfoo>y")),
        callbacks._clean_css_classname!(context,pv("evaluate eval")),
        callbacks._alternate!(context,pv("one"),pv("two")),callbacks._alternate!(context,pv("one"),pv("two"))];
    assert.deepEqual(values.map(value => {
        assert.ok(NativeString.is(value));
        return {base64:value.bytes().toString("base64"),utf8:value.flagged()?1:0};
    }), oracle);
});
test("only branded diagnostics gain fixed markup and no author HTML authority", () => {
    const error = nativeProgramError("layer '<b>name</b>' line 4: bad call\n");
    error.stack = "PRIVATE IMPLEMENTATION STACK";
    const rendered = renderDiagnostic({kind:"program",signature:"EntryPage::print()",error});
    assert.equal(rendered.bytes().toString(), "<b>Error running style:</b> layer &#39;&lt;b&gt;name&lt;/b&gt;&#39; line 4: bad call<br />\n");
    assert.ok(!rendered.bytes().includes(Buffer.from("PRIVATE")));
    assert.throws(() => preparationDiagnostic(new Error(error.message)));
    let timeout: Error;
    try {raiseNativeExecutionStop("deadline");} catch (value) {timeout = value as Error;}
    assert.ok(preparationDiagnostic(timeout!).bytes().includes(Buffer.from("<ul><li>Infinite loop")));
});

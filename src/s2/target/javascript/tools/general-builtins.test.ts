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
import {Context,Layer,runtime} from "../runtime/s2runtime";
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
        callbacks._striphtml!(context,pv("a<b\rc>d<e\nf>g")),
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

test("native run-function recursion and deadline prepare/render text is preserved",()=>{
    const rows=JSON.parse(execFileSync("perl",["tools/general-diagnostics-native.pl"],{encoding:"utf8",timeout:10000}));
    for(const row of rows) {
        let error:Error,now=0;
        const layer=new Layer();
        layer.source="diagnostic control";
        layer.registerFunction(["again()"],()=>ctx=>{
            runtime.nativeCOP(ctx,layer,1);
            ctx.recoveryCheckpoint();
            return ctx.getFunction("again()")(ctx);
        },1);
        layer.registerFunction([row.entry],()=>ctx=>{
            if(row.kind==="deadline") {now=4001;ctx.checkExecutionDeadline();return;}
            return ctx.getFunction("again()")(ctx);
        },2);
        const context=new Context([layer],()=>{},undefined,{},undefined,2,undefined,
            {nowMilliseconds:()=>now});
        try {context.runNativeFunction(row.entry);}catch(value){error=value as Error;}
        assert.ok(error!);
        const result=row.entry==="prop_init()"?preparationDiagnostic(error!,row.entry):
            renderDiagnostic({kind:row.kind,signature:row.entry,error:error!});
        assert.equal(result.bytes().toString("base64"),row.html);
    }
});

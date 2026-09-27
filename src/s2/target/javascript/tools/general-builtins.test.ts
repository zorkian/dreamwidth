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
import path from "node:path";
import type {NativeProfile} from "../runtime/native-profile";
import {Context,Layer,runtime} from "../runtime/s2runtime";
import {NativeString, nativeProgramError, raiseNativeExecutionStop} from "../runtime/native-scalar";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {preparationDiagnostic, renderDiagnostic} from "../live/render/general-diagnostics";

test("plural host uses native language reentry, whitespace, fallback and first substitution",()=>{
    const script=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;use MIME::Base64 qw(encode_base64);use JSON::PP;
        my @rows;for my $case(['one # // two # #',2,1],['//zero//',4,99],['',undef,99],
            ['one '.chr(0x2003).'//'.chr(0x2003).'two #',3,1]) {
            my($value,$n,$form)=@$case;my $ctx=[{}, {}, {message=>$value}];
            no warnings 'redefine';local *S2::run_function=sub{$form};
            my $result=S2::Builtin::LJ::get_plural_phrase($ctx,$n,'message');
            my $flag=utf8::is_utf8($value)?1:0;utf8::encode($value) if $flag;
            my $outflag=utf8::is_utf8($result)?1:0;utf8::encode($result) if $outflag;
            push @rows,{input=>encode_base64($value,''),flag=>$flag,n=>$n,form=>$form,
                output=>encode_base64($result,''),outputflag=>$outflag};
        }print encode_json(\@rows);`;
    const rows=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:10000}));
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    for(const row of rows) {
        const layer=new Layer();layer.scalarProfile=profile;let calls=0;
        layer.registerFunction(["lang_map_plural(int)"],()=>()=>{calls++;return row.form;});
        const callbacks=generalScalarCallbacks({page:()=>undefined,seesControlStrip:()=>false});
        const context=new Context([layer],()=>{},undefined,callbacks);
        context.prop._message=NativeString.fromFrame({bytes:Buffer.from(row.input,"base64"),utf8:!!row.flag});
        const value=callbacks._get_plural_phrase!(context,row.n,NativeString.hostUtf8Bytes("message"));
        assert.ok(NativeString.is(value));
        assert.deepEqual({output:value.bytes().toString("base64"),outputflag:value.flagged()?1:0},
            {output:row.output,outputflag:row.outputflag});
        assert.equal(calls,1);
    }
});

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
        callbacks._alternate!(context,pv("one"),pv("two")),callbacks._alternate!(context,pv("one"),pv("two")),
        callbacks._eurl!(context,input),
        callbacks._clean_url!(context,NativeString.bytes(Buffer.concat([Buffer.from("https://example.invalid/"),Buffer.from([255,10])]))),
        callbacks._clean_url!(context,pv("https://example.invalid/a\\b"))];
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

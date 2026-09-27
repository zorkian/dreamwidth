// recovery.test.ts
//
// Independent native generated-program recovery and closed-language tests.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {s2, Context, Layer} from "../runtime/s2runtime";
import {recoverActiveLayer, type RecoveryInput} from "../live/render/recovery";

function input(code: string, id=101): RecoveryInput {
    return {id,ownerId:1,systemUserId:1,parentId:0,type:"core",activeBytes:Buffer.from(code)};
}

// This explicit test adapter supplies the agreed G1 metadata/checkpoint seam
// against the preserved base runtime. It is not an integrated-runtime claim.
function testRuntime() {
    const metadata: unknown[]=[];
    return {metadata, api:{...s2, runtime:{...s2.runtime,
        makeHash(pairs: [unknown,unknown][]) {
            const hash=Object.create(null);for(const [k,v] of pairs)hash[String(k)]=v;return hash;
        },recoveryCheckpoint() {}},
        makeLayer() {
            const layer=new Layer();
            return Object.assign(layer,{
                registerClassMetadata(name: string, data: Record<string,unknown>) {
                    layer.registerClass(name,typeof data.parent === "string" ? data.parent : undefined);
                    metadata.push(["class",name,data]);
                },registerGlobalFunction(...args: unknown[]) {metadata.push(["global",...args]);},
            });
        }}};
}
function recovered(code: string, id=101, runtime=testRuntime()) {
    const result=recoverActiveLayer(input(code,id),1);
    assert.equal(result.kind,"recovered",result.kind === "gap" ? result.reason : "");
    if(result.kind !== "recovered")throw new Error("Expected recovered program");
    const layer=runInNewContext(result.code+"; recovered_layer;",{s2:runtime.api},{timeout:5000}) as Layer;
    return {layer,result,runtime};
}
const envelope=(body: string)=>`package S2; use strict; register_layer(101); ${body} 1;`;

test("actual compiler-generated custom active program recovers without source/checker", () => {
    const native=JSON.parse(execFileSync("perl",[resolve("../../tests/js-recovery/native.pl")],
        {encoding:"utf8",timeout:15000})) as {codes:string[];outputs:string[];numeric:{literal:string;product:string;concat:number}};
    assert.deepEqual(native.numeric,{literal:"9007199254740993",product:"9007199515875289",concat:2});
    assert.deepEqual(native.outputs,["A:child(box=6):4:1:3:base=21:kept:-4:3:2:reverse=3:size=3:unicode=猫é:keys=3:type=child:null:done\n",
        "custom:child(box=6):4:1:3:custom=21:kept:-4:3:2:reverse=3:size=3:unicode=猫é:keys=3:type=child:null:done\n"]);
    const runtime=testRuntime();
    const layers=native.codes.map((code,i)=>recovered(code,101+i,runtime).layer);
    for(const [i,stack] of [[0,[layers[0]!]], [1,layers]] as const) {
        let output="";
        const context=new Context([...stack],text=>{output+=text;});
        context.runFunction("main()");
        assert.equal(output,native.outputs[i]);
    }
    assert.ok(runtime.metadata.some((m: any)=>m[0] === "class" && m[1] === "Box"));
});

test("historical constants/Color tuple and exact aliases are declarative", () => {
    const code=envelope(`use constant VTABLE => 0; use constant STATIC => 1; use constant PROPS => 2;
        register_set(101,"color",["#abc",\\&S2::Builtin::Color__Color]);
        register_function(101,["first()","historical()"],sub { return sub {
            my ($_ctx)=@_; $S2::pout->("legacy"); }; });`);
    const {layer}=recovered(code);
    assert.equal((layer.properties.get("_color") as any)._as_string,"#aabbcc");
    assert.equal(layer.functions.get("first()"),layer.functions.get("historical()"));
});

test("literals, prototype keys, deletion, evaluation order and safe/raw output remain distinct", () => {
    const code=envelope(`register_set(101,"__proto__",{"constructor"=>"kept", "__proto__"=>"old", "__proto__"=>"new"});
        register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;
            my $h={"__proto__"=>"visible","gone"=>"delete"}; delete $h->{"gone"};
            $S2::pout_s->("<b>"); $S2::pout->($h->{"__proto__"});
            $S2::pout->(S2::notags("<x>"));
        };});`);
    const {layer}=recovered(code);
    const value=layer.properties.get("___proto__") as any;
    assert.equal(Object.getPrototypeOf(value),null);
    assert.equal(value.__proto__,"new");assert.equal(value.constructor,"kept");
    let raw="",safe="";
    new Context([layer],x=>{raw+=x;},undefined,undefined,x=>{safe+=x;return "SAFE";}).runFunction("main()");
    assert.equal(safe,"<b>");assert.equal(raw,"SAFEvisible&lt;x&gt;");
});

test("complete hostile syntax is rejected, including unreachable suffix and interpolated literals", () => {
    for(const suffix of ["BEGIN {system('touch marker');}", "use Evil;", "require 'evil';",
        "system('id');", "register_function(101,[],sub {return sub { my ($_ctx)=@_; if(0){system('id');} };});",
        "register_set(999,'x','wrong');", "register_set(101,'x',`id`);",
        'register_set(101,"x","$ENV{SECRET}");', 'register_set(101,"x",S2::Builtin::LJ::system("id")); trailing']) {
        assert.equal(recoverActiveLayer(input(envelope(suffix)),1).kind,"gap",suffix);
    }
    const fake='BEGIN { system("id"); }';
    const escaped=fake.replaceAll('"','\\"');
    const {layer}=recovered(envelope(`register_set(101,"data","${escaped}");`));
    assert.equal(layer.properties.get("_data"),fake);
});

test("current source is absent from the recovery contract; active bytes alone bind the result", () => {
    const a=recoverActiveLayer(input(envelope('register_set(101,"label","A");')),1);
    const b=recoverActiveLayer(input(envelope('register_set(101,"label","B");')),1);
    assert.equal(a.kind,"recovered");assert.equal(b.kind,"recovered");
    if(a.kind === "recovered" && b.kind === "recovered")assert.notEqual(a.activeSha256,b.activeSha256);
    assert.equal(recovered(envelope('register_set(101,"label","A");')).layer.properties.get("_label"),"A");
});

test("native unsafe integer literals and operations stay explicit unfinished ABI gaps", () => {
    const literal=recoverActiveLayer(input(envelope('register_set(101,"large",9007199254740993);')),1);
    assert.equal(literal.kind,"gap");
    if(literal.kind === "gap")assert.match(literal.reason,/native-width/);
    const {layer}=recovered(envelope(`register_function(101,["main()"],sub {return sub {
        my ($_ctx)=@_; my $n=94906267; $S2::pout->($n * $n);
    };});`));
    let output="";
    assert.throws(()=>new Context([layer],s=>{output+=s;}).runFunction("main()"),/native integer ABI gap/);
    assert.equal(output,"");
    // Independent exact integer expectation; Number would round this result.
    assert.equal((94906267n * 94906267n).toString(),"9007199515875289");
});

test("quoted token spellings never become parser syntax", () => {
    for(const value of [")", "(", "}", "{", "if", "return", "use", "eq", "+", "package"]) {
        const {layer}=recovered(envelope(`register_set(101,"literal",${JSON.stringify(value)});`));
        assert.equal(layer.properties.get("_literal"),value);
    }
    assert.equal(recoverActiveLayer(input(envelope('register_set(101,"x",1 "eq" 1);')),1).kind,"gap");
    assert.equal(recoverActiveLayer(input(envelope('register_function(101,["main()"],sub{return sub{my ($_ctx)=@_; $_ctx->{"builtin"}->("id");};});')),1).kind,"gap");
});

test("retained native operator precedence and array autovivification are explicit", () => {
    const {layer}=recovered(envelope(`register_function(101,["main()"],sub{return sub {
        my ($_ctx)=@_; my $a; push(@{$a},1,2); my $h; $h->{"x"}=3;
        $S2::pout->("x" . 1 + 2); $S2::pout->($a->[-1]); $S2::pout->($h->{"x"});
    };});`));
    let output="";new Context([layer],s=>{output+=s;}).runFunction("main()");
    assert.equal(output,"223");
});

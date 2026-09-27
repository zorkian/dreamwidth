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
import {resolve,join} from "node:path";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {NativeOutput,NativeString} from "../runtime/native-string";
import {scalarPV,legacyText} from "../runtime/native-scalar";
import {ArtifactCompiler,instantiateProgram,type ActiveStyleSnapshot} from "../live/render/layer-artifact";
import {runInNewContext} from "node:vm";
import {s2, Context, Layer} from "../runtime/s2runtime";
import {Parser} from "../live/render/recovery/parser";
import {instantiate} from "../live/render/recovery/execute";
import {recoverActiveLayer, type RecoveryInput} from "../live/render/recovery";

function input(code: string, id=101): RecoveryInput {
    return {id,ownerId:1,systemUserId:1,parentId:0,type:"core",activeBytes:Buffer.from(code)};
}

// All execution uses the installed reviewed runtime and private Context brand.
const text=(value: unknown)=>legacyText(scalarPV(value));
function recovered(code: string, id=101) {
    const result=recoverActiveLayer(input(code,id),1);
    assert.equal(result.kind,"recovered",result.kind === "gap" ? result.reason : "");
    if(result.kind !== "recovered")throw new Error("Expected recovered program");
    const layer=runInNewContext(result.code+"; recovered_layer;",{s2},{timeout:5000}) as Layer;
    return {layer,result};
}
const envelope=(body: string)=>`package S2; use strict; register_layer(101); ${body} 1;`;

test("production raw-byte native and source-proven/recovered programs share actual scalar ABI",async()=>{
    const native=JSON.parse(execFileSync("perl",[resolve("../../tests/js-recovery/native.pl")],
        {encoding:"utf8",timeout:15000})) as {codes:string[];sources:string[];codesUtf8:number[];
        outputs:{base64:string;utf8:number}[];numeric:{literal:string;product:string;concat:number}};
    assert.deepEqual(native.codesUtf8,[0,0]);
    assert.deepEqual(native.numeric,{literal:"9007199254740993",product:"9007199515875289",concat:2});
    const prefix=Buffer.from("A:child(box=6):4:1:3:base=21:kept:-4:3:2:reverse=3:size=3:unicode=");
    const suffix=Buffer.concat([Buffer.from(":keys=3:type=child:null:byte="),Buffer.from("e78cabc3a9","hex"),
        Buffer.from(":byte-size=5:scalar-reverse="),Buffer.from("a9c3ab8ce7","hex"),
        Buffer.from(":direct-reverse="),Buffer.from("e78cabc3a9","hex"),
        Buffer.from(":compare=greater:wide=9007199254740993:product=9007199515875289:alias=2:2:done\n")]);
    assert.deepEqual(Buffer.from(native.outputs[0]!.base64,"base64"),
        Buffer.concat([prefix,Buffer.from("ab8ce7a9c3","hex"),suffix]));
    assert.deepEqual(Buffer.from(native.outputs[1]!.base64,"base64"),Buffer.concat([
        Buffer.from("custom:child(box=6):4:1:3:custom=21:kept:-4:3:2:reverse=3:size=3:unicode="),
        Buffer.from("ab8ce7a9c3","hex"),suffix]));
    const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:native.codes.map((code,i)=>({
        id:101+i,ownerId:i?2:1,parentId:i?101:0,type:i?"layout":"core",compiledTime:1,
        sourceBytes:Buffer.from(native.sources[i]!,"base64"),activeCompiledBytes:Buffer.from(code,"base64")}))};
    const directory=mkdtempSync(join(tmpdir(),"g1r-shared-"));
    try {
        const launcher=join(directory,"compiler-isolation");
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",resolve("tools/compiler-isolation.c"),"-o",launcher]);
        const producer=new ArtifactCompiler({s2Root:resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:launcher});
        const compiled=await producer.compile(snapshot);
        assert.equal(compiled.kind,"compiled");if(compiled.kind!=="compiled")throw Error("source correspondence required");
        const source=instantiateProgram(compiled.program);
        assert.deepEqual(await producer.compile({...snapshot,layers:snapshot.layers.map(row=>({...row,sourceBytes:null}))}),
            {kind:"recovery",layerId:101,reason:"missing-source"});
        assert.deepEqual(await producer.compile({...snapshot,layers:snapshot.layers.map(row=>row.id===101 ?
            {...row,sourceBytes:Buffer.from(Buffer.from(row.sourceBytes!).toString().replace('set label = "A"','set label = "B"'))} : row)}),
            {kind:"recovery",layerId:101,reason:"active-source-correspondence"});
        const recoveredLayers=native.codes.map((code,i)=>{
            const bytes=Buffer.from(code,"base64"),result=recoverActiveLayer({...input("",101+i),activeBytes:bytes},1);
            assert.equal(result.kind,"recovered",result.kind==='gap'?result.reason:'');
            if(result.kind!=="recovered")throw Error("recovery required");
            const layer=runInNewContext(result.code+";recovered_layer;",{s2},{timeout:5000}) as Layer;
            layer.scalarProfile=producer.scalarProfile;
            return layer;
        });
        for(const layers of [source,recoveredLayers])for(const [i,stack] of [[0,[layers[0]!]], [1,layers]] as const){
            const output=new NativeOutput();
            const context=new Context([...stack],()=>{throw Error("legacy output forbidden");},
                undefined,undefined,undefined,500,{raw:v=>output.append(v),safe:v=>output.append(v)});
            context.runFunction("main()");
            assert.equal(output.bytes().toString("base64"),native.outputs[i]!.base64);
            assert.equal(output.frame().utf8,native.outputs[i]!.utf8===1);
        }
        assert.ok(recoveredLayers[0]!.classMetadata.has("Box"));
    } finally {rmSync(directory,{recursive:true,force:true});}
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
    assert.equal(text(s2.runtime.memberSlot(value,NativeString.hostUtf8Bytes("__proto__"),"hash").get()),"new");assert.equal(text(s2.runtime.memberSlot(value,NativeString.hostUtf8Bytes("constructor"),"hash").get()),"kept");
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
    assert.equal(text(layer.properties.get("_data")),fake);
});

test("current source is absent from the recovery contract; active bytes alone bind the result", () => {
    const a=recoverActiveLayer(input(envelope('register_set(101,"label","A");')),1);
    const b=recoverActiveLayer(input(envelope('register_set(101,"label","B");')),1);
    assert.equal(a.kind,"recovered");assert.equal(b.kind,"recovered");
    if(a.kind === "recovered" && b.kind === "recovered")assert.notEqual(a.activeSha256,b.activeSha256);
    assert.equal(text(recovered(envelope('register_set(101,"label","A");')).layer.properties.get("_label")),"A");
});

test("wide numeric lexemes and operations use installed native scalar semantics",()=>{
    const {layer}=recovered(envelope(`register_set(101,"large",9007199254740993);
        register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;
        my $n=94906267;$S2::pout->($n*$n);};});`));
    assert.equal(text(layer.properties.get("_large")),"9007199254740993");
    let output="";new Context([layer],s=>output+=s).runFunction("main()");
    assert.equal(output,"9007199515875289");
});

test("quoted token spellings never become parser syntax", () => {
    for(const value of [")", "(", "}", "{", "if", "return", "use", "eq", "+", "package"]) {
        const {layer}=recovered(envelope(`register_set(101,"literal",${JSON.stringify(value)});`));
        assert.equal(text(layer.properties.get("_literal")),value);
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

test("Context fields and alternate builtin contexts cannot be nominated by active code", () => {
    for(const body of [
        `$_ctx->{"safeOutput"}=sub {my ($x)=@_;return $x;};$S2::pout_s->("<script>x</script>");`,
        `my $x=$_ctx->{"builtin"};`,
        `$_ctx->[1]{"safeOutput"}="changed";`,
        `my $alias=$_ctx;`,
    ]) {
        const result=recoverActiveLayer(input(envelope(`register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;${body}};});`)),1);
        assert.equal(result.kind,"gap");
    }
    const {layer}=recovered(envelope(`register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;
        S2::Builtin::LJ::Page__print_body({"builtin"=>{}},{});
    };});`));
    assert.throws(()=>new Context([layer],()=>{}).runFunction("main()"),/requires executing Context/);
});


test("executor independently protects Context and refuses forged function contexts", () => {
    const {layer}=recovered(envelope(`register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;
        $S2::pout_s->("<script>x</script>");
    };});`));
    const fn=layer.functions.get("main()")!;
    let bypass=false;
    assert.throws(()=>fn({getFunction(){},safePrint(){bypass=true;},print(){bypass=true;}} as unknown as Context),/authoritative Context/);
    assert.equal(bypass,false);
    const prototypeForged=Object.create(Context.prototype);
    assert.equal(s2.runtime.isContext(prototypeForged),false);
    assert.throws(()=>fn(prototypeForged),/authoritative Context/);
    let safe="";
    new Context([layer],()=>{},undefined,undefined,text=>{safe+=text;return "clean";}).runFunction("main()");
    assert.equal(safe,"<script>x</script>");
});


test("executor refuses Context hash reads and writes even without frontend validation", () => {
    for(const body of [
        `$_ctx->{"safeOutput"}=sub {my ($x)=@_;return $x;};`,
        `my $x=$_ctx->{"builtin"};`,
        `my $alias=$_ctx;my $x=$alias->{"write"};`,
    ]) {
        const ast=new Parser(envelope(`register_function(101,["main()"],sub {return sub {my ($_ctx)=@_;${body}};});`)).parse();
        const layer=instantiate(ast,s2,101) as Layer;
        assert.throws(()=>new Context([layer],()=>{}).runFunction("main()"),/Context (mutation|hash access) refused/);
    }
});

test("all native stock registrations plus Venture helpers and 2000-term recovery execution",
    {timeout:180000},()=>{
    const oracle=JSON.parse(execFileSync("/usr/bin/prlimit",["--as=1073741824","--cpu=120","--",
        "perl",resolve("../../tests/js-recovery/stock-native.pl")],{
        env:{...process.env,PERL_HASH_SEED:"0",PERL_PERTURB_KEYS:"0"},
        encoding:"utf8",timeout:150000,maxBuffer:128*1024*1024}));
    assert.equal(oracle.layers.length,59);
    const layers=new Map<string,Layer>();
    for(const row of oracle.layers) {
        const result=recoverActiveLayer({...input("",row.id),activeBytes:Buffer.from(row.activeBase64,"base64")},1);
        assert.equal(result.kind,"recovered",row.name+": "+(result.kind==='gap'?result.reason:''));
        if(result.kind!=="recovered")throw Error("stock recovery required");
        layers.set(row.name,runInNewContext(result.code+";recovered_layer;",{s2},{timeout:5000}));
    }
    const context=new Context([layers.get("core2")!,layers.get("venture/layout.s2")!],()=>{throw Error("unexpected output");});
    const comment={".type":"Comment",_replies:[
        {".type":"Comment",_replies:[{".type":"Comment",_replies:[]}]},
        {".type":"Comment",_replies:[]}]};
    assert.equal(text(context.getFunction("print_module_pagesummary_comment_count(Comment)")(context,comment)),String(oracle.count));
    assert.equal(text(context.getFunction("generate_font_css(string,string,string,string,string)")(
        context,...["Georgia","Arial","serif","12","px"].map(NativeString.hostUtf8Bytes))),oracle.font);
    const result=recoverActiveLayer({...input("",903),activeBytes:Buffer.from(oracle.long.activeBase64,"base64")},1);
    assert.equal(result.kind,"recovered",result.kind==='gap'?result.reason:'');
    if(result.kind!=="recovered")throw Error("long recovery required");
    const layer=runInNewContext(result.code+";recovered_layer;",{s2},{timeout:5000});
    const output=new NativeOutput();
    new Context([layer],()=>{throw Error("legacy sink forbidden");},undefined,undefined,undefined,500,
        {raw:v=>output.append(v),safe:()=>{throw Error("unexpected safe output");}}).runFunction("main()");
    assert.equal(output.bytes().toString("base64"),oracle.long.outputBase64);
    assert.equal(output.bytes().length,2000);
});

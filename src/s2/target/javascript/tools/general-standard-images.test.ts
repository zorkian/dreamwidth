// general-standard-images.test.ts
//
// Actual native known-HTTPS regex, scalar flags and explicit proxy omission.
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
import {mkdtempSync,readFileSync,writeFileSync,cpSync,mkdirSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralRenderer} from "../live/render/general-child";
import {verifyGeneralRuntime} from "../live/render/manifest";
import {GeneralStandardImages,installedImageLanguageContext} from "../live/domain/general-standard-images";
import {parentInstalledStandardImages} from "../live/render/general-standard-images-host";
import {MysqlPublicTranslations} from "../live/data/public-translations";
import {withSelectedFixture} from "./selected-fixture";
import {generalNativeHostResult,generalNativeHostValue} from "../live/render/general-native-host-result";
import {isNativeProgramError,nativeProgramError,scalarPV,NativeString} from "../runtime/native-scalar";
import {readStartupConfig} from "../live/server/startup-config";
import {encodeGeneralModel} from "../live/render/general-model-wire";
import {parentLoadUser} from "../live/render/general-user-host";
import {GeneralUserAuthority} from "../live/domain/general-user-authority";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import {config} from "../live/tests/fixtures";
const pv=NativeString.hostUtf8Bytes;

test("real private source image helpers reset at print and retain prepared aliases",()=>withSelectedFixture(async fixture=>{
    const script=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        use lib '/workspaces/dreamwidth/src/s2';require S2::Compiler;require S2::Checker;
        use JSON::PP;use MIME::Base64 qw(encode_base64);
        my $source=q!layerinfo type=core;
            class Image {var string url;var string alttext;function builtin set_url(string url);}
            function builtin get_image(string key):Image;
            property Image saved;
            property string text_icon_alt_private;set text_icon_alt_private="before";
            property int num_items_recent;set num_items_recent=3;
            class RecentPage {var Image standard;function print();}
            function prop_init() {$*saved=get_image("security-private");$*text_icon_alt_private="after";}
            function modules_init() {}
            function RecentPage::print() {var Image fresh=get_image("security-private");$fresh->set_url("a b");
                print $*saved.alttext + "|" + $.standard.alttext + "|" + $fresh.alttext + "|" + $fresh.url + "|" + $*saved.url;}
        !;my $original=$source;my $code='';S2::Compiler->new({checker=>S2::Checker->new})->compile_source(
            {type=>'core',source=>\$source,output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
        S2::load_layer(101,$code);my $ctx=S2::make_context(101);
        # Explicit current-context isolation is a measured protective divergence
        # from native init's absent/prior-request CURR_CTX global (not reused).
        local $LJ::S2::CURR_CTX=$ctx;local $LJ::S2::RES_MADE=0;
        no warnings 'redefine';local *LJ::Lang::ml=sub{'ML:'.($_[0]//'')};
        S2::set_output(sub{});S2::set_output_safe(sub{});S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
        my $page={_type=>'RecentPage',standard=>LJ::S2::Image_std('security-private')};
        my $out='';
        local $LJ::S2::ret_ref=\$out;
        my $ok=LJ::S2::s2_run(undef,$ctx,{contenttype=>'text/html'},'RecentPage::print()',$page);
        die 'Unexpected native render failure' unless $ok;
        print encode_json({source=>encode_base64($original,''),code=>encode_base64($code,''),output=>encode_base64($out,'')});`;
    const native=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:15000}));
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-standard-images-"));
    const exported=path.join(directory,"private.json");
    execFileSync("perl",["-I","/workspaces/dreamwidth/cgi-bin","tools/site-config.pl","--output",exported,
        "--app-origin","http://app.example.test","--listen-origin","http://viewer.example.test:9191"],{timeout:15000});
    const startup=readStartupConfig(exported),source=new GeneralStandardImages(startup.standardImages!);
    const sandbox=path.join(directory,"sandbox"),isolation=path.join(directory,"compiler-isolation");
    for(const [input,output] of [["live/render/sandbox.c",sandbox],["tools/compiler-isolation.c",isolation]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",input!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:path.resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:isolation});
    const language=new MysqlPublicTranslations(fixture.startup.database,startup.placeholder,compiler.scalarProfile);
    await fixture.admin.query(`INSERT INTO ${fixture.table(fixture.g,"ml_langs")} (lnid,lncode,lnname,parenttype,parentlnid) VALUES (1,'en','English','diff',0)`);
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    const compiled=path.join(directory,"compiled");cpSync(path.resolve("dist"),compiled,{recursive:true});
    const driver=readFileSync(path.join(compiled,"tools/general-model-worker-child.js"),"utf8")
        .replaceAll('require("../live/render/','require("./').replaceAll('require("../live/domain/','require("../domain/')
        .replaceAll('require("../runtime/','require("../../runtime/');
    mkdirSync(path.join(compiled,"live/render"),{recursive:true});writeFileSync(path.join(compiled,"live/render/general-worker.js"),driver);
    const descriptor=path.join(directory,"installation.json");writeFileSync(descriptor,JSON.stringify({schema:1,kind:"general-s2-worker",entry:"app/dist/live/render/general-worker.js"}));
    execFileSync(process.execPath,["--input-type=module","-e",
        "import {stageGeneralRuntime} from '../../../content/tools/stage-runtime.mjs';stageGeneralRuntime(process.argv[1],{s2Dist:process.argv[2]});",descriptor,compiled],{timeout:120000});
    const renderer=new GeneralRenderer(sandbox,verifyGeneralRuntime(descriptor),{maxOutputBytes:1048576,maxHeapMiB:128,timeoutMs:10000});
    try {
        const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,type:"core",
            sourceBytes:Buffer.from(native.source,"base64")}]});
        const unused={async snapshot():Promise<never>{throw Error("Unused public provider");},async revalidate(){return true;}};
        const publicSession=new GeneralPublicSession(unused,language,compiler.scalarProfile,25,undefined,
            installedImageLanguageContext(startup.nativeLanguageContext));
        const authority=new GeneralUserAuthority(publicSession,{displayName:()=>pv(""),journalBase:()=>pv(""),tellFriend:false});
        const events:string[]=[];
        const frame=await renderer.render("a".repeat(64),{start:{version:1,transfer:coordinator.transfer(prepared),config,kind:"recent"},
            async host(operation,parameters,phase){
                if(operation==="standard-images") {events.push(phase);return parentInstalledStandardImages(parameters,source,publicSession);}
                if(operation==="user-lite")return parentLoadUser(parameters,authority);
                throw Error("Unexpected host");
            },
            async select(count){publicSession.afterContextInitialization();assert.equal(count,3);events.push("select");return {kind:"recent",page:encodeGeneralModel({title:pv("selected"),username:pv(""),standardImageName:pv("security-private")})};}});
        assert.equal(Buffer.from(frame.bytes).toString("base64"),native.output);
        assert.deepEqual(events,["initialize","select","render"]);
        assert.equal(await publicSession.finish(async()=>true),true);
    }finally{renderer.close();await language.close();}
},true));

test("private native helper errors preserve positive origin and infrastructure stays terminal",async()=>{
    const branded=nativeProgramError("Known native language error");
    const wire=await generalNativeHostResult(()=>{throw branded;});
    assert.throws(()=>generalNativeHostValue(wire,()=>null),error=>isNativeProgramError(error));
    const unknown=Error("Known native language error");
    await assert.rejects(generalNativeHostResult(()=>{throw unknown;}),error=>error===unknown);
    assert.throws(()=>generalNativeHostValue({kind:"native-error",error:{kind:"pv",base64:"!",utf8:false}},()=>null));
    assert.equal(generalNativeHostValue(await generalNativeHostResult(()=>7),value=>value),7);
});

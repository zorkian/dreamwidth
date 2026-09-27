// general-page-worker.test.ts
//
// Actual installed factory execution with declared empty-content native providers.
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
import {cpSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {ArtifactCompiler} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralRenderer} from "../live/render/general-child";
import {verifyGeneralRuntime} from "../live/render/manifest";
import {encodeGeneralModel} from "../live/render/general-model-wire";
import {parentLoadUser,parentUserUrl} from "../live/render/general-user-host";
import {GeneralUserAuthority} from "../live/domain/general-user-authority";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import {NativeString} from "../runtime/native-string";
import {config} from "../live/tests/fixtures";

const source=`layerinfo type = core;
property int num_items_recent; property int initialized; set initialized = 0;
property string text_module_customtext; set text_module_customtext = "Before init";
class UserLite { var string user; var string username; function builtin equals(UserLite other):bool; }
function builtin UserLite(string name):UserLite;
function builtin get_url(UserLite user, string view):string;
class Entry { var UserLite poster; var string subject; }
class RecentPage { var string global_title; var string customtext_title; var UserLite journal; var Entry[] entries; function print(); }
class EntryPage { var string global_title; var string customtext_title; var UserLite journal; var Entry entry; function print(); }
function label(string name):string { return "[" + $name + "]"; }
function prop_init() { $*initialized++; $*num_items_recent = 3; $*text_module_customtext = "Initialized"; print "suppressed"; }
function modules_init() {}
function RecentPage::print() { print label("recent") + $.global_title + ":" + $*initialized + ":" + $.entries[0].poster.user + ":" + get_url($.entries[0].poster, "recent"); if ($.journal->equals($.entries[0].poster)) { print ":same"; } print ":" + $.customtext_title; }
function EntryPage::print() { print label("entry") + $.global_title + ":" + $*initialized + ":" + $.entry.poster.user + ":" + get_url($.entry.poster, "recent"); if ($.journal->equals($.entry.poster)) { print ":same"; } print ":" + $.customtext_title; }
`;

test("real factory prepares Page/Entry after one init and resumes source/recovered custom functions",async()=>{
    const native=JSON.parse(execFileSync("perl",["-e",String.raw`use strict;use warnings;no warnings 'once';
        use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;use S2::Compiler;use S2::Checker;
        use JSON::PP;use MIME::Base64 qw(encode_base64);my $source=do{local $/;<STDIN>};
        my $checker=S2::Checker->new();my $code='';S2::Compiler->new({checker=>$checker})->compile_source(
            {type=>'core',source=>\$source,output=>\$code,layerid=>101,untrusted=>1,builtinPackage=>'S2::Builtin::LJ'});
        S2::load_layer(101,$code,1);my %outputs;
        {package FactoryUrlUser;sub journal_base{'https://public.example.invalid'}}
        no warnings 'redefine';local *LJ::load_user=sub{$_[0] eq 'public_name'?bless({},'FactoryUrlUser'):undef};
        for my $kind('recent','entry'){my $ctx=S2::make_context(101);S2::set_output(sub{});S2::set_output_safe(sub{});
            S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
            # Declared public model fields; native constructor semantics are independently qualified.
            my $entry={_type=>'Entry',subject=>undef,poster=>{_type=>'UserLite',user=>'public_name',_u=>{userid=>111}}};
            my $page={_type=>$kind eq 'recent'?'RecentPage':'EntryPage',global_title=>'Title',entry=>$entry,entries=>[$entry],
                journal=>{_type=>'User',user=>'public_name',_u=>{userid=>111}},
                customtext_title=>LJ::S2::escape_prop_value_ret($ctx->[S2::PROPS()]->{text_module_customtext},'plain')};
            my $out='';S2::set_output(sub{$out.=$_[0]});S2::set_output_safe(sub{$out.=$_[0]});
            S2::run_code($ctx,$page->{_type}.'::print()',$page);$outputs{$kind}=encode_base64($out,'');
        }print encode_json({code=>encode_base64($code,''),outputs=>\%outputs});`],
        {input:source,encoding:"utf8",timeout:10000}));
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-page-factory-"));
    const sandbox=path.join(directory,"sandbox"),isolation=path.join(directory,"compiler-isolation");
    for(const [input,output] of [["live/render/sandbox.c",sandbox],["tools/compiler-isolation.c",isolation]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",input!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:path.resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:isolation});
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
    const compiled=path.join(directory,"compiled");cpSync(path.resolve("dist"),compiled,{recursive:true});
    const driver=readFileSync(path.join(compiled,"tools/general-page-worker-child.js"),"utf8")
        .replaceAll('require("../live/render/','require("./')
        .replaceAll('require("../live/domain/','require("../domain/')
        .replaceAll('require("../runtime/','require("../../runtime/');
    writeFileSync(path.join(compiled,"live/render/general-worker.js"),driver);
    const descriptor=path.join(directory,"installation.json");
    writeFileSync(descriptor,JSON.stringify({schema:1,kind:"general-s2-worker",entry:"app/dist/live/render/general-worker.js"}));
    execFileSync(process.execPath,["--input-type=module","-e",
        "import {stageGeneralRuntime} from '../../../content/tools/stage-runtime.mjs';stageGeneralRuntime(process.argv[1],{s2Dist:process.argv[2]});",
        descriptor,compiled],{timeout:120000});
    const renderer=new GeneralRenderer(sandbox,verifyGeneralRuntime(descriptor),
        {maxOutputBytes:1048576,maxHeapMiB:128,timeoutMs:10000});
    for(const missing of [false,true]) {
        const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:111,
            parentId:0,type:"core",compiledTime:1,sourceBytes:missing?null:Buffer.from(source),
            activeCompiledBytes:Buffer.from(native.code,"base64")}]});
        assert.equal(prepared.program.route,missing?"recovery":"source");
        for(const kind of ["recent","entry"] as const) {
            let selected=false;const reads:string[]=[];
            const session=new GeneralPublicSession({async snapshot(name){reads.push(name);assert.equal(selected,true);
                return {requestedName:name,user:{userid:111,username:name,clusterid:0,status:"A",statusvis:"V",journaltype:"P",
                    dversion:1,caps:"0",name:NativeString.hostUtf8Bytes("Public"),identity:null},fingerprint:"declared"};},
                async revalidate(){return true;}},
                {async snapshot():Promise<never>{throw Error("No fixture ML read");},async revalidate(){return true;}},
                prepared.program.scalarProfile,25);
            const users=new GeneralUserAuthority(session,{displayName:user=>NativeString.hostUtf8Bytes(user.username),
                journalBase:()=>NativeString.hostUtf8Bytes("https://public.example.invalid"),tellFriend:false});
            const frame=await renderer.render("b".repeat(64),{
                start:{version:1,transfer:coordinator.transfer(prepared),config,kind},
                async select(count){assert.equal(count,3);assert.equal(selected,false);selected=true;
                    return {kind,page:encodeGeneralModel({title:NativeString.hostUtf8Bytes("Title"),username:NativeString.hostUtf8Bytes("public_name")})};},
                async host(operation,parameters){
                    if(operation==="user-lite")return parentLoadUser(parameters,users);
                    assert.equal(operation,"user-url");return parentUserUrl(parameters,users);
                },
            });
            assert.equal(frame.utf8,false);assert.equal(Buffer.from(frame.bytes).toString("base64"),native.outputs[kind]);
            assert.ok(reads.length>=1);assert.equal(await session.finish(async()=>true),true);
        }
    }
    console.log("Actual factory source/recovery evidence (declared empty content): "+directory);
});

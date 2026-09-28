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
import {generalUserpicImage} from "../live/domain/general-userpic-image";
import {prepareGeneralUserpicRoot} from "../live/domain/general-image-url";

const source=`layerinfo type = core;
property int num_items_recent; property int initialized; set initialized = 0;
property string text_module_customtext; set text_module_customtext = "Before init";
class UserLite { var string user; var string username; function builtin equals(UserLite other):bool; }
function builtin UserLite(string name):UserLite;
function builtin get_url(UserLite user, string view):string;
class Image { var int width; var string url; }
class User extends UserLite { var Image default_pic; }
function builtin get_url(User user, string view):string;
class Entry { var UserLite poster; var string subject; var Image userpic; }
class Date { var int year; var int month; var int day; function builtin day_of_week():int; }
class RecentPage { var string global_title; var string customtext_title; var User journal; var Entry[] entries; function print(); }
class EntryPage { var string global_title; var string customtext_title; var User journal; var Entry entry; function print(); }
function civil_day():Date { var Date d=new Date; $d.year=2026; $d.month=9; $d.day=27; return $d; }
function label(string name):string { return "[" + $name + "]"; }
function prop_init() { $*initialized++; $*num_items_recent = 3; $*text_module_customtext = "Initialized"; print "suppressed"; }
function modules_init() {}
function RecentPage::print() { print label("recent") + $.global_title + ":" + $*initialized + ":" + $.entries[0].poster.user + ":" + get_url($.journal, "recent"); if ($.journal->equals($.entries[0].poster)) { print ":same"; } print ":" + $.entries[0].subject + ":" + $.customtext_title; print ":" + $.journal.default_pic.width + ":" + $.journal.default_pic.url; var Date d=civil_day(); print ":" + $d->day_of_week(); $.entries[0].userpic.width=7; if (isnull $.entries[0].userpic) { print ":null"; } else { print ":object"; } }
function EntryPage::print() { print label("entry") + $.global_title + ":" + $*initialized + ":" + $.entry.poster.user + ":" + get_url($.journal, "recent"); if ($.journal->equals($.entry.poster)) { print ":same"; } print ":" + $.entry.subject + ":" + $.customtext_title; print ":" + $.journal.default_pic.width + ":" + $.journal.default_pic.url; var Date d=civil_day(); print ":" + $d->day_of_week(); $.entry.userpic.width=7; if (isnull $.entry.userpic) { print ":null"; } else { print ":object"; } }
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
        my $picture_owner=bless {userid=>111,user=>'public_name',clusterid=>0,statusvis=>'V',defaultpicid=>17},'LJ::User';
        local *LJ::load_userid=sub{die 'Unplanned picture owner' unless $_[0]==111;return $picture_owner};
        local $LJ::USERPIC_ROOT='https://pics.example.invalid';
        for my $kind('recent','entry'){my $ctx=S2::make_context(101);S2::set_output(sub{});S2::set_output_safe(sub{});
            S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
            # Declared public model fields; native constructor semantics are independently qualified.
            my $subject='<script>discard</script><b>Subject</b>';
            LJ::CleanHTML::clean_subject(\$subject);
            my $entry={_type=>'Entry',subject=>$subject,poster=>{_type=>'UserLite',user=>'public_name',_u=>{userid=>111}},
                userpic=>$kind eq 'entry'?LJ::S2::Null('Image'):undef};
            my $page={_type=>$kind eq 'recent'?'RecentPage':'EntryPage',global_title=>'Title',entry=>$entry,entries=>[$entry],
                journal=>{_type=>'User',user=>'public_name',_u=>{userid=>111},
                    default_pic=>LJ::S2::Image_userpic($picture_owner,17,undef,13,15)},
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
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
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
        const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:111,
            parentId:0,type:"core",sourceBytes:Buffer.from(source)}]});
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
                    const pv=NativeString.hostUtf8Bytes;
                    const root=prepareGeneralUserpicRoot({base64:Buffer.from("https://pics.example.invalid").toString("base64"),utf8:false});
                    const defaultPicture=generalUserpicImage({userid:111,picid:17,root:root.value,
                        username:pv("public_name"),width:13,height:15,description:undefined,keyword:undefined});
                    const page={fields:{styleId:0,styleModtime:0,baseUrl:pv("/journal"),journalType:pv("P"),
                        ownerName:pv("Title"),journalTitle:undefined,journalSubtitle:undefined,
                        layoutName:undefined,themeName:undefined,layoutUrl:pv(""),getargs:[],
                        viewingStyleOptions:undefined,viewUrls:[],links:[],
                        customtext:{title:undefined,url:undefined,content:undefined},
                        customtextDefaults:{title:pv("stale caller default"),url:undefined,content:undefined},
                        showControlStrip:0,isCanary:0,noMobileCookie:0,sessionMessages:undefined,
                        headContent:pv(""),canUseNetwork:0,activeEntries:[]},
                        journalName:pv("public_name"),defaultPicture,websiteUrl:undefined,websiteName:undefined};
                    const entry={journalId:111,posterId:111,forceMoodtheme:undefined,permalinkUrl:pv("/261.html"),
                        dateparts:pv("2026 09 27 00 00 00 00"),systemDateparts:pv("2026 09 27 00 00 00 00"),
                        security:pv("public"),allowmask:0,adultContentLevel:pv(""),adminPost:0,
                        content:{subject:pv("<script>discard</script><b>Subject</b>"),event:undefined,
                            journalName:pv("public_name"),ditemid:261,
                            jitemid:1,editor:undefined,preformatted:0,importSourceDefined:false,isSyndicated:0,
                            logtimeMysql:pv("2026-09-27 00:00:00"),suspendMessage:0,noEntryBody:0,noHtml:0,
                            cutUrl:pv("/261.html"),cutDisable:0}};
                    const approved=kind==="recent"?{kind,page:{page,selection:{skip:0,itemshow:3,maxskip:97,
                        showStickies:false,stickyEntries:[],window:[{entry,countedSticky:false,
                            datePrefix:pv("2026 09 27")}],hasLookahead:false},
                        navigation:{filterActive:false,filterName:pv(""),filterTags:undefined,
                            selectionHead:pv(""),feedTagQuery:pv(""),linkAttributes:[]}}}:
                        {kind,page:{page,entry:{...entry,mode:undefined},thread:undefined}};
                    return {kind,page:encodeGeneralModel(approved)};},
                async host(operation,parameters){
                    if(operation==="user-lite")return parentLoadUser(parameters,users);
                    assert.equal(operation,"user-url");return parentUserUrl(parameters,users);
                },
            });
            assert.equal(frame.utf8,false);assert.equal(Buffer.from(frame.bytes).toString("base64"),native.outputs[kind]);
            assert.ok(reads.length>=1);assert.equal(await session.finish(async()=>true),true);
        }
    console.log("Actual factory source evidence (cleaned subject, empty event): "+directory);
});

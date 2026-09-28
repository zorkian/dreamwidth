// general-page-model.test.ts
//
// Actual native anonymous Page construction with fixed public helper facts.
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
import {mkdtempSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ArtifactCompiler} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {GeneralProgramSession} from "../live/render/general-session";
import {config} from "../live/tests/fixtures";
import {execFileSync} from "node:child_process";
import {generalPage,type GeneralPageInput} from "../live/domain/general-page-model";
import {NativeString} from "../runtime/native-string";
import {runtime} from "../runtime/s2runtime";
import {escapeGeneralPlainProperty} from "@dreamwidth/content/general-contexts";
const pv=(value:string)=>NativeString.hostUtf8Bytes(value);

test("anonymous Page keeps native args, fallback double-clean order, views and source URL",async()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
        *DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;require LJ::CleanHTML;
        use lib '/workspaces/dreamwidth/src/s2';require S2::Compiler;require S2::Checker;
        my $source=q!layerinfo type = core;
            class string {function builtin css_multiply_length(int multiplier) : string;}
            property int num_items_recent;set num_items_recent=20;
            property int init_count;set init_count=0;
            class DateTime {var int year;}
            class RecentPage {var string view;var string global_title;var string stylesheet_url;var DateTime time;function print();}
            function prop_init() {$*init_count++;$*num_items_recent=3;print "SUPPRESSED";}
            function modules_init() {}
            function RecentPage::print() {var string length="2px";print $.view + "|" + $.global_title + "|" + $.stylesheet_url + "|" + $.time.year + "|" + $*init_count + "|" + $*num_items_recent + "|" + $length->css_multiply_length(3);}
        !;
        my $original=$source;my $code='';my $compiler=S2::Compiler->new({checker=>S2::Checker->new});
        $compiler->compile_source({type=>'core',source=>\$source,output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
        S2::load_layer(101,$code);
        use MIME::Base64 qw(encode_base64);my @outputs;

        {package PageUser;sub prop{$_[0]{props}{$_[1]}}sub set_prop{$_[0]{props}{$_[1]}=$_[2]}
        sub meta_discovery_links{''}sub profile_url{'/profile'}sub is_identity{$_[0]{journaltype} eq 'I'}
        sub is_syndicated{$_[0]{journaltype} eq 'Y'}sub can_use_network_page{$_[0]{network}}
        sub can_use_active_entries{0}}
        {package PageRequest;sub cookie{0}sub msgs{[]}sub clear_msgs{}}
        local $LJ::SITEROOT='/site';local $LJ::APPLE_TOUCH_ICON='';local $LJ::FACEBOOK_PREVIEW_ICON='';
        local $LJ::IS_CANARY=0;
        no warnings 'redefine';local *DW::Request::get=sub{bless {},'PageRequest'};
        local *LJ::get_remote=sub{undef};local *LJ::Links::load_linkobj=sub{[]};
        local *LJ::S2::User=sub{{_type=>'User'}};local *LJ::create_url=sub{'/journal'.$_[0]};
        local *LJ::viewing_style_opts=sub{{}};local *LJ::Hooks::run_hook=sub{0};
        local *S2::get_style_modtime=sub{100};my $date=\&LJ::S2::DateTime_unix;
        local *LJ::S2::DateTime_unix=sub{$date->(1790506804)};
        my @rows;for my $kind('P','I','Y'){
            my $u=bless {_s2styleid=>0,_journalbase=>'/journal',journaltype=>$kind,name=>'fallback&name',
                journaltitle=>'0',journalsubtitle=>'<sub>',props=>{customtext_title=>'Custom Text',customtext_url=>'0',customtext_content=>'0'}},'PageUser';
            my $p=LJ::S2::Page($u,{ctx=>[{}, {}, {text_module_customtext=>'T<\n',text_module_customtext_url=>'/a?x=1&y=2',
                text_module_customtext_content=>"a\nb"}],getargs=>{'.x'=>'v','ordinary'=>'drop'}});
            push @rows,{map{$_=>$p->{$_}}qw(view args journal_type base_url stylesheet_url customtext_title customtext_url
                customtext_content views_order global_title global_subtitle include_meta_viewport has_activeentries)};
            my $ctx=S2::make_context(101);S2::set_output(sub{});S2::set_output_safe(sub{});
            S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
            $p->{_type}='RecentPage';$p->{view}='recent';my $out='';
            S2::set_output(sub{$out.=$_[0]});S2::set_output_safe(sub{$out.=$_[0]});
            S2::run_code($ctx,'RecentPage::print()',$p);push @outputs,encode_base64($out,'');
        }print encode_json({rows=>\@rows,source=>encode_base64($original,''),code=>encode_base64($code,''),outputs=>\@outputs});`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    const expected=native.rows;
    const pages:Record<string,unknown>[]=[];
    const fields=["view","args","journal_type","base_url","stylesheet_url","customtext_title","customtext_url",
        "customtext_content","views_order","global_title","global_subtitle","include_meta_viewport","has_activeentries"];
    for(const [index,kind] of ["P","I","Y"].entries()) {
        const input:GeneralPageInput={styleId:0,styleModtime:100,baseUrl:pv("/journal"),journal:{".type":"User"},
            journalType:pv(kind),ownerName:pv("fallback&name"),journalTitle:pv("0"),journalSubtitle:pv("<sub>"),
            layoutName:undefined,themeName:undefined,layoutUrl:pv(""),
            getargs:[[pv(".x"),pv("v")],[pv("ordinary"),pv("drop")]],viewingStyleOptions:{},viewUrls:[],links:[],
            customtext:{title:pv("Custom Text"),url:pv("0"),content:pv("0")},
            customtextDefaults:{title:pv("T<\\n"),url:pv("/a?x=1&y=2"),content:pv("a\nb")},
            showControlStrip:0,isCanary:0,noMobileCookie:0,sessionMessages:[],headContent:pv(""),canUseNetwork:0,activeEntries:[]};
        const calls:string[]=[];
        const page=generalPage(input,{clockSeconds:()=>1790506804,escapeProperty(value,mode){calls.push(mode);
            if(mode==="plain")return NativeString.fromFrame(escapeGeneralPlainProperty(runtime.scalarPV(value).frame()));
            // Native test provider only: real clean_event, never an installed identity cleaner.
            const script=String.raw`use lib '/workspaces/dreamwidth/cgi-bin';require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
                require LJ::S2;local $/;my $v=<STDIN>;LJ::S2::escape_prop_value($v,'html');print $v;`;
            return NativeString.bytes(execFileSync("perl",["-e",script],{input:runtime.scalarPV(value).bytes(),timeout:10000}));
        }});
        const plain=(value:unknown):unknown=>NativeString.is(value)?value.bytes().toString("utf8"):
            Array.isArray(value)?value.map(plain):value&&typeof value==="object"?
                Object.fromEntries(Object.keys(value).map(key=>[key,plain((value as Record<string,unknown>)[key])])):value;
        const projected=Object.fromEntries(fields.map(name=>[name,plain(page["_"+name])]));
        projected.args=Object.fromEntries(runtime.hashKeys(page._args).map(key=>[
            runtime.scalarPV(key).bytes().toString("utf8"),plain(runtime.memberSlot(page._args,key,"hash").get())]));
        assert.deepEqual(projected,expected[index]);
        assert.deepEqual(calls,["plain","plain","html"]);pages.push(page);
    }
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-page-context-"));
    const isolation=path.join(directory,"compiler-isolation"),sandbox=path.join(directory,"sandbox");
    for(const [source,output] of [["tools/compiler-isolation.c",isolation],["live/render/sandbox.c",sandbox]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:path.resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:isolation});
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    {
            const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,
                type:"core",sourceBytes:Buffer.from(native.source,"base64")}]});
            const session=new GeneralProgramSession(coordinator.transfer(prepared),config,
                generalScalarCallbacks({page:()=>pages[0],seesControlStrip:()=>false}), {
                contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
                stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
                    trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},
                transformCss:()=>{throw Error("Fixture has no CSS");},expandEmbed:()=>{throw Error("Fixture has no embed");}});
            const context=session.context;
            assert.equal(session.initialize({clean(){throw Error("Fixture has no rich initialization property");}}).kind,"initialized");
            const page=pages[0]!;page[".type"]="RecentPage";page._view=pv("recent");
            session.beginRender();
            const frame=session.completePage(page,"recent",()=>{throw Error("Positive Page must not request diagnostic");});
            assert.equal(session.context,context);
            assert.equal(Buffer.from(frame.bytes).toString("base64"),native.outputs[0]);
    }
});

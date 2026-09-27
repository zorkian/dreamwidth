// general-recent-from-source.test.ts
//
// Actual native Recent window, sticky, day and navigation model preparation.
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
import path from "node:path";
import {tmpdir} from "node:os";
import {mkdtempSync} from "node:fs";
import {ArtifactCompiler} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralProgramSession} from "../live/render/general-session";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {initializedRecentCount} from "../live/render/general-selection";
import {config} from "../live/tests/fixtures";
import {execFileSync} from "node:child_process";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {generalRecentHead} from "../live/domain/general-recent-head";
import {generalMakeLink,generalEscapeUrl} from "../live/domain/general-navigation-url";
import {runtime} from "../runtime/s2runtime";
import {generalRecentFromSource} from "../live/domain/general-recent-from-source";
import type {GeneralModel} from "../live/domain/general-model-primitives";
const pv=NativeString.hostUtf8Bytes;
test("Recent retains native sticky counting, current-entry day flags and maxskip navigation",async()=>{
    const script=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;use JSON::PP;use MIME::Base64 qw(encode_base64);
        use lib '/workspaces/dreamwidth/src/s2';require S2::Compiler;require S2::Checker;
        my $source=q!layerinfo type=core;
            property int num_items_recent;set num_items_recent=20;
            property int init_count;set init_count=0;
            class Entry {var int itemid;var int new_day;var int end_day;}
            class StickyEntry extends Entry {}
            class RecentNav {var int count;var int skip;}
            class RecentPage {var Entry[] entries;var RecentNav nav;function print();}
            function prop_init() {$*num_items_recent=3;$*init_count++;print "SUPPRESSED";}
            function modules_init() {$*init_count++;}
            function RecentPage::print() {print $*init_count + ":" + $.nav.count + ":" + $.nav.skip;
                foreach var Entry entry ($.entries) {print "|" + $entry.itemid + ":" + $entry.new_day + ":" + $entry.end_day;}}
        !;my $original=$source;my $code='';S2::Compiler->new({checker=>S2::Checker->new})->compile_source(
            {type=>'core',source=>\$source,output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
        S2::load_layer(101,$code);my @outputs;
        {package RecentUser;sub is_community{$_[0]{community}}sub user{'journal'}sub journal_base{'/journal'}sub should_block_robots{0}
            sub prop{undef}sub sticky_entries{bless {eventtime=>'2026-09-25 00:00:00',id=>257},'RecentEntry'}
            sub sticky_entry_active_ids{257}sub recent_items{map{{itemid=>$_,anum=>1,posterid=>500}}1..4}}
        {package RecentEntry;sub visible_to{1}sub poster{bless{},'RecentPoster'}sub is_suspended_for{0}}
        {package RecentPoster;sub is_suspended{0}}
        no warnings 'redefine';local $LJ::SITENAMESHORT='DW';local $LJ::MAX_SCROLLBACK_LASTN=6;
        local *LJ::S2::Page=sub{{_type=>'Page',base_url=>'/journal',head_content=>''}};
        local *LJ::S2::Image_std=sub{{_type=>'Image',url=>$_[0]}};
        local *LJ::need_res=sub{};local *LJ::S2::tracking_popup_js=sub{''};local *LJ::Talk::init_s2journal_js=sub{};
        local *LJ::Talk::init_s2journal_shortcut_js=sub{};local *LJ::Lang::ml=sub{''};local *LJ::robot_meta_tags=sub{''};
        local *LJ::Hooks::run_hook=sub{0};local *LJ::Entry::new=sub{my($class,$u,%args)=@_;my $id=$args{ditemid};
            bless {id=>$id,eventtime=>$id==769?'2026-09-27 01:00:00':'2026-09-26 00:00:00'},'RecentEntry'};
        local *LJ::S2::Entry_from_entryobj=sub{{_type=>'Entry',itemid=>$_[1]{id},new_day=>0,end_day=>0}};
        local *LJ::alldatepart_s2=sub{my $v=shift;$v=~s/[-:]/ /g;$v};
        my @out;for my $skip(0,3){my $ctx=S2::make_context(101);S2::set_output(sub{});S2::set_output_safe(sub{});
            S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
            my $u=bless{community=>$skip==3?1:0},'RecentUser';my $p=LJ::S2::RecentPage($u,undef,
            {ctx=>$ctx,getargs=>{skip=>$skip}});
            my $printed='';S2::set_output(sub{$printed.=$_[0]});S2::set_output_safe(sub{$printed.=$_[0]});
            S2::run_code($ctx,'RecentPage::print()',$p);push @outputs,encode_base64($printed,'');
            push @out,{entries=>[map{{id=>$_->{itemid},type=>$_->{_type},new=>$_->{new_day},end=>$_->{end_day}}}@{$p->{entries}}],
                nav=>$p->{nav},head=>$p->{head_content},feeds=>$p->{data_links_order}};
        }print encode_json({rows=>\@out,outputs=>\@outputs,source=>encode_base64($original,''),code=>encode_base64($code,'')});`;
    const native=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:10000}));
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-recent-context-"));
    const isolation=path.join(directory,"compiler-isolation"),sandbox=path.join(directory,"sandbox");
    for(const [source,output] of [["tools/compiler-isolation.c",isolation],["live/render/sandbox.c",sandbox]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:path.resolve("../.."),perl:"/usr/bin/perl",isolationExecutable:isolation});
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"),{sandbox});
    for(const [index,skip] of [0,3].entries()) {
        const entry=(id:number):GeneralModel=>({".type":"Entry",_itemid:id,_new_day:0,_end_day:0});
        const displayed:number[]=[];
        const page=generalRecentFromSource({page:{".type":"Page",_base_url:pv("/journal"),_head_content:pv("")},
            skip,itemshow:3,maxskip:3,hasLookahead:true,showStickies:skip===0,stickyEntries:[entry(257)],
            window:[257,513,769].map(id=>({entry:entry(id),countedSticky:id===257,
                datePrefix:pv(id===769?"2026 09 27":"2026 09 26")})),
            filterActive:0,filterName:pv(""),filterTags:0,feedTagQuery:pv(""),linkAttributes:[],
            selectionHead:generalRecentHead({isCommunity:skip===3,siteNameShort:pv("DW"),canonicalJournalBase:pv("/journal"),
                robotMarkup:pv(""),icbm:undefined,cutLabels:{expanded:pv(""),collapsed:pv(""),collapseAll:pv(""),expandAll:pv("")}})}, {
            standardImage:kind=>({".type":"Image",_url:pv(kind)}),eventDisplayed:e=>{displayed.push(e._itemid as number);},
            makeLink:generalMakeLink});
        const nav=Object.fromEntries(Object.entries(page._nav as GeneralModel).map(([key,value])=>[
            key===".type"?"_type":key.slice(1),NativeString.is(value)?value.bytes().toString():value]));
        assert.deepEqual({entries:(page._entries as GeneralModel[]).map(e=>({id:e._itemid,type:e[".type"],new:e._new_day,end:e._end_day})),
            nav,head:scalarPV(page._head_content).bytes().toString(),feeds:(page._data_links_order as NativeString[]).map(v=>v.bytes().toString())},native.rows[index]);
        assert.deepEqual(displayed,skip===0?[513,769]:[257,513,769]);
        assert.equal(runtime.hashKeys(page._data_link).length,2);
        for(const missing of [false,true]) {
            const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,
                type:"core",compiledTime:1,sourceBytes:missing?null:Buffer.from(native.source,"base64"),
                activeCompiledBytes:Buffer.from(native.code,"base64")}]});
            const session=new GeneralProgramSession(coordinator.transfer(prepared),config,
                generalScalarCallbacks({page:()=>page,seesControlStrip:()=>false}),{
                contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
                stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
                    trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},
                transformCss:()=>{throw Error("Fixture has no CSS");},expandEmbed:()=>{throw Error("Fixture has no embed");}});
            const sameContext=session.context;
            const initialized=session.initialize({clean(){throw Error("Fixture has no rich initialization property");}});
            assert.equal(initialized.kind,"initialized");
            if(initialized.kind==="initialized")assert.equal(initializedRecentCount(initialized.recentCount),3);
            session.beginRender();const frame=session.completePage(page,"recent",()=>{throw Error("Unexpected diagnostic");});
            assert.equal(session.context,sameContext);
            assert.equal(Buffer.from(frame.bytes).toString("base64"),native.outputs[index]);
        }
    }
});

test("native eurl preserves byte/flag codepoints and make_link last-wins without implicit encoding",()=>{
    const script=String.raw`use lib '/workspaces/dreamwidth/cgi-bin';require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        use JSON::PP;use MIME::Base64 qw(encode_base64);my @out;
        for my $v (undef,'0',"a b?&/\\:",pack('C*',255,0),chr(0x732b)) {
            my $out=LJ::eurl($v);push @out,{value=>encode_base64($out,''),flag=>utf8::is_utf8($out)?1:0};
        }my $link=LJ::S2::make_link('/journal/',{skip=>3,empty=>'',zero=>'0'});print encode_json({rows=>\@out,link=>$link});`;
    // make_link lives in the installed source module, not a copied oracle.
    const native=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:10000}));
    const inputs=[undefined,pv("0"),pv("a b?&/\\:"),NativeString.bytes(Buffer.from([255,0])),NativeString.hostUnicode("猫")];
    assert.deepEqual(inputs.map(v=>{const out=generalEscapeUrl(v);return {value:out.bytes().toString("base64"),flag:out.flagged()?1:0};}),native.rows);
    const actual=generalMakeLink(pv("/journal/"),[[pv("skip"),1],[pv("empty"),pv("")],[pv("zero"),pv("0")],[pv("skip"),3]]);
    const logical=(value:string)=>[...new URL(value,"https://example.test").searchParams].sort();
    assert.deepEqual(logical(actual.bytes().toString()),logical(native.link));
});

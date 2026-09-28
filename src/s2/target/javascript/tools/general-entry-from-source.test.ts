// general-entry-from-source.test.ts
//
// Actual native selected Entry preparation with declared public helper providers.
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
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {ArtifactCompiler} from "../live/render/layer-artifact";
import {ProgramCoordinator} from "../live/render/program-coordinator";
import {GeneralProgramSession} from "../live/render/general-session";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {config} from "../live/tests/fixtures";
import {execFileSync} from "node:child_process";
import {Context,Layer,runtime} from "../runtime/s2runtime";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {generalEntryFromSource,type GeneralEntrySourceInput} from "../live/domain/general-entry-from-source";
import {generalImage,generalCommentInfo} from "../live/domain/general-model-primitives";
import type {NativeProfile} from "../runtime/native-profile";
const pv=NativeString.hostUtf8Bytes;

test("selected Entry follows native author/picture/theme/tag/comment order and constructor aliases",async()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;use JSON::PP;
        use lib '/workspaces/dreamwidth/src/s2';require S2::Compiler;require S2::Checker;use MIME::Base64 qw(encode_base64);
        my $source=q!layerinfo type = core;
            property int init_count;set init_count=0;
            class Entry {var string subject;var string text;var string dom_id;}
            class EntryPage {var Entry entry;function print();}
            function prop_init() {$*init_count++;print "SUPPRESSED";}
            function modules_init() {}
            function EntryPage::print() {print $.entry.subject + "|" + $.entry.text + "|" + $.entry.dom_id + "|" + $*init_count;}
        !;my $original=$source;my $code='';
        S2::Compiler->new({checker=>S2::Checker->new})->compile_source({type=>'core',source=>\$source,output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
        S2::load_layer(101,$code);my @outputs;
        {package EntryJournal;sub user{'journal'}sub id{500}sub prop{$_[1] eq 'opt_forcemoodtheme'?'Y':undef}sub moodtheme{9}sub adult_content_calculated{''}}
        {package EntryPoster;sub moodtheme{7}}
        {package EntryPicture;sub picid{31}}
        {package SelectedEntry;sub anum{5}sub jitemid{1}sub ditemid{261}sub journalid{500}sub posterid{501}
        sub subject_html{push @main::trace,'subject';'TITLE'}sub event_html{push @main::trace,'event';'BODY'}
        sub url{'/261.html'}sub userpic{(bless({},'EntryPicture'),'keyword')}sub security{'public'}
        sub adult_content_calculated{''}sub allowmask{0}sub props{{}}sub admin_post{0}
        sub comment_info{push @main::trace,'comments';{count=>2,enabled=>1}}sub group_names{''}}
        our @trace;my $journal=bless {},'EntryJournal';my $poster=bless {},'EntryPoster';
        no warnings 'redefine';local *LJ::get_remote=sub{undef};local *LJ::load_userid=sub{$_[0]==500?$journal:$poster};
        local *LJ::viewing_style_args=sub{''};local *LJ::viewing_style_opts=sub{{}};
        local *LJ::S2::UserLite=sub{push @trace,$_[0]==$journal?'journal':'poster';{_type=>'UserLite',_u=>$_[0]}};
        local *LJ::expand_embedded=sub{push @trace,'s2-entry:'.$_[1]};
        local *DW::Logic::AdultContent::transform_post=sub{my($class,%args)=@_;push @trace,'adult';$args{post}};
        local *LJ::S2::Image_userpic=sub{push @trace,'picture';LJ::S2::Image('/picture',75,51,'ALT')};
        local *LJ::Tags::get_logtags=sub{{1=>{}}};
        local *LJ::S2::TagList=sub{push @trace,'tags';push @{$_[4]},{_type=>'Tag',name=>'tag'};'TAGS'};
        local *LJ::is_enabled=sub{1};local *LJ::currents=sub{('Music'=>'MUSIC')};
        local *LJ::Entry::new=sub{bless {},'SelectedEntry'};
        my @rows;for my $position('left','none') {
            @trace=();my $entry=bless {eventtime=>'2026-09-27 00:00:00',logtime=>'2026-09-26 23:00:00'},'SelectedEntry';
            my $out=LJ::S2::Entry_from_entryobj($journal,$entry,{getargs=>{},ctx=>[{}, {},{userpics_position=>$position,entry_userpic_style=>'small'}]});
            my $ctx=S2::make_context(101);S2::set_output(sub{});S2::set_output_safe(sub{});
            S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');my $printed='';
            S2::set_output(sub{$printed.=$_[0]});S2::set_output_safe(sub{$printed.=$_[0]});
            S2::run_code($ctx,'EntryPage::print()',{_type=>'EntryPage',entry=>$out});push @outputs,encode_base64($printed,'');
            push @rows,{trace=>[@trace],subject=>$out->{subject},text=>$out->{text},width=>$out->{userpic}{width},
                height=>$out->{userpic}{height},keys=>$out->{link_keyseq},dom=>$out->{dom_id},year=>$out->{time}{year},
                systemhour=>$out->{system_time}{hour},metadata=>$out->{metadata},tag=>$out->{tags}[0]{name},count=>$out->{comments}{count}};
        }print encode_json({rows=>\@rows,source=>encode_base64($original,''),code=>encode_base64($code,''),outputs=>\@outputs});`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const directory=mkdtempSync(path.join(tmpdir(),"g2c-entry-context-"));
    const isolation=path.join(directory,"compiler-isolation"),sandbox=path.join(directory,"sandbox");
    for(const [source,output] of [["tools/compiler-isolation.c",isolation],["live/render/sandbox.c",sandbox]])
        execFileSync("cc",["-std=c11","-Wall","-Wextra","-Werror","-O2",source!,"-o",output!]);
    const compiler=new ArtifactCompiler({s2Root:root,perl:"/usr/bin/perl",isolationExecutable:isolation});
    const coordinator=new ProgramCoordinator(compiler,path.join(directory,"cache"));
    for(const [index,position] of ["left","none"].entries()) {
        const layer=new Layer();layer.scalarProfile=profile;const context=new Context([layer],()=>{throw Error("Unexpected print");});
        context.prop._userpics_position=pv(position);context.prop._entry_userpic_style=pv("small");
        const trace:string[]=[];const journal={".type":"UserLite"},poster={".type":"UserLite"};
        const input:GeneralEntrySourceInput={journalId:500,posterId:501,permalinkUrl:pv("/261.html"),dateparts:pv("2026 9 27 0 0 0 0"),
            systemDateparts:pv("2026 9 26 23 0 0 6"),security:pv("public"),allowmask:0,adultContentLevel:pv(""),adminPost:0,
            forceMoodtheme:pv("Y"),content:{subject:pv("TITLE"),event:pv("BODY"),journalName:pv("journal"),ditemid:261,jitemid:1,
                editor:undefined,preformatted:0,importSourceDefined:false,isSyndicated:0,logtimeMysql:pv("2026-09-26 23:00:00"),
                suspendMessage:0,noEntryBody:0,noHtml:0,cutUrl:pv("/261.html"),cutDisable:0}};
        const result=generalEntryFromSource(context,input,{features:{memories:true,tellafriend:true,esn:true},
            cleanSubject(value){trace.push("subject");return value;},cleanEvent(value){trace.push("event");return value;},
            // Actual event_html's internal expansion is covered separately; native fake event_html above omits it.
            expandEmbedded(value,id,stage){if(stage==="s2-entry")trace.push(stage+":"+id);return value;},
            transformAdult(value){trace.push("adult");return value;},user(kind){trace.push(kind);return kind==="journal"?journal:poster;},
            picture(kind){assert.equal(kind,"entry-poster");trace.push("picture");return generalImage(pv("/picture"),75,51,pv("ALT"));},
            moodtheme(kind){assert.equal(kind,"journal");return 9;},tagList(){trace.push("tags");return {html:pv("TAGS"),tags:[{".type":"Tag",_name:pv("tag")}]};},
            commentInfo(){trace.push("comments");return generalCommentInfo({_count:2,_enabled:1});},
            standardImage(){throw Error("Public entry requires no security/adult icon");},
            currents(theme){assert.equal(theme,9);return {values:[[pv("Music"),pv("MUSIC")]]};},groupNames(){return pv("");}});
        const str=(value:unknown)=>value===undefined?null:scalarPV(value).bytes().toString();
        const image=(result._userpic??{}) as Record<string,unknown>;
        const metadata=Object.fromEntries(runtime.hashKeys(result._metadata).map(key=>[str(key),str(runtime.memberSlot(result._metadata,key,"hash").get())]));
        assert.deepEqual({trace,subject:str(result._subject),text:str(result._text),width:image._width===undefined?null:Number(str(image._width)),
            height:image._height===undefined?null:Number(str(image._height)),keys:(result._link_keyseq as unknown[]).map(str),dom:str(result._dom_id),
            year:Number(str((result._time as Record<string,unknown>)._year)),systemhour:Number(str((result._system_time as Record<string,unknown>)._hour)),metadata,
            tag:str((result._tags as Record<string,unknown>[])[0]!._name),count:Number(str((result._comments as Record<string,unknown>)._count))},native.rows[index]);
        assert.equal(result._journal,journal);assert.equal(result._poster,poster);
            const prepared=await coordinator.prepare({styleId:0,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,
                type:"core",sourceBytes:Buffer.from(native.source,"base64")}]});
            const session=new GeneralProgramSession(coordinator.transfer(prepared),config,generalScalarCallbacks({page:()=>{throw Error("Fixture does not request Page");},seesControlStrip:()=>false}),{
                contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
                stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
                    trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},
                transformCss:()=>{throw Error("Fixture has no CSS");},expandEmbed:()=>{throw Error("Fixture has no embed");}});
            const initializedContext=session.context;
            assert.equal(session.initialize({clean(){throw Error("Fixture has no rich initialization property");}}).kind,"initialized");
            session.beginRender();
            const frame=session.completePage({".type":"EntryPage",_entry:result},"entry",()=>{throw Error("Unexpected diagnostic");});
            assert.equal(session.context,initializedContext);
            assert.equal(Buffer.from(frame.bytes).toString("base64"),native.outputs[index]);
    }
});

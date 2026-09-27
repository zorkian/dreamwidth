// general-entry-page-source.test.ts
//
// Direct native EntryPage Entry preparation with declared public helper providers.
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
import {Context,Layer,runtime} from "../runtime/s2runtime";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import type {NativeProfile} from "../runtime/native-profile";
import {generalImage,generalCommentInfo,type GeneralModel} from "../live/domain/general-model-primitives";
import {generalEntryPageEntryFromSource} from "../live/domain/general-entry-page-source";
import {generalCommentNavigation} from "../live/domain/general-comment-navigation";
import {attachGeneralEntryCommentNavigation,generalEntryPageFromSource} from "../live/domain/general-page-assembly";
const pv=NativeString.hostUtf8Bytes;

test("Entry navigation shares constructor authority with installed callbacks",()=>{
    const navigation=generalCommentNavigation(),page:GeneralModel={};
    const input={permalink:pv("https://journal.invalid/261.html"),
        styledEntryUrl:pv("https://journal.invalid/261.html?style=mine"),
        styleArgument:pv("style=mine"),flat:true,topOnly:false,pages:3,current:2,
        items:7,first:4,last:6,comments:[{},{}],noPosts:false,expandAll:false};
    attachGeneralEntryCommentNavigation(page,input,navigation);
    const range=page._comment_pages as GeneralModel;
    const text=(value:unknown)=>scalarPV(value).bytes().toString("utf8");
    assert.equal(text(range._url_next),"https://journal.invalid/261.html?view=flat&page=3&style=mine");
    assert.equal(text(range._url_prev),"https://journal.invalid/261.html?view=flat&page=1&style=mine");
    assert.equal(text(navigation.callbacks._ItemRange__url_of!(undefined!,range,pv("2.9"))),
        "https://journal.invalid/261.html?view=flat&page=2&style=mine");
    assert.equal(text(navigation.callbacks._ItemRange__url_of!(undefined!,{...range},2)),"");
    attachGeneralEntryCommentNavigation(page,{...input,comments:[]},navigation);
    const empty=page._comment_pages as GeneralModel;
    assert.equal(empty._current,1);assert.equal(empty._total,1);
    assert.equal(empty._total_subitems,0);assert.equal(empty._from_subitem,undefined);
});

test("outer Entry assembly gates disabled comments before projection",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const layer=new Layer();layer.scalarProfile=profile;
    const context=new Context([layer],()=>{throw Error("Unexpected print");});
    context.prop._userpics_position=pv("none");
    const journal:GeneralModel={".type":"UserLite"};let head=false,empty=false;
    const page=generalEntryPageFromSource(context,{thread:pv("257"),page:{styleId:0,styleModtime:0,
        baseUrl:pv("/journal"),journal,journalType:pv("P"),ownerName:undefined,journalTitle:undefined,
        journalSubtitle:undefined,layoutName:undefined,themeName:undefined,layoutUrl:pv(""),getargs:[],
        viewingStyleOptions:undefined,viewUrls:[],links:[],customtext:{title:undefined,url:undefined,content:undefined},
        customtextDefaults:{title:undefined,url:undefined,content:undefined},showControlStrip:0,isCanary:0,
        noMobileCookie:0,sessionMessages:undefined,headContent:pv(""),canUseNetwork:0,activeEntries:[]},
        entry:{mode:undefined,permalinkUrl:pv("/261.html"),dateparts:pv("2026 09 27 00 00 00 00"),
            systemDateparts:pv("2026 09 27 00 00 00 00"),security:pv("public"),allowmask:0,
            adultContentLevel:pv(""),adminPost:0,content:{subject:undefined,event:undefined,
                journalName:pv("journal"),ditemid:261,jitemid:1,editor:undefined,preformatted:0,
                importSourceDefined:false,isSyndicated:0,logtimeMysql:pv("2026-09-27 00:00:00"),
                suspendMessage:0,noHtml:0}}}, {
        page:{clockSeconds:()=>0,escapeProperty(value,mode){assert.equal(value,undefined);return value;}},
        entry:{features:{memories:false,tellafriend:false,esn:false},user:()=>journal,
            picture(){throw Error("No picture read");},commentInfo:()=>generalCommentInfo({_enabled:0,_count:0}),
            cleanSubject(){throw Error("No subject input");},cleanEvent(){throw Error("No event input");},
            expandEmbedded:value=>value,tagList:()=>({html:undefined,tags:[]}),recordPublicEntry(){},
            standardImage(){throw Error("No icon");},currents:()=>({values:[]}),groupNames:()=>pv("")},
        navigation:generalCommentNavigation(),prepareHead(){head=true;},
        comments(){throw Error("Disabled comment read");},emptyComments(){empty=true;
            return {permalink:pv("/261.html"),styledEntryUrl:pv("/261.html"),styleArgument:undefined,
                flat:false,topOnly:false,pages:9,current:4,items:8,first:1,last:8,expandAll:false};},
    });
    assert.equal(page[".type"],"EntryPage");assert.equal(head,true);assert.equal(empty,true);
    assert.deepEqual(page._comments,[]);assert.equal((page._comment_pages as GeneralModel)._total,1);
    assert.equal(scalarPV(page._viewing_thread_id).bytes().toString(),"257");
});

test("direct Entry keeps native helper order, mode links and journal currents distinct from Recent",()=>{
    const script=String.raw`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;use JSON::PP;
        my @trace;
        {package EntryPageUser;sub adult_content_calculated{''}}
        {package EntryPageRequest;sub uri{'/261.html'}}
        {package EntryPageEntry;
            sub correct_anum{1}sub ditemid{261}sub jitemid{1}sub poster{$_[0]{poster}}sub visible_to{1}
            sub userpic{push @trace,'picture-row';return(undef,'keyword')}
            sub comment_info{push @trace,'comments';return {count=>2,enabled=>1,show_postlink=>1,show_readlink=>2}}
            # Declared fixed content providers, not a native cleaner-parity claim.
            sub subject_html{push @trace,'subject';return 'TITLE'}
            sub event_html{push @trace,'event','entry-event:261';return 'BODY'}
            sub tag_map{{1=>'tag'}}sub security{'public'}sub adult_content_calculated{''}
            sub allowmask{0}sub props{{}}sub admin_post{0}sub url{'/261.html'}
            sub eventtime_mysql{'2026-09-27 00:00:00'}sub logtime_mysql{'2026-09-26 23:00:00'}
            sub group_names{push @trace,'groups';return ''}}
        no warnings 'redefine';local *LJ::is_enabled=sub{0};local *LJ::get_remote=sub{undef};
        local *LJ::isu=sub{1};local *LJ::S2::UserLite=sub{my $kind=$_[0]{userid}==500?'journal':'poster';
            push @trace,$kind;return {_type=>'UserLite',_u=>$_[0],name=>$kind}};
        local *LJ::S2::Image_userpic=sub{push @trace,'picture:'.$_[1].':'.$_[2];return LJ::S2::Image('/picture',75,51,'ALT')};
        local *LJ::S2::TagList=sub{push @trace,'tags';push @{$_[4]},{_type=>'Tag',name=>'tag'};return 'TAGS'};
        local *LJ::currents=sub{push @trace,'currents:'.($_[1]{userid}==500?'journal':'poster');return ('Music'=>'MUSIC')};
        my @out;for my $position('left','none') {
            @trace=();my $u=bless {userid=>500},'EntryPageUser';
            my $poster=bless {userid=>501},'EntryPageUser';my $entry=bless {poster=>$poster},'EntryPageEntry';
            local *LJ::Entry::new=sub{$entry};
            my $ctx=[{}, {}, {userpics_position=>$position,entry_userpic_style=>'small'}];
            my($raw,$e)=LJ::S2::EntryPage_entry($u,undef,{ljentry=>$entry,ctx=>$ctx,
                r=>bless({},'EntryPageRequest'),getargs=>{mode=>$position eq 'none'?'reply':''}});
            push @out,{trace=>[@trace],subject=>$e->{subject},text=>$e->{text},dom=>$e->{dom_id},
                post=>"$e->{comments}{show_postlink}",read=>"$e->{comments}{show_readlink}",
                postnum=>0+$e->{comments}{show_postlink},readnum=>0+$e->{comments}{show_readlink},
                width=>$e->{userpic}?$e->{userpic}{width}:undef,height=>$e->{userpic}?$e->{userpic}{height}:undef,
                metadata=>$e->{metadata},publictext=>$LJ::REQ_GLOBAL{text_of_first_public_post},
                publictags=>$LJ::REQ_GLOBAL{tags_of_first_public_post},separate=>$e->{journal}!=$e->{poster}?1:0};
        }print encode_json(\@out);`;
    const native=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:10000}));
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    for(const [index,position] of ["left","none"].entries()) {
        const layer=new Layer();layer.scalarProfile=profile;
        const context=new Context([layer],()=>{throw Error("Unexpected print");});
        context.prop._userpics_position=pv(position);context.prop._entry_userpic_style=pv("small");
        // Recent's shared-pic/forced-poster-theme settings must not affect this route.
        context.prop._use_shared_pic=1;
        const trace:string[]=[],journal:GeneralModel={".type":"UserLite",_name:pv("journal")},
            poster:GeneralModel={".type":"UserLite",_name:pv("poster")};
        let publictext:unknown,publictags:unknown;
        const result=generalEntryPageEntryFromSource(context,{mode:pv(position==="none"?"reply":""),
            permalinkUrl:pv("/261.html"),dateparts:pv("2026 09 27 00 00 00 00"),
            systemDateparts:pv("2026 09 26 23 00 00 06"),security:pv("public"),allowmask:0,
            adultContentLevel:pv(""),adminPost:0,
            content:{subject:pv("TITLE SOURCE"),event:pv("BODY SOURCE"),journalName:pv("journal"),ditemid:261,jitemid:1,
                editor:undefined,preformatted:0,importSourceDefined:false,isSyndicated:0,
                logtimeMysql:pv("2026-09-26 23:00:00"),suspendMessage:0,noHtml:0}}, {
            features:{memories:false,tellafriend:false,esn:false},
            user(kind){trace.push(kind);return kind==="journal"?journal:poster;},
            picture(){trace.push("picture-row","picture:0:keyword");return generalImage(pv("/picture"),75,51,pv("ALT"));},
            commentInfo(){trace.push("comments");return generalCommentInfo({_count:2,_enabled:1,_show_postlink:1,_show_readlink:2});},
            cleanSubject(value){assert.equal(scalarPV(value).bytes().toString(),"TITLE SOURCE");trace.push("subject");return pv("TITLE");},
            cleanEvent(value,options){assert.equal(scalarPV(value).bytes().toString(),"BODY SOURCE");
                assert.equal(options.cutUrl,undefined);assert.equal(options.cutDisable,undefined);trace.push("event");return pv("BODY");},
            expandEmbedded(value,id,stage){assert.equal(stage,"entry-event");trace.push(stage+":"+id);return value;},
            tagList(){trace.push("tags");return {html:pv("TAGS"),tags:[{".type":"Tag",_name:pv("tag")}]};},
            recordPublicEntry(text,tags){publictext=text;publictags=tags.map(tag=>tag._name);},
            standardImage(){throw Error("No public security/adult icon");},
            currents(){trace.push("currents:journal");return {values:[[pv("Music"),pv("MUSIC")]]};},
            groupNames(){trace.push("groups");return pv("");},
        });
        const str=(value:unknown)=>value===undefined?null:scalarPV(value).bytes().toString();
        const pic=result._userpic as GeneralModel|undefined,comments=result._comments as GeneralModel;
        assert.deepEqual({trace,subject:str(result._subject),text:str(result._text),dom:str(result._dom_id),
            post:str(comments._show_postlink),read:str(comments._show_readlink),
            postnum:Number(str(comments._show_postlink)),readnum:Number(str(comments._show_readlink)),
            width:pic?Number(str(pic._width)):null,height:pic?Number(str(pic._height)):null,
            metadata:Object.fromEntries(runtime.hashKeys(result._metadata).map(key=>[
                str(key),str(runtime.memberSlot(result._metadata,key,"hash").get())])),
            publictext:str(publictext),publictags:(publictags as unknown[]).map(str),
            separate:result._journal!==result._poster?1:0},native[index]);
    }
});

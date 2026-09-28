// general-comment-from-source.test.ts
//
// Retained Comment conversion with declared providers and hidden no-read controls.
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
import {NativeString,NativeNumber,scalarPV} from "../runtime/native-scalar";
import {runtime,type Context} from "../runtime/s2runtime";
import {generalCommentFromSource,generalCommentTreeFromSource,type GeneralCommentSourceInput,
    type GeneralApprovedCommentNode,type GeneralCommentSourceOperations} from "../live/domain/general-comment-from-source";
import {generalImage} from "../live/domain/general-model-primitives";
const pv=NativeString.hostUtf8Bytes;

test("approved Comment projection follows retained source and invokes no hidden content providers",()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;use Scalar::Util qw(refaddr);
BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
open my $fh,'<','/workspaces/dreamwidth/cgi-bin/LJ/S2/EntryPage.pm' or die $!;
my $source=do{local $/;<$fh>};close $fh;
my($body)=$source=~/foreach my \$com \(\@\$srclist\) \{(.*?)\n\s*push \@\$destlist, \$s2com;/s;
die 'Source conversion missing' unless defined $body;
$body.=' $s2com;';
{package CommentEntry;sub anum{5}sub ditemid{261}sub logtime_unix{1000}}
{package CommentAuthor;sub is_suspended{$_[0]{suspended}}}
{package CommentEdit;sub is_edited{1}sub edit_url{'/edit'}sub edit_reason{'edited <&'}
sub edit_time{1020}sub threadroot_url{'/root'}sub admin_post{1}}
our @trace;my @rows;
no warnings 'redefine';
local *LJ::Talk::treat_as_anon=sub{push @trace,'anonymous';!$_[0]};
local *LJ::S2::DateTime_unix=sub{push @trace,'date:'.$_[0];{_type=>'DateTime',value=>$_[0]}};
local *LJ::S2::DateTime_tz=sub{push @trace,'poster-time:'.$_[0];
    $_[1]?{_type=>'DateTime',value=>$_[0],zone=>$_[1]{suspended}?'S':'V'}:undef};
local *LJ::S2::UserLite=sub{push @trace,'poster';{_type=>'UserLite',user=>'registered'}};
local *LJ::Comment::new=sub{bless {},'CommentEdit'};
local *LJ::S2::Image_userpic=sub{my($u,$id,$keyword,$w,$h)=@_;LJ::S2::Image('/picture',$w,$h,'ALT')};
local *LJ::Talk::get_subjecticon_by_id=sub{{img=>'icon.gif',w=>3,h=>4}};
local *LJ::get_lastcomment=sub{(261,0)};
local *LJ::is_enabled=sub{push @trace,'feature:'.$_[0] if $_[0] eq 'esn'||$_[0] eq 'edit_comments';
    $_[0] eq 'esn'||$_[0] eq 'edit_comments'};
my $loaded=0;
local *S2::get_property_value=sub{$_[1] eq 'userpics_position'?($loaded?'left':'none'):'small'};
local *LJ::Talk::talkargs=sub{my($url,@args)=@_;$url.'?'.join('&',grep{defined&&length}@args)};
for my $spec(['A',0,0],['F',999,0],['S',0,0],['D',0,0],['A',2,1,1],['A',1,0,1],['A',1,1,1],
    ['D',2,1,1],['S',2,1,1],['S',2,1,0]) {
    @trace=();my($state,$poster,$suspended)=@$spec;
    $loaded=$poster==1;
    my $poster_loaded=$spec->[3]//0;
    my %user=$poster_loaded?($poster=>bless({suspended=>$suspended},'CommentAuthor')):();
    my %userpic=(7=>{width=>13,height=>15});my $com={posterid=>$poster,talkid=>1,body=>'one<b>two</b>',subject=>'Q<"&',
        datepost=>'2026-09-27 00:00:00',datepost_unix=>1015,parenttalkid=>$loaded?2:0,_loaded=>$loaded,
        state=>$state,_show=>0,children=>[],props=>$loaded?{subjecticon=>3,imported_from=>'Source &<'}:{},showable_children=>2,hide_children=>0,
        hidden_child=>0,echi=>'E',pickw=>$suspended&&$loaded?'kw':undef};
    $com->{picid}=7 if $loaded;
    my $entry=bless {},'CommentEntry';my $u=bless {},'CommentAuthor';my $remote;
    my $get={};my $opts={ctx=>[]};my $depth=1;my $flat_mode=0;my $viewsome=0;my $viewall=0;
    my $tz_remote;my($last_talkid,$last_jid)=(261,0);my $permalink='/261.html';
    my($style_arg,$link_thread_arg)=('','');my $userlite_journal={_type=>'UserLite',user=>'journal'};
    my $p={_viewing_thread_id=>0};
    my $result=eval 'package LJ::S2;'.$body;die $@ if $@;
    my %projection=map {$_=>$result->{$_}} qw(subject text full screened screened_noshow frozen deleted fromsuspended
        seconds_since_entry anchor dom_id comment_posted edited permalink_url reply_url expand_url js_expand_url);
    $projection{poster}=$result->{poster};$projection{links}=$result->{link_keyseq};
    $projection{editreason}=$result->{editreason};$projection{admin_post}=$result->{admin_post};
    $projection{editUrl}=$result->{edit_url};$projection{threadroot}=$result->{threadroot_url};
    $projection{picture}=$result->{userpic};$projection{metadata}=$result->{metadata};
    $projection{timePoster}=$result->{time_poster};
    $projection{timeAlias}=refaddr($result->{time})==refaddr($result->{system_time})?1:0;
    push @rows,{state=>$state,poster=>$poster,suspended=>$suspended,posterLoaded=>$poster_loaded,
        result=>\%projection,
        featureCalls=>[grep{/^feature:/}@trace]};
}
print JSON::PP->new->canonical->encode(\@rows);`;
    const rows=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000,maxBuffer:131072})) as any[];
    assert.equal(rows.length,10);
    const approved:GeneralCommentSourceInput[]=[];
    const journal={".type":"UserLite",_user:pv("journal")};
    for(const row of rows) {
        const hidden=row.state==="S"||row.state==="D"||row.suspended&&row.posterLoaded;
        const loaded=row.poster===1;
        const common={state:row.state,show:row.state!=="S"&&row.state!=="D",
            posterId:row.poster,posterLoaded:!!row.posterLoaded,posterSuspended:!!row.suspended,
            talkid:261,ditemid:261,depth:1,journal,
            datepostUnix:1015,entryLogtimeUnix:1000,permalinkUrl:pv("/261.html?thread=261#cmt261"),
            replyUrl:pv("/261.html?replyto=261"),parentUrl:loaded?pv("/261.html?thread=517#cmt517"):undefined,threadrootUrl:undefined,
            expandUrl:pv("/261.html?thread=261#cmt261"),jsExpandUrl:pv("/261.html?thread=261&destination_thread=0#cmt261"),
            hasChildren:false,showableChildren:2,hideChildren:0,hiddenChild:0,echi:pv("E"),lastTalkid:261,lastJournalId:0};
        const suspendedOnly=row.suspended&&row.posterLoaded&&row.state!=="D"&&row.state!=="S";
        const input:GeneralCommentSourceInput=suspendedOnly?{...common,kind:"suspended-loaded",loaded,
            pictureKeyword:loaded?pv('kw'):undefined,importedFrom:loaded?pv('Source &<'):undefined,
            adminPost:loaded?1:0}:
            hidden?{...common,kind:"stub"}:{...common,kind:"shown",
            loaded,posterUsername:row.posterLoaded?pv('registered'):undefined,
            body:pv('one<b>two</b>'),subject:pv('Q<"&'),
            noHtml:0,anonymous:true,preformatted:undefined,editor:undefined,datepost:pv("2026-09-27 00:00:00"),
            importSourceDefined:false,importedFrom:loaded?pv('Source &<'):undefined,pictureKeyword:undefined,
            subjectIcon:loaded?3:undefined,hasPicture:loaded,adminPost:loaded?1:0};
        approved.push(input);
        let cleans=0,posters=0,posterTimes=0;
        const featureCalls:string[]=[];
        const posterModel={".type":"UserLite",_user:pv("registered")};
        const model=generalCommentFromSource({prop:{_userpics_position:pv(loaded?"left":"none"),
            _comment_userpic_style:pv("small")}} as unknown as Context,input,{
            cleanComment(value,options){cleans++;assert.equal(value!.bytes().toString(),'one<b>two</b>');
                assert.equal(options.anonymous,true);assert.equal(options.noCss,true);
                // Declared original-native cleaner result, not a JS cleaner implementation.
                return pv(row.result.text);},
            dateTimeUnix:value=>({".type":"DateTime",_value:value}),
            posterTime:value=>{posterTimes++;return {".type":"DateTime",_value:value,
                _zone:row.suspended?'S':'V'};},
            poster(username){posters++;assert.ok(loaded);
                assert.equal(username.bytes().toString(),"registered");return posterModel;},
            edit(){assert.ok(loaded);return {edited:1,url:pv('/edit?'),reason:pv('edited <&'),time:1020,threadrootUrl:pv('/root')};},
            subjectImage(){assert.ok(loaded);return generalImage(pv('/icon.gif'),3,4,undefined);},
            picture(style){assert.ok(loaded);assert.equal(style,'small');return generalImage(pv('/picture'),
                NativeNumber.nv(9.75),NativeNumber.nv(11.25),pv('ALT'));},
            esnEnabled:()=>{featureCalls.push('feature:esn');return true;},
            editCommentsEnabled:()=>{featureCalls.push('feature:edit_comments');return true;}});
        const text=(value:unknown)=>value===undefined?null:scalarPV(value).bytes().toString();
        for(const key of ['subject','text','anchor','dom_id','permalink_url','reply_url','expand_url','js_expand_url'])
            assert.equal(text(model['_'+key]),row.result[key],key);
        for(const key of ['full','screened','screened_noshow','frozen','deleted','fromsuspended','seconds_since_entry',
            'comment_posted','edited'])assert.equal(model['_'+key]===undefined?null:
                text(model['_'+key]),row.result[key]===null?null:String(row.result[key]),key);
        assert.deepEqual((model._link_keyseq as unknown[]).map(text),row.result.links);
        assert.equal(model._time,model._system_time);assert.equal(row.result.timeAlias,1);
        assert.equal(cleans,hidden?0:1);assert.equal(posters,loaded&&!suspendedOnly?1:0);
        assert.equal(posterTimes,(row.posterLoaded?1:0)+(loaded?1:0));
        assert.equal((model._time_poster as any)?._zone,row.result.timePoster?.zone);
        assert.deepEqual(featureCalls,row.featureCalls);
        if(loaded) {
            assert.equal(model._poster,suspendedOnly?undefined:posterModel);
            assert.equal(text(model._editreason),row.result.editreason);
            assert.equal(text(model._edit_url),row.result.editUrl);
            assert.equal(text(model._threadroot_url),row.result.threadroot);
            if(!suspendedOnly){
                assert.equal(text((model._userpic as any)._width),String(row.result.picture.width));
                assert.equal(text((model._userpic as any)._height),String(row.result.picture.height));
            }
            assert.equal(model._admin_post,row.result.admin_post);
        }
        if(suspendedOnly){
            assert.equal(text(runtime.memberSlot(model._metadata,pv('picture_keyword'),'hash').get()),
                row.result.metadata.picture_keyword??null);
            assert.equal(text(runtime.memberSlot(model._metadata,pv('imported_from'),'hash').get()),
                row.result.metadata.imported_from??null);
        }
        if(row.poster===999&&!hidden)assert.equal((model._poster as any)._journal_type.bytes().toString(),'P');
        if(hidden)assert.equal(model._poster,undefined);
    }
    const context={prop:{_userpics_position:pv('none')}} as unknown as Context;
    const trace:number[]=[];
    const provider=(input:GeneralCommentSourceInput):GeneralCommentSourceOperations=>{
        trace.push(Number(input.talkid));
        return {cleanComment:()=>pv('declared prepared comment'),dateTimeUnix:value=>({'.type':'DateTime',_value:value}),
            posterTime:()=>undefined,poster(){throw Error('No approved author provider');},
            edit(){throw Error('No edit reads');},subjectImage(){throw Error('No icon reads');},
            picture(){throw Error('No picture reads');},esnEnabled:()=>false,editCommentsEnabled:()=>false};
    };
    assert.deepEqual(generalCommentTreeFromSource(context,pv('0'),()=>{
        throw Error('Disabled comments must not access records');},provider),[]);
    const node=(index:number,id:number,children:GeneralApprovedCommentNode[]=[]):GeneralApprovedCommentNode=>{
        const {depth:_depth,hasChildren:_children,...input}=approved[index]!;
        return {input:{...input,talkid:id},children};
    };
    const first=node(4,1,[node(0,2)]),second=node(1,3);
    const tree=generalCommentTreeFromSource(context,1,()=>[first,second],provider);
    assert.deepEqual(trace,[1,2,3]);assert.deepEqual(tree.map(model=>model._talkid),[1,3]);
    const replies=tree[0]!._replies as any[];
    assert.equal(replies[0]._talkid,2);assert.equal(replies[0]._depth,2);
    assert.equal(tree[0]!._fromsuspended,1);assert.equal(replies[0]._journal,tree[0]!._journal);
    assert.equal(tree[0]!._thread_url,first.input.expandUrl);
    const cycle=node(0,4);(cycle.children as GeneralApprovedCommentNode[]).push(cycle);
    assert.throws(()=>generalCommentTreeFromSource(context,1,()=>[cycle],provider),/Invalid approved comment tree/);
});

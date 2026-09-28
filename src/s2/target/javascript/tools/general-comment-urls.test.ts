// general-comment-urls.test.ts
//
// Native Comment URL source and approved entry-context projection.
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
import {NativeString} from "../runtime/native-string";
import {generalCommentUrls,generalTalkArgs} from "../live/domain/general-comment-urls";
import {generalCommentEdit} from "../live/domain/general-comment-edit";
import type {GeneralSelectedComment} from "../live/domain/general-comment-projection";

const pv=(value:string)=>NativeString.bytes(Buffer.from(value,"ascii"));
const text=(value:NativeString|undefined)=>value?.bytes().toString("ascii")??null;

test("approved Comment URLs match native talkargs and EntryPage request branches",()=>{
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
    *DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Talk;
my @rows;
for my $spec (['/261.html',1,2,5,'s2id=44',261,0],
    ['/261.html?x=1',1,0,5,undef,261,undef]) {
    my($base,$id,$parent,$anum,$style,$thread,$destination)=@$spec;
    my $dtalk=$id*256+$anum;my $dparent=$parent*256+$anum;
    my $link=defined($destination)?($destination?"thread=$destination":''):
        ($thread?"thread=$thread":'');
    my $dest=defined($destination)?$destination:($thread||0);
    push @rows,{
        permalink=>"$base?thread=$dtalk".LJ::Talk::comment_anchor($dtalk),
        reply=>LJ::Talk::talkargs($base,"replyto=$dtalk",$style,$link),
        parent=>$parent?LJ::Talk::talkargs($base,"thread=$dparent",$style).
            LJ::Talk::comment_anchor($dparent):undef,
        expand=>LJ::Talk::talkargs($base,"thread=$dtalk",$style).
            LJ::Talk::comment_anchor($dtalk),
        jsExpand=>LJ::Talk::talkargs($base,"thread=$dtalk",
            "destination_thread=$dest",$style).LJ::Talk::comment_anchor($dtalk),
    };
}
print encode_json({rows=>\@rows,filtered=>LJ::Talk::talkargs('/x','0',undef,'q=1')});`;
    const native=JSON.parse(execFileSync("perl",["-e",source],
        {encoding:"utf8",timeout:10000,maxBuffer:32768})) as {
            rows:Record<string,string|null>[];filtered:string};
    const cases=[{permalink:pv('/261.html'),talkId:1,parentTalkId:2,entryAnum:5,
        styleArgument:pv('s2id=44'),viewingThread:261,destinationThread:0},
    {permalink:pv('/261.html?x=1'),talkId:1,parentTalkId:0,entryAnum:5,
        styleArgument:undefined,viewingThread:261,destinationThread:undefined}];
    assert.equal(native.rows.length,cases.length);
    for(const [index,input] of cases.entries()) {
        const actual=generalCommentUrls(input);
        assert.deepEqual({permalink:text(actual.permalink),reply:text(actual.reply),
            parent:text(actual.parent),expand:text(actual.expand),jsExpand:text(actual.jsExpand)},
        native.rows[index]);
        assert.equal(actual.talkId,261);
    }
    assert.equal(text(generalTalkArgs(pv('/x'),[pv('0'),undefined,pv('q=1')])),native.filtered);
    assert.throws(()=>generalCommentUrls({...cases[0]!,talkId:-1}),/Invalid selected/);
});

test("loaded Comment edit and thread-root links match native source branches",()=>{
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
    *DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Talk;require LJ::Comment;
local $LJ::SITEROOT='/app';
{package FixtureJournal;sub user{'ordinary6'}}
{package FixtureEntry;sub url{$_[0]->{url}}sub jitemid{300}
    sub journal{bless {},'FixtureJournal'}}
{package FixtureComment;our @ISA=('LJ::Comment');sub dtalkid{$_[0]->{id}}
    sub entry{bless {url=>$_[0]->{url}},'FixtureEntry'}
    sub prop{$_[0]->{edit_time}}}
my @rows;
for my $spec (['/300.html',261,2,'s2id=44','thread=261','1020'],
    ['/300.html?x=1',261,0,undef,'thread=261',undef]) {
    my($base,$id,$parent,$style,$link,$time)=@$spec;
    my $comment=bless {url=>$base,id=>$id,edit_time=>$time},'FixtureComment';
    push @rows,{edited=>$comment->is_edited?1:0,
        url=>LJ::Talk::talkargs($comment->edit_url,$style,$link),
        threadroot=>$parent?$comment->threadroot_url($style):undef};
}
print encode_json(\@rows);`;
    const native=JSON.parse(execFileSync("perl",["-e",source],
        {encoding:"utf8",timeout:10000,maxBuffer:32768})) as
        {edited:number;url:string;threadroot:string|null}[];
    const cases=[{permalink:pv('/300.html'),parentId:2,style:pv('s2id=44'),
        editTime:pv('1020')},{permalink:pv('/300.html?x=1'),parentId:0,
        style:undefined,editTime:undefined}];
    for(const [index,input] of cases.entries()) {
        const urls=generalCommentUrls({permalink:input.permalink,styleArgument:input.style,
            talkId:1,parentTalkId:input.parentId,entryAnum:5,
            viewingThread:261,destinationThread:undefined});
        const node={parentId:input.parentId,urls,fields:{loaded:true,
            editTime:input.editTime,editReason:pv('Why')}} as GeneralSelectedComment;
        const actual=generalCommentEdit(node,{permalink:input.permalink,
            siteRoot:pv('/app'),journalName:pv('ordinary6'),styleArgument:input.style});
        assert.deepEqual({edited:actual.edited,url:text(actual.url),
            threadroot:text(actual.threadrootUrl)},native[index]);
        assert.equal(text(actual.reason),input.editTime?'Why':null);
        assert.equal(text(actual.time as NativeString|undefined),text(input.editTime));
    }
});

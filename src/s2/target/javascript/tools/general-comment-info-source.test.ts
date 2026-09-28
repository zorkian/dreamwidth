// general-comment-info-source.test.ts
//
// Actual anonymous Entry::comment_info scalar and URL ordering controls.
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
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {NativeNumber} from "../runtime/native-number";
import {generalCommentInfoFromSource} from "../live/domain/general-comment-info-source";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {withSelectedFixture} from "./selected-fixture";

const oracle=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
    *DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Entry;require LJ::Talk;require LJ::S2;
{package FixedJournal;sub count_maxcomments {$_[0]->{maximum}}}
{package FixedEntry;our @ISA=('LJ::Entry');sub url {$_[0]->{url}}
 sub props {$_[0]->{props}}sub prop {$_[0]->{props}{$_[1]}}
 sub reply_count {defined $_[0]->{props}{replycount}?$_[0]->{props}{replycount}:$_[0]->{logcount}}}
my @rows=({show=>'Y',logcount=>4,maximum=>5},
 {show=>'Y',logcount=>9,propcount=>'0007',maximum=>5},
 {show=>'N',logcount=>9,maximum=>5},
 {show=>'Y',logcount=>9,poster=>'1',maintainer=>'1',maximum=>5},
 {show=>'Y',logcount=>9,poster=>'0',maintainer=>'1',maximum=>5},
 {show=>'Y',logcount=>0,maximum=>0});
my @out;for my $row(@rows){my $u=bless {opt_showtalklinks=>$row->{show},maximum=>$row->{maximum}},'FixedJournal';
 my $e=bless {url=>'https://public.example.invalid/entry?x=1',logcount=>$row->{logcount},
  props=>{replycount=>$row->{propcount},opt_nocomments=>$row->{poster},
   opt_nocomments_maintainer=>$row->{maintainer}}},'FixedEntry';
 my $info=LJ::S2::CommentInfo($e->comment_info(u=>$u,remote=>undef,style_args=>'style=mine'));
 push @out,{count=>0+$info->{count},showread=>defined $info->{show_readlink}?"$info->{show_readlink}":'',
  enabled=>0+$info->{enabled},maximum=>0+$info->{maxcomments},
  maintainer=>defined $info->{comments_disabled_maintainer}?"$info->{comments_disabled_maintainer}":'',
  read=>$info->{read_url},post=>$info->{post_url},permalink=>$info->{permalink_url}};}
print JSON::PP->new->canonical->encode(\@out);`;

test("anonymous CommentInfo preserves source count, threshold, disabled and talkargs ordering",()=>{
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    const rows=[{show:"Y",count:4,max:5},{show:"Y",count:"0007",max:5},
        {show:"N",count:9,max:5},{show:"Y",count:9,poster:"1",maintainer:"1",max:5},
        {show:"Y",count:9,poster:"0",maintainer:"1",max:5},{show:"Y",count:0,max:0}];
    const text=(value:unknown)=>scalarPV(value).bytes().toString("latin1");
    const actual=rows.map(row=>{
        const model=generalCommentInfoFromSource({
            permalink:NativeString.bytes(Buffer.from("https://public.example.invalid/entry?x=1")),
            styleArgument:NativeString.bytes(Buffer.from("style=mine")),showTalkLinks:row.show,
            noComments:row.poster===undefined?undefined:NativeString.bytes(Buffer.from(row.poster)),
            noCommentsMaintainer:row.maintainer===undefined?undefined:
                NativeString.bytes(Buffer.from(row.maintainer)),
            replyCount:typeof row.count==="number"?NativeNumber.integer(BigInt(row.count)):
                NativeString.bytes(Buffer.from(row.count)),maxComments:row.max});
        return {count:Number(text(model._count)),showread:text(model._show_readlink),
            enabled:Number(text(model._enabled)),maximum:Number(text(model._maxcomments)),
            maintainer:text(model._comments_disabled_maintainer),read:text(model._read_url),
            post:text(model._post_url),permalink:text(model._permalink_url)};
    });
    assert.deepEqual(actual,native);
    assert.throws(()=>generalCommentInfoFromSource({permalink:NativeString.bytes(Buffer.alloc(0)),
        styleArgument:undefined,showTalkLinks:"Y",noComments:undefined,noCommentsMaintainer:undefined,
        replyCount:NativeNumber.integer(1n),maxComments:null}));
});

test("selected SQL replycount prop overrides log2 and its witness revokes on mutation",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},()=>withSelectedFixture(async f=>{
    const request=f.request("ordinary6",{kind:"entry",ditemid:257});
    const noEncoding={async item(){throw Error("Unreached encoding conversion");}} as unknown as GeneralTextEncoding;
    const selected=await f.store.loadNativeSelectedSnapshot(request);
    assert.ok(selected);const entry=selected.facts.entries[0]!;
    const initial=await GeneralSelectedText.prepare(selected,noEncoding);
    const url=NativeString.bytes(Buffer.from("/257.html"));
    const before=generalCommentInfoFromSource(initial.commentInfoInput(entry,url,undefined,5));
    assert.equal(scalarPV(before._count).bytes().toString(),"0");
    await f.admin.query(`UPDATE ${f.table(f.c,"log2")} SET replycount=4
        WHERE journalid=900001 AND jitemid=1`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(selected),false);
    const changed=await f.store.loadNativeSelectedSnapshot(request);assert.ok(changed);
    const prepared=await GeneralSelectedText.prepare(changed,noEncoding);
    const count=generalCommentInfoFromSource(prepared.commentInfoInput(changed.facts.entries[0]!,url,undefined,5));
    assert.equal(scalarPV(count._count).bytes().toString(),"4");
    let [definitions]=await f.admin.query<import("mysql2/promise").RowDataPacket[]>(
        `SELECT propid FROM ${f.table(f.g,"logproplist")} WHERE name='replycount'`);
    if(!definitions.length){
        await f.admin.query(`INSERT INTO ${f.table(f.g,"logproplist")}(name) VALUES ('replycount')`);
        [definitions]=await f.admin.query<import("mysql2/promise").RowDataPacket[]>(
            `SELECT propid FROM ${f.table(f.g,"logproplist")} WHERE name='replycount'`);
    }
    assert.equal(definitions.length,1);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"logprop2")}(journalid,jitemid,propid,value)
        VALUES (900001,1,?,'0007')`,[definitions[0]!.propid]);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(changed),false);
    const override=await f.store.loadNativeSelectedSnapshot(request);assert.ok(override);
    const after=await GeneralSelectedText.prepare(override,noEncoding);
    const info=generalCommentInfoFromSource(after.commentInfoInput(override.facts.entries[0]!,url,undefined,5));
    assert.equal(scalarPV(info._count).bytes().toString(),"7");
    assert.equal(scalarPV(info._show_readlink).bytes().toString(),"0007");
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(override),true);
},false,true));

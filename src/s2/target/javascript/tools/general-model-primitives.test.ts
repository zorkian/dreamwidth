// general-model-primitives.test.ts
//
// Native constructor scalar provenance, model aliasing and comparison controls.
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
import {generalImage,generalLink,generalDate,generalDateCompare,generalCommentInfo,generalNull} from "../live/domain/general-model-primitives";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {runtime} from "../runtime/s2runtime";
const bytes=(value:string)=>NativeString.hostUtf8Bytes(value);
const frame=(value:unknown)=>value===undefined?null:{base64:scalarPV(value).bytes().toString("base64"),utf8:scalarPV(value).flagged()?1:0};

test("native public constructors preserve PV values, object aliases and numeric coercion",()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
        use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;use MIME::Base64 qw(encode_base64);
        BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        sub frame {defined $_[0]?{base64=>encode_base64($_[0],''),utf8=>utf8::is_utf8($_[0])?1:0}:undef}
        my $image=LJ::S2::Image(pack('C*',255,0), '075',undef,'0','__proto__'=>'first','__proto__'=>'last');
        my $link=LJ::S2::Link('/rel','caption',$image,'constructor'=>'native');
        $image->{width}='changed';
        my $date=LJ::S2::Date('9007199254740993','002','03');
        my $other=LJ::S2::Date('9007199254740994',2,3);$other->{sec}=3;
        my $info={count=>'0007',enabled=>'0'};my $returned=LJ::S2::CommentInfo($info);$returned->{marker}='alias';
        my $zero=LJ::S2::Date(2026,9,27,undef);eval {LJ::S2::Date(2026,9,27,'0')};my $error=$@;
        print JSON::PP->new->canonical->encode({image=>{map {$_=>frame($image->{$_})} qw(url width height alttext)},
            extra=>frame($image->{extra}{'__proto__'}),link=>{url=>frame($link->{url}),caption=>frame($link->{caption}),icon_width=>frame($link->{icon}{width})},
            date=>{map {$_=>frame($date->{$_})} qw(year month day _dayofweek)},compare=>frame(S2::Builtin::LJ::Date__compare(undef,$date,$other)),
            info=>{count=>frame($info->{count}),enabled=>frame($info->{enabled}),marker=>frame($info->{marker})},
            null=>LJ::S2::Null('Image'),zero_error=>index($error,'S2 Builtin Date() takes day of week 1-7, not 0-6')>=0?1:0});`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    const image=generalImage(NativeString.bytes(Buffer.from([255,0])),bytes("075"),undefined,bytes("0"),
        [[bytes("__proto__"),bytes("first")],[bytes("__proto__"),bytes("last")]]);
    const link=generalLink(bytes("/rel"),bytes("caption"),image,[[bytes("constructor"),bytes("native")]]);
    image._width=bytes("changed");
    const date=generalDate(bytes("9007199254740993"),bytes("002"),bytes("03"));
    const other=generalDate(bytes("9007199254740994"),2,3);other._sec=3;
    const info={_count:bytes("0007"),_enabled:bytes("0")} as Record<string,unknown>;
    assert.equal(generalCommentInfo(info),info);info._marker=bytes("alias");
    const extra=image._extra as Record<string,unknown>;
    const actual={image:Object.fromEntries(["url","width","height","alttext"].map(key=>[key,frame(image["_"+key])])),
        extra:frame(runtime.memberSlot(extra,bytes("__proto__"),"hash").get()),link:{url:frame(link._url),caption:frame(link._caption),icon_width:frame((link._icon as Record<string,unknown>)._width)},
        date:{year:frame(date._year),month:frame(date._month),day:frame(date._day),_dayofweek:frame(date._dayofweek)},compare:frame(generalDateCompare(date,other)),
        info:{count:frame(info._count),enabled:frame(info._enabled),marker:frame(info._marker)},
        null:{_type:generalNull("Image")[".type"],_isnull:generalNull("Image")[".isnull"]?1:0},zero_error:1};
    assert.deepEqual(actual,native);
    assert.equal(link._icon,image);assert.equal(Object.getPrototypeOf(extra),null);
    assert.throws(()=>generalDate(2026,9,27,bytes("0")),/S2 Builtin Date/);
});

// general-model-date.test.ts
//
// Actual native date-part splitting and approved anonymous request-clock construction.
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
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {generalDateTimeParts,generalDateTimeClock,generalMysqlDateParts} from "../live/domain/general-model-date";
import type {NativeProfile} from "../runtime/native-profile";

test("DateTime_parts preserves native split/coercion and anonymous clock is UTC",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const inputs=[undefined,"2026 09 27 12 03 04 0"," 2026 09 27","9007199254740993 2 3","2026\t9\n27 0 0 0 6\n"];
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
        use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;use MIME::Base64 qw(encode_base64);
        BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        local $/;my $inputs=decode_json(<STDIN>);my @out;
        for my $value(@$inputs){my $model=LJ::S2::DateTime_parts($value);push @out,{map {$_=>defined $model->{$_}?
            {base64=>encode_base64($model->{$_},''),utf8=>utf8::is_utf8($model->{$_})?1:0}:undef}
            qw(year month day hour min sec _dayofweek)};}
        my $clock=LJ::S2::DateTime_unix(1790506804);
        print encode_json({parts=>\@out,clock=>{map {$_=>0+$clock->{$_}} qw(year month day hour min sec _dayofweek)}});`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{input:JSON.stringify(inputs),encoding:"utf8",timeout:10000}));
    const fields=["year","month","day","hour","min","sec","_dayofweek"];
    const project=(model:Record<string,unknown>)=>Object.fromEntries(fields.map(field=>{
        const value=model[field==="_dayofweek"?field:"_"+field];
        return [field,value===undefined?null:{base64:scalarPV(value).bytes().toString("base64"),utf8:scalarPV(value).flagged()?1:0}];
    }));
    assert.deepEqual(inputs.map(input=>project(generalDateTimeParts(input===undefined?undefined:NativeString.hostUtf8Bytes(input),profile))),native.parts);
    const clock=generalDateTimeClock(1790506804);
    assert.deepEqual(Object.fromEntries(fields.map(field=>[field,Number(scalarPV(clock[field==="_dayofweek"?field:"_"+field]).bytes().toString())])),native.clock);
});

test("selected civil timestamps retain native UTC Entry date-parts bytes",()=>{
    const inputs=["2026-09-27 12:03:04","2000-02-29 23:59:59","1969-12-31 00:00:00",
        "1000-01-01 00:00:00","9999-12-31 23:59:59"];
    const script=String.raw`use strict;use warnings;use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;use MIME::Base64 qw(encode_base64);
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};
        *DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';local $/;my $inputs=decode_json(<STDIN>);
        print encode_json([map{my $value=LJ::alldatepart_s2($_);
            {base64=>encode_base64($value,''),utf8=>utf8::is_utf8($value)?1:0}}@$inputs]);`;
    const native=JSON.parse(execFileSync("perl",["-e",script],{
        input:JSON.stringify(inputs),encoding:"utf8",timeout:10000}));
    assert.deepEqual(inputs.map(value=>{
        const frame=generalMysqlDateParts(value);
        return {base64:frame.bytes().toString("base64"),utf8:frame.flagged()?1:0};
    }),native);
    assert.throws(()=>generalMysqlDateParts("2026-02-30 00:00:00"));
});

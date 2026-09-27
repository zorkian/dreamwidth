// general-site-url.test.ts
//
// Actual native lj/site modes and scalar byte output.
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
import {NativeString} from "../runtime/native-string";
import type {NativeProfile} from "../runtime/native-profile";
import {expandGeneralSiteUrl} from "../live/domain/general-site-url";

test("lj/site URL helpers retain native mode, false segment and numeric formatting",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const inputs=["faq/12x","faq/0","support/-2.5","memories/MiXeD-name","userinfo/","userpics/bad@name",
        "user/MiXeD-name/profile/ignored","user/bad@name/path","user/name/0/path","user/name/bad&part","unknown/path"];
    const pv=inputs.map(value=>NativeString.hostUtf8Bytes(value));
    pv.push(NativeString.bytes(Buffer.concat([Buffer.from("user/name/"),Buffer.from([255])])));
    const source=`use strict; use JSON::PP; use MIME::Base64 qw(decode_base64 encode_base64); use lib '/workspaces/dreamwidth/cgi-bin';
BEGIN { require DBI; no warnings 'redefine'; *DBI::connect=sub{die 'DB forbidden'}; *DBI::connect_cached=sub{die 'DB forbidden'}; }
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl'; require LJ::CleanHTML; local $LJ::SITEROOT='https://app.example.invalid';
local $LJ::USERNAME_MAXLENGTH=25; local $/; my $rows=decode_json(<STDIN>); my @out;
for my $r (@$rows) {my $v=decode_base64($r);my $result=LJ::CleanHTML::ExpandLJURL($v);push @out,{base64=>encode_base64($result,''),utf8=>utf8::is_utf8($result)?1:0};}
print encode_json([@out]);`;
    const oracle=JSON.parse(execFileSync("perl",["-e",source],{input:JSON.stringify(pv.map(v=>v.bytes().toString("base64"))),encoding:"utf8",timeout:10000}));
    const results=pv.map(value=>expandGeneralSiteUrl(value,NativeString.hostUtf8Bytes("https://app.example.invalid"),profile,25));
    assert.deepEqual(results.map(value=>({base64:value.bytes().toString("base64"),utf8:value.flagged()?1:0})),oracle);
});

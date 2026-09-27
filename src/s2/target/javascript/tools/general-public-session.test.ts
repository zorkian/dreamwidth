// general-public-session.test.ts
//
// Public helper request witnesses, native names and final release ordering.
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
import {canonicalPublicUsername, GeneralPublicSession} from "../live/domain/general-public-session";
import type {PublicUserSnapshot} from "../live/data/public-users";
import type {PublicTranslationSnapshot} from "../live/data/public-translations";

const root=path.resolve("../..");
const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
    input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;

test("public names use actual Perl byte/flag character classes",()=>{
    const cases=[NativeString.hostUtf8Bytes("  MiXeD-name\t"),NativeString.hostUtf8Bytes("0"),
        NativeString.bytes(Buffer.from([160,97,160])),NativeString.flagged(Buffer.from("\u00a0a\u00a0")),
        NativeString.flagged(Buffer.from("\u212a")),NativeString.hostUtf8Bytes("bad@name"),
        NativeString.hostUtf8Bytes("a".repeat(26))];
    const perl=`use strict; use JSON::PP; use MIME::Base64 qw(decode_base64); use lib '/workspaces/dreamwidth/cgi-bin';
BEGIN { require DBI; no warnings 'redefine'; *DBI::connect=sub{die 'DB forbidden'}; *DBI::connect_cached=sub{die 'DB forbidden'}; }
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl'; local $LJ::USERNAME_MAXLENGTH=25;
local $/; my $rows=decode_json(<STDIN>); my @out; for my $r (@$rows) { my $v=decode_base64($r->{base64});
utf8::decode($v) if $r->{utf8}; push @out,LJ::canonical_username($v); } print encode_json([@out]);`;
    const native=JSON.parse(execFileSync("perl",["-e",perl],{input:JSON.stringify(cases.map(v=>({base64:v.bytes().toString("base64"),utf8:v.flagged()}))),encoding:"utf8",timeout:10000}));
    assert.deepEqual(cases.map(v=>canonicalPublicUsername(v,profile,25)),native);
    assert.equal(canonicalPublicUsername(cases[6]!,profile,100),"a".repeat(26));
});
test("all helper witnesses precede final authority and session cannot reopen",async()=>{
    const order:string[]=[];
    const user:PublicUserSnapshot={requestedName:"arbitrary",user:null,fingerprint:"absence"};
    const translation:PublicTranslationSnapshot={name:"video",language:"en",value:NativeString.hostUtf8Bytes("text"),fingerprint:"text"};
    let current=true;
    const users={async snapshot(name:string){order.push("user:"+name);return user;},async revalidate(value:PublicUserSnapshot){assert.equal(value,user);order.push("check-user");return current;}};
    const translations={async snapshot(){order.push("translation");return translation;},async revalidate(value:PublicTranslationSnapshot){assert.equal(value,translation);order.push("check-translation");return true;}};
    const session=new GeneralPublicSession(users,translations,profile,25);
    assert.equal(await session.user(NativeString.hostUtf8Bytes("@invalid")),null);
    await session.user(NativeString.hostUtf8Bytes("ARBITRARY"));await session.translation("video");
    assert.equal(await session.finish(async()=>{order.push("authority");return true;}),true);
    assert.deepEqual(order,["user:arbitrary","translation","check-user","check-translation","authority"]);
    await assert.rejects(session.user(NativeString.hostUtf8Bytes("other")),/closed/);
    await assert.rejects(session.finish(async()=>true),/closed/);
    const changed=new GeneralPublicSession(users,translations,profile,25);await changed.user(NativeString.hostUtf8Bytes("arbitrary"));current=false;
    assert.equal(await changed.finish(async()=>{throw Error("Changed helper must prevent release");}),false);
});

test("encoding dependency is reached explicitly and rechecked before final private authority",async()=>{
    const order:string[]=[];
    const unreachable={async snapshot():Promise<never>{throw Error("Unreached");},async revalidate(){return true;}};
    let current=true;
    const witness={entries:[],fingerprint:"public-codes"};
    const encodings={async snapshot(){order.push("codes");return witness;},async revalidate(value:typeof witness){
        assert.equal(value,witness);order.push("check-codes");return current;}};
    const session=new GeneralPublicSession(unreachable,unreachable,profile,25,encodings);
    await session.encoding();
    assert.equal(await session.finish(async()=>{order.push("authority");return true;}),true);
    assert.deepEqual(order,["codes","check-codes","authority"]);
    const changed=new GeneralPublicSession(unreachable,unreachable,profile,25,encodings);
    await changed.encoding();current=false;
    assert.equal(await changed.finish(async()=>{throw Error("Changed codes must block release");}),false);
});

// general-user-model.test.ts
//
// Actual native public UserLite fields and immutable private account binding controls.
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
import {prepareGeneralUserLite} from "../live/domain/general-user-model";
import {parentLoadUser,parentUserUrl} from "../live/render/general-user-host";
import {generalNativeHostValue} from "../live/render/general-native-host-result";
import {decodeGeneralString} from "../live/render/general-site-url-client";
import {decodePreparedUser} from "../live/render/general-user-client";
import {encodeScalar} from "../runtime/native-scalar";
import {nativePublicDisplayName} from "../live/domain/general-user-display";
import {GeneralUserAuthority} from "../live/domain/general-user-authority";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import type {NativeProfile} from "../runtime/native-profile";
import path from "node:path";
import {GeneralUserBindings} from "../live/render/general-user-bindings";
import type {PublicUserFacts} from "../live/data/public-users";

const oracle=`use strict; use warnings; no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
use JSON::PP; use MIME::Base64 qw(encode_base64);
BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
{package FixedPublicUser;sub user {'public_name'};sub display_name {$_[0]->{display}};
sub allpics_base {'https://public.example.invalid/base/icons'};}
my @out;
for my $enabled(0,1){ no warnings 'redefine';local *LJ::is_enabled=sub{die 'Unexpected feature' unless $_[0] eq 'tellafriend';$enabled};
my $u=bless {display=>pack('C*',255,38,34),name=>pack('C*',255,0,60,62),journaltype=>'I'},'FixedPublicUser';
my $model=LJ::S2::UserLite($u);delete $model->{_u};
push @out,{type=>$model->{_type},values=>{map {$_=>encode_base64($model->{$_},'')} qw(user username name journal_type userpic_listing_url)},keys=>$model->{link_keyseq}};}
print JSON::PP->new->canonical->encode(\\@out);`;

test("public UserLite exactly escapes native fields while leaving account facts private",()=>{
    const rows=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    const user:PublicUserFacts={userid:111,username:"public_name",clusterid:0,status:"V",statusvis:"X",journaltype:"I",
        dversion:1,caps:"0",name:NativeString.bytes(Buffer.from([255,0,60,62])),
        identity:{type:"O",value:NativeString.hostUtf8Bytes("Private parent identity")}};
    for(const enabled of [false,true]) {
        const model=prepareGeneralUserLite(user,{displayName:()=>NativeString.bytes(Buffer.from([255,38,34])),
            journalBase:()=>NativeString.hostUtf8Bytes("https://public.example.invalid/base"),tellFriend:enabled})!;
        const values=Object.fromEntries(["user","username","name","journal_type","userpic_listing_url"].map(key=>
            [key,(model["_"+key] as NativeString).bytes().toString("base64")]));
        assert.deepEqual({type:model[".type"],values,keys:model._link_keyseq.map(v=>v.bytes().toString())},rows[Number(enabled)]);
        assert.equal(Object.hasOwn(model,"_u"),false);assert.equal(Object.hasOwn(model,"_caps"),false);
        assert.equal(Object.hasOwn(model,"_identity"),false);
    }
    assert.equal(prepareGeneralUserLite(null,{displayName(){throw Error("absent helper");},
        journalBase(){throw Error("absent helper");},tellFriend:false}),undefined);
});
test("private native account reference survives public mutation, never field/copy forgery",()=>{
    const bindings=new GeneralUserBindings(),model={".type":"UserLite",_user:"original"};
    const handle="a".repeat(64);bindings.bind(model,handle);
    const alias=model;alias._user="different";Object.assign(alias,{_u:handle,host_userid:999});
    assert.equal(bindings.account(alias),handle);
    assert.equal(bindings.account({...model}),undefined);
    assert.equal(bindings.account({_u:handle}),undefined);
    assert.throws(()=>bindings.bind(model,"b".repeat(64)));
    assert.throws(()=>bindings.bind({},"malformed"));
});

test("parent-issued accounts remain request-private and carry the final user witness",async()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const user:PublicUserFacts={userid:111,username:"public_name",clusterid:0,status:"V",statusvis:"X",journaltype:"I",
        dversion:1,caps:"0",name:NativeString.hostUtf8Bytes("Public"),identity:null};
    const snapshot={requestedName:"public_name",user,fingerprint:"original"};
    const absent={requestedName:"not_existing",user:null,fingerprint:"absent"};
    let served=snapshot;
    let current=true,reads=0;
    const store={async snapshot(name:string){reads++;return name==="not_existing"?absent:served;},
        async revalidate(value:unknown){assert.ok(value===snapshot||value===served||value===absent);return current;}};
    const translations={async snapshot():Promise<never>{throw Error("No translation read");},async revalidate(){return true;}};
    const session=new GeneralPublicSession(store,translations,profile,25);
    const operations={displayName:()=>NativeString.hostUtf8Bytes("public_name"),
        journalBase:()=>NativeString.hostUtf8Bytes("https://public.example.invalid"),tellFriend:false};
    const authority=new GeneralUserAuthority(session,operations);
    for(const invalid of ["","?","a".repeat(26)]) {
        const before=reads;
        assert.equal(await parentLoadUser({name:encodeScalar(NativeString.bytes(Buffer.from(invalid)))},authority),null);
        assert.equal(reads,before);
    }
    assert.equal(await parentLoadUser({name:encodeScalar(NativeString.bytes(Buffer.from("not_existing")))},authority),null);
    const prepared=(await authority.load(NativeString.hostUtf8Bytes("PUBLIC-NAME")))!;
    assert.equal(reads,2);assert.equal(authority.account(prepared.account),user);
    const response=await parentLoadUser({name:encodeScalar(NativeString.hostUtf8Bytes("public_name"))},authority);
    const bindings=new GeneralUserBindings();
    const workerModel=decodePreparedUser(response,bindings) as Record<string,unknown>;
    assert.equal(authority.account(bindings.account(workerModel)),user);
    const nativeEquality=JSON.parse(execFileSync("perl",["-e",`use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        no warnings 'uninitialized';my @out;for my $pair([111,111],[111,222],[undef,undef],[111,undef]){
        my($a,$b)=map {defined $_?{_u=>{userid=>$_}}:{}} @$pair;
        push @out,S2::Builtin::LJ::UserLite__equals(undef,$a,$b)?JSON::PP::true:JSON::PP::false;}
        print encode_json(\\@out);`],{encoding:"utf8",timeout:10000}));
    assert.deepEqual(nativeEquality,[true,false,true,false]);
    const second=(await authority.load(NativeString.hostUtf8Bytes("public_name")))!;
    assert.equal(await parentLoadUser({left:prepared.account,right:second.account},authority),nativeEquality[0]);
    assert.equal(await parentLoadUser({left:null,right:null},authority),nativeEquality[2]);
    assert.equal(await parentLoadUser({left:prepared.account,right:null},authority),nativeEquality[3]);
    await assert.rejects(parentLoadUser({left:prepared.account,right:"0".repeat(64)},authority));
    await assert.rejects(parentLoadUser({left:prepared.account,right:null,userid:111},authority));
    workerModel._user=NativeString.hostUtf8Bytes("forged");
    assert.equal(authority.account(bindings.account(workerModel)),user);
    assert.equal(bindings.account({...workerModel}),undefined);
    assert.throws(()=>decodePreparedUser({...response as object,extra:1},bindings));
    await assert.rejects(parentLoadUser({name:encodeScalar(NativeString.hostUtf8Bytes("public_name")),userid:111},authority));
    assert.equal(decodePreparedUser(null,bindings),undefined);
    (prepared.model as Record<string,unknown>)._user=NativeString.hostUtf8Bytes("other");
    assert.equal(authority.account(prepared.account),user);
    assert.throws(()=>authority.account("0".repeat(64)));
    const other=new GeneralUserAuthority(session,operations);
    assert.throws(()=>other.account(prepared.account));
    assert.equal(Object.hasOwn(prepared.model,"account"),false);
    const nativeUrls=JSON.parse(execFileSync("perl",["-e",String.raw`use strict;use warnings;
        use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
        BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        {package UrlUser;sub journal_base{'https://public.example.invalid'}}
        no warnings 'redefine';local *LJ::load_user=sub{$_[0] eq 'public_name'?bless({},'UrlUser'):undef};
        print encode_json([map {S2::Builtin::LJ::get_url(undef,{user=>'public_name'},$_)}
            ('userinfo','recent','tag/?q=a&b')]);`],{encoding:"utf8",timeout:10000}));
    const urls=[];
    for(const view of ["userinfo","recent","tag/?q=a&b"]) {
        const reply=await parentUserUrl({name:encodeScalar(NativeString.hostUtf8Bytes("public_name")),
            view:encodeScalar(NativeString.hostUtf8Bytes(view))},authority);
        urls.push(generalNativeHostValue(reply,decodeGeneralString).bytes().toString());
    }
    assert.deepEqual(urls,nativeUrls);
    await assert.rejects(parentUserUrl({name:encodeScalar(NativeString.hostUtf8Bytes("public_name")),
        view:encodeScalar(NativeString.hostUtf8Bytes("recent")),userid:111},authority));
    authority.bindSelectedCommentPosters({roots:[{show:true,posterLoaded:true,
        posterSuspended:false,posterId:111,posterUsername:NativeString.bytes(Buffer.from("public_name")),
        children:[]}]});
    assert.throws(()=>authority.bindSelectedCommentPosters({roots:[{show:true,posterLoaded:true,
        posterSuspended:false,posterId:111,posterUsername:NativeString.bytes(Buffer.from([0xe9])),
        children:[]}]}));
    assert.equal((await authority.load(NativeString.bytes(Buffer.from("public_name"))))?.model[".type"],"UserLite");
    served={requestedName:"public_name",user:{...user,userid:222},fingerprint:"reused"};
    await assert.rejects(parentLoadUser({name:encodeScalar(NativeString.bytes(Buffer.from("public_name")))},authority));
    current=false;
    assert.equal(await session.finish(async()=>{throw Error("Stale user must prevent private release");}),false);
});

test("identity display preserves installed OpenID, hook-false and percent-byte semantics",()=>{
    const root=path.resolve("../..");
    const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
    const cases=["http://WWW.Example.invalid/","https://dev.Example.invalid:123/users/a%FF/",
        "https://profile.Example.invalid/a%20b/","https://Example.invalid/~a/",
        "https://example.invalid/deep/path","HTTPS://Example.invalid/","relative%FF","https://x/a\r:b"];
    const oracle=`use strict;use warnings;no warnings 'once';use lib '/workspaces/dreamwidth/cgi-bin';
        use JSON::PP;use MIME::Base64 qw(encode_base64);
        BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require Net::OpenID::VerifiedIdentity;
        {package PublicIdentity;sub typeid {'O'};sub value {$_[0]->{value}};}
        {package PublicIdentityUser;sub is_identity {1};sub identity {bless {value=>$_[0]->{value}},'PublicIdentity'};}
        local $LJ::OPTMOD_OPENID_VERIFIED_IDENTITY=1;local $LJ::IS_DEV_SERVER=1;
        no warnings 'redefine';local *LJ::Hooks::run_hook=sub{die 'Unexpected hook' unless $_[0] eq 'identity_display_name';return '0';};
        local $/;my $cases=decode_json(<STDIN>);my @out;for my $value(@$cases){my $u=bless {value=>$value},'PublicIdentityUser';
        my $name=LJ::User::display_name($u);push @out,{bytes=>encode_base64($name,''),flag=>utf8::is_utf8($name)?1:0};}
        print encode_json(\\@out);`;
    const expected=JSON.parse(execFileSync("perl",["-e",oracle],{input:JSON.stringify(cases),encoding:"utf8",timeout:10000}));
    const user:PublicUserFacts={userid:1,username:"identity",clusterid:0,status:"A",statusvis:"X",journaltype:"I",
        dversion:1,caps:"0",name:NativeString.hostUtf8Bytes(""),identity:null};
    assert.deepEqual(cases.map(value=>{
        const name=nativePublicDisplayName({...user,identity:{type:"O",value:NativeString.hostUtf8Bytes(value)}},
            {openidAvailable:true,isDevServer:true,profile,identityDisplayName:()=>NativeString.hostUtf8Bytes("0")})!;
        return {bytes:name.bytes().toString("base64"),flag:name.flagged()?1:0};
    }),expected);
});

// general-model-user.test.ts
//
// Actual native User website fields and private handle separation.
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
import {generalUser} from "../live/domain/general-model-user";
import {generalNull} from "../live/domain/general-model-primitives";
import {GeneralUserBindings} from "../live/render/general-user-bindings";
import {NativeString} from "../runtime/native-string";

test("User preserves native website octets and separately issued account identity",()=>{
    const script=String.raw`use strict;use warnings;use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
        use MIME::Base64 qw(encode_base64);BEGIN{require DBI;no warnings 'redefine';
        *DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::S2;
        {package ModelUser;sub user{'name'}sub display_name{'display'}sub allpics_base{'/icons'}}
        my $u=bless {defaultpicid=>0,name=>'name',journaltype=>'P',url=>pack('C*',47,255,38,97),urlname=>'<name>'},'ModelUser';
        no warnings 'redefine';local *LJ::is_enabled=sub{0};my $model=LJ::S2::User($u);
        print encode_json({type=>$model->{_type},pic=>{type=>$model->{default_pic}{_type},null=>$model->{default_pic}{_isnull}},
            url=>{base64=>encode_base64($model->{website_url},''),utf8=>utf8::is_utf8($model->{website_url})?1:0},
            name=>{base64=>encode_base64($model->{website_name},''),utf8=>utf8::is_utf8($model->{website_name})?1:0}});`;
    const expected=JSON.parse(execFileSync("perl",["-e",script],{encoding:"utf8",timeout:10000}));
    const lite={".type":"UserLite",_user:NativeString.hostUtf8Bytes("name")};
    const model=generalUser(lite,generalNull("Image"),NativeString.bytes(Buffer.from([47,255,38,97])),NativeString.hostUtf8Bytes("<name>"));
    const frame=(value:unknown)=>({base64:(value as NativeString).bytes().toString("base64"),utf8:(value as NativeString).flagged()?1:0});
    const pic=model._default_pic as Record<string,unknown>;
    assert.deepEqual({type:model[".type"],pic:{type:pic[".type"],null:pic[".isnull"]?1:0},url:frame(model._website_url),name:frame(model._website_name)},expected);
    const bindings=new GeneralUserBindings(),handle="a".repeat(64);bindings.bind(lite,handle);
    assert.equal(bindings.account(model),undefined);bindings.bind(model,handle);
    assert.equal(bindings.account(model),handle);assert.equal(bindings.account({...model}),undefined);
});

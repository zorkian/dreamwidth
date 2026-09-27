// general-journal-url.test.ts
//
// Source public journal rule selection and reached hook return semantics.
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
import {generalJournalBase} from "../live/domain/general-journal-url";
import {config} from "../live/tests/fixtures";
import type {PublicAppConfig} from "../live/contracts";

test("public journal URLs select actual type, P fallback and truthy installed hook",()=>{
    const base:PublicAppConfig={...config,canonicalAppOrigin:"http://localhost",journalUrls:{
        protocol:"http",domain:"example.invalid",isDevServer:false,hookConfigured:false,
        subdomainRules:{P:[true,"path.example.invalid"],C:[false,"community.example.invalid"]}}};
    const cases=[{username:"one_two",journaltype:"P",dev:false,hook:null},
        {username:"one",journaltype:"C",dev:false,hook:null},
        {username:"_edge",journaltype:"I",dev:false,hook:null},
        {username:"feed",journaltype:"Y",dev:false,hook:null},
        {username:"one",journaltype:"P",dev:true,hook:null},
        {username:"one",journaltype:"P",dev:false,hook:"0"},
        {username:"one",journaltype:"P",dev:false,hook:"https://hook.example.invalid/one"}];
    const source=`use strict; use JSON::PP; use lib '/workspaces/dreamwidth/cgi-bin';
BEGIN { require DBI; no warnings 'redefine'; *DBI::connect=sub{die 'DB forbidden'}; *DBI::connect_cached=sub{die 'DB forbidden'}; }
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl'; require LJ::User;
local $LJ::PROTOCOL='http'; local $LJ::DOMAIN='example.invalid';local $/;my $cases=decode_json(<STDIN>);my @out;
for my $r (@$cases) {local $LJ::IS_DEV_SERVER=$r->{dev}; local $LJ::SUBDOMAIN_RULES={P=>[$r->{dev}?0:1,$r->{dev}?'':'path.example.invalid'],C=>[0,'community.example.invalid']};
no warnings 'redefine';local *LJ::Hooks::are_hooks=sub{$_[0] eq 'journal_base' && defined $r->{hook}};
local *LJ::Hooks::run_hook=sub{$r->{hook}};
my $u=bless {user=>$r->{username},journaltype=>$r->{journaltype},userid=>900001},'LJ::User';push @out,LJ::journal_base($u);}
print encode_json([@out]);`;
    const oracle=JSON.parse(execFileSync("perl",["-e",source],{input:JSON.stringify(cases),encoding:"utf8",timeout:10000}));
    const actual=cases.map(row=>{
        const cfg:PublicAppConfig={...base,journalUrls:{...base.journalUrls,isDevServer:row.dev,
            hookConfigured:row.hook!==null,subdomainRules:row.dev?{P:[false,""]}:base.journalUrls.subdomainRules}};
        return generalJournalBase(row,cfg,row.hook===null?undefined:()=>NativeString.hostUtf8Bytes(row.hook!)).bytes().toString();
    });
    assert.deepEqual(actual,oracle);
    assert.throws(()=>generalJournalBase(cases[0]!,{...base,journalUrls:{...base.journalUrls,hookConfigured:true}}),/not wired/);
});

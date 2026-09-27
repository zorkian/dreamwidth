// general-maintainers.test.ts
//
// Current native community-maintainer authority and private release witnesses.
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
import {MysqlPublicMaintainers} from "../live/data/public-maintainers";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import type {NativeProfile} from "../runtime/native-profile";
import {NativeString} from "../runtime/native-string";
import {scalarTruthy} from "../runtime/native-scalar";
import {withSelectedFixture} from "./selected-fixture";

const root=path.resolve("../..");
const profile=JSON.parse(execFileSync("perl",["tools/compile-active.pl",root,path.join(root,"S2.pm")],{
    input:JSON.stringify({profileOnly:true}),encoding:"utf8",maxBuffer:1048576,timeout:10000})).profile as NativeProfile;
const unused={async snapshot():Promise<never>{throw Error("Unreached helper");},async revalidate(){return true;}};

// The actual Entry/User methods and check_rel query run against only the guarded
// schema. Native cache operations are explicit inert test providers; no cache IO.
function nativeOfficial(schema:string,posterId:number):number {
    const perl=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use DBI;use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Entry;
my($schema,$pid)=@ARGV;die 'Isolated schema required' unless $schema=~/\As6_selected_[a-f0-9]{16}_g\z/;
my $db=DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
 {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0});
$db->do('SET SESSION TRANSACTION READ ONLY');$db->do('START TRANSACTION READ ONLY');
my $journal=bless $db->selectrow_hashref('SELECT * FROM user WHERE userid=900001'),'LJ::User';
my $row=$db->selectrow_hashref('SELECT * FROM user WHERE userid=?',undef,$pid);
my $poster=$row?bless($row,'LJ::User'):undef;
{package FixtureEntry;our @ISA=('LJ::Entry');sub journal{$_[0]->{journal}}sub poster{$_[0]->{poster}}sub prop{1}
 package FixtureCache;sub get{undef}sub set{$_[3]}}
no warnings 'redefine';local *DW::Cache::request=sub{bless {},'FixtureCache'};
local *LJ::_get_rel_memcache=sub{undef};local *LJ::_set_rel_memcache=sub{};
local *LJ::get_db_reader=sub{$db};local *LJ::get_cluster_reader=sub{die 'Unexpected clustered relationship'};
local *LJ::run_hook=sub{die 'Unexpected relationship hook'};
die 'Wrong relationship routing' unless LJ::get_reluser_id('A')==0;
my $entry=bless {journal=>$journal,poster=>$poster},'FixtureEntry';
print encode_json(0+$entry->admin_post);$db->do('ROLLBACK');$db->disconnect;`;
    return JSON.parse(execFileSync("perl",["-e",perl,schema,String(posterId)],{encoding:"utf8",timeout:10000}));
}

test("official posts require current community/poster/maintainer source authority",async()=>{
    await withSelectedFixture(async({admin,g,c,table,store,request,startup,logProp})=>{
        const maintainers=new MysqlPublicMaintainers(startup.database);
        const session=()=>new GeneralPublicSession(unused,unused,profile,25,undefined,undefined,maintainers);
        // No unknown8bit input reaches conversion in this fixed ASCII fixture.
        const encoding={async item():Promise<never>{throw Error("Unexpected charset conversion");}} as unknown as GeneralTextEncoding;
        await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,1,?,'1')`,[logProp("admin_post")]);
        const project=async()=>{
            const snapshot=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"entry",ditemid:257}));assert.ok(snapshot);
            const authority=session();const selected=await GeneralSelectedText.prepare(snapshot,encoding,authority);
            const entry=snapshot.facts.entries[0]!;
            const projected=selected.entrySource(entry,{permalinkUrl:NativeString.hostUtf8Bytes("/257.html"),
                adultContentLevel:NativeString.hostUtf8Bytes("none"),content:{suspendMessage:0,noEntryBody:0,noHtml:0,
                    cutUrl:NativeString.hostUtf8Bytes("/257.html"),cutDisable:0}});
            assert.equal(Object.hasOwn(projected,"relationships"),false);
            assert.equal(Object.hasOwn(projected,"canManage"),false);
            assert.equal(Object.hasOwn(projected,"props"),false);
            return {snapshot,authority,official:scalarTruthy(projected.adminPost)?1:0};
        };
        try {
            // Personal journals never gain official status, even self-authored.
            let prepared=await project();assert.equal(prepared.official,nativeOfficial(g,900001));assert.equal(prepared.official,0);
            assert.equal(await prepared.authority.finish(()=>store.revalidateNativeSelectedFingerprint(prepared.snapshot)),true);
            await admin.query(`UPDATE ${table(g,"user")} SET journaltype='C' WHERE userid=900001`);
            prepared=await project();assert.equal(prepared.official,nativeOfficial(g,900001));assert.equal(prepared.official,1);
            assert.equal(await prepared.authority.finish(()=>store.revalidateNativeSelectedFingerprint(prepared.snapshot)),true);
            await admin.query(`UPDATE ${table(c,"log2")} SET posterid=900002 WHERE journalid=900001 AND jitemid=1`);
            prepared=await project();assert.equal(prepared.official,nativeOfficial(g,900002));assert.equal(prepared.official,0);
            await admin.query(`INSERT INTO ${table(g,"reluser")} (userid,targetid,type) VALUES (900001,900002,'A')`);
            prepared=await project();assert.equal(prepared.official,nativeOfficial(g,900002));assert.equal(prepared.official,1);
            // Revocation after preparation blocks publication before the final
            // private reread; the next request has an ordinary nonofficial post.
            await admin.query(`DELETE FROM ${table(g,"reluser")} WHERE userid=900001 AND targetid=900002`);
            assert.equal(await prepared.authority.finish(async()=>{throw Error("Revoked authority must prevent release");}),false);
            prepared=await project();assert.equal(prepared.official,nativeOfficial(g,900002));assert.equal(prepared.official,0);
            const absent=await maintainers.snapshot(900001,999999);assert.equal(absent.canManage,false);
            assert.equal(nativeOfficial(g,999999),0);
            assert.equal(await maintainers.revalidate({...absent}),false);
            await admin.query(`INSERT INTO ${table(g,"reluser")} (userid,targetid,type) VALUES (900002,900001,'A')`);
            assert.equal((await maintainers.snapshot(900001,900002)).canManage,false);
            assert.equal(nativeOfficial(g,900002),0);
        } finally {await maintainers.close();}
    },false,false,false,true);
});

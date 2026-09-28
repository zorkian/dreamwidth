// general-comment-anonymity.test.ts
//
// Isolated current identity relationship and selected Comment cleaner authority.
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
import {MysqlPublicCommentAuthors,type PublicCommentAnonymitySnapshot} from
    "../live/data/public-comment-authors";
import {MysqlPublicMaintainers} from "../live/data/public-maintainers";
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import {generalSelectedComments} from "../live/domain/general-comment-projection";
import {GeneralPublicSession} from "../live/domain/general-public-session";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {NativeString} from "../runtime/native-string";
import type {NativeProfile} from "../runtime/native-profile";
import {withSelectedFixture} from "./selected-fixture";

function nativeAnonymous(schema:string,ownerId:number,posterId:number):number {
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use DBI;use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Talk;
require DW::User::Edges::WatchTrust;require DW::User::Edges::CommMembership;
my($schema,$ownerid,$posterid)=@ARGV;
die 'Isolated schema required' unless $schema=~/\As6_selected_[a-f0-9]{16}_g\z/;
my $db=DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
 {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0});
$db->do('SET SESSION TRANSACTION READ ONLY');$db->do('START TRANSACTION READ ONLY');
my $owner=bless $db->selectrow_hashref('SELECT * FROM user WHERE userid=?',undef,$ownerid),'LJ::User';
my $poster=bless $db->selectrow_hashref('SELECT * FROM user WHERE userid=?',undef,$posterid),'LJ::User';
{package FixtureCache;sub get{undef}sub set{$_[3]}}
no warnings 'redefine';local *DW::Cache::request=sub{bless {},'FixtureCache'};
local *LJ::MemCache::get=sub{undef};local *LJ::MemCache::set=sub{};
local *LJ::_get_rel_memcache=sub{undef};local *LJ::_set_rel_memcache=sub{};
local *LJ::get_db_reader=sub{$db};local *LJ::get_cluster_reader=sub{die 'Unexpected cluster relation'};
print encode_json(LJ::Talk::treat_as_anon($poster,$owner)?1:0);
$db->do('ROLLBACK');$db->disconnect;`;
    return JSON.parse(execFileSync("perl",["-e",source,schema,String(ownerId),String(posterId)],
        {encoding:"utf8",timeout:10000,maxBuffer:32768}));
}

test("selected identity Comment mode follows current trust or membership and revokes",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async f=>{
    await f.admin.query(`INSERT INTO ${f.table(f.g,"user")}
        (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,
        opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
        VALUES (900999,'identityposter',0,'A','V','I','Identity','Y','all','N',1,NULL,10,2)`);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"useridmap")}(userid,user)
        VALUES (900999,'identityposter')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talk2")}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talktext2")}(journalid,jtalkid,subject,body)
        VALUES (900001,77,'Identity subject','Identity public body')`);
    const request=f.request("ordinary6",{kind:"entry",ditemid:300*256+1});
    const noEncoding={async item(){throw Error('Unreached charset conversion');}} as unknown as GeneralTextEncoding;
    const store=new MysqlPublicCommentAuthors(f.startup.database);
    const maintainers=new MysqlPublicMaintainers(f.startup.database);
    const snapshots:PublicCommentAnonymitySnapshot[]=[];
    const authority={async entryMaintainer(journalId:number,posterId:number){
        return (await maintainers.snapshot(journalId,posterId)).canManage;},
        async commentAnonymous(ownerId:number,posterId:number,ownerType:string,
        posterName:string){const witness=await store.snapshot(ownerId,posterId,ownerType,posterName);
        snapshots.push(witness);return witness.anonymous;}} as GeneralPublicSession;
    const selected=async()=>{
        const issued=await f.store.loadNativeSelectedSnapshot(request);assert.ok(issued?.facts.comments);
        const prepared=await GeneralSelectedText.prepare(issued,noEncoding,authority);
        const tree=generalSelectedComments(issued,{commentSettings:f.startup.commentSettings,
            capabilities:f.startup.capabilities},prepared,
        {permalink:NativeString.hostUtf8Bytes('/300.html'),styleArgument:undefined});
        assert.ok(tree);return {issued,tree};
    };
    try {
        let current=await selected();
        assert.equal(current.tree.roots[0]?.anonymous,true);
        assert.equal(nativeAnonymous(f.g,900001,900999),1);
        const noLookup={async snapshot(){throw Error('Unreached public lookup');},
            async revalidate(){throw Error('Unreached public recheck');}};
        const session=new GeneralPublicSession(noLookup,noLookup,{} as NativeProfile,25,
            undefined,undefined,undefined,store);
        assert.equal(await session.commentAnonymous(900001,900999,'P','identityposter'),true);
        await f.admin.query(`INSERT INTO ${f.table(f.g,"wt_edges")}
            (from_userid,to_userid,groupmask) VALUES (900001,900999,1)`);
        assert.equal(await store.revalidate(snapshots.at(-1)!),false);
        assert.equal(await session.finish(async()=>true),false);
        assert.equal(await f.store.revalidateNativeSelectedFingerprint(current.issued),true);
        current=await selected();assert.equal(current.tree.roots[0]?.anonymous,false);
        assert.equal(nativeAnonymous(f.g,900001,900999),0);
        await f.admin.query(`UPDATE ${f.table(f.g,"wt_edges")} SET groupmask=2
            WHERE from_userid=900001 AND to_userid=900999`);
        assert.equal(await store.revalidate(snapshots.at(-1)!),false);
        current=await selected();assert.equal(current.tree.roots[0]?.anonymous,true);
        assert.equal(nativeAnonymous(f.g,900001,900999),1);
        await f.admin.query(`UPDATE ${f.table(f.g,"user")}
            SET journaltype='C' WHERE userid=900001`);
        current=await selected();assert.equal(current.tree.roots[0]?.anonymous,true);
        assert.equal(nativeAnonymous(f.g,900001,900999),1);
        await f.admin.query(`INSERT INTO ${f.table(f.g,"reluser")}(userid,targetid,type)
            VALUES (900001,900999,'E')`);
        assert.equal(await store.revalidate(snapshots.at(-1)!),false);
        current=await selected();assert.equal(current.tree.roots[0]?.anonymous,false);
        assert.equal(nativeAnonymous(f.g,900001,900999),0);
        await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET user='renamedidentity'
            WHERE userid=900999`);
        assert.equal(await store.revalidate(snapshots.at(-1)!),false);
        await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET user='identityposter'
            WHERE userid=900999`);
        await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET journaltype='I'
            WHERE userid=900001`);
        const self=await store.snapshot(900001,900001,'I','ordinary6');
        assert.equal(self.anonymous,false);
        assert.equal(nativeAnonymous(f.g,900001,900001),0);
    } finally {await store.close();await maintainers.close();}
},false,false,false,false,true));

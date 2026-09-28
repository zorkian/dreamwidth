// general-comment-picture-provider.test.ts
//
// Selected Comment picture resolution from bounded public author facts.
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
import {GeneralSelectedText} from "../live/domain/general-selected-text";
import {generalSelectedComments} from "../live/domain/general-comment-projection";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import type {GeneralTextEncoding} from "../live/domain/general-text-encoding";
import {withSelectedFixture} from "./selected-fixture";

const pv=NativeString.hostUtf8Bytes;
function nativeMapChoice():unknown {
    const source=String.raw`use strict;use warnings;no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::User::Icons;
my $u=bless {userid=>900999,defaultpicid=>951,dversion=>10,clusterid=>7},'LJ::User';
no warnings 'redefine';
local *LJ::User::get_userpic_info=sub{{pic=>{951=>{picid=>951},952=>{picid=>952}},
 kw=>{mapped=>{picid=>952}},mapid=>{5=>{picid=>952}},map_redir=>{6=>5},mapkw=>{5=>'mapped'}}};
my $chosen=$u->get_picid_from_mapid(6);
my $keyword=$u->get_keyword_from_mapid(6);
my $legacy=$u->get_picid_from_keyword('mapped');
local *LJ::User::get_userpic_info=sub{{pic=>{951=>{picid=>951}},
 mapid=>{},map_redir=>{6=>5},mapkw=>{5=>'mapped'}}};
print encode_json([$chosen,$keyword,$legacy,$u->get_picid_from_mapid(6)]);`;
    return JSON.parse(execFileSync("perl",["-e",source],
        {encoding:"utf8",timeout:10000,maxBuffer:32768}));
}
test("selected Comment picture follows map redirect, row presence and fractional style",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1"
},async()=>withSelectedFixture(async f=>{
    await f.admin.query(`INSERT INTO ${f.table(f.g,"user")}
        (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,
        opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
        VALUES (900999,'pictureauthor',7,'A','V','P','Picture author','Y','all','N',1,951,10,2)`);
    await f.admin.query(`INSERT INTO ${f.table(f.g,"useridmap")}(userid,user)
        VALUES (900999,'pictureauthor')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talk2")}
        (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
        VALUES (900001,77,'L',300,0,900999,'2026-09-26 01:00:00','A')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talktext2")}(journalid,jtalkid,subject,body)
        VALUES (900001,77,'Public subject','Public body')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userpic2")}
        (userid,picid,width,height,state,description)
        VALUES (900999,951,8,8,'N','Default'),(900999,952,9,7,'N','Mapped')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userkeywords")}(userid,kwid,keyword)
        VALUES (900999,1,'mapped')`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userpicmap3")}
        (userid,mapid,kwid,picid,redirect_mapid)
        VALUES (900999,5,1,952,NULL),(900999,6,NULL,NULL,5)`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,77,?,'6')`,[f.talkProp('picture_mapid')]);
    const request=f.request("ordinary6",{kind:"entry",ditemid:300*256+1});
    const noEncoding={async item(){throw Error("Unexpected encoding conversion");}} as unknown as GeneralTextEncoding;
    const selected=async()=>{
        const issued=await f.store.loadNativeSelectedSnapshot(request);assert.ok(issued);
        const prepared=await GeneralSelectedText.prepare(issued,noEncoding);
        const tree=generalSelectedComments(issued,{commentSettings:f.startup.commentSettings,
            capabilities:f.startup.capabilities},prepared,
        {permalink:pv("/300.html"),styleArgument:undefined});
        assert.ok(tree);return {issued,prepared,node:tree.roots[0]!};
    };
    let current=await selected();
    assert.deepEqual(nativeMapChoice(),[952,"mapped",952,951]);
    assert.equal(current.node.fields?.pictureKeyword?.bytes().toString(),"mapped");
    const root=pv("https://userpic.example.invalid");
    const full=current.prepared.commentPicture(current.node,root,"full");
    const small=current.prepared.commentPicture(current.node,root,"small");
    const smaller=current.prepared.commentPicture(current.node,root,"smaller");
    assert.equal(full.hasPicture,true);
    assert.equal(scalarPV(full.image?._url).bytes().toString(),"https://userpic.example.invalid/952/900999");
    assert.equal(scalarPV(full.image?._width).bytes().toString(),"9");
    assert.equal(scalarPV(small.image?._width).bytes().toString(),"6.75");
    assert.equal(scalarPV(smaller.image?._height).bytes().toString(),"3.5");
    assert.throws(()=>current.prepared.commentPicture({...current.node,show:false},root,"full"));
    await f.admin.query(`INSERT INTO ${f.table(f.c,"userpicmap2")}(userid,kwid,picid)
        VALUES (900999,1,952)`);
    await f.admin.query(`INSERT INTO ${f.table(f.c,"talkprop2")}(journalid,jtalkid,tpropid,value)
        VALUES (900001,77,?,'mapped')`,[f.talkProp('picture_keyword')]);
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET dversion=8 WHERE userid=900999`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(current.issued),false);
    current=await selected();
    assert.equal(scalarPV(current.prepared.commentPicture(current.node,root,"full").image?._url)
        .bytes().toString(),"https://userpic.example.invalid/952/900999");
    await f.admin.query(`UPDATE ${f.table(f.g,"user")} SET dversion=10 WHERE userid=900999`);
    current=await selected();
    await f.admin.query(`DELETE FROM ${f.table(f.c,"userpic2")}
        WHERE userid=900999 AND picid=952`);
    assert.equal(await f.store.revalidateNativeSelectedFingerprint(current.issued),false);
    current=await selected();
    assert.equal(current.prepared.commentPicture(current.node,root,"full").image?._url!==undefined,true);
    assert.equal(scalarPV(current.prepared.commentPicture(current.node,root,"full").image?._url)
        .bytes().toString(),"https://userpic.example.invalid/951/900999");
    await f.admin.query(`DELETE FROM ${f.table(f.c,"userpic2")}
        WHERE userid=900999 AND picid=951`);
    current=await selected();
    assert.equal(current.prepared.commentPicture(current.node,root,"full").hasPicture,false);
}));

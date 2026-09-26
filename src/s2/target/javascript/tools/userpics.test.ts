// userpics.test.ts
//
// Retained native userpic helpers and owner-scoped source mapping qualification.
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
import {spawnSync} from "node:child_process";
import path from "node:path";
import {UserpicSelection} from "../live/domain/userpics";
import {callbacks} from "../live/render/builtins";
import {prepareUserpic} from "../live/render/prepare";
import {approveSnapshot} from "../live/policy/cohort";
import {config,capabilities,snapshot,now} from "../live/tests/fixtures";
import type {RawUserpics} from "../live/contracts";
import type {RenderInput} from "../live/render/types";

const raw: RawUserpics = {pictures:[
    {userid:900001,picid:11,width:100,height:80,state:"N",description:'café & "tea"'},
    {userid:900001,picid:22,width:75,height:90,state:"N",description:"selected"}],
    mappings:[{mapid:1,keyword:"chosen",picid:22,redirectMapid:null},
        {mapid:2,keyword:null,picid:null,redirectMapid:1},
        {mapid:3,keyword:null,picid:null,redirectMapid:4},
        {mapid:4,keyword:null,picid:null,redirectMapid:3},
        {mapid:5,keyword:null,picid:22,redirectMapid:null},
        {mapid:6,keyword:null,picid:null,redirectMapid:null}]};

const cases: {id:string;props:Record<string,string|null>;version?:number;state?:string;description?:string}[] = [
    {id:"default",props:{}}, {id:"keyword",props:{picture_mapid:"1"}},
    {id:"missing",props:{picture_mapid:"9"}}, {id:"leading-map",props:{picture_mapid:"01"}}, {id:"redirect",props:{picture_mapid:"2"}},
    {id:"loop",props:{picture_mapid:"3"}}, {id:"null-keyword",props:{picture_mapid:"5"}},
    {id:"null-picture",props:{picture_mapid:"6"}},
    {id:"pic-number",props:{picture_keyword:"pic#22"},version:8},
    {id:"unknown-keyword",props:{picture_keyword:"absent"},version:8},
    {id:"leading-pic",props:{picture_keyword:"pic#022"},version:8},
    {id:"empty-keyword",props:{picture_keyword:""},version:8},
    {id:"default-description-zero",props:{},description:"0"}, {id:"default-X",props:{},state:"X"}, {id:"default-S",props:{},state:"S"},
    {id:"default-missing",props:{},state:"missing"}];

test("source userpic defaults, keyword redirects, skeleton and escaped labels match retained helpers",()=>{
    const result=spawnSync("perl",[path.resolve(__dirname,"../../tools/userpic-native.pl")],
        {encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const native=JSON.parse(result.stdout);assert.equal(native.length,cases.length);
    const journal={...approveSnapshot(snapshot(),config,capabilities),userid:900001,username:"ordinary7"};
    const input:RenderInput={journal,config,page:{kind:"recent",pageSkip:0,itemshow:20,maxScrollback:100,hasPrevious:false},
        skip:0,skipPresent:false,nowSeconds:now,formChallenge:"inert",uniq:"inert",resourceTimes:{}};
    for(const [index,item] of cases.entries()){
        const value=structuredClone(raw);
        const pictures=item.state==="missing"?value.pictures.filter(p=>p.picid!==11):
            value.pictures.map(p=>p.picid===11?{...p,state:item.state??"N",description:item.description??p.description}:p);
        const selector=new UserpicSelection({...value,pictures},900001,11,item.version??10);
        const picture=selector.forEntry(item.props);
        assert.ok(picture);const image=prepareUserpic(input,picture);
        assert.deepEqual({id:item.id,picid:picture.picid,keyword:picture.keyword,width:image.width,height:image.height,
            alt:image.alttext,title:image.extra.title,url:image.url},native[index]);
    }
});

test("owner collisions, invalid map domains and bounded inventory cannot authorize another picture",()=>{
    assert.throws(()=>new UserpicSelection({...raw,pictures:[{...raw.pictures[0]!,userid:2}]},900001,11,10));
    assert.throws(()=>new UserpicSelection({...raw,mappings:Array(10001).fill(raw.mappings[0])},900001,11,10));
    const selector=new UserpicSelection(raw,900001,11,10);
    assert.throws(()=>selector.forEntry({picture_mapid:"2abc"}));
    for(const state of ["X","S"]){
        const value={...raw,pictures:raw.pictures.map(p=>p.picid===22?{...p,state}:p)};
        assert.equal(new UserpicSelection(value,900001,11,10).forEntry({picture_mapid:"1"})!.picid,11);
    }
});

test("htmlattr preserves native empty, name and escaped scalar behavior",()=>{
    const cases = [["HEIGHT",0],["width",75],["title",""],["title",'café & "tea"'],
        ["data-x","x"],["onclick2","x"],["","x"],["TITLE","<>'"]];
    const native = spawnSync("perl",["-I"+process.env.LJHOME+"/cgi-bin","-e",
        "require 'ljlib.pl'; require LJ::S2; use JSON::PP; my $rows=decode_json($ARGV[0]); print encode_json([map {S2::Builtin::LJ::htmlattr(undef,@$_)} @$rows]);",
        JSON.stringify(cases)],{encoding:"utf8",timeout:10000});
    assert.equal(native.status,0,native.stderr);
    const callback = callbacks({},{})._htmlattr!;
    assert.deepEqual(cases.map(([name,value])=>callback(null as any,name,value)),JSON.parse(native.stdout));
});

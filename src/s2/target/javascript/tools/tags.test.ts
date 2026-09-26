// tags.test.ts
//
// Native tag projection, byte URLs and deterministic stock cutoff qualification.
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
import {approveTags} from "../live/domain/tags";
import {prepareTag,prepareTagDetail} from "../live/render/prepare";
import {callbacks} from "../live/render/builtins";
import {Context} from "../runtime/s2runtime";
import {approveSnapshot} from "../live/policy/cohort";
import {snapshot,config,capabilities} from "../live/tests/fixtures";
import {createRedirectAdmission} from "../live/policy/redirects";

const base="https://app.synthetic.invalid/~ordinary_tag";
test("retained helper public masks, selected taxonomy independence and native byte scalars",()=>{
    const result=spawnSync("perl",[path.resolve(__dirname,"../../tools/tags-native.pl")],{encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);const native=JSON.parse(result.stdout);
    assert.equal(native.viewerCanManageTags,0);
    assert.deepEqual(native.nativeTiedCutoff,[["z"],["a"]]); // Source preserves incoming hash/cache tie order.
    assert.equal(callbacks({},{})._viewer_can_manage_tags!(new Context([],()=>{})),false);
    const definitions=[
        {kwid:1,parentkwid:null,display:true,name:"public"},
        {kwid:2,parentkwid:null,display:true,name:"private-summary-public-association"},
        {kwid:3,parentkwid:null,display:false,name:"display-off"},
        {kwid:4,parentkwid:null,display:true,name:"NEVER_PROJECT_PRIVATE_TAXONOMY"}];
    const summaries=[{kwid:1,security:"9223372036854775808",count:3},{kwid:1,security:"0",count:7},
        {kwid:2,security:"0",count:4},{kwid:3,security:"9223372036854775808",count:2},{kwid:4,security:"0",count:3}];
    const associations=[1,2,3].map(kwid=>({jitemid:300,kwid}));
    const projected=approveTags({definitions,summaries,associations},[300],true);
    const simple=(tag:any)=>({_id:tag._id,_type:tag._type,name:tag.name,url:tag.url});
    assert.deepEqual(projected.entries.get(300)!.map(tag=>prepareTag(tag,base)).sort((a,b)=>
        Buffer.compare(Buffer.from(a.name),Buffer.from(b.name))).map(simple),native.selectedTagObjects.map((tag:any)=>({...tag,_id:Number(tag._id)})));
    assert.deepEqual(projected.sidebar.map(tag=>{const value=prepareTagDetail(tag,base);
        return {...simple(value),use_count:value.use_count,security_counts:value.security_counts,visibility:value.visibility};}),native.sidebar);
    const maskRaw={definitions:[1,2,3,4,5].map(kwid=>({kwid,parentkwid:null,display:true,name:"mask"+kwid})),
        summaries:[{kwid:1,security:"9223372036854775808",count:0},{kwid:2,security:"1",count:2},
            {kwid:3,security:"2",count:3},{kwid:4,security:"0",count:4},
            {kwid:5,security:"9223372036854775808",count:5},{kwid:5,security:"0",count:7}],associations:[]};
    assert.deepEqual(approveTags(maskRaw,[],true).sidebar.map(tag=>[tag.id,tag.count]),[[1,0],[5,5]]);
    assert.equal(native.maskTaxonomy[1].security_level,"public");assert.equal(native.maskTaxonomy[1].security.public,0);
    assert.equal(native.maskTaxonomy[2].security_level,"protected");assert.equal(native.maskTaxonomy[3].security_level,"group");
    assert.equal(native.maskTaxonomy[4].security_level,"private");assert.equal(native.maskTaxonomy[5].security.public,5);
    for(const row of native.urlRows.filter((row:any)=>row.representation==="native-db-bytes")){
        const value=prepareTag({id:9,name:row.input},base);
        assert.equal(value.url,row.url,row.input);assert.equal(Buffer.from(value.name).toString("hex"),row.escapedNameHex);
    }
    assert.deepEqual(["z","😀","\uE000","&"].map(name=>prepareTag({id:9,name},base)).sort((a,b)=>
        Buffer.compare(Buffer.from(a.name),Buffer.from(b.name))).map(tag=>Buffer.from(tag.name).toString("hex")),native.byteSortedNamesHex);
    assert.deepEqual(native.disabledTagInput,{});assert.equal(native.disabledHookTagList[0].name,"HOOK_WHILE_DISABLED");
    assert.deepEqual(approveTags({definitions,summaries,associations},[300],false).entries.get(300),[]);
    assert.equal(native.scalars[0].tag,null);assert.equal(native.scalars[0].detail.name,"0");assert.equal(native.scalars[0].detail.url,null);
    assert.equal(native.scalars[1].tag,null);assert.equal(native.scalars[1].detail,null);
    assert.equal(native.missingTaxonomy["11 300"][2],null);assert.equal(native.missingTaxonomy["11 300"][3],null);
    for(const invalid of ["", "0"]){
        assert.throws(()=>approveTags({definitions:[{...definitions[0]!,name:invalid}],summaries:[summaries[0]!],associations:[]},[],true));
        assert.throws(()=>approveTags({definitions:[{...definitions[0]!,name:invalid}],summaries:[],
        associations:[{jitemid:300,kwid:1}]},[300],true));}
    assert.throws(()=>approveTags({definitions:[],summaries:[],associations:[{jitemid:300,kwid:9}]},[300],true));
    assert.throws(()=>approveTags({definitions:[{...definitions[0]!,kwid:0}],summaries:[],associations:[]},[],true));
});

test("cutoff ties use escaped UTF8 bytes and hook guard follows actual selected TagList",()=>{
    const page={}, ctx=new Context([],()=>{}), tags=Array.from({length:52},(_,id)=>prepareTagDetail({id:id+1,
        name:id<50?"tag"+String(id).padStart(2,"0"):id===50?"\uE000":"😀",count:1},base));
    const callback=callbacks(page,{visible_tags:tags})._Page__visible_tag_list!;
    assert.equal((callback(ctx,page,50) as any[]).length,50);
    assert.deepEqual(callback(ctx,page,50),callback(ctx,page,50));
    const boundary=callbacks(page,{visible_tags:tags.slice(50).reverse()})._Page__visible_tag_list!;
    assert.equal((boundary(ctx,page,1) as any[])[0].name,"\uE000");
    assert.throws(()=>approveSnapshot(snapshot(),{...config,tagsEnabled:false,tagListHookConfigured:true},capabilities));
    const empty={...snapshot(),entries:[],selection:{...snapshot().selection,window:[],selectedJitemids:[]}};
    assert.doesNotThrow(()=>approveSnapshot(empty as any,{...config,tagsEnabled:false,tagListHookConfigured:true},capabilities));
});

test("only canonical bounded tag-nav key extends retained go redirects",()=>{
    const admit=createRedirectAdmission(config), request={method:"GET",host:"localhost:8081",origin:null,
        hasAuthorization:false,hasForwardedHeaders:false,cookieHeader:null};
    const target="/go?dir=next&itemid=384&journal=ordinary6&redir_key="+encodeURIComponent("café & 😀");
    assert.deepEqual(admit({...request,rawTarget:target}),{kind:"redirect",status:307,location:config.canonicalAppOrigin+target});
    for(const key of ["%00","%0A","%ff","%2f","x&extra=1"]){
        assert.deepEqual(admit({...request,rawTarget:"/go?dir=next&itemid=384&journal=ordinary6&redir_key="+key}),{kind:"reject"});}
});

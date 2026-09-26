// links.test.ts
//
// Native escaped link serialization and owner-scoped flat ordering.
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
import {cleanTrustedSafeChunk} from "../runtime/s2runtime";
import {escapeHtml} from "../live/render/builtins";
import {approveLinks,navigationUrl} from "../live/domain/links";

test("reached ehtml attributes preserve retained one-decode bytes and refuse active destinations",()=>{
    const result=spawnSync("perl",[path.resolve(__dirname,"../../tools/links-native.pl")],{encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const parsed=JSON.parse(result.stdout);
    const objects=approveLinks([
        {ordernum:2,parentnum:0,title:"second",url:"/relative?q=1&x=2",hover:null},
        {ordernum:1,parentnum:0,title:"heading",url:null,hover:null},
        {ordernum:2,parentnum:7,title:"tie",url:"?q=&#39;",hover:"A 'quote' & tea"},
        {ordernum:3,parentnum:0,title:"-",url:"0",hover:null}]);
    assert.deepEqual(objects.map(link=>({_type:"UserLink",is_heading:Number(link.isHeading),
        title:escapeHtml(link.title),url:escapeHtml(link.url),hover:escapeHtml(link.hover),children:[]})),parsed.objects);
    const native=parsed.rows;
    assert.equal(native.length,16);
    for(const row of native){
        if(["javascript","spaced-script","nul-script","vbscript","about","data","title-scheme"].includes(row.id)){
            assert.throws(()=>cleanTrustedSafeChunk(row.input),row.id);
            if(row.id!=="title-scheme")assert.throws(()=>navigationUrl(row.url),row.id);
        }else{
            assert.equal(cleanTrustedSafeChunk(row.input),row.output,row.id);
            assert.equal(navigationUrl(row.url),row.url);
        }
    }
    for(const value of ['<a href="&#x6a;avascript:1">x</a>','<a href="&Tab;javascript:1">x</a>',
        '<a href="javascript&colon;1">x</a>','<a href="data:text/html,x">x</a>','<a href="/path\u00a0gap">x</a>'])assert.throws(()=>cleanTrustedSafeChunk(value));
});

test("flat native links preserve stable ties, false URLs and dash separators",()=>{
    const row=(ordernum:number,title:string,url:string|null)=>({ordernum,parentnum:7,title,url,hover:null});
    const rows=[row(2,"second","/relative?q=1&x=2"),row(1,"heading",null),row(2,"tie","?q=&#39;"),row(3,"-","0")];
    assert.deepEqual(approveLinks(rows),[
        {title:"heading",url:"",hover:"",isHeading:true},
        {title:"second",url:"/relative?q=1&x=2",hover:"",isHeading:false},
        {title:"tie",url:"?q=&#39;",hover:"",isHeading:false},
        {title:"",url:"0",hover:"",isHeading:true}]);
    assert.throws(()=>approveLinks(Array(10001).fill(rows[0])));
});

// crossposts.test.ts
//
// Independent network Storable crosspost bytes and finite rejection boundaries.
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
import {resolve} from "node:path";
import {decodeCrosspostLinks,approveCrosspostUrls,opaqueCrosspostBytes} from "../live/domain/crossposts";
import {decodeLegacyBytes} from "../live/data/legacy-text";

function nativeCrossposts(): any {
    const result=spawnSync("perl",[resolve(__dirname,"../../tools/crossposts-native.pl")],
        {encoding:"utf8",timeout:10000,env:{...process.env,PERL_HASH_SEED:"0",PERL_PERTURB_KEYS:"0"}});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test("21 independent native network2.11/helper cases and named representation differences",()=>{
    const native=nativeCrossposts();assert.equal(native.rows.length,21);
    assert.deepEqual(native.magic,{hdrsize:2,major:2,minor:11,netorder:1,version:"2.11",version_nv:"2.011"});
    const expected:Record<string,string[]>={empty:[],simple:["https://example.test/123"],
        two:["https://example.test/123","/relative?q=a&b=c"],unicode:["https://example.test/café/🙂"],
        quote:["https://example.test/a'"],entity:["https://example.test/a?x=&quot;&y=<a>"],false:[],
        feature:["https://example.test/café/🙂","/relative?q=a&b=c",
            "https://example.test/a?x=&quot;&y=<a>","https://example.test/a'"],
        long:["https://example.test/"+"x".repeat(260)],utf8bytes:["https://example.test/café/🙂"],
        longutf8:["https://example.test/"+"🙂".repeat(70)]};
    for(const row of native.rows){
        const base64=Buffer.from(row.hex,"hex").toString("base64");
        if(Object.hasOwn(expected,row.id))assert.deepEqual(decodeCrosspostLinks(base64),expected[row.id],row.id);
        else assert.throws(()=>decodeCrosspostLinks(base64),row.id);
    }
    const simple=native.rows.find((row:any)=>row.id==="simple");
    assert.equal(simple.hex,"050b03000000010403000000020a1868747470733a2f2f6578616d706c652e746573742f3132330000000375726c08fb000000066974656d69640000000131");
    assert.equal(Buffer.from(simple.nativeHtmlHex,"hex").toString(),"<a href='https://example.test/123'>https://example.test/123</a>");
    assert.equal(native.rows.find((row:any)=>row.id==="false").nativeXpostPresent,false);
    assert.equal(native.rows.find((row:any)=>row.id==="trailing").nativeThawAccepted,true);
    assert.equal(native.rows.find((row:any)=>row.id==="truncated").nativeThawAccepted,false);
    assert.match(native.rows.find((row:any)=>row.id==="arrayvalue").nativeError,/Not a HASH reference/);
    assert.equal(native.rows.find((row:any)=>row.id==="alias").nativeXpostPresent,true);
    const unicode=native.rows.find((row:any)=>row.id==="unicode");
    assert.equal(unicode.nativeHtmlHex,native.rows.find((row:any)=>row.id==="utf8bytes").nativeHtmlHex);
});
test("finite byte/depth/count/duplicate/opcode/full-consumption and URL safety bounds",()=>{
    const native=nativeCrossposts();
    const original=Buffer.from(native.rows.find((row:any)=>row.id==="simple").hex,"hex");
    const rejects=(bytes:Buffer)=>assert.throws(()=>decodeCrosspostLinks(bytes.toString("base64")));
    for(const [offset,value] of [[0,4],[1,10],[2,25],[7,0],[8,2],[12,17]] as const){
        const bytes=Buffer.from(original);bytes[offset]=value;rejects(bytes);
    }
    for(const count of [-1,2147483647]){const bytes=Buffer.from(original);bytes.writeInt32BE(count,3);rejects(bytes);}
    const duplicate=Buffer.from(native.rows.find((row:any)=>row.id==="two").hex,"hex");
    const key=duplicate.indexOf(Buffer.from("0000000132","hex"));assert.ok(key>0);duplicate[key+4]=49;rejects(duplicate);
    for(let size=0;size<original.length;size++)rejects(original.subarray(0,size));
    rejects(Buffer.concat([original,Buffer.from([0])]));
    assert.throws(()=>decodeCrosspostLinks(original.toString("base64")+"\n"));
    assert.throws(()=>opaqueCrosspostBytes(Buffer.alloc(8193).toString("base64")));
    assert.deepEqual(opaqueCrosspostBytes("/w=="),Buffer.from([255]),"opaque is not a second decoder");
    assert.deepEqual(decodeLegacyBytes("C3BF","FF","C3BF",24576,8192).originalBytes,Buffer.from([255]));
    assert.throws(()=>decodeLegacyBytes("C3BF","FF","3F",24576,8192));
    const two=native.rows.find((row:any)=>row.id==="two");
    assert.deepEqual(approveCrosspostUrls(Buffer.from(two.hex,"hex").toString("base64"),
        "https://journal.test/~ordinary/384.html"),["https://example.test/123","/relative?q=a&b=c"]);
});

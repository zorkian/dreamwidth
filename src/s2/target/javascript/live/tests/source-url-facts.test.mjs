// source-url-facts.test.mjs
//
// Actual cleaner and native source URL-map/canonical username facts.
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
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import test from "node:test";
const require = createRequire(import.meta.url);
const {createEntryCleaner} = require(resolve("../../../content/dist"));
const limits = {maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,
    maxCssBytes:65536,maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const context = {
    policy:"dreamwidth-entry-html-raw0-v1",insertionContext:"html-div-flow",
    documentUrl:"http://app.example/~journal/",entryUrl:"http://app.example/~journal/512.html",
    journalUsername:"journal",journalId:7,entryId:512,cuts:"source-compatible-recent",
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,
        maxImageHeight:null,placeholderUndefinedImageSize:false,extractImages:false},
    imagePlaceholder:{src:"/img/placeholder.png",width:35,height:35,alt:"Image",title:"Image"},
    urls:{siteDomain:"",knownHttpsSites:[],formDomainBanned:[],imageProxy:"not-configured"},
};
function clean(cleaner, body, changes = {}) {
    return cleaner.clean({body,format:"html_raw0",context:{...context,...changes}});
}

test("exact source map case survives admission and matches retained image/form decisions", () => {
    const cases=[];
    for (const host of ["example.com","EXAMPLE.COM","Example.com"]) {
        for (const key of ["example.com","EXAMPLE.COM","Example.com"]) {
            for (const siteDomain of ["",key]) {
                cases.push({url:`http://${host}/image.png`,siteDomain,known:[key],banned:[key]});
            }
        }
    }
    cases.push({url:"http://unrelated.org/image.png",siteDomain:"",known:["EXAMPLE.COM","example.com"],banned:[]});
    const native = spawnSync("perl", ["live/tests/source-url-facts.pl"], {
        input:JSON.stringify(cases),encoding:"utf8",timeout:10000,maxBuffer:1024*1024,
    });
    assert.equal(native.status,0,native.stderr);
    const expected=JSON.parse(native.stdout);
    assert.equal(expected.length,cases.length);
    const cleaner=createEntryCleaner(limits);
    try {
        cases.forEach((row,index) => {
            const actual=clean(cleaner,`<img src="${row.url}"><form action="${row.url}"><p>form</p></form>`,{
                urls:{siteDomain:row.siteDomain,knownHttpsSites:row.known,
                    formDomainBanned:row.banned,imageProxy:"not-configured"},
            });
            assert.equal(actual.kind,"ok",JSON.stringify(row));
            assert.ok(actual.fragment.html.includes(`src="${expected[index].image}"`),JSON.stringify(row));
            if (expected[index].action === null) assert.ok(!actual.fragment.html.includes("action="),JSON.stringify(row));
            else assert.ok(actual.fragment.html.includes(`action="${expected[index].action}"`),JSON.stringify(row));
        });
        assert.equal(expected[0].image,"https://example.com/image.png");
        // A matching uppercase image domain/key upgrades; a mixed-case mismatch
        // does not. Forms lowercase the operand, so uppercase-only keys are dead.
        const upper=cases.findIndex(x=>x.url.includes("EXAMPLE.COM") && x.known[0]==="EXAMPLE.COM" && x.siteDomain==="");
        assert.equal(expected[upper].image,"https://EXAMPLE.COM/image.png");
        assert.equal(expected[upper].action,"http://EXAMPLE.COM/image.png");
        assert.equal(expected.at(-1).image,"http://unrelated.org/image.png");
        for (const keys of [["a.com","a.com"],["z.com","a.com"],["user@a.com"],
            ["a.com/path"],["a.com?x"],["a.com#x"],["a com"],["//a.com"]]) {
            const output=clean(cleaner,"<p>unchanged bounds</p>",{
                urls:{...context.urls,knownHttpsSites:keys},
            });
            assert.deepEqual(output,{kind:"failure",reason:"unsupported"},JSON.stringify(keys));
        }
    } finally {cleaner.close();}
});

test("canonical digit/underscore names retain finite safe cut IDs and full-entry bodies", () => {
    const cleaner=createEntryCleaner(limits);
    try {
        for (const name of ["7journal","_journal","a".repeat(25)]) {
            const entryUrl=`http://app.example/~${name}/512.html`;
            const recent=clean(cleaner,'<p>shown</p><lj-cut text="more"><p>hidden</p></lj-cut>',{
                journalUsername:name,entryUrl,
            });
            assert.equal(recent.kind,"ok",name);
            assert.ok(recent.fragment.html.includes(`id="span-cuttag_${name}_512_1"`));
            assert.ok(recent.fragment.html.includes(`href="${entryUrl}#cutid1"`));
            assert.ok(!recent.fragment.html.includes("hidden"));
            const full=clean(cleaner,'<lj-cut><p>visible</p></lj-cut>',{
                journalUsername:name,entryUrl,cuts:"source-compatible-entry",
            });
            assert.equal(full.kind,"ok",name);
            assert.equal(full.fragment.html,'<a name="cutid1"></a><p>visible</p>');
        }
        for (const name of ["", "a".repeat(26), "UPPER", "hy-phen", "a/b", "é", "a b", "a?b"]) {
            assert.deepEqual(clean(cleaner,"<p>body</p>",{journalUsername:name}),
                {kind:"failure",reason:"unsupported"},name);
        }
    } finally {cleaner.close();}
});

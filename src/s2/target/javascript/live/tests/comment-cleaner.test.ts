// comment-cleaner.test.ts
//
// Retained registered/anonymous comment cleaner context and safety differences.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {EntryContentContext,CommentContentInput} from '@dreamwidth/content/contracts';
import {config} from './fixtures';
const {createEntryCleaner}=require(resolve(__dirname,'../../../../../../content/dist')) as typeof import('@dreamwidth/content');
const {JSDOM}=require(resolve(__dirname,'../../../../../../content/node_modules/jsdom'));
const context:EntryContentContext={policy:'dreamwidth-entry-html-raw0-v1',insertionContext:'html-div-flow',
    documentUrl:'http://localhost:8080/~s2js_slice3/384.html',entryUrl:'http://localhost:8080/~s2js_slice3/384.html',
    journalUsername:'s2js_slice3',journalId:6,entryId:384,cuts:'source-compatible-entry',...config.entryContent,
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,maxImageHeight:null,
        placeholderUndefinedImageSize:false,extractImages:false}};
const limits={maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,maxCssBytes:65536,
    maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const cases:readonly {body:string;formatting:CommentContentInput['formatting'];anonymous:boolean}[]=[
    {body:'<b class="source" id="source" style="color:red">Text</b> <a href="https://example.invalid/">Link</a>',formatting:'html_raw0',anonymous:false},
    {body:'<b style="color:red">Text</b> <a href="https://example.invalid/">Link</a>',formatting:'html_raw0',anonymous:true},
    {body:'one\ntwo\nhttps://example.invalid/x',formatting:'html_casual0',anonymous:false},
    {body:'one\ntwo\nhttps://example.invalid/x',formatting:'html_casual1',anonymous:true},
    {body:'!markdown\n# Heading',formatting:'html_casual1',anonymous:false},
    {body:'<pre>\nX</pre>',formatting:'html_raw0',anonymous:false},
    {body:'<table><tr><td>Cell</td></tr></table>',formatting:'html_raw0',anonymous:false},
    {body:'<font>Gone</font><table><tr><td>Gone</td></tr></table>Kept',formatting:'html_raw0',anonymous:true},
    {body:'<b style="color:red;position:relative">Text</b>',formatting:'html_raw0',anonymous:false},
    {body:'<b style="color:red;margin:5px;height:10px">Text</b>',formatting:'html_raw0',anonymous:false},
    {body:'<a href="  /rel  ">Relative</a>',formatting:'html_raw0',anonymous:true},
    {body:'<a>Missing</a>',formatting:'html_raw0',anonymous:true},
    {body:'<a href="javascript:bad()">Screened</a>',formatting:'html_raw0',anonymous:true},
];

test('comment context retains native trust, breaks, strong CSS and anonymous extraction',()=>{
    const native=spawnSync('perl',[resolve(__dirname,'../../../tools/native-comments.pl'),'--clean'],{
        input:JSON.stringify(cases.map(row=>({body:row.body,options:{editor:row.formatting,
            anon_comment:row.anonymous?1:0,nocss:row.anonymous?1:0}}))),encoding:'utf8',timeout:10000,
        env:{...process.env,PERL_HASH_SEED:'0',PERL_PERTURB_KEYS:'0'}});
    assert.equal(native.status,0,native.stderr);
    const outputs=JSON.parse(native.stdout) as string[];assert.equal(outputs.length,cases.length);
    const cleaner=createEntryCleaner(limits);
    try {
        for(let index=0;index<cases.length;index++) {
            const row=cases[index]!;
            const result=cleaner.comment({...row,context});assert.equal(result.kind,'ok',JSON.stringify(result));
            if(result.kind!=='ok')throw Error('Missing comment output');
            const original=new JSDOM(outputs[index]),candidate=new JSDOM(result.html);
            try {
                assert.equal(candidate.window.document.body.textContent,original.window.document.body.textContent,String(index));
                for(const selector of ['table','pre','b','br','a'])assert.equal(
                    candidate.window.document.querySelectorAll(selector).length,
                    original.window.document.querySelectorAll(selector).length,`${index} ${selector}`);
                assert.deepEqual([...candidate.window.document.querySelectorAll('a')].map((a:any)=>a.getAttribute('href')),
                    [...original.window.document.querySelectorAll('a')].map((a:any)=>a.getAttribute('href')));
                assert.equal(candidate.window.document.querySelectorAll('[id],[class]').length,0);
                const before=original.window.document.querySelector('b'),after=candidate.window.document.querySelector('b');
                if(before&&after)for(const property of ['color','position','margin','height'])
                    assert.equal(after.style.getPropertyValue(property),before.style.getPropertyValue(property),`${index} ${property}`);
            }finally {original.window.close();candidate.window.close();}
        }
        for(const body of ['@someone','x \\@someone','<lj user="someone">']) {
            const result=cleaner.comment({body,formatting:'html_casual1',anonymous:false,context});
            if(body==='x \\@someone')assert.equal(result.kind,'ok');
            else assert.equal(result.kind,'failure',body);
        }
        // The maintained sanitizer removes the entire active script, rather
        // than preserving its native deny-mode inner text as visible prose.
        assert.deepEqual(cleaner.comment({body:'<script>bad()</script>',formatting:'html_casual1',
            anonymous:false,context}),{kind:'ok',html:''});
    }finally {cleaner.close();}
});

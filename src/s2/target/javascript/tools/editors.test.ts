// editors.test.ts
//
// Retained entry format precedence and original-source cleaner qualification.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {entryBodyFormat} from '../live/policy/cohort';
import {config} from '../live/tests/fixtures';
import type {EntryContentContext} from '@dreamwidth/content/contracts';
const {createEntryCleaner}=require(resolve(__dirname,'../../../../../content/dist')) as typeof import('@dreamwidth/content');
const limits={maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,maxCssBytes:65536,
    maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const context:EntryContentContext={policy:'dreamwidth-entry-html-raw0-v1',insertionContext:'html-div-flow',
    documentUrl:'https://app.invalid/~synthetic/384.html',entryUrl:'https://app.invalid/~synthetic/384.html',
    journalUsername:'synthetic',journalId:11,entryId:384,cuts:'source-compatible-entry',...config.entryContent,
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,maxImageHeight:null,
        placeholderUndefinedImageSize:false,extractImages:false}};
test('31 native entry-format and independent OG records retain original context',()=>{
    const root=resolve(__dirname,'../../../../../..');
    const oracle=spawnSync('perl',[resolve(root,'src/s2/target/javascript/tools/editors-native.pl')],
        {cwd:root,env:{...process.env,LJHOME:root},encoding:'utf8',timeout:10000,maxBuffer:262144});
    assert.equal(oracle.status,0,oracle.stderr);assert.equal(oracle.stderr,'');
    const rows=JSON.parse(oracle.stdout);assert.equal(rows.length,31);
    // Fixed browser-equivalent HTML5 BR/entity spelling, not normalized outputs.
    const raw='a\nhttp://example.invalid/?a=1&amp;b=2\nmail@example.invalid\n';
    const casual='a<br><a href="http://example.invalid/?a=1&amp;b=2">http://example.invalid/?a=1&amp;b=2</a><br>mail@example.invalid<br>';
    const display:Record<string,string>={magic_raw:'!markdown\n**bold**\nnext',crlf:'a<br>b\rc<br>',
        pre:'<pre>\nhttp://example.invalid/\\@x\n</pre>',code:'<code>a<br>\\@x</code>',
        textarea:'<textarea>\n\\@x\n</textarea>',mentions0:'x @name',escaped:'x@name',
        email:'mail@example.invalid',cut:'a<br><a name="cutid1"></a>hidden<br><b>x</b><br>after',false_body:'0'};
    const cleaner=createEntryCleaner(limits);
    try {
        for(const row of rows){
            const refused=['invalid_truthy','magic_missing','markdown_alias'].includes(row.id);
            if(refused){assert.throws(()=>entryBodyFormat(row.source,row.props,row.logtime),row.id);continue;}
            const format=entryBodyFormat(row.source,row.props,row.logtime);
            const expected=row.entry.format_calls[0];
            assert.equal(format,expected==='rte0'?'html_casual1':expected??'html_raw0',row.id);
            const input={body:row.source,format,context};
            const displayed=cleaner.clean(input);
            if(row.entry.mentions.length){assert.deepEqual(displayed,{kind:'failure',reason:'unsupported'},row.id);continue;}
            assert.equal(displayed.kind,'ok',row.id+': '+JSON.stringify(displayed));
            if(displayed.kind==='ok')assert.equal(displayed.fragment.html,display[row.id]??(format==='html_raw0'?raw:casual),row.id);
            const metadata=cleaner.metadata({subject:'Title',entry:input});
            if(row.metadata.mentions.length||['magic_raw','escaped'].includes(row.id)){
                assert.deepEqual(metadata,{kind:'failure',reason:'unsupported'},row.id+' metadata');
            }else{
                assert.equal(metadata.kind,'ok',row.id+' metadata');
                if(metadata.kind==='ok')assert.equal(metadata.metadata.eventText,row.metadata.output,row.id+' independent helper');
            }
        }
        const recent=cleaner.clean({body:'a\n<lj-cut text="More">hidden @name</lj-cut>\nafter',
            format:'html_casual1',context:{...context,cuts:'source-compatible-recent'}});
        assert.equal(recent.kind,'ok');
        if(recent.kind==='ok'){
            assert.ok(!recent.fragment.html.includes('hidden'));
            assert.ok(recent.fragment.html.includes('id="span-cuttag_synthetic_384_1"'));
            assert.ok(recent.fragment.html.includes('id="div-cuttag_synthetic_384_1"'));
            assert.ok(recent.fragment.html.includes('href="https://app.invalid/~synthetic/384.html#cutid1"'));
        }
        // Unsupported format work is unreachable for native Perl-false bodies.
        for(const body of ['', '0'])assert.equal(entryBodyFormat(body,{editor:'markdown0'},'2026-01-01 00:00:00'),'html_raw0');
        assert.equal(entryBodyFormat('x',{import_source:''},'2026-01-01 00:00:00'),'html_casual0');
        assert.equal(entryBodyFormat('x',{import_source:'0'},'2026-01-01 00:00:00'),'html_casual0');
    }finally{cleaner.close();}
});

test('native support-auth scalar removal binds original hashes and stripped parser locations',()=>{
    const root=resolve(__dirname,'../../../../../..');
    const oracle=spawnSync('perl',[resolve(root,'src/s2/target/javascript/tools/editors-native.pl'),'--request-auth'],
        {cwd:root,env:{...process.env,LJHOME:root},encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.equal(oracle.status,0,oracle.stderr);assert.equal(oracle.stderr,'');
    const rows=JSON.parse(oracle.stdout);assert.equal(rows.length,21);
    const {stripRequestAuth}=require(resolve(root,'src/content/dist/policy/request-auth')) as {stripRequestAuth:(s:string)=>string};
    const {inputHash}=require(resolve(root,'src/content/dist/policy/validation')) as {inputHash:(v:unknown)=>string};
    for(const row of rows.filter((r:any)=>r.kind==='scalar'))assert.equal(stripRequestAuth(row.source),row.output);
    const token='SYNTH_TOKEN',url='https://example.invalid/see_request?id=1&auth='+token+'&more=1';
    const safe='https://example.invalid/see_request?id=1&more=1',source='<a href="'+url+'">'+url+'</a>';
    const cleaner=createEntryCleaner(limits);
    try {
        for(const format of ['html_raw0','html_casual0','html_casual1'] as const) {
            const input={body:source,format,context};const result=cleaner.clean(input);
            assert.equal(result.kind,'ok');if(result.kind!=='ok')throw Error('Missing auth fragment');
            assert.equal(result.provenance.inputSha256,inputHash(input));
            assert.notEqual(result.provenance.inputSha256,inputHash({...input,body:stripRequestAuth(source)}));
            assert.equal(result.fragment.html,'<a href="https://example.invalid/see_request?id=1&amp;more=1">https://example.invalid/see_request?id=1&amp;more=1</a>');
        }
        const subject=cleaner.subject({source,context});assert.equal(subject.kind,'ok');
        if(subject.kind!=='ok')throw Error('Missing subject');
        assert.equal(subject.subject.all,safe);assert.ok(!subject.subject.html.includes(token));
        for(const mode of ['plain_subject','plain_all']) {
            assert.equal(rows.find((r:any)=>r.mode===mode).output,url,'native no-angle bypass is independent evidence');
        }
        const plain=cleaner.subject({source:url,context});assert.equal(plain.kind,'ok');
        if(plain.kind==='ok')assert.deepEqual({...plain.subject},{html:safe,recentHtml:safe,all:safe});
        const metadata=cleaner.metadata({subject:url,entry:{body:source,format:'html_raw0',context}});
        assert.equal(metadata.kind,'ok');if(metadata.kind==='ok')assert.deepEqual({...metadata.metadata},
            {kind:'inert-entry-metadata',subjectText:safe,eventText:'<a href="https://example.invalid/see_request?id=1&amp;more=1">'+safe+'</a>'});
        for(const anonymous of [false,true]) {
            const result=cleaner.comment({body:source,context,formatting:'html_raw0',anonymous});
            assert.equal(result.kind,'ok');if(result.kind==='ok')assert.ok(!result.html.includes(token));
        }
        const first=cleaner.customtext({source,context});assert.equal(first.kind,'ok');
        if(first.kind!=='ok')throw Error('Missing customtext');
        const second=cleaner.customtext({source:first.html,context});assert.equal(second.kind,'ok');
        assert.ok(!JSON.stringify([first,second]).includes(token));
        for(const row of rows.filter((r:any)=>r.kind==='context'&&!r.mode.startsWith('plain')))
            assert.ok(!row.output.includes(token),row.mode);
        // Removal must not rescue an oversized ORIGINAL source.
        assert.deepEqual(cleaner.clean({body:'see_request?x=1&auth='+'A'.repeat(65536),format:'html_raw0',context}),
            {kind:'failure',reason:'unsupported'});
        assert.deepEqual(cleaner.subject({source:'see_request?x=1&auth='+'A'.repeat(1024),context}),
            {kind:'failure',reason:'unsupported'});
        const encoded=cleaner.clean({body:'see_request?x=1&amp;auth=ENCODED',format:'html_raw0',context});
        assert.equal(encoded.kind,'ok');if(encoded.kind==='ok')assert.equal(encoded.fragment.html,'see_request?x=1&amp;auth=ENCODED');
        // Offline image source spans refer to the stripped parse source; their
        // exchange hash remains bound to the complete original input/context.
        const imageInput={body:url+'<img src="http://img.test/a">',format:'html_raw0' as const,
            context:{...context,urls:{...context.urls,imageProxy:'host-resolved' as const}}};
        const pending=cleaner.clean(imageInput);assert.equal(pending.kind,'image-resolution-required');
        if(pending.kind==='image-resolution-required') {
            assert.equal(pending.images.inputSha256,inputHash(imageInput));
            const request=pending.images.requests[0]!;
            assert.equal(stripRequestAuth(imageInput.body).slice(request.sourceStart,request.sourceEnd),request.sourceText);
            assert.notEqual(imageInput.body.slice(request.sourceStart,request.sourceEnd),request.sourceText);
        }
    } finally {cleaner.close();}
});

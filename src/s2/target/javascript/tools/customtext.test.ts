// customtext.test.ts
//
// Independent native compiled-literal and customtext context qualifications.
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

import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {renderStock} from "../live/render/engine";
import {validateArtifact} from "../live/render/artifact";
import {approveSnapshot} from "../live/policy/cohort";
import type {RenderInput,RenderContentPreparation} from "../live/render/types";
import {resolve} from "node:path";
import {readPropertyLayer} from "../live/domain/property-layer";
import {createEntryCleaner} from "@dreamwidth/content";
import {config,capabilities,snapshot,now} from "../live/tests/fixtures";

test('canonical native wrapper data and original-source customtext',()=>{
    const native=spawnSync('perl',[resolve(__dirname,'../../tools/customtext-native.pl')],{
        encoding:'utf8',timeout:15000,env:{...process.env,PERL_HASH_SEED:'0',PERL_PERTURB_KEYS:'0'}});
    assert.equal(native.status,0,native.stderr);
    const rows=JSON.parse(native.stdout);
    for(const row of rows.filter((row:any)=>row.kind==='wrapper')) {
        assert.deepEqual({...readPropertyLayer(row.compiled,987654)},row.sets);
        for(const bad of [row.compiled+'1;\n',row.compiled.replace('register_layer(987654)','register_layer(2)'),
            row.compiled.replace('"module_customtext_order",13','"module_customtext_order",1 + 2'),
            row.compiled.replace('"module_customtext_order"','"unknown"'),row.compiled.slice(0,-1)]) {
            assert.throws(()=>readPropertyLayer(bad,987654));
        }
    }
    const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT||'artifacts/live/stock.json','utf8')));
    const probe={...artifact,layers:[{...artifact.layers[0]!,code:artifact.layers[0]!.code+
        '\nlayer_0.registerFunction(["RecentPage::print()"], function(){return function(ctx){ctx.print("<html><body>"+JSON.stringify(ctx.prop._module_sections)+"</body></html>");};});'},artifact.layers[1]!]};
    assert.throws(()=>validateArtifact(probe),'instrumentation is not production code');
    const placement=(value:Record<string,any[]>)=>Object.fromEntries(Object.entries(value).filter(([,array])=>array.some(item=>item?.length)).map(([key,array])=>
        [key,array.flatMap((item,index)=>item?.length?[[index,item]]:[])]));
    for(const row of rows.filter((row:any)=>row.kind==='placement')) {
        const journal={...approveSnapshot(snapshot(),config,capabilities),entries:[],customtextProperties:{
            module_customtext_show:1,module_customtext_section:row.section,module_customtext_order:row.order}};
        const input:RenderInput={journal,config,page:{kind:'recent',pageSkip:0,itemshow:20,maxScrollback:100,hasPrevious:false},
            skip:0,skipPresent:false,nowSeconds:now,formChallenge:'test',uniq:'test',resourceTimes:new Proxy({}, {get:()=>1})};
        const content:RenderContentPreparation={subject:()=>{throw Error('unexpected subject');},
            body:()=>{throw Error('unexpected body');},metadata:()=>{throw Error('unexpected metadata');}};
        if(!row.ok)assert.throws(()=>renderStock(probe,input,2097152,content));
        else {
            const html=renderStock(probe,input,2097152,content);
            const value=JSON.parse(html.slice('<html><body>'.length,html.indexOf("<div id='statistics'")));
            assert.deepEqual(placement(value),placement(row.sections),row.section+':'+row.order);
        }
    }
    const cleaner=createEntryCleaner({maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,
        maxCssBytes:65536,maxCssNodes:4096,maxImageCandidates:256,maxCuts:16});
    const clean=(body:string)=>cleaner.customtext({source:body,context:{
        policy:'dreamwidth-entry-html-raw0-v1',insertionContext:'html-div-flow',
        documentUrl:'http://localhost:8080/~ordinary/',entryUrl:'http://localhost:8080/~ordinary/',
        journalUsername:'ordinary',journalId:900001,entryId:1,cuts:'source-compatible-entry',
        ...config.entryContent,reader:{removeColors:false,removeSizes:false,removeFonts:false,
            maxImageWidth:null,maxImageHeight:null,placeholderUndefinedImageSize:false,extractImages:false}}});
    try {
        for(const source of ['\ntext','plain\nline','<pre>a\nb</pre>','mail@example.invalid','\\@name']) {
            const row=rows.find((row:any)=>row.kind==='pipeline'&&row.source===source);
            const result=clean(source);assert.equal(result.kind,'ok');
            if(result.kind==='ok') {
                assert.equal(row.html.output,source==='\ntext'?'<br />text':source==='plain\nline'?'plain<br />line':source==='<pre>a\nb</pre>'?'<pre>a<br />b</pre>':source==='\\@name'?'@name':source);
                assert.equal(result.html,source==='\ntext'?'<br>text':source==='plain\nline'?'plain<br>line':row.html.output);
            }
        }
        for(const source of ['@name','!markdown\n**bold**'])assert.deepEqual(clean(source),{kind:'failure',reason:'unsupported'});
        const first=clean('\\@name');assert.equal(first.kind,'ok');
        if(first.kind==='ok')assert.deepEqual(clean(first.html),{kind:'failure',reason:'unsupported'});
    } finally {cleaner.close();}
});


test('only finalized customtext bytes authorize the separate stock safe chunk',()=>{
    const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT||'artifacts/live/stock.json','utf8')));
    const journal={...approveSnapshot(snapshot(),config,capabilities),entries:[],
        customtextProperties:{module_customtext_show:1},
        customtextStored:{title:'Rich',url:'',content:'<p style="color: red">Custom</p>'}};
    const input:RenderInput={journal,config,page:{kind:'recent',pageSkip:0,itemshow:20,maxScrollback:100,hasPrevious:false},
        skip:0,skipPresent:false,nowSeconds:now,formChallenge:'test',uniq:'test',resourceTimes:new Proxy({}, {get:()=>1})};
    const content:RenderContentPreparation={customtext:value=>value,
        subject:()=>{throw Error('unexpected subject');},body:()=>{throw Error('unexpected body');},
        metadata:()=>{throw Error('unexpected metadata');}};
    // This narrow unit callback stands in for the child cleaner; actual cleaner
    // and stock execution are independently exercised by HTTP fixture tests.
    assert.ok(renderStock(artifact,input,2097152,content).includes(journal.customtextStored.content));
    const sequence:string[]=[];
    const defaults={...input,journal:{...journal,customtextStored:{title:null,url:null,content:'0'},
        customtextProperties:{module_customtext_show:1,text_module_customtext_content:'source'}}};
    const twice={...content,customtext(value:string){sequence.push(value);return value==='source'?'FIRST':'SECOND';}};
    assert.ok(renderStock(artifact,defaults,2097152,twice).includes('SECOND'));
    assert.deepEqual(sequence,['source','FIRST'],'Page cleans actual property result, not raw source again');
    const chunk='ctx.safePrint(s2.runtime.prepareString(__96_p._customtext_content));';
    assert.ok(artifact.layers[0]!.code.includes(chunk));
    for(const value of ['<p style="color: blue">unregistered</p>','<img src="x" onerror="alert(1)">']) {
        const code=artifact.layers[0]!.code.replace(chunk,
            '__96_p._customtext_content='+JSON.stringify(value)+';'+chunk);
        const mutant={...artifact,layers:[{...artifact.layers[0]!,code},artifact.layers[1]!]};
        // Test-only mutant is deliberately NOT valid production artifact code.
        assert.throws(()=>validateArtifact(mutant));
        assert.throws(()=>renderStock(mutant,input,2097152,content));
    }
});

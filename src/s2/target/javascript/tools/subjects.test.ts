// subjects.test.ts
//
// Native subject contexts, stock wrappers and textual current qualification.
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
import type {EntryContentContext, SubjectPreparation} from "@dreamwidth/content/contracts";
import {formatPlainSubject} from "../live/render/builtins";
import {approveSnapshot} from "../live/policy/cohort";
import {snapshot,config,capabilities} from "../live/tests/fixtures";
const {createEntryCleaner}=require(resolve(__dirname,"../../../../../content/dist")) as typeof import("@dreamwidth/content");
const limits={maxInputBytes:65536,maxOutputBytes:2097152,maxNodes:4096,maxDepth:16,
    maxCssBytes:65536,maxCssNodes:4096,maxImageCandidates:256,maxCuts:16};
const context:EntryContentContext={policy:"dreamwidth-entry-html-raw0-v1",insertionContext:"html-div-flow",
    documentUrl:"https://journal.invalid/384.html",entryUrl:"https://journal.invalid/384.html",
    journalUsername:"ordinary",journalId:11,entryId:384,cuts:"source-compatible-entry",...config.entryContent,
    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,maxImageHeight:null,
        placeholderUndefinedImageSize:false,extractImages:false}};
const props={_text_nosubject:"NO SUBJECT",_all_entrysubjects:1,_text_nosubject_screenreader:"HIDDEN"};
const cases=["","0","Plain &amp; &#39; &unknown;","first\nsecond",
    '<b>Bold</b> <i>I</i><u>U</u><em>E</em><strong>S</strong><cite>C</cite>',
    '<a href="https://example.invalid/?x=1&amp;y=2">link &amp; label</a>',
    '<a href="javascript:alert(1)">bad</a>','<a href="data:text/html,x">data</a>',
    '<a href="about:blank">about</a>','<a href="java&#x73;cript:alert(1)">entity</a>',
    '<a href="https://example.invalid/" onclick="alert(1)">event</a>',
    '<font color="red">font</font><script>alert(1)</script>',
    '<style>b{color:red}</style>X','<b style="color:red;font-weight:bold;font-style:italic;text-decoration:underline">X</b>',
    '<b style="position:fixed;z-index:9999">X</b>','<b style="position:absolute;left:0">X</b>',
    '<b style="width:expression(alert(1))">X</b>','<b style="behavior:url(x.htc)">X</b>',
    '<b style="-moz-binding:url(https://asset.invalid/x.xml)">X</b>',
    '<b style="background-image:url(javascript:alert(1))">X</b>',
    '<a href="/relative?q=&quot;x&quot;">R</a>', '\n <b>prefix</b>', '<b>caf&#233; &amp; &#39;</b>',
    '<b style="color:r\\65 d">escaped red</b>', '<b style="position:\\66 ixed;top:0">escaped fixed</b>',
    'Plain "double" &amp;', '<b id="source-control" class="ordinary">named</b>',
    '<style>b{color:red}</style>\n X<b>Y</b>'];
interface Native {source:string;subject:string;all:string;og:string;recent:string;entry:string;currents:Record<string,string>}
function prepared(item:SubjectPreparation):Record<string,unknown>{return {subject:item.html,
    _subject_recent:item.recentHtml,_subject_all:item.all,permalink_url:"https://journal.invalid/384.html"};}
test("fixed native subject/all/current/wrapper records and explicit context corrections",()=>{
    const call=spawnSync("perl",[resolve(__dirname,"../../tools/subjects-native.pl")],
        {input:JSON.stringify(cases),encoding:"utf8",timeout:10000});
    assert.equal(call.status,0,call.stderr);const native=JSON.parse(call.stdout) as Native[];
    const cleaner=createEntryCleaner(limits);
    try{for(const [index,source] of cases.entries()){
        const result=cleaner.subject({source,context});assert.equal(result.kind,"ok",source);
        if(result.kind!=="ok")throw new Error(source);
        const subject=result.subject;const row=native[index]!;
        assert.equal(subject.all,row.all,source+" independent all");
        const currents=approveSnapshot((()=>{const data=snapshot();for(const entry of data.entries)Object.assign(entry.props,{current_mood:source,current_music:source,current_location:source});return data;})(),config,capabilities).entries[0]!.currents!;
        assert.deepEqual(Object.keys(currents),source&&source!=="0"?["mood","music","location"]:[]);
        assert.deepEqual(Object.keys(row.currents).sort(),source&&source!=="0"?["Location","Mood","Music"]:[]);
        if(index>=14&&index<=18){
            assert.equal(subject.html,"<b>X</b>","named CSS containment correction");
            assert.notEqual(subject.html,row.subject);
        }else if(index===20){
            assert.equal(subject.html,'<a href="https://journal.invalid/relative?q=%22x%22">R</a>',"canonical origin adaptation");
        }else if(index===22){
            assert.equal(subject.html,"<b>café &amp; '</b>","HTML5 entity serialization");
            assert.notEqual(subject.html,row.subject);
        }else if(index===23){
            assert.equal(subject.html,'<b style="color:red">escaped red</b>',"maintained escaped-identifier serialization");
            assert.notEqual(subject.html,row.subject);
        }else if(index===24){
            assert.equal(subject.html,"<b>escaped fixed</b>","decoded fixed containment");
        }else if(index===25){
            assert.equal(subject.html,row.subject);
            assert.equal(formatPlainSubject(prepared(subject),{},props,"recent"),
                '<a title="Plain &quot;double&quot; &amp;" href="https://journal.invalid/384.html">Plain "double" &amp;</a>',
                "literal quote attribute safety correction; entities not double escaped");
        }else if(index===26){
            assert.equal(subject.html,'<b class="ordinary">named</b>',"stock-control ID containment, class preserved");
        }else{
            assert.equal(subject.html,row.subject,source);
            assert.equal(formatPlainSubject(prepared(subject),{},props,"recent"),row.recent);
            assert.equal(formatPlainSubject({...prepared(subject),full:1},{},props,"entry"),row.entry);
        }
        const metadata=cleaner.metadata({subject:source,entry:{body:"body",format:"html_raw0",context}});
        assert.equal(metadata.kind,"ok");if(metadata.kind!=="ok")throw new Error(source);
        assert.equal(metadata.metadata.subjectText,row.all,"OG raw-source all, never display");
    }}finally{cleaner.close();}
});
test("unported subject capabilities refuse only encountered input",()=>{
    const cleaner=createEntryCleaner(limits);
    try{for(const source of ['<lj user="person">','<user name="person">','<lj-template name="x">Y</lj-template>',
        '<object><param name="x"></object>X','<embed src="x">','<span class="ljuser">person</span>']){
        assert.deepEqual(cleaner.subject({source,context}),{kind:"failure",reason:"unsupported"});
    }assert.equal(cleaner.subject({source:"ordinary",context}).kind,"ok");}finally{cleaner.close();}
});
test("textual currents retain raw key presence and numeric/coords still refuse",()=>{
    for(const props of [{current_coords:"1,2",current_location:"text"},
        {current_moodid:"1",current_mood:"custom"}]){
        const data=snapshot();Object.assign(data.entries[0]!.props,props);
        assert.throws(()=>approveSnapshot(data,config,capabilities));
    }
    const data=snapshot();for(const entry of data.entries)Object.assign(entry.props,{current_music:"<script>bad</script>",
        current_mood:"0",current_location:"",current_moodid:"0",current_coords:"0"});
    const entry=approveSnapshot(data,config,capabilities).entries[0]!;
    assert.deepEqual(entry.currents,{music:"<script>bad</script>"});
    const cleaner=createEntryCleaner(limits);
    try{const result=cleaner.subject({source:entry.currents!.music!,context});
        assert.equal(result.kind,"ok");if(result.kind==="ok")assert.equal(result.subject.html,"");
    }finally{cleaner.close();}
    Object.assign(data.owner,{optForceMoodtheme:"Y",moodthemeid:932});
    assert.doesNotThrow(()=>approveSnapshot(data,config,capabilities),"no numeric mood -> no theme lookup");
});

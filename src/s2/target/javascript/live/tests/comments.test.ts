// comments.test.ts
//
// Native public comment selection and projection qualification.
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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectComments,approveComments,validateCommentQuery} from '../domain/comments';
import {snapshot,config,capabilities} from './fixtures';
import type {RawCommentHeader,RawJournalSnapshot} from '../contracts';
import {createRedirectAdmission} from '../policy/redirects';
const settings={pageSize:2,threadPoint:4,maxSubjects:3};
const header=(jtalkid:number,parenttalkid=0,state='A',posterid=0):RawCommentHeader=>
    ({jtalkid,parenttalkid,state,posterid,datepost:'2026-09-26 00:00:00'});
const caps={...capabilities,threadExpandAll:{defaultValue:1,byBit:[],hookConfigured:false},
    threadExpander:{defaultValue:1,byBit:[],hookConfigured:false},
    maxComments:{defaultValue:5000,byBit:[],hookConfigured:false}};
const cfg={...config,commentSettings:settings};

test('thread-root app control admits only the observed finite native query',()=>{
    const decide=createRedirectAdmission(cfg);
    const request={method:'GET',rawTarget:'',host:'localhost:8081',origin:null,
        hasForwardedHeaders:false,hasAuthorization:false,cookieHeader:null};
    const path='/go?redir_type=threadroot&journal=s2js_slice3&talkid=384';
    for(const method of ['GET','HEAD'])assert.deepEqual(decide({...request,method,rawTarget:path}),
        {kind:'redirect',status:307,location:config.canonicalAppOrigin+path});
    for(const rawTarget of [path+'&extra=1',path+'&talkid=384',path.replace('384','0384'),
        path.replace('384','1099511627776'),path.replace('s2js_slice3','UPPER'),
        path.replace('threadroot','other'),path.replace('&journal=','&journal=%')])
        assert.equal(decide({...request,rawTarget}).kind,'reject',rawTarget);
    assert.equal(decide({...request,rawTarget:path,hasForwardedHeaders:true}).kind,'reject');
    assert.equal(decide({...request,rawTarget:path,hasAuthorization:true}).kind,'reject');
});

test('native root pages, low-byte alias, missing fallback and hidden leaf structure',()=>{
    const headers=[header(1),header(2,1),header(3),header(4),header(5,0,'S'),header(6,0,'D'),header(7,5,'F')];
    const selection=selectComments(headers,{},settings,true);
    assert.deepEqual(selection.roots.map(n=>n.header.jtalkid),[1,3]);
    assert.deepEqual(selection.fullIds,[1,3,2]);
    assert.equal(selection.pages,2);
    assert.equal(selectComments(headers,{page:99},settings,true).page,2);
    for(const thread of [519,520])assert.deepEqual(selectComments(headers,{thread},settings,true).roots.map(n=>n.header.jtalkid),[2]);
    assert.deepEqual(selectComments(headers,{thread:999*256},settings,true).roots.map(n=>n.header.jtalkid),[1,3]);
    const hidden=selectComments(headers,{thread:6*256},settings,true);
    assert.equal(hidden.roots[0]!.header.state,'D');assert.deepEqual(hidden.fullIds,[]);
    assert.throws(()=>selectComments([header(1,0,'Q')],{},settings,true));
    assert.throws(()=>selectComments([header(1,2),header(2,1)],{},settings,true));
    assert.equal(validateCommentQuery({destinationThread:0}).destinationThread,0);
});
test('approved tree never exposes hidden source, identity, unknown or private talkprops',()=>{
    const data=snapshot({kind:'entry',ditemid:384});
    const raw={headers:[header(1),header(2,1,'S',9),header(3,2)],authors:[],texts:[
        {jtalkid:1,subject:'First',body:'Body',props:{}},{jtalkid:3,subject:'Third',body:'Body',props:{}}]};
    const safe=approveComments({...data,comments:raw},cfg,caps)!;
    assert.equal(safe.roots[0]!.replies[0]!.author,null);
    assert.equal(safe.roots[0]!.replies[0]!.rawBody,null);
    assert.equal(safe.roots[0]!.replies[0]!.state,'S');
    assert.throws(()=>approveComments({...data,comments:{...raw,texts:[...raw.texts,{jtalkid:2,subject:'SECRET',body:'SECRET',props:{poster_ip:'SECRET'}}]}},cfg,caps));
    assert.throws(()=>approveComments({...data,comments:{...raw,texts:raw.texts.map(t=>({...t,props:{poster_ip:'SECRET'}}))}},cfg,caps));
    for(const name of ['subjecticon','edit_time'])assert.throws(()=>approveComments({...data,comments:{...raw,
        texts:raw.texts.map(t=>({...t,props:{[name]:'1'}}))}},cfg,caps));
});

import {Renderer} from '../render/child';
import {verifyRuntime} from '../render/manifest';
import {validateArtifact,instantiate} from '../render/artifact';
import {prepareComments} from '../render/comment-model';
import {callbacks} from '../render/builtins';
import {object} from '../render/objects';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {approveSnapshot} from '../policy/cohort';
import {loadResourceTimes} from '../render/resources';
import {now,limits} from './fixtures';
import {Context} from '../../runtime/s2runtime';
import {renderStock} from '../render/engine';
import type {RenderInput,RenderContentPreparation} from '../render/types';

test('poster and root-summary membership freezes only complete prepared escaped chunks',()=>{
    const path=process.env.S2_LIVE_TEST_ARTIFACT||'/tmp/slice14-stock.json';
    const artifact=validateArtifact(JSON.parse(readFileSync(path,'utf8')));
    const data:RawJournalSnapshot={...snapshot({kind:'entry',ditemid:384}),comments:{headers:[header(1,0,'A',6),header(2)],authors:[{userid:6,user:'s2js_slice3',
        name:'Public author',clusterid:1,status:'A',statusvis:'V',journaltype:'P',caps:'2',timezone:'UTC',
        defaultpicid:0,dversion:10,pictures:{pictures:[],mappings:[]}}],texts:[
        {jtalkid:1,subject:'" <img src=x onerror=bad> &quot;',body:'Body',
            props:{imported_from:'<img src=x onerror=bad>'}},
        {jtalkid:2,subject:'Anonymous',body:'Body',props:{}}]}};
    const input:RenderInput={page:{kind:'entry',ditemid:384},journal:approveSnapshot(data,cfg,caps),config:cfg,
        skip:0,skipPresent:false,nowSeconds:now,formChallenge:'public-challenge',uniq:'AAAAAAAAAAAAAAA',
        resourceTimes:loadResourceTimes()};
    // This engine test supplies fixed inert content; actual cleaner and child
    // behavior is exercised separately by the current-child test below.
    const content:RenderContentPreparation={body:()=>'<p>Entry</p>',comment:()=>'<p>Comment</p>',
        subject:entry=>({html:entry.subject,recentHtml:entry.subject,all:entry.subject}) as
            import('@dreamwidth/content/contracts').SubjectPreparation,
        metadata:()=>({kind:'inert-entry-metadata',subjectText:'Title',eventText:'Description'})};
    const html=renderStock(artifact,input,2097152,content);
    assert.ok(html.includes('pagesummary-poster'));
    assert.ok(html.includes('imported-from'));
    assert.ok(html.includes('&lt;img src=x onerror=bad&gt;'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('"canAdmin":0'));
    assert.ok(!html.includes('"canAdmin":true'));
    const original=Context.prototype.runMethod;
    for(const field of ['subject','imported_from']) {
        Context.prototype.runMethod=function(value,name) {
            const page=value as Record<string,any>;
            if(name==='print()'&&page['.type']==='EntryPage') {
                if(field==='subject')page.comments[0].subject='changed';
                else page.comments[0].metadata.imported_from='changed';
            }
            return original.call(this,value,name);
        };
        try {assert.throws(()=>renderStock(artifact,input,2097152,content),/Unsupported safe HTML attribute style/);}
        finally {Context.prototype.runMethod=original;}
    }
});

test('current isolated stock child renders registered and anonymous tree with safe cmtinfo',async()=>{
    const path=process.env.S2_LIVE_TEST_ARTIFACT||'/tmp/slice14-stock.json';
    const child=new Renderer(validateArtifact(JSON.parse(readFileSync(path,'utf8'))),path+'.sandbox',limits,verifyRuntime(path));
    const data=snapshot({kind:'entry',ditemid:384});
    const author={userid:6,user:'s2js_slice3',name:'Public author',clusterid:1,status:'A',statusvis:'V',journaltype:'P',
        caps:'2',timezone:'UTC',defaultpicid:0,dversion:10,pictures:{pictures:[],mappings:[]}};
    const headers=[header(1,0,'A',6),header(2,1),header(3,1,'S'),header(4,1,'F',6),header(5,1),header(6)];
    const selection=selectComments(headers,{},settings,true);
    const raw={headers,authors:[author],texts:[...selection.fullIds,...selection.subjectIds].map(id=>({jtalkid:id,
        subject:'Public subject '+id,body:selection.fullIds.includes(id)?'<p style="color:red">Public body '+id+'</p>':null,
        props:{editor:'html_raw0'}}))};
    const journal=approveSnapshot({...data,comments:raw},cfg,caps);
    try {
        const html=await child.render({page:{kind:'entry',ditemid:384},journal,config:cfg,skip:0,skipPresent:false,
            nowSeconds:now,formChallenge:'public-challenge',uniq:'AAAAAAAAAAAAAAA',resourceTimes:loadResourceTimes()});
        assert.ok(html.includes('Public body 1'));
        assert.ok(html.includes('Public body 2'));
        assert.ok(html.includes('Public subject 4'));
        assert.ok(!html.includes('Public body 4'));
        assert.ok(html.includes('Expander.make'));
        assert.ok(html.includes('destination_thread=0'));
        assert.ok(html.includes('http://localhost:8081/users/s2js_slice3/384.html?expand_all=1#comments'));
        assert.ok(!html.includes('poster_ip'));
        const noExpand=approveSnapshot({...data,comments:raw},cfg,{...caps,
            threadExpandAll:{defaultValue:0,byBit:[],hookConfigured:false},
            threadExpander:{defaultValue:0,byBit:[],hookConfigured:false}});
        const plain=await child.render({page:{kind:'entry',ditemid:384},journal:noExpand,config:cfg,skip:0,skipPresent:false,
            nowSeconds:now,formChallenge:'public-challenge',uniq:'AAAAAAAAAAAAAAA',resourceTimes:loadResourceTimes()});
        assert.ok(!plain.includes('Expander.make('));
        assert.ok(plain.includes('http://localhost:8080/~s2js_slice3/384.html?thread='));
    }finally{await child.close();}
});

test('edge-depth1000 projects and crosses actual IPC;1001 refuses before recursion',async()=>{
    const chain=(count:number)=>Array.from({length:count},(_,index)=>header(index+1,index));
    assert.equal(selectComments(chain(182),{},settings,true).roots[0]!.header.jtalkid,1);
    assert.throws(()=>selectComments(chain(1002),{},settings,true),/Unsupported/);
    const data:RawJournalSnapshot={...snapshot({kind:'entry',ditemid:384}),comments:{headers:chain(1001),authors:[],
        texts:(()=>{const selected=selectComments(chain(1001),{},settings,true);return [...selected.fullIds,...selected.subjectIds].map(id=>({jtalkid:id,subject:'',body:selected.fullIds.includes(id)?'':null,props:{opt_preformatted:'1'}}));})()}};
    const journal=approveSnapshot(data,cfg,caps);
    const path=process.env.S2_LIVE_TEST_ARTIFACT||'/tmp/slice14-stock.json';
    const child=new Renderer(validateArtifact(JSON.parse(readFileSync(path,'utf8'))),path+'.sandbox',limits,verifyRuntime(path));
    try {
        const html=await child.render({page:{kind:'entry',ditemid:384},journal,config:cfg,skip:0,skipPresent:false,
            nowSeconds:now,formChallenge:'public-challenge',uniq:'AAAAAAAAAAAAAAA',resourceTimes:loadResourceTimes()});
        assert.equal((html.match(/class='dwexpcomment'/g)??[]).length,1001);
    }finally {await child.close();}
});

 test('native maxcomments threshold preserves zero and disabled effective count',()=>{
    const data=snapshot({kind:'entry',ditemid:384});
    const run=(count:number,limit:number,enabled=true,hook=false)=>{
        const entry={...data.entries[0]!,replycount:count};
        const owner={...data.owner,optShowTalkLinks:enabled?'Y':'N'};
        return approveSnapshot({...data,owner,entries:[entry],selection:{...data.selection,...(data.selection.kind==='entry'?{target:{...data.selection.target!,replycount:count}}:{})}},cfg,{...caps,
            maxComments:{defaultValue:limit,byBit:[],hookConfigured:hook}}).entries[0]!;
    };
    assert.equal(run(4,5).commentsAtMax,false);
    assert.equal(run(5,5).commentsAtMax,true);
    assert.equal(run(0,0).commentsAtMax,true);
    assert.equal(run(5,5,false).commentsAtMax,false);
    assert.throws(()=>run(1,5,true,true));
    assert.throws(()=>approveSnapshot({...data,entries:[{...data.entries[0]!,replycount:1}]},cfg,capabilities));
    assert.equal(approveSnapshot(data,cfg,capabilities).entries[0]!.commentsAtMax,false);
});

test('native logtime-relative seconds and one/two-child plural captions',()=>{
    const root=path.resolve(__dirname,'../../../../../../..');
    const native=spawnSync('perl',[path.join(root,'src/s2/target/javascript/tools/native-comments.pl'),'--presentation'],
        {cwd:root,env:{...process.env,LJHOME:root},timeout:10000,maxBuffer:524288,encoding:'utf8'});
    assert.equal(native.status,0,native.stderr);
    const expected=JSON.parse(native.stdout) as {seconds_since_entry:number;captions:{kind:string;count:number;html:string}[]};
    const data=snapshot({kind:'entry',ditemid:384});
    const journal=approveSnapshot({...data,comments:{headers:[{...header(1),datepost:'1970-01-01 01:06:40'}],authors:[],
        texts:[{jtalkid:1,subject:'Public',body:'Public',props:{}}]}},cfg,caps);
    // Model-only time tuple: native datepost4000/logtime2500/eventtime1000.
    const input:RenderInput={page:{kind:'entry',ditemid:384},journal:{...journal,
        entries:journal.entries.map(e=>({...e,eventtime:'1970-01-01 00:16:40',logtime:'1970-01-01 00:41:40'}))},
        config:cfg,skip:0,skipPresent:false,nowSeconds:now,formChallenge:'public',uniq:'AAAAAAAAAAAAAAA',resourceTimes:loadResourceTimes()};
    const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT||'/tmp/slice14-stock.json','utf8')));
    let printed='';const funcs=callbacks({},{});
    const ctx=new Context(instantiate(artifact),text=>{printed+=text;},{},funcs);
    const content:RenderContentPreparation={body:()=>'',comment:()=>'',subject:e=>({html:e.subject,recentHtml:e.subject,all:e.subject}) as import('@dreamwidth/content/contracts').SubjectPreparation,metadata:()=>({kind:'inert-entry-metadata',subjectText:'',eventText:''})};
    const comment=prepareComments(input,ctx,content,object('UserLite'),journal.baseUrl+'/384.html').comments[0]!;
    assert.equal(comment.seconds_since_entry,expected.seconds_since_entry);
    comment.expand_url='http://app.invalid/~synthetic/384.html?thread=384#cmt384';
    for(const row of expected.captions) {
        comment.showable_children=row.count;printed='';
        funcs['_Comment__print_'+row.kind+'_link']!(ctx,comment,{});
        assert.equal(/>([^<]*)<\/a>/.exec(printed)![1],/>([^<]*)<\/a>/.exec(row.html)![1],row.kind+row.count);
    }
});

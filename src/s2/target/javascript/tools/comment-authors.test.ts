// comment-authors.test.ts
//
// Native public comment-author badges and selected SQL privacy qualification.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {authorBadge} from '../live/domain/comments';
import {badge} from '../live/render/host';
import type {RawCommentAuthor} from '../live/contracts';
import {config,capabilities,limits} from '../live/tests/fixtures';
import {withSelectedFixture} from './selected-fixture';
import {MysqlLiveStore} from '../live/data/mysql';
import {approveSnapshot} from '../live/policy/cohort';
import {createAnonymousRecentService} from '../live/policy/service';
import {createLiveApp} from '../live/server/app';
import {Renderer} from '../live/render/child';
import {commentsBrowser} from './comments-browser';

const cap=(value=0,hookConfigured=false)=>({defaultValue:value,byBit:[],hookConfigured});
test('native author status, staff, readonly ordering and cluster-zero absence',()=>{
    const root=path.resolve(__dirname,'../../../../../..');
    const native=spawnSync('perl',[path.join(root,'src/s2/target/javascript/tools/native-comments.pl'),'--authors'],
        {cwd:root,env:{...process.env,LJHOME:root},encoding:'utf8',timeout:10000,maxBuffer:131072});
    assert.equal(native.status,0,native.stderr);assert.equal(native.stderr,'');
    const rows=JSON.parse(native.stdout);assert.equal(rows.length,19);
    for(const row of rows) {
        const a={userid:234,user:'author',name:'Public <name>',caps:'0',status:row.emailStatus,
            statusvis:row.statusvis,clusterid:row.cluster,journaltype:'P',dversion:10,defaultpicid:77,
            timezone:null,pictures:{pictures:[],mappings:[]}} satisfies RawCommentAuthor;
        const facts={...capabilities,authorStaffHeadicon:cap(row.source.staff,row.source.hook==='check_cap_staff_headicon'),
            authorReadonly:cap(row.source.readonly,row.source.hook==='check_cap_readonly'),
            authorAvoidReadonly:cap(row.source.avoid,row.source.hook==='check_cap_avoid_readonly'),
            authorReadonlyClusters:[{clusterId:row.cluster,forced:!!row.source.forced,
                advisory:row.source.advisory==='when_needed'?'when-needed':row.source.advisory}]};
        if(row.id==='suspended') {
            assert.deepEqual(row.entryProjection,{full:0,subject:'',text:'',fromsuspended:1,posterPresent:0,picturePresent:0});continue;
        }
        if(row.error||row.source.head||row.source.hook&&row.id!=='forced_shortcircuit') {
            assert.throws(()=>authorBadge(a,{...config,headIconHookConfigured:!!row.source.head},facts));continue;
        }
        const appearance=authorBadge(a,config,facts);
        assert.equal(appearance.badgeDeleted,row.badge.includes('line-through'),row.id);
        assert.equal(appearance.badgeKind==='staff',row.badge.includes('user_staff.png'),row.id);
        // Actual source output is independently compared to the complete badge builder.
        const input={config:{...config,imgPrefix:'/img'},journal:{username:'author',baseUrl:'https://app.invalid/~author'}};
        assert.equal(badge(input as Parameters<typeof badge>[0],appearance),row.badge,row.id);
        if(row.id==='expunged') {
            assert.deepEqual(row.pictures,{info:null,picid:77,keywordPicid:77,loaded:{}});
            assert.equal(row.timezone,null);assert.equal(row.timezoneProp,null);
        }
    }
    const visible={statusvis:'V',clusterid:0,caps:'0'} as RawCommentAuthor;
    assert.deepEqual(authorBadge(visible,config,{...capabilities,authorReadonly:undefined,authorAvoidReadonly:undefined,
        authorReadonlyClusters:undefined}),{badgeKind:'personal',badgeDeleted:false});
    assert.throws(()=>authorBadge(visible,{...config,headIconHookConfigured:undefined},capabilities));
});

function get(port:number,query=''):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:'127.0.0.1',port,path:'/users/ordinary6/76801.html'+query,
            headers:{Host:'localhost:8081'}},response=>{
            const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
            response.on('end',()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString(),headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error('Author HTTP deadline')));call.on('error',reject);call.end();
    });
}

test('actual selected author states keep public presentation and revoke suspension without profile reads',{
    skip:process.env.S2_SELECTED_FIXTURE!=='1'
},async t=>withSelectedFixture(async f=>{
    const settings={pageSize:2,threadPoint:4,maxSubjects:3};
    const facts={...f.startup.capabilities,authorStaffHeadicon:{...cap(),byBit:[{bit:9,value:1}]}};
    const store=await MysqlLiveStore.open({...f.startup,commentSettings:settings,capabilities:facts});
    const cfg={...config,commentSettings:settings};
    const users=f.table(f.g,'user'),talk=f.table(f.c,'talk2'),text=f.table(f.c,'talktext2');
    const req=f.request('ordinary6',{kind:'entry',ditemid:76801});
    const pictures=MysqlLiveStore.prototype as unknown as {loadUserpics:(...args:unknown[])=>Promise<unknown>};
    const originalPictures=pictures.loadUserpics;
    const pictureReads:number[]=[];
    const reads=t.mock.method(pictures,'loadUserpics',async function(this:MysqlLiveStore,...args:unknown[]){
        pictureReads.push(Number(args[1]));return originalPictures.apply(this,args);
    });
    await f.admin.query(`UPDATE ${users} SET defaultpicid=77,status='N',caps=514 WHERE userid=900002`);
    await f.admin.query(`INSERT INTO ${f.table(f.other,'userpic2')} (userid,picid,width,height,state,description)
        VALUES (900002,77,40,30,'N','Public author picture')`);
    for(const [id,parent,state] of [[1,0,'A'],[2,1,'A'],[3,1,'S'],[4,1,'F'],[5,1,'D'],[6,0,'A'],[7,6,'A'],[8,0,'A']] as const) {
        await f.admin.query(`INSERT INTO ${talk} (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
            VALUES (900001,?,'L',300,?,?,'2026-09-26 01:00:00',?)`,[id,parent,[1,4].includes(id)?900002:0,state]);
        await f.admin.query(`INSERT INTO ${text} (journalid,jtalkid,subject,body) VALUES
            (900001,?,CONVERT(? USING latin1),CONVERT(? USING latin1))`,[id,Buffer.from('Public subject '+id),Buffer.from('<p>Public body '+id+'</p>')]);
        await f.admin.query(`INSERT INTO ${f.table(f.c,'talkprop2')} (journalid,jtalkid,tpropid,value)
            VALUES (900001,?,?,'html_raw0')`,[id,f.talkProp('editor')]);
    }
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config:cfg,capabilities:facts,
        limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
    const app=createLiveApp(cfg,service);
    try {
        await app.listen({host:'127.0.0.1',port:process.env.S2_COMMENTS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=='string');
        const normal=await store.loadRawSnapshot(req);assert.ok(normal?.comments);
        assert.equal(normal.comments.authors[0]!.status,'N');
        const response=await get(address.port);assert.equal(response.status,200);
        assert.ok(response.body.includes('Public body 1'));assert.ok(response.body.includes('user_staff.png'));
        assert.equal(response.headers['cache-control'],'private, no-store');
        const picturePage=await get(address.port,'?thread=1025');assert.equal(picturePage.status,200);
        assert.ok(picturePage.body.includes('/userpic/77/900002'));
        for(const [status,cluster] of [['D',19],['X',0],['X',19]] as const) {
            await f.admin.query(`UPDATE ${users} SET statusvis=?,clusterid=? WHERE userid=900002`,[status,cluster]);
            if(status==='X'&&cluster===0) {
                // If either public-property lookup ran, strict decoding would
                // fail. Expunged source objects never preload timezone.
                await f.admin.query(`INSERT INTO ${f.table(f.g,'userprop')} (userid,upropid,value)
                    VALUES (900002,?,CONVERT(? USING latin1))`,[f.prop('timezone'),Buffer.from([255])]);
                await f.admin.query(`INSERT INTO ${f.table(f.other,'userproplite2')} (userid,upropid,value)
                    VALUES (900002,?,CONVERT(? USING latin1))`,[f.prop('timezone'),Buffer.from([255])]);
            }
            pictureReads.length=0;
            const raw=await store.loadRawSnapshot(req);assert.ok(raw?.comments);
            const approved=approveSnapshot(raw,cfg,facts);const author=approved.comments!.roots[0]!.author!;
            assert.equal(author.badgeDeleted,true);assert.equal(author.badgeKind,'staff');
            for(const key of ['clusterid','caps','statusvis','authorReadonlyClusters'])assert.ok(!JSON.stringify(approved.comments).includes('\"'+key+'\"'));
            if(status==='X')assert.equal(author.timezone,null);
            if(cluster===0) {assert.ok(!pictureReads.includes(900002));assert.equal(author.userpic,null);assert.deepEqual(raw.comments.authors[0]!.pictures,{pictures:[],mappings:[]});}
            else assert.equal(author.userpic?.picid,77);
            const page=await get(address.port);assert.equal(page.status,200);
            assert.ok(page.body.includes('text-decoration: line-through;'));assert.ok(page.body.includes('Public body 1'));
        }
        // The actual stock browser runs the X positive-cluster struck staff badge,
        // then retained individual and expand-all read controls.
        const page=await get(address.port);
        const imageUrl=new URL(config.userpicRoot+'/77/900002',`http://localhost:${address.port}`).href;
        const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64');
        if(process.env.S2_COMMENTS_BROWSER_OUTPUT)await assert.rejects(
            ()=>commentsBrowser(page.body,address.port,new Map([['https://undeclared.invalid/picture.png',png]])),
            /exact emitted configured URL/);
        await commentsBrowser(page.body,address.port,new Map([[imageUrl,png]]));
        await f.admin.query(`DELETE FROM ${f.table(f.g,'userprop')} WHERE userid=900002 AND upropid=?`,[f.prop('timezone')]);
        await f.admin.query(`DELETE FROM ${f.table(f.other,'userproplite2')} WHERE userid=900002 AND upropid=?`,[f.prop('timezone')]);
        await f.admin.query(`UPDATE ${users} SET statusvis='V',clusterid=19 WHERE userid=900002`);
        const baseline=await store.loadRawSnapshot(req);assert.ok(baseline);
        const original=Renderer.prototype.render;
        const hook=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>){
            const html=await original.apply(this,args);await f.admin.query(`UPDATE ${users} SET statusvis='S' WHERE userid=900002`);return html;
        });
        try {
            const blocked=await get(address.port);assert.equal(blocked.status,409);assert.equal(blocked.body,'Journal changed during render\n');
            assert.equal(blocked.headers['set-cookie'],undefined);assert.equal(blocked.headers.location,undefined);
        } finally {hook.mock.restore();}
        pictureReads.length=0;
        await f.admin.query(`INSERT INTO ${f.table(f.g,'userprop')} (userid,upropid,value)
            VALUES (900002,?,CONVERT(? USING latin1))`,[f.prop('timezone'),Buffer.from([255])]);
        const hidden=await store.loadRawSnapshot(req);assert.ok(hidden?.comments);
        assert.equal(hidden.comments.authors[0]!.name,'');assert.equal(hidden.comments.authors[0]!.timezone,null);
        const noBadge=approveSnapshot(hidden,{...cfg,headIconHookConfigured:true},
            {...facts,authorStaffHeadicon:undefined,authorReadonly:undefined,authorAvoidReadonly:undefined,
                authorReadonlyClusters:undefined});
        assert.equal(noBadge.comments!.roots[0]!.author,null);
        const suspended=await get(address.port);assert.equal(suspended.status,200);assert.ok(!pictureReads.includes(900002));
        for(const value of ['Public body 1','Public subject 1','second6','Public author picture'])assert.ok(!suspended.body.includes(value),value);
        await f.admin.query(`DELETE FROM ${f.table(f.g,'userprop')} WHERE userid=900002 AND upropid=?`,[f.prop('timezone')]);
        await f.admin.query(`UPDATE ${users} SET statusvis='V' WHERE userid=900002`);
        assert.equal(await store.revalidateFingerprint(baseline),true);
        assert.equal((await get(address.port)).status,200);
    } finally {reads.mock.restore();await app.close();await store.close();}
}));

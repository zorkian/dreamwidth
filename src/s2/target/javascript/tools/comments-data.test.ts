// comments-data.test.ts
//
// Selected public comment SQL privacy, isolation and freshness qualification.
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
import {withSelectedFixture} from './selected-fixture';
import {MysqlLiveStore} from '../live/data/mysql';
import {approveSnapshot} from '../live/policy/cohort';
import {config} from '../live/tests/fixtures';
import {limits} from '../live/tests/fixtures';
import {createAnonymousRecentService} from '../live/policy/service';
import {createLiveApp} from '../live/server/app';
import {Renderer} from '../live/render/child';
import {request as httpRequest} from 'node:http';
import {commentsBrowser} from './comments-browser';

test('selected comment SQL excludes hidden bytes and private props, brackets authors and rechecks mutations',{
    skip:process.env.S2_SELECTED_FIXTURE!=='1'
},async t=>withSelectedFixture(async f=>{
    const settings={pageSize:2,threadPoint:4,maxSubjects:3};
    const startup={...f.startup,commentSettings:settings};
    const store=await MysqlLiveStore.open(startup);
    const cfg={...config,commentSettings:settings};
    const req=f.request('ordinary6',{kind:'entry',ditemid:300*256+1});
    const talks=f.table(f.c,'talk2'),texts=f.table(f.c,'talktext2'),props=f.table(f.c,'talkprop2');
    try {
        const states=['A','A','S','F','D','A','A','A'];
        const parents=[0,1,1,1,1,0,6,0];
        await f.admin.query(`INSERT INTO ${f.table(f.g,'user')} (userid,user,clusterid,status,statusvis,journaltype,name,
            opt_showtalklinks,opt_whocanreply,opt_forcemoodtheme,moodthemeid,defaultpicid,dversion,caps)
            VALUES (900003,'suspended14',19,'A','S','P','PRIVATE_NAME','Y','all','N',1,NULL,10,2),
                (900004,'hiddenidentity',19,'A','V','I','IDENTITY_NAME','Y','all','N',1,NULL,10,2)`);
        await f.admin.query(`INSERT INTO ${f.table(f.g,'useridmap')} (userid,user) VALUES
            (900003,'suspended14'),(900004,'hiddenidentity')`);
        for(let id=1;id<=states.length;id++) {
            const poster=id===1?900001:id===3?900004:id===4?900002:id===6?900003:0;
            await f.admin.query(`INSERT INTO ${talks} (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
                VALUES (900001,?,'L',300,?,?,'2026-09-26 01:00:00',?)`,[id,parents[id-1],poster,states[id-1]]);
            await f.admin.query(`INSERT INTO ${texts} (journalid,jtalkid,subject,body) VALUES (900001,?,CONVERT(? USING latin1),CONVERT(? USING latin1))`,
                [id,[3,5,6].includes(id)?Buffer.from([255]):Buffer.from('Public subject '+id),
                    [3,5,6].includes(id)?Buffer.from([255]):Buffer.from('<p>Public body '+id+'</p>')]);
        }
        await f.admin.query(`INSERT INTO ${props} (journalid,jtalkid,tpropid,value) VALUES
            (900001,1,?,'PRIVATE_IP_MARKER'),(900001,1,?,'html_raw0')`,[f.talkProp('poster_ip'),f.talkProp('editor')]);
        await f.admin.query(`INSERT INTO ${f.table(f.g,'userprop')} (userid,upropid,value) VALUES (900001,?,'UTC')`,[f.prop('timezone')]);
        const data=await store.loadRawSnapshot(req);assert.ok(data?.comments);
        assert.deepEqual(data.comments.texts.map(t=>t.jtalkid),[1,2,4,7]);
        assert.equal(data.comments.texts.find(t=>t.jtalkid===4)!.body,null);
        assert.equal(data.comments.authors.find(a=>a.userid===900001)!.timezone,'UTC');
        assert.equal(data.comments.authors.find(a=>a.userid===900003)!.name,'');
        assert.ok(!JSON.stringify(data.comments).includes('PRIVATE_IP_MARKER'));
        assert.ok(!JSON.stringify(data.comments).includes('IDENTITY_NAME'));
        const approved=approveSnapshot(data,cfg,startup.capabilities);
        assert.ok(!JSON.stringify(approved).includes('PRIVATE_IP_MARKER'));
        assert.ok(!JSON.stringify(approved).includes('PRIVATE_NAME'));
        assert.equal(await store.revalidateFingerprint(data),true);
        await f.admin.query(`UPDATE ${props} SET value='CHANGED_PRIVATE_IP' WHERE journalid=900001 AND jtalkid=1 AND tpropid=?`,[f.talkProp('poster_ip')]);
        assert.equal(await store.revalidateFingerprint(data),false);
        await f.admin.query(`UPDATE ${props} SET value='PRIVATE_IP_MARKER' WHERE journalid=900001 AND jtalkid=1 AND tpropid=?`,[f.talkProp('poster_ip')]);
        assert.equal(await store.revalidateFingerprint(data),true);
        await f.admin.query(`UPDATE ${talks} SET state='S' WHERE journalid=900001 AND jtalkid=1`);
        assert.equal(await store.revalidateFingerprint(data),false);
        await f.admin.query(`UPDATE ${talks} SET state='A' WHERE journalid=900001 AND jtalkid=1`);
        await f.admin.query(`INSERT INTO ${f.table(f.other,'talk2')} (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state)
            VALUES (900002,1,'L',300,0,0,'2026-09-26 00:00:00','A')`);
        assert.equal(await store.revalidateFingerprint(data),true);
        assert.equal(await store.loadRawSnapshot(f.request('ordinary6',{kind:'entry',ditemid:301*256+1})),null);
        const recent=await store.loadRawSnapshot(f.request());assert.ok(recent);approveSnapshot(recent,cfg,startup.capabilities);
        assert.equal(recent.comments,undefined);
        const service=await createAnonymousRecentService({repository:store,secretSource:store,config:cfg,
            capabilities:startup.capabilities,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
        const app=createLiveApp(cfg,service);
        await app.listen({host:'127.0.0.1',port:process.env.S2_COMMENTS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=='string');
        const get=(path='/users/ordinary6/76801.html',method='GET')=>new Promise<{
            status:number;headers:Headers;text():Promise<string>}>((resolve,reject)=>{
            const call=httpRequest({hostname:'127.0.0.1',port:address.port,path,method,headers:{Host:'localhost:8081'}},response=>{
                const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
                response.on('end',()=>resolve({status:response.statusCode??0,
                    headers:new Headers(Object.entries(response.headers).filter(([,v])=>v!==undefined)
                        .map(([name,value]):[string,string]=>[name,Array.isArray(value)?value.join(','):String(value)])),
                    text:async()=>Buffer.concat(chunks).toString('utf8')}));
            });call.setTimeout(20000,()=>call.destroy(Error('Comment HTTP deadline')));call.on('error',reject);call.end();
        });
        try {
            const response=await get();assert.equal(response.status,200);
            const html=await response.text();assert.ok(html.includes('Public body 1'));
            assert.ok(html.includes('Public subject 4'));assert.ok(!html.includes('Public body 4'));
            for(const marker of ['PRIVATE_IP_MARKER','PRIVATE_NAME','IDENTITY_NAME'])assert.ok(!html.includes(marker));
            assert.equal(response.headers.get('cache-control'),'private, no-store');
            assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
            assert.equal(Number(response.headers.get('content-length')),Buffer.byteLength(html));
            for(const query of ['?thread=1025&destination_thread=0','?expand_all=1']) {
                const expanded=await get('/users/ordinary6/76801.html'+query);
                const body=await expanded.text();assert.equal(expanded.status,200,body);
                assert.ok(body.includes('Public body 4'));
            }
            await commentsBrowser(html,address.port);
            const head=await get(undefined,'HEAD');assert.equal(head.status,200);
            assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),response.headers.get('content-length'));
            assert.equal((await get('/users/ordinary6/77057.html')).status,404);
            for(const [change,restore] of [
                [`UPDATE ${talks} SET state='S' WHERE journalid=900001 AND jtalkid=1`,
                    `UPDATE ${talks} SET state='A' WHERE journalid=900001 AND jtalkid=1`],
                [`UPDATE ${texts} SET body='Changed public body' WHERE journalid=900001 AND jtalkid=1`,
                    `UPDATE ${texts} SET body='<p>Public body 1</p>' WHERE journalid=900001 AND jtalkid=1`],
                [`UPDATE ${talks} SET parenttalkid=0 WHERE journalid=900001 AND jtalkid=2`,
                    `UPDATE ${talks} SET parenttalkid=1 WHERE journalid=900001 AND jtalkid=2`],
                [`UPDATE ${f.table(f.g,'user')} SET name='Changed public author' WHERE userid=900002`,
                    `UPDATE ${f.table(f.g,'user')} SET name='Another ordinary' WHERE userid=900002`],
            ]) {
                const original=Renderer.prototype.render;
                const hook=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>){
                    const result=await original.apply(this,args);await f.admin.query(change!);return result;
                });
                try {
                    const blocked=await get();assert.equal(blocked.status,409);
                    assert.equal(await blocked.text(),'Journal changed during render\n');
                    assert.equal(blocked.headers.get('set-cookie'),null);assert.equal(blocked.headers.get('location'),null);
                }finally {hook.mock.restore();await f.admin.query(restore!);}
                assert.equal((await get()).status,200);
            }
            for(const opt_whocanreply of ['reg','friends']) {
                await f.admin.query(`UPDATE ${f.table(f.g,'user')} SET opt_whocanreply=? WHERE userid=900001`,[opt_whocanreply]);
                try {const retained=await get();assert.equal(retained.status,200);assert.ok((await retained.text()).includes('Public body 1'));}
                finally {await f.admin.query(`UPDATE ${f.table(f.g,'user')} SET opt_whocanreply='all' WHERE userid=900001`);}
            }
            await f.admin.query(`UPDATE ${f.table(f.g,'user')} SET opt_showtalklinks='N' WHERE userid=900001`);
            try {const retained=await get();assert.equal(retained.status,200);assert.ok((await retained.text()).includes('Public body 1'));}
            finally {await f.admin.query(`UPDATE ${f.table(f.g,'user')} SET opt_showtalklinks='Y' WHERE userid=900001`);}
            for(const name of ['opt_nocomments','opt_nocomments_maintainer']) {
                await f.admin.query(`INSERT INTO ${f.table(f.c,'logprop2')} (journalid,jitemid,propid,value) VALUES(900001,300,?,'1')`,[f.logProp(name)]);
                try {const retained=await get();assert.equal(retained.status,200);assert.ok((await retained.text()).includes('Public body 1'));}
                finally {await f.admin.query(`DELETE FROM ${f.table(f.c,'logprop2')} WHERE journalid=900001 AND jitemid=300 AND propid=?`,[f.logProp(name)]);}
            }
        }finally {await app.close();}
        await f.admin.query(`UPDATE ${talks} SET state='Q' WHERE journalid=900001 AND jtalkid=8`);
        await assert.rejects(()=>store.loadRawSnapshot(req));
    }finally{await store.close();}
}));

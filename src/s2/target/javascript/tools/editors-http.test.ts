// editors-http.test.ts
//
// Actual selected entry formats, independent metadata and final freshness.
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
import {request as httpRequest} from 'node:http';
import {withSelectedFixture} from './selected-fixture';
import {createAnonymousRecentService} from '../live/policy/service';
import {createLiveApp} from '../live/server/app';
import {Renderer} from '../live/render/child';
import {config,capabilities,limits} from '../live/tests/fixtures';
import type {RenderInput} from '../live/render/types';
import {editorsBrowser} from './editors-browser';
const rich='First\n<b style="color:red;font-weight:bold">Styled editor</b>\nhttps://editor.slice16.invalid/?x=1&y=2\n'+
    '<lj-cut text="More">Cut editor body</lj-cut>\nLast';
function get(port:number,path:string):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:'127.0.0.1',port,path,headers:{Host:'localhost:8081'}},response=>{
            const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
            response.on('end',()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString(),headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error('Editor HTTP deadline')));call.on('error',reject);call.end();
    });
}
test('actual original-source formats exclude private bytes and revoke editor/import/date changes',{
    skip:process.env.S2_SELECTED_FIXTURE!=='1',timeout:120000},async t=>withSelectedFixture(async f=>{
    const {store,admin,table,g,c,other}=f;
    const [defs]:any=await admin.query(`SELECT propid,name FROM ${table(g,'logproplist')} WHERE name IN ('editor','opt_preformatted','import_source')`);
    const prop=(name:string)=>{const found=defs.find((row:any)=>row.name===name);assert.ok(found,name);return found.propid;};
    const set=async(name:string,value:string|null)=>{
        await admin.query(`DELETE FROM ${table(c,'logprop2')} WHERE journalid=900001 AND jitemid=300 AND propid=?`,[prop(name)]);
        if(value!==null)await admin.query(`INSERT INTO ${table(c,'logprop2')} (journalid,jitemid,propid,value)
            VALUES(900001,300,?,CONVERT(? USING latin1))`,[prop(name),Buffer.from(value)]);
    };
    await admin.query(`UPDATE ${table(c,'logtext2')} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=300`,[Buffer.from(rich)]);
    await admin.query(`UPDATE ${table(c,'logtext2')} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid IN (301,302)`,[Buffer.from([255])]);
    await admin.query(`UPDATE ${table(other,'logtext2')} SET event='FOREIGN_EDITOR' WHERE journalid=900002`);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
    const app=createLiveApp(config,service);const original=Renderer.prototype.render;
    const capture=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,input:RenderInput){
        assert.ok(!JSON.stringify(input).includes('FOREIGN_EDITOR'));
        assert.ok(input.journal.entries.every(entry=>!entry.rawBody.includes('\uFFFD')));
        return original.call(this,input);
    });
    try {
        await app.listen({host:'127.0.0.1',port:process.env.S2_EDITORS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=='string');
        for(const editor of ['html_raw0','html_casual0','html_casual1','rte0',null,'','0']){
            await set('editor',editor);
            for(const path of ['/users/ordinary6/','/users/ordinary6/76801.html']){
                const page=await get(address.port,path);assert.equal(page.status,200,editor+': '+page.body);
                assert.equal(page.headers['cache-control'],'private, no-store');assert.ok(page.body.includes('Styled editor'));
                if(editor!=='html_raw0')assert.ok(page.body.includes('<br>'));
                if(path.endsWith('/'))assert.ok(!page.body.includes('Cut editor body'));
                else assert.ok(page.body.includes('Cut editor body'));
            }
        }
        // Defined empty/zero import source disables mention conversion in display,
        // while independent Entry OG remains unsupported for the same raw mention.
        await admin.query(`UPDATE ${table(c,'logtext2')} SET event='x @name' WHERE journalid=900001 AND jitemid=300`);
        for(const imported of ['', '0']){
            await set('editor',null);await set('import_source',imported);
            assert.equal((await get(address.port,'/users/ordinary6/')).status,200);
            assert.equal((await get(address.port,'/users/ordinary6/76801.html')).status,422);
        }
        await set('import_source',null);
        assert.equal((await get(address.port,'/users/ordinary6/')).status,422,'one selected unsupported entry refuses whole page');
        await admin.query(`UPDATE ${table(c,'logtext2')} SET event=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=300`,[Buffer.from(rich)]);
        await set('editor','html_casual1');
        const baseline=await store.loadRawSnapshot(f.request('ordinary6'));assert.ok(baseline);
        // Existing complete reread binds all three independent inference inputs.
        capture.mock.restore();
        for(const kind of ['editor','import','date']){
            const hook=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,input:RenderInput){
                const output=await original.call(this,input);
                if(kind==='editor')await set('editor','html_raw0');
                if(kind==='import')await set('import_source','0');
                if(kind==='date')await admin.query(`UPDATE ${table(c,'log2')} SET logtime='2018-01-01 00:00:00' WHERE journalid=900001 AND jitemid=300`);
                return output;
            });
            const page=await get(address.port,'/users/ordinary6/76801.html');assert.equal(page.status,409);
            assert.ok(!page.body.includes('Styled editor'));assert.equal(page.headers['set-cookie'],undefined);
            hook.mock.restore();await set('editor','html_casual1');await set('import_source',null);
            await admin.query(`UPDATE ${table(c,'log2')} SET logtime=? WHERE journalid=900001 AND jitemid=300`,[baseline.entries.find(e=>e.jitemid===300)!.logtime]);
            assert.equal((await store.loadRawSnapshot(f.request('ordinary6')))!.fingerprint,baseline.fingerprint);
            assert.equal((await get(address.port,'/users/ordinary6/76801.html')).status,200);
        }
        const page=await get(address.port,'/users/ordinary6/76801.html');
        await editorsBrowser(address.port,page.body);
    }finally{capture.mock.restore();await app.close();}
}));

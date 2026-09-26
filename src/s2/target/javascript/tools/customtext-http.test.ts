// customtext-http.test.ts
//
// Selected owner literal layer and customtext through actual SQL and stock child.
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {withSelectedFixture} from './selected-fixture';
import {createAnonymousRecentService} from '../live/policy/service';
import {createLiveApp} from '../live/server/app';
import {customtextBrowser} from './customtext-browser';
import {Renderer} from '../live/render/child';
import {config,capabilities,limits} from '../live/tests/fixtures';

test('actual owner compiled customtext, source-only freshness and selected identity',{
    skip:process.env.S2_SELECTED_FIXTURE!=='1',timeout:120000},async t=>withSelectedFixture(async f=>{
    const {admin,table,g,c,store}=f;
    const native=spawnSync('perl',[resolve(__dirname,'../../tools/customtext-native.pl')],{encoding:'utf8',timeout:15000});
    assert.equal(native.status,0,native.stderr);
    const compiled=JSON.parse(native.stdout).find((row:any)=>row.kind==='wrapper'&&row.name==='basic').compiled;
    const [layers]=await admin.query<any[]>(`SELECT s2lid FROM ${table(g,'s2layers')} WHERE type='layout'`);
    const layout=Number(layers[0]!.s2lid);
    await admin.query(`INSERT INTO ${table(g,'s2layers')} (s2lid,userid,b2lid,type) VALUES(987654,900001,?,'user')`,[layout]);
    await admin.query(`INSERT INTO ${table(g,'s2info')} (s2lid,infokey,value) VALUES(987654,'type','user')`);
    await admin.query(`INSERT INTO ${table(g,'s2source_inno')} (s2lid,s2code) VALUES(987654,'SOURCE NOT INTERPRETED')`);
    await admin.query(`INSERT INTO ${table(c,'s2stylelayers2')} (userid,styleid,type,s2lid) VALUES(900001,44,'user',987654)`);
    const set=async(text:string)=>admin.query(`REPLACE INTO ${table(c,'s2compiled2')} (userid,s2lid,comptime,compdata) VALUES(900001,987654,123,?)`,[gzipSync(Buffer.from(text))]);
    await set(compiled);
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
    assert.equal(baseline.style?.layers.find(layer=>layer.type==='user')?.propertyCompiled,compiled);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
    const app=createLiveApp(config,service);
    if(process.env.S2_CUSTOMTEXT_BROWSER_OUTPUT)await app.listen({host:'127.0.0.1',port:8081});
    try {
        for(const url of ['/users/ordinary6/','/users/ordinary6/76801.html']) {
            const result=await app.inject({url,headers:{host:'localhost:8081'}});
            assert.equal(result.statusCode,200,result.body);
            assert.ok(result.body.includes('module-customtext'));
            assert.ok(result.body.includes('<b>hello</b>'));
        }
        const mutate=async(sql:string,values:unknown[])=>{
            const original=Renderer.prototype.render;
            const stub=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>){
                const html=await original.apply(this,args);await admin.query(sql,values);return html;
            });
            try {const result=await app.inject({url:'/users/ordinary6/',headers:{host:'localhost:8081'}});assert.equal(result.statusCode,409,result.body);}
            finally {stub.mock.restore();}
        };
        await mutate(`UPDATE ${table(g,'s2source_inno')} SET s2code=? WHERE s2lid=987654`,['STALE DIFFERENT SOURCE']);
        // Changed source revokes in-flight output, but the next request still
        // executes unchanged compiled literals, matching native authority.
        assert.equal((await app.inject({url:'/users/ordinary6/',headers:{host:'localhost:8081'}})).statusCode,200);
        await admin.query(`UPDATE ${table(g,'s2source_inno')} SET s2code='SOURCE NOT INTERPRETED' WHERE s2lid=987654`);
        await mutate(`UPDATE ${table(c,'s2compiled2')} SET comptime=124 WHERE userid=900001 AND s2lid=987654`,[]);
        await set(compiled);
        await mutate(`UPDATE ${table(c,'s2compiled2')} SET compdata=? WHERE userid=900001 AND s2lid=987654`,[gzipSync(Buffer.from(compiled.replace('"Title"','"Changed"')))]);
        await set(compiled);
        await mutate(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=987655 WHERE userid=900001 AND styleid=44 AND type='user'`,[]);
        await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=987654 WHERE userid=900001 AND styleid=44 AND type='user'`);
        for(const bad of [compiled+'print "BAD";\n',compiled.replace('"module_customtext_order",13','"module_customtext_order",1 + 2')]) {
            await set(bad);assert.equal((await app.inject({url:'/users/ordinary6/',headers:{host:'localhost:8081'}})).statusCode,422);
        }
        await set(compiled);
        await admin.query(`UPDATE ${table(g,'s2layers')} SET userid=900002 WHERE s2lid=987654`);
        assert.equal((await app.inject({url:'/users/ordinary6/',headers:{host:'localhost:8081'}})).statusCode,422);
        await admin.query(`UPDATE ${table(g,'s2layers')} SET userid=900001 WHERE s2lid=987654`);
        assert.equal(await store.revalidateFingerprint(baseline),true);
        const [props]=await admin.query<any[]>(`SELECT upropid FROM ${table(g,'userproplist')} WHERE name='customtext_content'`);
        const propId=Number(props[0]!.upropid);
        const rich='<p style="color: red">Custom rich</p>\nhttps://example.invalid/a?x=1&y=2\nmail@example.invalid';
        await admin.query(`INSERT INTO ${table(c,'userpropblob')} (userid,upropid,value) VALUES(900001,?,CONVERT(? USING latin1))`,[propId,Buffer.from(rich)]);
        const response=await app.inject({url:'/users/ordinary6/76801.html',headers:{host:'localhost:8081'}});
        assert.equal(response.statusCode,200,response.body);
        assert.ok(response.body.includes('Custom rich'));
        const richSnapshot=await store.loadRawSnapshot(f.request());assert.ok(richSnapshot);
        await mutate(`UPDATE ${table(c,'userpropblob')} SET value='Changed default' WHERE userid=900001 AND upropid=?`,[propId]);
        await admin.query(`UPDATE ${table(c,'userpropblob')} SET value=CONVERT(? USING latin1) WHERE userid=900001 AND upropid=?`,[Buffer.from(rich),propId]);
        assert.equal(await store.revalidateFingerprint(richSnapshot),true);
        if(process.env.S2_CUSTOMTEXT_BROWSER_OUTPUT)await customtextBrowser(response.body,8081);
        for(const value of ['@name','!markdown\n**bold**']) {
            await admin.query(`UPDATE ${table(c,'userpropblob')} SET value=CONVERT(? USING latin1) WHERE userid=900001 AND upropid=?`,[Buffer.from(value),propId]);
            assert.equal((await app.inject({url:'/users/ordinary6/76801.html',headers:{host:'localhost:8081'}})).statusCode,422,value);
        }
        await admin.query(`UPDATE ${table(c,'userpropblob')} SET value='<script>alert(1)</script>' WHERE userid=900001 AND upropid=?`,[propId]);
        const removed=await app.inject({url:'/users/ordinary6/76801.html',headers:{host:'localhost:8081'}});
        assert.equal(removed.statusCode,200);assert.ok(!removed.body.includes('alert(1)'));
        const [urlDefs]=await admin.query<any[]>(`SELECT upropid FROM ${table(g,'userproplist')} WHERE name='customtext_url'`);
        const urlId=Number(urlDefs[0]!.upropid);
        for(const value of ['javascript:alert(1)','javascri&#112;t:alert(1)','https://example.invalid/a"quote']) {
            await admin.query(`REPLACE INTO ${table(c,'userpropblob')} (userid,upropid,value) VALUES(900001,?,CONVERT(? USING latin1))`,[urlId,Buffer.from(value)]);
            assert.equal((await app.inject({url:'/users/ordinary6/76801.html',headers:{host:'localhost:8081'}})).statusCode,422,value);
        }
        await admin.query(`DELETE FROM ${table(c,'userpropblob')} WHERE userid=900001 AND upropid=?`,[urlId]);
        await admin.query(`DELETE FROM ${table(c,'userpropblob')} WHERE userid=900001 AND upropid=?`,[propId]);
        assert.equal(await store.revalidateFingerprint(baseline),true);
    } finally {await app.close();await service.close();}
}));

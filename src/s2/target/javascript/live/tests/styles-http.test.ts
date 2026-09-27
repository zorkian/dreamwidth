// styles-http.test.ts
//
// Qualified stock theme and typed overrides through SQL, child and HTTP.
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
import {gzipSync} from 'node:zlib';
import {withSelectedFixture} from '../../tools/selected-fixture';
import {createAnonymousRecentService} from '../policy/service';
import {createLiveApp} from '../server/app';
import {Renderer} from '../render/child';
import {config,capabilities,limits} from './fixtures';
import {stylesBrowser} from './styles-browser.test';

test('actual theme/user property snapshots, stylesheet, isolation and final reread',{
 skip:process.env.S2_SELECTED_FIXTURE!=='1',timeout:120000},async t=>withSelectedFixture(async f=>{
 const {admin,table,g,c,store}=f;
 const run=spawnSync('perl',['tools/styles-native.pl'],{encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);
 const rows=JSON.parse(run.stdout);const user=rows.find((row:any)=>row.compiled);
 const [layouts]=await admin.query<any[]>(`SELECT s2lid,userid FROM ${table(g,'s2layers')} WHERE type='layout'`);
 const layout=Number(layouts[0].s2lid),system=Number(layouts[0].userid);
 for(const [i,name] of ['dazzle','kelis'].entries()) {
   const id=980003+i;const row=rows.find((row:any)=>row.name===name);
   await admin.query(`INSERT INTO ${table(g,'s2layers')} (s2lid,userid,b2lid,type) VALUES(?,?,?,'theme')`,[id,system,layout]);
   await admin.query(`INSERT INTO ${table(g,'s2info')} (s2lid,infokey,value) VALUES(?,'type','theme')`,[id]);
   await admin.query(`INSERT INTO ${table(g,'s2source_inno')} (s2lid,s2code) VALUES(?,?)`,[id,row.source]);
   await admin.query(`INSERT INTO ${table(g,'s2compiled')} (s2lid,comptime) VALUES(?,123)`,[id]);
 }
 await admin.query(`INSERT INTO ${table(c,'s2stylelayers2')} (userid,styleid,type,s2lid) VALUES(900001,44,'theme',980003)`);
 await admin.query(`INSERT INTO ${table(g,'s2layers')} (s2lid,userid,b2lid,type) VALUES(980005,900001,?,'user')`,[layout]);
 await admin.query(`INSERT INTO ${table(g,'s2info')} (s2lid,infokey,value) VALUES(980005,'type','user')`);
 await admin.query(`INSERT INTO ${table(g,'s2source_inno')} (s2lid,s2code) VALUES(980005,'STALE SOURCE IS NOT INTERPRETED')`);
 await admin.query(`INSERT INTO ${table(c,'s2stylelayers2')} (userid,styleid,type,s2lid) VALUES(900001,44,'user',980005)`);
 const set=async(text:string)=>admin.query(`REPLACE INTO ${table(c,'s2compiled2')} (userid,s2lid,comptime,compdata) VALUES(900001,980005,123,?)`,[gzipSync(Buffer.from(text))]);
 await set(user.compiled);
 await admin.query(`INSERT INTO ${table(c,'userkeywords')} (userid,kwid,keyword) VALUES(900001,1,'Visible tag')`);
 await admin.query(`INSERT INTO ${table(c,'usertags')} (journalid,kwid,display) VALUES(900001,1,'1')`);
 await admin.query(`INSERT INTO ${table(c,'logkwsum')} (journalid,kwid,security,entryct) VALUES(900001,1,9223372036854775808,1)`);
 const appConfig={...config,cssCleanerHookConfigured:false};
 const service=await createAnonymousRecentService({repository:store,secretSource:store,config:appConfig,capabilities,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
 const app=createLiveApp(appConfig,service);
 if(process.env.S2_STYLES_BROWSER_OUTPUT)await app.listen({host:'127.0.0.1',port:8081});
 const get=(url='/users/ordinary6/')=>app.inject({url,headers:{host:'localhost:8081'}});
 try {
   const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
   for(const url of ['/users/ordinary6/','/users/ordinary6/76801.html']) {
     const response=await get(url);assert.equal(response.statusCode,200,response.body);
     assert.ok(response.body.includes('<style type="text/css">'));
     assert.ok(response.body.includes("class='theme-name'>Dazzle</span>"));
     assert.ok(response.body.includes(`href="${appConfig.siteRoot}/customize/?layoutid=${layout}"`));
     assert.ok(response.body.includes('#123456'));assert.ok(response.body.includes('font-family:Georgia'));
     assert.ok(response.body.includes('.entry .inner,.module{padding:.5em}'));
     assert.ok(!/\/res\/[0-9]+\/stylesheet/.test(response.body),'No retained journal CSS masking');
     assert.equal(response.headers['cache-control'],'private, no-store');
     assert.equal(await store.revalidateFingerprint(baseline),true);
   }
   if(process.env.S2_STYLES_BROWSER_OUTPUT) {
     await set(user.compiled.replace('"module_tags_show",0','"module_tags_show",1').replace('"module_tags_order",-1','"module_tags_order",19'));
     await stylesBrowser((await get('/users/ordinary6/76801.html')).body,8081);
     await set(user.compiled);
   }
   await admin.query(`INSERT INTO ${table(g,'user')} (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,opt_forcemoodtheme,moodthemeid,dversion,caps) VALUES(900003,'zvi',0,'N','V','P','Credit','Y','all','N',1,10,2)`);
   await admin.query(`INSERT INTO ${table(g,'useridmap')} (userid,user) VALUES(900003,'zvi')`);
   const present=await get();assert.equal(present.statusCode,200,present.body);assert.ok(present.body.includes("lj:user='zvi'"));
   const mutate=async(query:string,values:unknown[])=>{
     const original=Renderer.prototype.render;
     const stub=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>){const html=await original.apply(this,args);await admin.query(query,values);return html;});
     try{assert.equal((await get()).statusCode,409);}finally{stub.mock.restore();}
   };
   assert.equal(await store.revalidateFingerprint(baseline),false,'Absent credit identity is a dependency');
   await mutate(`UPDATE ${table(g,'user')} SET statusvis='D' WHERE userid=900003`,[]);
   const deletedCredit=await get();assert.equal(deletedCredit.statusCode,200);
   assert.ok(deletedCredit.body.includes("lj:user='zvi'"));
   await admin.query(`DELETE FROM ${table(g,'useridmap')} WHERE userid=900003`);
   await admin.query(`DELETE FROM ${table(g,'user')} WHERE userid=900003`);
   assert.equal(await store.revalidateFingerprint(baseline),true,'Credit absence restored');
   await mutate(`UPDATE ${table(g,'s2source_inno')} SET s2code='different' WHERE s2lid=980003`,[]);
   await admin.query(`UPDATE ${table(g,'s2source_inno')} SET s2code=? WHERE s2lid=980003`,[rows.find((row:any)=>row.name==='dazzle').source]);
   await mutate(`UPDATE ${table(c,'s2compiled2')} SET compdata=? WHERE userid=900001 AND s2lid=980005`,[gzipSync(Buffer.from(user.compiled.replace('Georgia','Arial')))]);await set(user.compiled);
   await mutate(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980004 WHERE userid=900001 AND styleid=44 AND type='theme'`,[]);
   const kelis=await get();assert.equal(kelis.statusCode,200);assert.ok(kelis.body.includes('#107d8d'));assert.ok(kelis.body.includes("class='theme-name'>Kelis</span>"));
   await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980003 WHERE userid=900001 AND styleid=44 AND type='theme'`);
   for(const value of ['Arial; color:red','</style><script>alert(1)</script>','url(https://bad.invalid)']) {
     await set(user.compiled.replace('Georgia',value));assert.equal((await get()).statusCode,422,value);
   }
   await set(user.compiled);
   for(const [query,restore] of [
     [`UPDATE ${table(g,'s2layers')} SET userid=900002 WHERE s2lid=980005`,`UPDATE ${table(g,'s2layers')} SET userid=900001 WHERE s2lid=980005`],
     [`UPDATE ${table(g,'s2layers')} SET b2lid=0 WHERE s2lid=980003`,`UPDATE ${table(g,'s2layers')} SET b2lid=${layout} WHERE s2lid=980003`],
     [`UPDATE ${table(g,'s2source_inno')} SET s2code='unqualified' WHERE s2lid=980004`,null]
   ] as [string,string|null][]) {await admin.query(query);if(query.includes('980004')){await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980004 WHERE userid=900001 AND styleid=44 AND type='theme'`);}assert.equal((await get()).statusCode,422);if(restore)await admin.query(restore);}
   await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980003 WHERE userid=900001 AND styleid=44 AND type='theme'`);
   assert.equal(await store.revalidateFingerprint(baseline),true);
   assert.equal((await get()).statusCode,200);
 } finally {await app.close();await service.close();}
}));

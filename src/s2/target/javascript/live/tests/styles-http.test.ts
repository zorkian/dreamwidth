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
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {readStartupConfig} from '../server/startup-config';
import {withSelectedFixture} from '../../tools/selected-fixture';
import {createAnonymousRecentService} from '../policy/service';
import {createLiveApp} from '../server/app';
import {Renderer} from '../render/child';
import {readPropertyLayer} from '../domain/property-layer';
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
 // Actual owning-site hook provenance, exported without connecting to DB or
 // executing callbacks. Other fixture config fields describe isolated schemas.
 const exported=mkdtempSync('/tmp/slice18-site-');
 let hook;
 try {
   const output=path.join(exported,'site.json');
   const exportRun=spawnSync('perl',['-I',path.join(process.env.LJHOME!,'cgi-bin'),'tools/site-config.pl',
     '--output',output,'--artifact',process.env.S2_LIVE_TEST_ARTIFACT!,
     '--app-origin',config.canonicalAppOrigin,'--listen-origin',config.listenOrigin],
     {encoding:'utf8',timeout:15000});
   assert.equal(exportRun.status,0,exportRun.stderr);
   hook=readStartupConfig(output).app.cssCleanerHookKind;
   assert.equal(hook,'proxy-css-links-only');
 }finally{rmSync(exported,{recursive:true,force:true});}
 const appConfig={...config,cssCleanerHookKind:hook};
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
   await set(user.compiled.replace('Georgia',JSON.stringify('"url(foo)"').slice(1,-1)));
   assert.equal((await get()).statusCode,422,'Raw hook trigger inside a legal quoted font string refuses');
   await set(user.compiled);
   for(const [query,restore] of [
     [`UPDATE ${table(g,'s2layers')} SET userid=900002 WHERE s2lid=980005`,`UPDATE ${table(g,'s2layers')} SET userid=900001 WHERE s2lid=980005`],
     [`UPDATE ${table(g,'s2layers')} SET b2lid=0 WHERE s2lid=980003`,`UPDATE ${table(g,'s2layers')} SET b2lid=${layout} WHERE s2lid=980003`],
     [`UPDATE ${table(g,'s2source_inno')} SET s2code='unqualified' WHERE s2lid=980004`,null]
   ] as [string,string|null][]) {await admin.query(query);if(query.includes('980004')){await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980004 WHERE userid=900001 AND styleid=44 AND type='theme'`);}assert.equal((await get()).statusCode,422);if(restore)await admin.query(restore);}
   await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=980003 WHERE userid=900001 AND styleid=44 AND type='theme'`);
   assert.equal(await store.revalidateFingerprint(baseline),true);
   assert.equal((await get()).statusCode,200);
   // A second immutable config snapshot models an extra unported callback. The
   // real SQL repository is shared; only this service's close ownership differs.
   const other=await createAnonymousRecentService({repository:{
     loadRawSnapshot:request=>store.loadRawSnapshot(request),
     revalidateFingerprint:snapshot=>store.revalidateFingerprint(snapshot),close:async()=>{}},
     secretSource:store,config:{...appConfig,cssCleanerHookKind:'unsupported'},capabilities,limits,
     artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
   const otherApp=createLiveApp({...appConfig,cssCleanerHookKind:'unsupported'},other);
   try {
     const refusal=await otherApp.inject({url:'/users/ordinary6/',headers:{host:'localhost:8081'}});
     assert.equal(refusal.statusCode,422);assert.equal(refusal.body,'Unsupported journal state\n');
     assert.equal(refusal.headers['cache-control'],'private, no-store');
     assert.equal(refusal.headers['set-cookie'],undefined);assert.equal(refusal.headers.location,undefined);
   }finally{await otherApp.close();await other.close();}
 } finally {await app.close();await service.close();}
}));

test('EasyRead+Aqua actual selected SQL, comments, native fallback CSS and identity freshness',{
 skip:process.env.S2_SELECTED_FIXTURE!=='1',timeout:120000},async t=>withSelectedFixture(async f=>{
 const {admin,table,g,c,store}=f;
 const run=spawnSync('perl',['tools/styles-native.pl'],{encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stderr);
 const rows=JSON.parse(run.stdout),native=rows.find((row:any)=>row.name==='easyread');
 const user=rows.find((row:any)=>row.compiled).compiled.replace('"module_tags_show",0','"module_tags_show",1').replace('"module_tags_order",-1','"module_tags_order",19');
 const [coreRows]=await admin.query<any[]>(`SELECT s2lid,userid FROM ${table(g,'s2layers')} WHERE type='core'`);
 const core=Number(coreRows[0].s2lid),system=Number(coreRows[0].userid);
 for(const [id,type,parent,source] of [[990002,'layout',core,native.layoutSource],[990003,'theme',990002,native.source]] as const) {
   await admin.query(`INSERT INTO ${table(g,'s2layers')} (s2lid,userid,b2lid,type) VALUES(?,?,?,?)`,[id,system,parent,type]);
   await admin.query(`INSERT INTO ${table(g,'s2info')} (s2lid,infokey,value) VALUES(?,'type',?)`,[id,type]);
   await admin.query(`INSERT INTO ${table(g,'s2source_inno')} (s2lid,s2code) VALUES(?,?)`,[id,source]);
   await admin.query(`INSERT INTO ${table(g,'s2compiled')} (s2lid,comptime) VALUES(?,123)`,[id]);
 }
 await admin.query(`UPDATE ${table(c,'s2stylelayers2')} SET s2lid=990002 WHERE userid=900001 AND styleid=44 AND type='layout'`);
 await admin.query(`INSERT INTO ${table(c,'s2stylelayers2')} (userid,styleid,type,s2lid) VALUES(900001,44,'theme',990003),(900001,44,'user',980005)`);
 await admin.query(`INSERT INTO ${table(g,'s2layers')} (s2lid,userid,b2lid,type) VALUES(980005,900001,990002,'user')`);
 await admin.query(`INSERT INTO ${table(g,'s2info')} (s2lid,infokey,value) VALUES(980005,'type','user')`);
 await admin.query(`INSERT INTO ${table(g,'s2source_inno')} (s2lid,s2code) VALUES(980005,'STALE SOURCE')`);
 const set=async(text:string)=>admin.query(`REPLACE INTO ${table(c,'s2compiled2')} (userid,s2lid,comptime,compdata) VALUES(900001,980005,123,?)`,[gzipSync(Buffer.from(text))]);await set(user);
 await admin.query(`INSERT INTO ${table(c,'userkeywords')} (userid,kwid,keyword) VALUES(900001,1,'Visible tag')`);
 await admin.query(`INSERT INTO ${table(c,'usertags')} (journalid,kwid,display) VALUES(900001,1,'1')`);
 await admin.query(`INSERT INTO ${table(c,'logkwsum')} (journalid,kwid,security,entryct) VALUES(900001,1,9223372036854775808,1)`);
 await admin.query(`UPDATE ${table(c,'log2')} SET replycount=2 WHERE journalid=900001 AND jitemid=300`);
 for(const [id,state,body] of [[1,'A','Public EasyRead comment'],[2,'S','HIDDEN_EASYREAD_COMMENT']] as const) {
   await admin.query(`INSERT INTO ${table(c,'talk2')} (journalid,jtalkid,nodetype,nodeid,parenttalkid,posterid,datepost,state) VALUES(900001,?,'L',300,0,0,'2026-09-26 01:00:00',?)`,[id,state]);
   await admin.query(`INSERT INTO ${table(c,'talktext2')} (journalid,jtalkid,subject,body) VALUES(900001,?,'Comment',?)`,[id,body]);
 }
 const exported=mkdtempSync('/tmp/slice19-site-');let hook;
 try {const output=path.join(exported,'site.json');const result=spawnSync('perl',['-I',path.join(process.env.LJHOME!,'cgi-bin'),'tools/site-config.pl','--output',output,'--artifact',process.env.S2_LIVE_TEST_ARTIFACT!,'--app-origin',config.canonicalAppOrigin,'--listen-origin',config.listenOrigin],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);hook=readStartupConfig(output).app.cssCleanerHookKind;}finally{rmSync(exported,{recursive:true,force:true});}
 const cfg={...config,commentSettings:f.startup.commentSettings,cssCleanerHookKind:hook};
 const service=await createAnonymousRecentService({repository:store,secretSource:store,config:cfg,capabilities:f.startup.capabilities,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
 const app=createLiveApp(cfg,service);if(process.env.S2_STYLES_BROWSER_OUTPUT)await app.listen({host:'127.0.0.1',port:8081});
 const get=(url='/users/ordinary6/')=>app.inject({url,headers:{host:'localhost:8081'}});
 try {
   for(const url of ['/users/ordinary6/','/users/ordinary6/76801.html']) {
     const baseline=await store.loadRawSnapshot(f.request('ordinary6',url.endsWith('.html')?{kind:'entry',ditemid:76801}:{kind:'recent',skip:0,itemshow:20}));assert.ok(baseline);
     const response=await get(url);assert.equal(response.statusCode,200,response.body);
     assert.ok(response.body.includes("class='theme-name'>Aqua</span>"));assert.ok(response.body.includes('>EasyRead</a>'));
     assert.ok(response.body.includes('customize/?layoutid=990002'));assert.ok(!response.body.includes('font-family:font-family'));
     assert.ok(!response.body.includes('HIDDEN_EASYREAD_COMMENT'));if(url.endsWith('.html'))assert.ok(response.body.includes('Public EasyRead comment'));
     assert.equal(await store.revalidateFingerprint(baseline),true);
   }
   if(process.env.S2_STYLES_BROWSER_OUTPUT)await stylesBrowser((await get('/users/ordinary6/76801.html')).body,8081,'easyread');
   await admin.query(`INSERT INTO ${table(c,'links')} (journalid,ordernum,parentnum,url,title,hover) VALUES(900001,1,0,'/about','Placement link','')`);
   // Exactly the new placement literals, independent of literal-set ordering.
   const placement=user.replace('1;\n# end.\n',[
     'register_set(980005,"module_userprofile_show",0);',
     'register_set(980005,"module_userprofile_order",1);',
     'register_set(980005,"module_userprofile_section","none");',
     'register_set(980005,"module_links_show",1);',
     'register_set(980005,"module_links_order",2);',
     'register_set(980005,"module_links_section","two");',
     'register_set(980005,"module_pagesummary_show",1);',
     'register_set(980005,"module_pagesummary_order",4);',
     'register_set(980005,"module_pagesummary_section","two");',
     'register_set(980005,"module_calendar_show",1);',
     'register_set(980005,"module_calendar_order",1);',
     'register_set(980005,"module_calendar_section","two");',
     'register_set(980005,"module_tags_section","two");','1;','# end.',''
   ].join('\n'));
   await set(placement);
   for(const url of ['/users/ordinary6/','/users/ordinary6/76801.html']) {
     const response=await get(url);assert.equal(response.statusCode,200,response.body);
     assert.ok(!response.body.includes('module-userprofile'));
     assert.ok(response.body.includes('Placement link'));assert.ok(response.body.includes('module-calendar'));assert.ok(response.body.includes('Monthly calendar'));assert.ok(response.body.includes('title="300 entries"'));
     assert.ok(!response.body.includes('302 entries'));assert.ok(!response.body.includes('Foreign same ID'));
     assert.ok(!response.body.includes('HIDDEN_EASYREAD_COMMENT'));
     assert.ok(response.body.indexOf('module-calendar')<response.body.indexOf('module-pagesummary'));
   }
   if(process.env.S2_STYLES_BROWSER_OUTPUT)await stylesBrowser((await get('/users/ordinary6/76801.html')).body,8081,'easyread',true);
   for(const bad of [placement.replace('"module_calendar_section","two"','"module_calendar_section","unknown"'),
     placement.replace('"module_calendar_show",1','"module_calendar_show",2'),
     placement.replace('"module_calendar_order",1','"module_calendar_order",1+1'),placement+'print "unsafe";']) {
     await set(bad);assert.equal((await get()).statusCode,422);
   }
   const originalPlacementRender=Renderer.prototype.render;
   const placementMutation=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>) {
     const html=await originalPlacementRender.apply(this,args);
     await set(placement.replace('"module_calendar_order",1','"module_calendar_order",3'));return html;
   });
   await set(placement);
   try{assert.equal((await get()).statusCode,409);}finally{placementMutation.mock.restore();}
   await set(placement);assert.equal((await get()).statusCode,200);
   await set(placement.replace('"module_userprofile_show",0','"module_userprofile_show",1').replace('"module_userprofile_section","none"','"module_userprofile_section","two"').replace('"module_userprofile_order",1','"module_userprofile_order",3'));
   const shown=await get();assert.equal(shown.statusCode,200,shown.body);assert.ok(shown.body.includes('module-userprofile'));
   await set(placement.replace('"module_calendar_section","two"','"module_calendar_section","none"'));
   const invisible=await get();assert.equal(invisible.statusCode,200);assert.ok(!invisible.body.includes('module-calendar'));
   await set(placement.replace('"module_calendar_order",1','"module_calendar_order",-1').replace('"module_calendar_section","two"','"module_calendar_section","none"'));
   assert.equal((await get()).statusCode,422,'Negative assignment to empty none fails rather than hiding it');
   await set(placement);assert.equal((await get()).statusCode,200,'Valid page after index refusal');
   await set(placement.replace('"module_links_order",2','"module_links_order",-1'));
   const negative=await get();assert.equal(negative.statusCode,200,negative.body);
   assert.ok(negative.body.includes('Placement link'));assert.ok(negative.body.includes('module-calendar'));
   // Earlier native navlinks at index10 seed this section, so -1 targets10,
   // not calendar at1. Preserve assignment-time length rather than sorting.
   // Credit executes after links in modules_init and overwrites the shared slot.
   await set(placement.replace('"module_links_order",2','"module_links_order",15'));
   const collision=await get();assert.equal(collision.statusCode,200,collision.body);
   assert.ok(collision.body.includes('module-credit'));assert.ok(!collision.body.includes('Placement link'));
   const nativeTypography=rows.find((row:any)=>row.name==='typography'&&row.layout==='easyread');
   const typography=placement.replace('1;\n# end.\n',nativeTypography.compiled.split('\n')
     .filter((line:string)=>line.startsWith('register_set(')).map((line:string)=>line.replace('990006','980005')).join('\n')+'\n1;\n# end.\n');
   await set(typography);
   for(const url of ['/users/ordinary6/','/users/ordinary6/76801.html']) {
     const response=await get(url);assert.equal(response.statusCode,200,response.body);
     assert.ok(response.body.includes('font-family:Verdana,Georgia,sans-serif;font-size:2em'));
     assert.ok(response.body.includes('font-family:Courier New,Georgia,sans-serif;font-size:120%'));
     assert.ok(response.body.includes('font-family:Times New Roman,Georgia,sans-serif'));
     assert.ok(!response.body.includes('HIDDEN_EASYREAD_COMMENT'));
   }
   if(process.env.S2_STYLES_BROWSER_OUTPUT)await stylesBrowser((await get('/users/ordinary6/76801.html')).body,8081,'easyread',true,true);
   for(const value of [typography.replace('"font_entry_title_size","120"','"font_entry_title_size","1px;color:red"'),
     typography.replace('"font_entry_title_units","%"','"font_entry_title_units","%;color:red"'),
     typography.replace('"font_module_heading","Georgia"','"font_module_heading"," "')]) {
     await set(value);assert.equal((await get()).statusCode,422);
   }
   await set(typography.replace('"font_entry_title_size","120"','"font_entry_title_size","1px;color:red"').replace('"font_entry_title_units","%"','"font_entry_title_units",""'));
   const notEmitted=await get();assert.equal(notEmitted.statusCode,200,notEmitted.body);assert.ok(!notEmitted.body.includes('color:red'));
   // Individually EOF-repaired pieces must not concatenate into extra CSS.
   const twoPart=typography.replace('"font_entry_title","Courier New"','"font_entry_title","Georgia /*"')
     .replace('"font_base","Georgia"','"font_base","'+String.raw`\"*/ } .pwn{color:#123457} /*\"`+'"');
   const decodedTwoPart=readPropertyLayer(twoPart,980005);
   assert.equal(decodedTwoPart.font_entry_title,'Georgia /*');
   assert.equal(decodedTwoPart.font_base,'"*/ } .pwn{color:#123457} /*"');
   await set(twoPart);assert.equal((await get()).statusCode,422,'Token-closed scalar proof prevents two-part CSS injection');
   await set(typography);assert.equal((await get()).statusCode,200,'Valid recovery after two-part payload');
   await set(typography);
   const originalTypographyRender=Renderer.prototype.render;
   const typographyMutation=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>) {
     const html=await originalTypographyRender.apply(this,args);await set(typography.replace('"font_entry_title_size","120"','"font_entry_title_size","125"'));return html;
   });
   try{assert.equal((await get()).statusCode,409);}finally{typographyMutation.mock.restore();}
   await set(typography);assert.equal((await get()).statusCode,200);
   await set(user);
   for(const [id,name] of [[900003,'rb'],[900004,'krja']] as const) {
     await admin.query(`INSERT INTO ${table(g,'user')} (userid,user,clusterid,status,statusvis,journaltype,name,opt_showtalklinks,opt_whocanreply,opt_forcemoodtheme,moodthemeid,dversion,caps) VALUES(?,?,0,'N','V','P','Credit','Y','all','N',1,10,2)`,[id,name]);
     await admin.query(`INSERT INTO ${table(g,'useridmap')} (userid,user) VALUES(?,?)`,[id,name]);
   }
   const present=await get();assert.equal(present.statusCode,200,present.body);assert.ok(present.body.includes("lj:user='rb'"));assert.ok(present.body.includes("lj:user='krja'"));
   const mutate=async(query:string,values:unknown[])=>{const original=Renderer.prototype.render;const stub=t.mock.method(Renderer.prototype,'render',async function(this:Renderer,...args:Parameters<Renderer['render']>){const html=await original.apply(this,args);await admin.query(query,values);return html;});try{assert.equal((await get()).statusCode,409);}finally{stub.mock.restore();}};
   await mutate(`UPDATE ${table(g,'user')} SET statusvis='D' WHERE userid=900003`,[]);await admin.query(`UPDATE ${table(g,'user')} SET statusvis='V' WHERE userid=900003`);
   await mutate(`UPDATE ${table(g,'s2compiled')} SET comptime=124 WHERE s2lid=990002`,[]);await admin.query(`UPDATE ${table(g,'s2compiled')} SET comptime=123 WHERE s2lid=990002`);
   await mutate(`UPDATE ${table(c,'s2compiled2')} SET compdata=? WHERE userid=900001 AND s2lid=980005`,[gzipSync(Buffer.from(user.replace('Georgia','Arial')))]);await set(user);
   await admin.query(`DELETE FROM ${table(c,'s2stylelayers2')} WHERE userid=900001 AND styleid=44 AND type='theme'`);assert.equal((await get()).statusCode,422);
   await admin.query(`INSERT INTO ${table(c,'s2stylelayers2')} (userid,styleid,type,s2lid) VALUES(900001,44,'theme',990003)`);
   for(const [query,restore] of [[`UPDATE ${table(g,'s2layers')} SET b2lid=0 WHERE s2lid=990003`,`UPDATE ${table(g,'s2layers')} SET b2lid=990002 WHERE s2lid=990003`],[`UPDATE ${table(g,'s2layers')} SET userid=900002 WHERE s2lid=990002`,`UPDATE ${table(g,'s2layers')} SET userid=${system} WHERE s2lid=990002`]]){await admin.query(query!);assert.equal((await get()).statusCode,422);await admin.query(restore!);}
   await admin.query(`UPDATE ${table(g,'s2source_inno')} SET s2code=? WHERE s2lid=990003`,[rows.find((row:any)=>row.name==='dazzle').source]);
   assert.equal((await get()).statusCode,422,'A Tabula theme cannot pair with EasyRead');
   await admin.query(`UPDATE ${table(g,'s2source_inno')} SET s2code=? WHERE s2lid=990003`,[native.source]);
   assert.equal((await get()).statusCode,200);
 }finally{await app.close();await service.close();}
}));

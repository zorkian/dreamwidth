// styles-native.test.ts
//
// Independent native stock themes, inert typed overrides and catalog integrity.
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
import {resolve} from "node:path";
import {readPropertyLayer} from "../domain/property-layer";
import {Context} from "../../runtime/s2runtime";
import {renderStock} from "../render/engine";
import {approveSnapshot} from "../policy/cohort";
import {snapshot,config,capabilities,now} from "./fixtures";
import {loadResourceTimes} from "../render/resources";
import {callbacks} from "../render/builtins";
import type {RenderInput,RenderContentPreparation} from "../render/types";
import {cssMultiplyLength} from "../render/builtins";
import {builtin} from "../../runtime/s2runtime";
import {validateArtifact} from "../render/artifact";
import {cleanStockStylesheet,validateStockFontFamily} from "@dreamwidth/content";

test("native Color/scalar wrapper and two stock stylesheet identities",()=>{
 const run=spawnSync("perl",[resolve("tools/styles-native.pl")],{encoding:"utf8",timeout:20000});
 assert.equal(run.status,0,run.stderr);const rows=JSON.parse(run.stdout);
 for(const row of rows.filter((row:any)=>row.name==='multiply'))assert.equal(cssMultiplyLength(row.input,2),row.value,row.input);
 const absent=rows.find((row:any)=>row.name==='absent-color');
 assert.equal(absent.before,0);assert.equal(absent.after,0);assert.equal(absent.css,'');assert.equal(absent.emptyDefined,1);assert.equal(absent.emptyString,'');assert.equal(absent.fallback.as_string,'#f8f1e0');
 for(const row of rows.filter((row:any)=>row.name==='credit')) {
   assert.equal(row.defined,row.state==='missing'?0:1);
   if(row.state==='missing')assert.equal(row.rendered,'zvi');
   else assert.ok(row.rendered.includes("lj:user='zvi'"));
 }
 const user=rows.find((row:any)=>row.name==='user-after-theme');
 assert.deepEqual({...readPropertyLayer(user.compiled,980005)}, {color_page_background:'#123456',font_base:'Georgia',module_tags_show:0,module_tags_order:-1});
 for(const row of rows.filter((row:any)=>row.name==='color')) {
   const value=builtin.construct_Color(row.input);
   if(row.value===null)assert.equal(value,undefined);
   else {assert.equal(value?.['.type'],'Color');assert.equal(value?._as_string,row.value.as_string);
     for(const channel of ['r','g','b'])assert.equal(value?.['_'+channel],row.value[channel]);}
 }
 for(const row of rows.filter((row:any)=>row.css)) {
   const name=row.name;assert.equal(row.title,name==='dazzle'?'Dazzle':'Kelis');
   const css=cleanStockStylesheet(row.css);assert.ok(css.includes('.entry .inner,.module{padding:.5em}'));
   assert.ok(css.includes(name==='dazzle'?'#00eeff':'#f8f1e0'));
 }
 for(const bad of [user.compiled+'print "BAD";',user.compiled.replace('Color__Color','other'),user.compiled.replace('#123456','javascript:bad')])assert.throws(()=>readPropertyLayer(bad,980005));
 for(const value of ['Georgia','Times New Roman','"Open Sans", Arial, serif'])validateStockFontFamily(value);
 for(const value of ['Arial; color:red','url(https://bad.invalid)','</style><script>x</script>','var(--font)'])assert.throws(()=>validateStockFontFamily(value));
 const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT!,'utf8')));
 assert.equal(artifact.themes?.length,2);
 for(const change of [(a:any)=>a.themes[0].code+='x',(a:any)=>a.themes[0].sourceHash='0'.repeat(64),(a:any)=>a.themes[1]=a.themes[0]]) {
   const copy=structuredClone(artifact);change(copy);assert.throws(()=>validateArtifact(copy));
 }
});


test("theme credit freezes complete prepared emission and refuses later altered chunks",()=>{
 const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT!,'utf8')));
 const cfg={...config,cssCleanerHookKind:'none' as const};
 const journal={...approveSnapshot(snapshot(),cfg,capabilities),theme:'dazzle' as const,themeLayoutId:980002,inlineStylesheet:true,
   themeAuthors:[{name:'zvi',author:{userid:900003,username:'zvi',badgeKind:'personal' as const,badgeDeleted:false}}]};
 const input:RenderInput={page:{kind:'recent',pageSkip:0,itemshow:20,maxScrollback:100,hasPrevious:false},journal,config:cfg,skip:0,skipPresent:false,
   nowSeconds:now,formChallenge:'public-challenge',uniq:'AAAAAAAAAAAAAAA',resourceTimes:loadResourceTimes()};
 const content:RenderContentPreparation={body:()=>'<p>Body</p>',subject:entry=>({html:entry.subject,recentHtml:entry.subject,all:entry.subject}) as import('@dreamwidth/content/contracts').SubjectPreparation,metadata:()=>{throw new Error('Unexpected metadata');},
   stylesheet:cleanStockStylesheet,fontFamily:validateStockFontFamily};
 assert.ok(renderStock(artifact,input,2097152,content).includes("lj:user='zvi'"));
 assert.ok(renderStock(artifact,{...input,journal:{...journal,themeAuthors:[{name:'zvi',author:null}]}},2097152,content).includes("class='style-author'>zvi</span>"));
 for(const hook of [undefined,'unsupported'] as const)assert.throws(()=>renderStock(artifact,{...input,config:{...cfg,cssCleanerHookKind:hook}},2097152,content),/Missing qualified stylesheet/);
 const original=Context.prototype.runMethod;
 Context.prototype.runMethod=function(value,name){
   if(name==='print()'&&(value as any)['.type']==='RecentPage')this.prop._text_theme_authors='changed';
   return original.call(this,value,name);
 };
 try {assert.throws(()=>renderStock(artifact,input,2097152,content),/Unsupported safe HTML attribute style/);}
 finally{Context.prototype.runMethod=original;}
 const lookup=callbacks({}, {theme_users:{zvi:null}})._UserLite!;
 assert.throws(()=>lookup({} as Context,'unplanned'),/Unplanned theme user/);
});

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
import {cleanStockStylesheet,validateStockFontFamily,validateStockFontSize} from "@dreamwidth/content";

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
 for(const row of rows.filter((row:any)=>row.name==='module-properties')) {
   assert.deepEqual({...readPropertyLayer(row.compiled,990004)},row.values);
   assert.equal(Object.keys(row.values).length,13);assert.equal(row.values.module_links_order,9);
   for(const bad of [row.compiled.replace('"module_links_order",9','"module_links_order",1+8'),
     row.compiled.replace('"module_links_show",1','"module_links_show",2'),
     row.compiled.replace('"module_links_section","two"','"module_links_section",1'),
     row.compiled.replace('"module_links_order"','"unknown_order"'),row.compiled+'# trailing'])
       assert.throws(()=>readPropertyLayer(bad,990004));
 }
 for(const row of rows.filter((row:any)=>row.name==='module-placement')) {
   if(row.case==='collision')assert.deepEqual(row.sections.one[2],['links']);
   if(row.case==='none')assert.deepEqual(row.sections.none[2],['userprofile']);
   if(row.case==='seeded-negative')assert.deepEqual(row.sections.one[1],['userprofile']);
   if(row.case.endsWith('negative')&&row.case!=='seeded-negative')assert.match(row.error,/non-creatable array/);
   else assert.equal(row.error,'');
   if(row.case==='credit-slot')assert.ok(Object.values(row.sections).some((section:any)=>section.some((item:any)=>item?.[0]==='credit')));
 }
 const helperExpected:Record<string,string>={specific:'font-family: Specific, Base, serif; font-size: 1.25em;',
   inherit:'font-family: Base, serif; ',fallback:'font-family: serif; ',empty:'',
   'not-emitted':'font-family: Base; ','emitted-injection':'font-family: Base; font-size: 1px;color:redpx;'};
 for(const row of rows.filter((row:any)=>row.name==='typography-helper'))assert.equal(row.output,helperExpected[row.case]);
 for(const row of rows.filter((row:any)=>row.name==='typography')) {
   assert.deepEqual({...readPropertyLayer(row.compiled,990006)},row.values);assert.equal(Object.keys(row.values).length,18);
   for(const bad of [row.compiled.replace('"font_entry_title_size","120"','"font_entry_title_size",120'),
     row.compiled.replace('"font_entry_title_size"','"unknown_font_units"'),row.compiled+'print "BAD";'])
       assert.throws(()=>readPropertyLayer(bad,990006));
 }
 for(const row of rows.filter((row:any)=>row.name==='typography-css')) {
   const css=cleanStockStylesheet(row.css,row.layout==='easyread'?'easyread-aqua':undefined);
   assert.ok(css.includes('font-size:1.25em'));assert.ok(css.includes('font-size:120%'));
   assert.ok(css.includes('font-family:Verdana'));assert.ok(css.includes('font-family:Courier New'));
   if(row.layout==='easyread'){assert.equal((row.css.match(/font-family: font-family:/g)||[]).length,2);assert.ok(row.css.includes('; font-size: 1em;'));}
 }
 for(const row of rows.filter((row:any)=>row.name==='base-typography')) {
   assert.deepEqual({...readPropertyLayer(row.compiled,990007)}, {font_fallback:'serif',font_base_size:'1.25',font_base_units:'em'});
   const expected:Record<string,string>={'family-size':'font-family: serif; font-size: 1.25em;',
     'family-only':'font-family: serif; ','size-only':'font-size: 1.25em;',neither:'','tabula-control':'font-family: serif; font-size: 1.25em;'};
   assert.equal(row.pageFont,expected[row.case]);
   const expectation={pageFont:row.pageFont,entryColor:'color: #cdc1ac'};
   const css=cleanStockStylesheet(row.css,row.case==='tabula-control'?undefined:'easyread-aqua',row.case==='tabula-control'?undefined:expectation);
   assert.ok(!css.includes('font-family:font-family'));assert.ok(!css.includes('font-family:font-size'));
   assert.equal(css.includes('font-size:1.25em'),['family-size','tabula-control'].includes(row.case));
   if(row.case!=='tabula-control') {
     assert.ok(css.includes('background-color:#13383e'));
     const container=css.match(/#primary,#secondary,#tertiary,#footer\{([^}]+)\}/)![1]!;
     assert.equal(container.includes('color:#cdc1ac'),row.case!=='neither');
     for(const bad of [row.css.replace('font-family: '+(row.pageFont||'\n    color:'),'font-family: other '+(row.pageFont||'\n    color:')),row.css+'p{broken:;',
       ...(row.case==='neither'?[row.css.replace('font-family: \n    color: #cdc1ac','font-family: \n    color: #123456')]:[])])assert.throws(()=>cleanStockStylesheet(bad,'easyread-aqua',expectation));
     assert.throws(()=>cleanStockStylesheet(row.css,'easyread-aqua',{...expectation,pageFont:row.pageFont+'font-size:1em;'}));
     if(row.case==='family-only')assert.ok(cleanStockStylesheet(row.css.replaceAll('font-family: serif;', 'font-family:  serif ;'),
       'easyread-aqua',{...expectation,pageFont:'font-family:  serif ; '}));
   }
 }
 const presentation=rows.find((row:any)=>row.name==='presentation');
 assert.deepEqual({...readPropertyLayer(presentation.compiled,990008)}, {entry_userpic_style:'small',comment_userpic_style:'smaller',userpics_position:'right',entry_metadata_position:'top'});
 for(const row of rows.filter((row:any)=>row.name==='presentation-size')) {
   const expected:Record<string,number[]>={'':[101,99],small:[75.75,74.25],smaller:[50.5,49.5],unknown:[101,99]};
   assert.deepEqual([row.width,row.height],expected[row.style]);
   assert.ok(row.image.includes(`height="${row.height}" width="${row.width}"`));
 }
 for(const row of rows.filter((row:any)=>row.name==='presentation-css')) {
   const css=cleanStockStylesheet(row.css,row.layout==='easyread'?'easyread-aqua':undefined);
   assert.ok(css.includes('text-align:right'));
   if(row.layout==='easyread')assert.ok(css.includes('margin-right:85px'));
 }
 const user=rows.find((row:any)=>row.name==='user-after-theme');
 assert.deepEqual({...readPropertyLayer(user.compiled,980005)}, {color_page_background:'#123456',font_base:'Georgia',module_tags_show:0,module_tags_order:-1});
 for(const row of rows.filter((row:any)=>row.name==='color')) {
   const value=builtin.construct_Color(row.input);
   if(row.value===null)assert.equal(value,undefined);
   else {assert.equal(value?.['.type'],'Color');assert.equal(value?._as_string,row.value.as_string);
     for(const channel of ['r','g','b'])assert.equal(value?.['_'+channel],row.value[channel]);}
 }
 for(const row of rows.filter((row:any)=>['dazzle','kelis'].includes(row.name))) {
   const name=row.name;assert.equal(row.title,name==='dazzle'?'Dazzle':'Kelis');
   const css=cleanStockStylesheet(row.css);assert.ok(css.includes('.entry .inner,.module{padding:.5em}'));
   assert.ok(css.includes(name==='dazzle'?'#00eeff':'#f8f1e0'));
 }
 for(const row of rows.filter((row:any)=>row.name==='easyread')) {
   assert.throws(()=>cleanStockStylesheet(row.css));
   const css=cleanStockStylesheet(row.css,'easyread-aqua');
   assert.ok(!css.includes('font-family:font-family'));
   assert.ok(!css.includes('.metadata-label:first'));
   assert.ok(css.includes('.module-content{font-family:'+(row.control==='present'?'Georgia':row.control==='empty'?'sans-serif':'APHont')));
   for(const bad of [row.css+'p{broken:;',row.css.replace('font-family: font-family:','font-family: other:'),
     row.css.replace('text-transform: uppercase','color: red'),row.css+'/* URL(foo) */',
     row.css.replace('color: ;','color: red;')])assert.throws(()=>cleanStockStylesheet(bad,'easyread-aqua'));
 }
 for(const bad of [user.compiled+'print "BAD";',user.compiled.replace('Color__Color','other'),user.compiled.replace('#123456','javascript:bad')])assert.throws(()=>readPropertyLayer(bad,980005));
 for(const value of ['Georgia','Times New Roman','"Open Sans", Arial, serif'])validateStockFontFamily(value);
 for(const value of ['Arial; color:red','url(https://bad.invalid)','</style><script>x</script>','var(--font)'])assert.throws(()=>validateStockFontFamily(value));
 const artifact=validateArtifact(JSON.parse(readFileSync(process.env.S2_LIVE_TEST_ARTIFACT!,'utf8')));
 assert.equal(artifact.themes?.length,artifact.layouts?3:2);
 if(artifact.layouts)for(const change of [(a:any)=>a.layouts[0].code+='x',(a:any)=>a.layouts[0].sourceHash='0'.repeat(64),
   (a:any)=>a.themes=a.themes.filter((theme:any)=>theme.name!=='aqua')]) {
   const copy=structuredClone(artifact);change(copy);assert.throws(()=>validateArtifact(copy));
 }
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
   stylesheet:(source)=>cleanStockStylesheet(source),fontFamily:validateStockFontFamily,fontSize:validateStockFontSize};
 assert.ok(renderStock(artifact,input,2097152,content).includes("lj:user='zvi'"));
 const typed={...input,journal:{...journal,customtextProperties:{font_entry_title:'Verdana'}}};
 assert.throws(()=>renderStock(artifact,typed,2097152,{...content,fontSize:undefined}));
 assert.ok(renderStock(artifact,typed,2097152,content).includes('font-family:Verdana'));

 assert.ok(renderStock(artifact,{...input,journal:{...journal,themeAuthors:[{name:'zvi',author:null}]}},2097152,content).includes("class='style-author'>zvi</span>"));
 for(const hook of [undefined,'unsupported'] as const)assert.throws(()=>renderStock(artifact,{...input,config:{...cfg,cssCleanerHookKind:hook}},2097152,content),/Missing qualified stylesheet/);
 const original=Context.prototype.runMethod;
 Context.prototype.runMethod=function(value,name){
   if(name==='print()'&&(value as any)['.type']==='RecentPage')this.prop._text_theme_authors='changed';
   return original.call(this,value,name);
 };
 try {assert.throws(()=>renderStock(artifact,input,2097152,content),/Unsupported safe HTML attribute style/);}
 finally{Context.prototype.runMethod=original;}
 const fallbackInput={...input,journal:{...journal,customtextProperties:{font_fallback:'serif',font_base_size:'1.25',font_base_units:'em'}}};
 const families:string[]=[];
 renderStock(artifact,fallbackInput,2097152,{...content,fontFamily:value=>{validateStockFontFamily(value);families.push(value);}});
 assert.equal(families.filter(value=>value==='serif').length,7,'Fallback proof reaches all seven emitting contexts');
 assert.throws(()=>renderStock(artifact,fallbackInput,2097152,{...content,fontSize:undefined}));
 const lookup=callbacks({}, {theme_users:{zvi:null}})._UserLite!;
 assert.throws(()=>lookup({} as Context,'unplanned'),/Unplanned theme user/);
});

// page-output.test.mjs
//
// Independent native streaming page-output qualification.
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
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPageOutput} from '../dist/page-output.js';
const nativeRows=name=>JSON.parse(execFileSync('bash',['-c','ulimit -v 131072; ulimit -t 5; exec perl "$1"','native',fileURLToPath(new URL(name,import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}));
const native=nativeRows('./page-output-native.pl');
const {concatenate}=await import('../dist/page-chunks.js');
const policy={domain:'example.org',webDomain:'www.example.org',statPrefix:'https://static.example.org',trustedHosts:{'trusted.test':true},cssCleanerEnabled:true,cssProxy:null};
function session(contentType='text/html',extra={}) {
 const chunks=[];
 const output=createPageOutput({contentType,stylesheet:policy,limits:{maxInputBytes:1024*1024,maxOutputBytes:1024*1024,timeoutMs:1000},output:chunk=>chunks.push(chunk),checkDepth:()=>{},transformCss:chunk=>chunk,expandEmbed:chunk=>chunk,...extra});
 return {output,chunks,bytes:()=>Buffer.from(concatenate(chunks).bytes)};
}
for(const row of native) test(`native ${row.id}`,()=>{
 assert.equal(row.ok,1);
 const {output,bytes}=session(row.ctype,{stylesheet:{...policy,cssProxy:row.cssProxy??null}});
 for(const [op,value,flag] of row.trace){
  const chunk={bytes:Buffer.from(value??'','base64'),utf8:!!flag};
  if(op==='safe')output.printSafe(chunk);else if(op==='raw')output.printRaw(chunk);else if(op==='start')output.startCss();else output.endCss();
 }
 output.finish();
 assert.deepEqual(bytes(),Buffer.from(row.base64,'base64'));
});
test('copies scalar input and prevents page-to-page eating leakage',()=>{
 const first=session();first.output.printSafe({bytes:Buffer.from('<script>never'),utf8:false});first.output.finish();assert.equal(first.bytes().toString(),'never');
 const second=session();const raw=Buffer.from('<b>visible</b>');second.output.printSafe({bytes:raw,utf8:false});raw.fill(0);second.output.finish();assert.equal(second.bytes().toString(),'<b>visible</b>');
});
test('output/input/deadline and completed-session bounds fail closed',()=>{
 const s=session('text/plain',{limits:{maxInputBytes:3,maxOutputBytes:3,timeoutMs:1000}});
 assert.throws(()=>s.output.printRaw({bytes:Buffer.from('four'),utf8:false}),/input bound/);
 const ended=session();ended.output.finish();assert.throws(()=>ended.output.printSafe({bytes:Buffer.from('x'),utf8:false}),/finished/);
});

const {cleanPageCss}=await import('../dist/page-css.js');
const cssNative=nativeRows('./page-css-native.pl');
for(const [index,row] of cssNative.entries())test(`native CSS ${index}`,()=>{
 if(row.error){assert.throws(()=>cleanPageCss(row.input,false));return;}
 assert.equal(cleanPageCss(row.input,false),row.plain);
 assert.equal(cleanPageCss(row.input,true),row.sheet);
});
test('neutral raw scalar flags/copies and native parser byte-entry are retained',()=>{
 const raw=session('text/plain');const input={bytes:Buffer.from('é'),utf8:true};raw.output.printRaw(input);input.bytes.fill(0);raw.output.finish();
 assert.equal(raw.chunks[0].utf8,true);assert.deepEqual(raw.bytes(),Buffer.from('é'));
 const downgraded=session();downgraded.output.printSafe({bytes:Buffer.from('é'),utf8:true});downgraded.output.finish();
 assert.deepEqual(downgraded.bytes(),Buffer.from([0xe9]));assert.equal(downgraded.chunks[0].utf8,false);
 assert.throws(()=>session().output.printSafe({bytes:Buffer.from('猫'),utf8:true}),/Wide character/);
});

test('native print checkpoint cadence excludes buffered CSS prints',()=>{
 let checks=0;const s=session('text/plain',{checkDepth:()=>checks++});
 for(let i=0;i<7;i++)s.output.printRaw({bytes:Buffer.from('x'),utf8:false});
 s.output.startCss();for(let i=0;i<20;i++)s.output.printSafe({bytes:Buffer.from(' '),utf8:false});
 assert.equal(checks,0);s.output.endCss();assert.equal(checks,1);s.output.finish();
});

test('native false CSS proxy scalar does not create a destination',async()=>{
 const {stylesheetDestination}=await import('../dist/page-css.js');
 assert.equal(stylesheetDestination('https://outside.test/x.css',{...policy,cssProxy:'0'}),false);
});

// native-autoviv.test.ts
//
// Native nested-reference semantics through the current S2 source backend.
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
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {ArtifactCompiler,instantiateProgram,type ActiveStyleSnapshot} from '../live/render/layer-artifact';
import {Context,runtime} from '../runtime/s2runtime';
import {NativeOutput,NativeString} from '../runtime/native-string';
import {scalarPV,isNativeProgramError} from '../runtime/native-scalar';
const oracle=JSON.parse(execFileSync('/usr/bin/prlimit',['--as=268435456','--cpu=10','--','perl','-e',String.raw`
use strict;use warnings;use JSON::PP;use MIME::Base64 qw(encode_base64);
use lib '/workspaces/dreamwidth/src/s2';use S2;use S2::Compiler;use S2::Checker;
open my$f,'<:raw','/workspaces/dreamwidth/src/s2/tests/js-autoviv/program.s2' or die'fixture';local$/;my$source=<$f>;my$copy=$source;my$code='';
S2::Compiler->new({checker=>S2::Checker->new})->compile_source({type=>'core',source=>\$copy,output=>\$code,layerid=>101,builtinPackage=>'S2::Builtin'});
S2::load_layer(101,$code);my$ctx=S2::make_context(101);my$out='';S2::set_output(sub{$out.=$_[0]});S2::set_output_safe(sub{$out.=$_[0]});S2::run_code($ctx,'main()');my$error;eval{S2::run_code($ctx,'fail()');1}or$error=$@;
my$x;my$v=$x->{a};my$y;my$w=$y->[2]{b};my$z={a=>undef};my$t=$z->{a}{b};my$k;my$q=$k->{do{die'order'unless ref$k eq'HASH';'v'}};
print JSON::PP->new->canonical->encode({source=>encode_base64($source,''),code=>encode_base64($code,''),output=>encode_base64($out,''),error=>$error,
 read=>[ref$x,exists$x->{a}?1:0,ref$y,ref$y->[2],exists$y->[2]{b}?1:0,ref$z->{a}],defined=>[map{S2::check_defined($_)?1:0}({}, {_type=>''},{_type=>'X',_isnull=>'0'},{_type=>'X',_isnull=>'1'})]});
`],{encoding:'utf8',timeout:15000,maxBuffer:1048576}));
const text=NativeString.hostUtf8Bytes;
test('current source preserves visible nested-reference output and null picture handling',async()=>{
 const expected='initial=null:read=:write=7:untyped:direct=8:null:key=1:entry=9:hash=11:alias=13:array=14:retained=13:newroot-null:recent=7:null:entry=7:null:undef=:::arithmetic=2:rhs=2:done\n';
 assert.equal(Buffer.from(oracle.output,'base64').toString(),expected);assert.match(oracle.error,/null Image object/);
 const directory=mkdtempSync(join(tmpdir(),'native-autoviv-'));
 try{const launcher=join(directory,'compiler-isolation');execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',resolve('tools/compiler-isolation.c'),'-o',launcher]);
 const compiler=new ArtifactCompiler({s2Root:resolve('../..'),perl:'/usr/bin/perl',isolationExecutable:launcher});
 const snapshot:ActiveStyleSnapshot={styleId:71,systemUserId:1,layers:[{id:101,ownerId:1,parentId:0,type:'core',sourceBytes:Buffer.from(oracle.source,'base64')}]};
 const source=await compiler.compile(snapshot);assert.equal(source.kind,'compiled');
 if(source.kind!=='compiled')throw Error('S2 source compilation required');
 const layers=instantiateProgram(source.program);
 const output=new NativeOutput(),ctx=new Context([...layers],()=>{throw Error('legacy output');},undefined,undefined,undefined,500,{raw:v=>output.append(v),safe:v=>output.append(v)});
 ctx.runNativeFunction('main()');assert.equal(output.bytes().toString('base64'),oracle.output);
 assert.throws(()=>ctx.runNativeFunction('fail()'),error=>isNativeProgramError(error)&&/null object/.test((error as Error).message));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('native read containers, missing final fields and private hash identity',()=>{
 let x:unknown;const root={get:()=>x,set:(value:unknown)=>x=value};const hash=runtime.referenceValue(root,'hash');
 const a=runtime.memberSlot(hash,text('a'),'hash');assert.equal(a.get(),undefined);assert.equal(a.exists(),false);
 let y:unknown;const array=runtime.referenceValue({get:()=>y,set:v=>y=v},'array');const index=runtime.memberSlot(array,text('2'),'array');const element=runtime.referenceValue(index,'hash');
 const b=runtime.memberSlot(element,text('b'),'hash');assert.equal(b.exists(),false);
 const z=runtime.makeHash([[text('a'),undefined]]),zchild=runtime.referenceValue(runtime.memberSlot(z,text('a'),'hash'),'hash');
 assert.deepEqual([Object.getPrototypeOf(hash)===null?'HASH':'',a.exists()?1:0,Array.isArray(y)?'ARRAY':'',Object.getPrototypeOf(element)===null?'HASH':'',b.exists()?1:0,Object.getPrototypeOf(zchild)===null?'HASH':''],oracle.read);
 runtime.memberSlot(hash,'_width','field').set(text('7'));assert.equal(scalarPV(runtime.memberSlot(hash,text('width'),'hash').get()).bytes().toString(),'7');assert.equal(runtime.isDefined(hash),false);
 assert.deepEqual([runtime.makeHash([]),{'.type':''},{'.type':'X','.isnull':text('0')},{'.type':'X','.isnull':text('1')}].map(value=>runtime.isDefined(value)?1:0),oracle.defined);
});
test('Context and prototype fields cannot acquire reference authority',()=>{
 const ctx=new Context([],()=>{});assert.throws(()=>runtime.referenceValue({get:()=>ctx,set:()=>{throw Error('unexpected');}},'hash'),/Context/);
 assert.throws(()=>runtime.memberSlot(ctx,text('prop'),'hash'),/receiver/);
 const hash=runtime.makeHash([]);runtime.memberSlot(hash,text('__proto__'),'hash').set(text('inert'));assert.equal(Object.getPrototypeOf(hash),null);
});

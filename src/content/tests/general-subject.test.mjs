// general-subject.test.mjs
//
// Independent native byte, flag and helper/eval ordering for subject cleaning.
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
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {cleanGeneralSubject} from '../dist/general-subject.js';
import {concatenate,scalarView,viewChunk} from '../dist/page-chunks.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {nativeCharacterClass}=require('../../s2/target/javascript/dist/runtime/native-profile.js');
const profileProbe=spawnSync('perl',['tools/compile-active.pl'],{cwd:fileURLToPath(new URL('../../s2/target/javascript/',import.meta.url)),input:JSON.stringify({profileOnly:true}),encoding:'utf8',timeout:10000,maxBuffer:1048576});
assert.equal(profileProbe.status,0,profileProbe.stderr);
const profile=JSON.parse(profileProbe.stdout).profile;
const characterClass=(kind,cp,utf8)=>nativeCharacterClass(profile,kind,cp,utf8);
const limits={maxInputBytes:1024*1024,maxOutputBytes:2*1024*1024,timeoutMs:10000};
const none=value=>({value,exceptionEffect:{kind:'none'}});
const b64=chunk=>Buffer.from(chunk.bytes).toString('base64');
const native=spawnSync('prlimit',['--as=268435456','--cpu=10','timeout','15','perl',
    fileURLToPath(new URL('./general-subject-native.pl',import.meta.url))],
    {encoding:'utf8',maxBuffer:1024*1024,timeout:16000});
assert.equal(native.status,0,native.stderr);
const evidence=JSON.parse(native.stdout);
assert.equal(evidence.parserVersion,'3.85');
function helpers(row,calls=[]){
    const opts={mode:row.mode,limits,characterClass,
        normalizeImageUrl:url=>{calls.push({kind:'image',url:scalarView(url),opts:{journal:'',ditemid:''}});return {value:url,exceptionEffect:{kind:'set',message:viewChunk('image helper effect\n')}};},
        rewriteBlockedHref:href=>none(viewChunk(scalarView(href).replace(/^https:\/\/blocked\.test\/.*$/,'#blocked'),href.utf8)),
        expandSiteUrl:path=>{calls.push({kind:'site',path:scalarView(path)});return none(concatenate([viewChunk('EXPAND:'),path]));},
        expandUser:(name,options)=>{
            const {site,...rest}=options;
            calls.push({kind:'user',name:name?b64(name):null,site:site?b64(site):null,
                nameFlag:name?.utf8??false,siteFlag:site?.utf8??false,
                opts:Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,Number(v)]))});
            const value=concatenate([viewChunk('USER:'),name??viewChunk('UNDEF'),viewChunk(':'),
                site??viewChunk('UNDEF'),viewChunk(':'+Number(options.no_link)+':'+Number(options.textonly))]);
            return {value,exceptionEffect:name&&scalarView(name)==='effect-set'
                ?{kind:'set',message:viewChunk('controlled helper failure\n')}:{kind:'none'}};
        },
        templateError:name=>{calls.push({kind:'ml',key:'cleanhtml.error.template',aopts:scalarView(name)});return none(concatenate([viewChunk('ML:cleanhtml.error.template:'),name]));},
        videoError:()=>{calls.push({kind:'ml',key:'cleanhtml.error.template.video',aopts:null});return none(viewChunk('ML:cleanhtml.error.template.video:'));},
        markupError:tag=>{calls.push({kind:'ml',key:'cleanhtml.error.markup.extra',aopts:scalarView(tag)});return none(concatenate([viewChunk('ML:cleanhtml.error.markup.extra:'),tag]));},
        validStylesheet:(href,host,path)=>{
            calls.push({kind:'stylesheet',host:scalarView(host),path:scalarView(path)});
            return {value:scalarView(host)==='zero.test'?0:scalarView(host)==='two.test'?viewChunk('2'):1,
                exceptionEffect:{kind:'set',message:viewChunk('stylesheet helper effect\n')}};
        },
    };
    if(row.id.startsWith('hook-'))opts.embedTransform=(tokens,options)=>{
        const plain=tokens.map(token=>token[0]==='S'
            ?['S',token[1],Object.fromEntries(Object.entries(token[2]).map(([k,v])=>[k,scalarView(v)])),token[3],scalarView(token[4])]
            :token[0]==='E'?['E',token[1],scalarView(token[2])]:['T',scalarView(token[1]),token[2]?1:'']);
        calls.push({kind:'embed',tokens:plain,nocheck:options.nocheck,wmode:null});
        return none(viewChunk('EMBED'));
    };
    return opts;
}
for(const row of evidence.rows)test(row.id+' / '+row.mode,()=>{
    const calls=[];
    const result=cleanGeneralSubject({bytes:Uint8Array.from(Buffer.from(row.inputBase64,'base64')),utf8:row.inputFlag},helpers(row,calls));
    // Existing private-viewer auth removal is deliberately extended to the
    // native no-angle fast path; its skipped eval remains untouched.
    const adapted={
        'auth-plain':'see_request?id=1',
        'xsl-safe':'text/plaintail'+(row.mode==='subject'?'<b>x</b>':'x'),
        'xsl-entities':'one&imagetwotail',
        'xsl-open':'one&two',
    };
    const expected=Object.hasOwn(adapted,row.id)?Buffer.from(adapted[row.id]).toString('base64'):row.outputBase64;
    assert.equal(b64(result.value),expected,'independent native raw bytes');
    assert.equal(result.value.utf8,row.outputFlag,'native scalar flag');
    assert.deepEqual(calls,row.calls,'reached native helper events');
    const effect=result.exceptionEffect;
    const exception=effect.kind==='none'?viewChunk('sentinel'):effect.kind==='cleared'?viewChunk(''):effect.message;
    assert.equal(b64(exception),row.exceptionBase64,'native eval register');
    if(row.id==='plain'||row.id==='auth-plain'||row.id==='comment')assert.equal(result.clearsException,false);
    if(row.id==='format'||row.id==='effect-set')assert.equal(result.clearsException,true);
});
test('helper infrastructure errors retain exact identity and never become native eval effects',()=>{
    const failure=new RangeError('controlled infrastructure');
    for(const [input,key] of [['<lj user="x">','expandUser'],['<a href="lj:x">x</a>','expandSiteUrl'],
        ['<a href="x">x</a>','rewriteBlockedHref'],['<link rel="stylesheet" href="https://one.test/x">','validStylesheet'],
        ['<img>','normalizeImageUrl'],['<lj-template/>','templateError'],['<div class="ljvideo"></div>','videoError']]){
        const options=helpers({mode:'subject',id:'failure'});options[key]=()=>{throw failure;};
        assert.throws(()=>cleanGeneralSubject(viewChunk(input),options),error=>error===failure);
    }
});
test('later native CLEAN eval replaces set effect; no-angle does not invoke helpers',()=>{
    const options=helpers({mode:'subject',id:'effect'});
    options.expandUser=()=>({value:viewChunk('x'),exceptionEffect:{kind:'set',message:{bytes:Uint8Array.of(255),utf8:false}}});
    const set=cleanGeneralSubject(viewChunk('<lj>'),options);
    assert.equal(b64(set.exceptionEffect.message),'/w==');
    assert.deepEqual(cleanGeneralSubject(viewChunk('<lj><b>y</b>'),options).exceptionEffect,{kind:'cleared'});
    for(const key of ['expandUser','expandSiteUrl','rewriteBlockedHref','normalizeImageUrl','templateError','videoError','markupError','validStylesheet'])options[key]=()=>{throw new Error('unreached');};
    assert.deepEqual(cleanGeneralSubject(viewChunk('plain'),options).exceptionEffect,{kind:'none'});
});
test('input, fast-path output and markup-error output share the supplied bounds',()=>{
    const options=helpers({mode:'subject',id:'bounds'});
    assert.throws(()=>cleanGeneralSubject(viewChunk('large'),{...options,limits:{...limits,maxInputBytes:1}}),/Subject input bound/);
    assert.throws(()=>cleanGeneralSubject(viewChunk('large'),{...options,limits:{...limits,maxOutputBytes:1}}),/Subject output bound/);
    assert.throws(()=>cleanGeneralSubject(viewChunk('<bad.foo>body'),{...options,limits:{...limits,maxOutputBytes:10}}),/Subject output bound/);
});

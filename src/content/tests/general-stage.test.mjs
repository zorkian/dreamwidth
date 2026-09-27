// general-stage.test.mjs
//
// General installed output closure without a stock catalog artifact.
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {stageGeneralRuntime} from '../tools/stage-runtime.mjs';

const content=fileURLToPath(new URL('..',import.meta.url));
const s2=path.resolve(content,'../s2/target/javascript');
const require=createRequire(import.meta.url);
const {verifyRuntime,verifyGeneralRuntime}=require(path.join(s2,'dist/live/render/manifest.js'));
test('exact general installed output closure is catalog-independent and remains closed',()=>{
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'g2c-general-stage-'));
    fs.chmodSync(temporary,0o755);
    const descriptor=path.join(temporary,'installation.json');
    fs.writeFileSync(descriptor,JSON.stringify({schema:1,kind:'general-s2-worker',entry:'app/dist/live/render/general-worker.js'})+'\n');
    const compiled=path.join(temporary,'compiled');fs.mkdirSync(path.join(compiled,'live/render'),{recursive:true});
    const worker=path.join(compiled,'live/render/general-worker.js');
    fs.writeFileSync(worker,`const {createPageOutput}=require('@dreamwidth/content/page-output');
const output=createPageOutput({contentType:'text/html',limits:{maxInputBytes:1024,maxOutputBytes:1024,timeoutMs:1000},
stylesheet:{domain:'example.invalid',webDomain:'www.example.invalid',statPrefix:'https://static.example.invalid',trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},
output:chunk=>process.stdout.write(Buffer.from(chunk.bytes)),transformCss:chunk=>chunk,checkDepth:()=>{},expandEmbed:chunk=>chunk});
output.printSafe({bytes:Buffer.from('<b>closed-general</b>'),utf8:false});output.finish();`);
    const build=()=>stageGeneralRuntime(descriptor,{s2Dist:compiled});
    build();
    const runtime=verifyGeneralRuntime(descriptor);
    assert.throws(()=>verifyRuntime(descriptor));
    const manifest=JSON.parse(fs.readFileSync(path.join(runtime.root,'manifest.json'),'utf8'));
    assert.equal(manifest.entryPath,'app/dist/live/render/general-worker.js');
    const names=manifest.files.map(value=>value.path);
    assert.ok(names.includes('app/node_modules/@dreamwidth/content/dist/page-output.js'));
    assert.ok(!names.includes('app/node_modules/@dreamwidth/content/dist/index.js'));
    assert.ok(!names.some(name=>name.includes('artifact.js')));
    const sandbox=path.join(temporary,'sandbox');
    execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-O2',path.join(s2,'live/render/sandbox.c'),'-o',sandbox]);
    const args=['--permission','--no-addons','--disable-proto=throw','--max-old-space-size=128',`--allow-fs-read=${runtime.root}`,runtime.entry];
    const child=spawnSync('/usr/bin/setpriv',['--reuid=65534','--regid=65534','--clear-groups',sandbox,runtime.node,...args],
        {cwd:runtime.root,env:{LANG:'C.UTF-8',TZ:'UTC'},encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr||String(child.error));assert.equal(child.stdout,'<b>closed-general</b>');
    build();assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime.root,'manifest.json'),'utf8')),manifest);
    const original=fs.readFileSync(runtime.entry);fs.chmodSync(runtime.entry,0o644);fs.writeFileSync(runtime.entry,'tampered');fs.chmodSync(runtime.entry,0o444);
    assert.throws(()=>verifyGeneralRuntime(descriptor));fs.chmodSync(runtime.entry,0o644);fs.writeFileSync(runtime.entry,original);fs.chmodSync(runtime.entry,0o444);
    fs.writeFileSync(worker,"require('unapproved-general-dependency');");
    assert.throws(build,/unexpected worker dependency/);assert.doesNotThrow(()=>verifyGeneralRuntime(descriptor));
    console.log(`General closed-stage mechanical evidence preserved: ${temporary}`);
});

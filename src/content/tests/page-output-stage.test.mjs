// page-output-stage.test.mjs
//
// Preserve the existing stock worker closure while page output is unwired.
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
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const content=fileURLToPath(new URL('..',import.meta.url));
const s2=path.resolve(content,'../s2/target/javascript');
test('normal easyread compiler, closed stager and production manifest verifier',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'go-stock-stage-'));
 const artifact=path.join(directory,'stock.json');
 execFileSync('perl',['tools/live-compile.pl','--easyread',artifact],
  {cwd:s2,timeout:120000,maxBuffer:1024*1024});
 execFileSync(process.execPath,[path.join(content,'tools/stage-runtime.mjs'),artifact],
  {cwd:s2,timeout:120000,maxBuffer:1024*1024});
 const require=createRequire(import.meta.url);
 const {verifyRuntime}=require(path.join(s2,'dist/live/render/manifest.js'));
 const verified=verifyRuntime(artifact);
 assert.equal(verified.entry,path.join(artifact+'.runtime','app/dist/live/render/worker.js'));
 const manifest=JSON.parse(readFileSync(artifact+'.runtime/manifest.json','utf8'));
 assert.equal(manifest.files.some(file=>file.path.endsWith('/page-output.js')),false);
 const entry=readFileSync(path.join(artifact+'.runtime','app/node_modules/@dreamwidth/content/dist/index.js'),'utf8');
 assert.doesNotMatch(entry,/require\(["']\.\/page-output["']\)/);
 console.log(`Preserved stage and verified manifest: ${artifact}`);
});

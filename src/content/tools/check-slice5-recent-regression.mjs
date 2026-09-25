// check-slice5-recent-regression.mjs
//
// Bind the unchanged Slice4 Recent cleaner outcomes to the Slice5 content build.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [bindingPath, syntheticPath, nativePath] = process.argv.slice(2);
if (!bindingPath || !syntheticPath || !nativePath || process.argv.length !== 5) {
    throw new Error('usage: check-slice5-recent-regression.mjs ' +
        'binding.json synthetic-result.json native-result.json');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = JSON.parse(fs.readFileSync(bindingPath));
assert.deepEqual(Object.keys(binding).sort(), [
    'schema', 'purpose', 'baselineLedgers', 'candidate', 'buildSha256',
    'compiled', 'lockSha256',
].sort());
assert.equal(binding.schema, 1);
assert.equal(binding.purpose, 'slice5-recent-cleaner-regression');
assert.match(binding.candidate, /^[0-9a-f]{40}$/);
assert.match(binding.buildSha256, /^[0-9a-f]{64}$/);
assert.match(binding.lockSha256, /^[0-9a-f]{64}$/);
assert.deepEqual(Object.keys(binding.baselineLedgers).sort(), ['native', 'synthetic']);
assert.equal(binding.buildSha256, sha(Buffer.from(JSON.stringify(binding.compiled))));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slice5-recent-binding-'));
const summaries = [];
try {
    for (const [corpus, resultPath] of [
        ['synthetic', syntheticPath], ['native', nativePath],
    ]) {
        const oldPath = path.join(root, 'corpus', `accepted-${corpus}-ledger.json`);
        const oldBytes = fs.readFileSync(oldPath);
        const old = JSON.parse(oldBytes);
        assert.equal(binding.baselineLedgers[corpus], sha(oldBytes),
            `${corpus}: historical accepted ledger changed`);
        const result = JSON.parse(fs.readFileSync(resultPath));
        assert.equal(result.corpus, corpus);
        assert.equal(result.candidate, binding.candidate);
        assert.equal(result.buildSha256, binding.buildSha256);
        assert.equal(result.lockSha256, binding.lockSha256);
        assert.deepEqual(result.compiled, binding.compiled);
        assert.equal(result.rows.length, corpus === 'synthetic' ? 26 : 384);
        assert.notEqual(result.buildSha256, old.buildSha256,
            `${corpus}: no new Slice5 compiled-content binding`);
        // Inherit every reviewed category, byte digest, and rationale unchanged.
        // The existing strict per-case checker recomputes output digests and
        // rejects any new refusal, adaptation, or altered output.
        const rebound = {...old, candidate: binding.candidate,
            buildSha256: binding.buildSha256, compiled: binding.compiled,
            lockSha256: binding.lockSha256};
        const reboundPath = path.join(temporary, `${corpus}.json`);
        fs.writeFileSync(reboundPath, JSON.stringify(rebound));
        const checked = execFileSync(process.execPath, [
            path.join(root, 'tools/check-difference-ledger.mjs'), resultPath,
            reboundPath,
        ], {encoding: 'utf8'});
        summaries.push(JSON.parse(checked));
    }
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}
assert.equal(summaries[0].cases + summaries[1].cases, 410);
process.stdout.write(JSON.stringify({candidate: binding.candidate,
    buildSha256: binding.buildSha256, historicalCases: 410,
    unchanged: summaries}) + '\n');

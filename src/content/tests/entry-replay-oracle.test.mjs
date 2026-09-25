// entry-replay-oracle.test.mjs
//
// Check exact retained Perl outputs for separate html_raw0 entry probes.
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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'corpus/entry-replay-cases.json');
const oraclePath = path.join(root, 'corpus/entry-replay-perl.json');
const source = fs.readFileSync(manifestPath);
const retained = fs.readFileSync(oraclePath);
const manifest = JSON.parse(source);
const oracle = JSON.parse(retained);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

assert.equal(manifest.kind, 'distinct-html_raw0-entry-replay');
assert.equal(manifest.perlInputEncoding, 'raw-utf8-bytes-from-logtext2');
assert.equal(manifest.cases.length, 26);
assert.equal(new Set(manifest.cases.map(item => item.id)).size, 26);
assert.equal(oracle.kind, 'retained-perl-entry-html_raw0-output');
assert.equal(oracle.manifestSha256, sha(source));
assert.equal(oracle.records.length, 26);
for (const [index, input] of manifest.cases.entries()) {
    const output = oracle.records[index];
    assert.equal(output.id, input.id);
    assert.equal(output.source, input.source);
    assert.deepEqual(output.reparse, input.reparse);
    assert.ok(input.reparse.every(value => ['document', 'div.entry-content'].includes(value)));
    assert.equal(output.inputUtf8Flag, false);
    assert.equal(output.inputSha256, sha(Buffer.from(input.body, 'utf8')));
    assert.equal(output.inputBytes, Buffer.byteLength(input.body, 'utf8'));
    assert.equal(output.died, false);
    const bytes = Buffer.from(output.outputBase64, 'base64');
    assert.equal(output.outputSha256, sha(bytes));
    assert.equal(output.outputBytes, bytes.length);
    assert.deepEqual(output.perlOptions, {...manifest.perlOptions, ...input.options});
}

const result = spawnSync('perl', [path.join(root, 'tools/cleaner-entry-oracle.pl'), manifestPath], {
    cwd: path.resolve(root, '../..'), encoding: null, timeout: 30000,
    env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'},
});
assert.equal(result.status, 0, result.stderr.toString());
assert.deepEqual(result.stdout, retained, 'real Perl replay must match retained bytes');
console.log('26 distinct html_raw0 retained Perl outputs and byte digests match');

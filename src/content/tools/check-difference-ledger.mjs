// check-difference-ledger.mjs
//
// Reject any change to reviewed per-case entry cleaner differences.
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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [resultPath, ledgerPath] = process.argv.slice(2);
if (!resultPath || !ledgerPath) {
    throw new Error('usage: check-difference-ledger.mjs result.json accepted-ledger.json');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = JSON.parse(fs.readFileSync(resultPath));
const accepted = JSON.parse(fs.readFileSync(ledgerPath));
assert.equal(result.schema, 1);
assert.equal(accepted.schema, 1);
assert.equal(result.corpus, accepted.corpus);
assert.equal(result.candidate, accepted.candidate);
assert.match(result.candidate, /^[0-9a-f]{40}$/);
assert.match(result.buildSha256, /^[0-9a-f]{64}$/);
assert.equal(result.buildSha256, accepted.buildSha256);
assert.match(result.lockSha256, /^[0-9a-f]{64}$/);
assert.equal(result.lockSha256, accepted.lockSha256);
assert.deepEqual(result.compiled, accepted.compiled);
assert.ok(result.compiled.length >= 2);
assert.equal(new Set(result.compiled.map(item => item.path)).size,
    result.compiled.length);
assert.equal(result.buildSha256,
    createHash('sha256').update(JSON.stringify(result.compiled)).digest('hex'));
const native = result.corpus === 'native';
assert.ok(native || result.corpus === 'synthetic');
const manifestBytes = fs.readFileSync(path.join(root, 'corpus', native
    ? 'native-derived-entry-cases.json' : 'entry-replay-cases.json'));
const oracleBytes = fs.readFileSync(path.join(root, 'corpus', native
    ? 'native-derived-entry-perl.json' : 'entry-replay-perl.json'));
const manifest = JSON.parse(manifestBytes);
const oracle = JSON.parse(oracleBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(result.manifestSha256, sha(manifestBytes));
assert.equal(accepted.manifestSha256, sha(manifestBytes));
assert.equal(result.oracleSha256, sha(oracleBytes));
assert.equal(accepted.oracleSha256, sha(oracleBytes));
assert.equal(oracle.manifestSha256, sha(manifestBytes));
assert.equal(result.rows.length, native ? 384 : 26);
assert.equal(accepted.cases.length, result.rows.length);
assert.equal(new Set(accepted.cases.map(item => item.id)).size, accepted.cases.length);
const categories = new Set(['exact', 'serialization', 'visible-adaptation',
    'origin-adaptation', 'security-correction', 'unsupported']);
const counts = Object.create(null);
for (const [index, row] of result.rows.entries()) {
    const input = manifest.cases[index];
    const perl = oracle.records[index];
    const reviewed = accepted.cases[index];
    assert.equal(row.id, input.id);
    assert.equal(perl.id, input.id);
    assert.equal(reviewed.id, input.id);
    assert.equal(row.source, native ? input.nativeSource : input.source);
    assert.equal(reviewed.source, row.source);
    const inputBytes = native ? Buffer.from(input.rawInputBase64, 'base64')
        : Buffer.from(input.body, 'utf8');
    assert.equal(row.inputSha256, sha(inputBytes));
    assert.equal(reviewed.inputSha256, row.inputSha256);
    const perlBytes = Buffer.from(perl.outputBase64, 'base64');
    assert.equal(row.perlSha256, sha(perlBytes));
    assert.equal(row.perlBytes, perlBytes.length);
    assert.equal(reviewed.perlSha256, row.perlSha256);
    assert.equal(reviewed.perlBytes, row.perlBytes);
    assert.ok(categories.has(reviewed.category), `${row.id}: unreviewed category`);
    assert.ok(typeof reviewed.rationale === 'string' && reviewed.rationale.length >= 8,
        `${row.id}: missing case rationale`);
    if (reviewed.category !== 'exact') {
        assert.ok(Array.isArray(reviewed.evidence) && reviewed.evidence.length > 0 &&
            reviewed.evidence.every(value => typeof value === 'string' && value.length >= 8),
        `${row.id}: missing source or browser evidence`);
    }
    assert.equal(reviewed.kind, row.kind);
    assert.equal(reviewed.reason, row.reason);
    assert.equal(reviewed.jsSha256, row.jsSha256);
    assert.equal(reviewed.jsBytes, row.jsBytes);
    if (row.kind === 'ok') {
        const jsBytes = Buffer.from(row.jsOutputBase64, 'base64');
        assert.equal(row.jsSha256, sha(jsBytes));
        assert.equal(row.jsBytes, jsBytes.length);
        assert.equal(row.jsHtml, new TextDecoder('utf-8', { fatal: true }).decode(jsBytes));
        assert.equal(row.rawEqual, jsBytes.equals(perlBytes));
        assert.equal(reviewed.category === 'exact', row.rawEqual,
            `${row.id}: exact category must match raw byte equality`);
        assert.notEqual(reviewed.category, 'unsupported');
    } else {
        assert.equal(row.kind, 'failure');
        assert.equal(row.reason, 'unsupported', `${row.id}: unavailable is not accepted`);
        assert.equal(row.jsOutputBase64, null);
        assert.equal(row.jsHtml, null);
        assert.equal(row.jsSha256, null);
        assert.equal(row.jsBytes, null);
        assert.equal(row.rawEqual, false);
        assert.equal(reviewed.category, 'unsupported');
    }
    counts[reviewed.category] = (counts[reviewed.category] ?? 0) + 1;
}
console.log(JSON.stringify({ candidate: result.candidate, corpus: result.corpus,
    cases: result.rows.length, categories: counts }));

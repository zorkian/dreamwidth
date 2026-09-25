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
import { preparedCorpusRoot } from './corpus-paths.mjs';
import { defaultAttestationRoot, verifyRunAttestation } from './run-attestation.mjs';

const [resultPath, ledgerPath, flag, suppliedAttestation] = process.argv.slice(2);
if (!resultPath || !ledgerPath || (flag && (flag !== '--attestation' ||
    !suppliedAttestation)) || process.argv.length > (flag ? 6 : 4)) {
    throw new Error('usage: check-difference-ledger.mjs result.json accepted-ledger.json ' +
        '[--attestation DIR]');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = JSON.parse(fs.readFileSync(resultPath));
const accepted = JSON.parse(fs.readFileSync(ledgerPath));
assert.equal(result.schema, 1);
assert.equal(accepted.schema, 2);
assert.equal(result.corpus, accepted.corpus);
const native = result.corpus === 'native';
assert.ok(native || result.corpus === 'synthetic');
const attested = verifyRunAttestation(suppliedAttestation ?? defaultAttestationRoot,
    native ? { nativePath: resultPath } : { syntheticPath: resultPath });
const fixedName = native ? 'nativeLedger' : 'syntheticLedger';
assert.equal(path.resolve(ledgerPath), attested.inventory.fixed.get(fixedName),
    'Use the fixed accepted ledger for this corpus');
const manifestBytes = fs.readFileSync(path.join(native ? preparedCorpusRoot() :
    path.join(root, 'corpus'), native ? 'native-derived-entry-cases.json' :
    'entry-replay-cases.json'));
const oracleBytes = fs.readFileSync(path.join(root, 'corpus', native
    ? 'native-derived-entry-perl.json' : 'entry-replay-perl.json'));
const manifest = JSON.parse(manifestBytes);
const oracle = JSON.parse(oracleBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(result.manifestSha256, sha(manifestBytes));
assert.equal(result.oracleSha256, sha(oracleBytes));
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
    const inputBytes = native ? Buffer.from(input.rawInputBase64, 'base64')
        : Buffer.from(input.body, 'utf8');
    assert.equal(row.inputSha256, sha(inputBytes));
    const perlBytes = Buffer.from(perl.outputBase64, 'base64');
    assert.equal(row.perlSha256, sha(perlBytes));
    assert.equal(row.perlBytes, perlBytes.length);
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
    if (row.kind === 'ok') {
        const jsBytes = Buffer.from(row.jsOutputBase64, 'base64');
        assert.equal(row.jsSha256, sha(jsBytes));
        assert.equal(row.jsBytes, jsBytes.length);
        assert.equal(row.jsHtml, new TextDecoder('utf-8', { fatal: true }).decode(jsBytes));
        assert.equal(row.rawEqual, jsBytes.equals(perlBytes));
        assert.equal(reviewed.category === 'exact', row.rawEqual,
            `${row.id}: exact category must match raw byte equality`);
        assert.notEqual(reviewed.category, 'unsupported');
        assert.deepEqual(reviewed.expectedJs, row.rawEqual ? { ref: 'perl' } :
            { sha256: row.jsSha256, bytes: row.jsBytes },
        `${row.id}: TypeScript bytes changed`);
    } else {
        assert.equal(row.kind, 'failure');
        assert.equal(row.reason, 'unsupported', `${row.id}: unavailable is not accepted`);
        assert.equal(row.jsOutputBase64, null);
        assert.equal(row.jsHtml, null);
        assert.equal(row.jsSha256, null);
        assert.equal(row.jsBytes, null);
        assert.equal(row.rawEqual, false);
        assert.equal(reviewed.category, 'unsupported');
        assert.equal(reviewed.expectedJs, null);
    }
    counts[reviewed.category] = (counts[reviewed.category] ?? 0) + 1;
}
console.log(JSON.stringify({ candidate: result.candidate, corpus: result.corpus,
    cases: result.rows.length, categories: counts }));

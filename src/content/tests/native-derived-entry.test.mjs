// native-derived-entry.test.mjs
//
// Verify all native call dispositions and distinct html_raw0 Perl replays.
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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparedCorpusRoot } from '../tools/corpus-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = preparedCorpusRoot();
const casesPath = path.join(corpus, 'native-derived-entry-cases.json');
const mapPath = path.join(corpus, 'native-call-replay-map.json');
const oraclePath = path.join(root, 'corpus/native-derived-entry-perl.json');
const casesBytes = fs.readFileSync(casesPath);
const mapBytes = fs.readFileSync(mapPath);
const oracleBytes = fs.readFileSync(oraclePath);
const cases = JSON.parse(casesBytes);
const mapping = JSON.parse(mapBytes);
const oracle = JSON.parse(oracleBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

assert.equal(cases.kind, 'native-call-derived-html_raw0-replay');
assert.equal(cases.omitted.length, 0);
assert.equal(cases.cases.length, 384);
assert.equal(new Set(cases.cases.map(item => item.id)).size, 384);
assert.equal(mapping.calls.length, 1062);
assert.equal(new Set(mapping.calls.map(item => item.nativeCall)).size, 1062);
assert.equal(mapping.calls.filter(item => item.disposition === 'native-only').length, 678);
assert.equal(mapping.calls.filter(item => item.disposition === 'new-html_raw0-replay').length, 384);
const expectedBySuite = new Map([
    ['cleaner-forms.t', 6], ['cleaner-event.t', 42], ['cleaner-markdown.t', 28],
    ['cleaner-embed.t', 23], ['cleaner-resource-loading.t', 5],
    ['cleaner-tables.t', 9], ['cleaner-xss.t', 254], ['cleaner-ljtags.t', 12],
    ['cleaner-event-embed.t', 1], ['cleaner-invalid.t', 4],
]);
for (const [suite, count] of expectedBySuite) {
    assert.equal(cases.cases.filter(item => item.nativeSource === `t/${suite}`).length, count);
}
assert.ok(mapping.calls.filter(item => item.disposition === 'native-only')
    .every(item => item.reason && item.nativeMethod !== 'clean_event'));
assert.equal(oracle.records.length, 384);
assert.equal(oracle.manifestSha256, sha(casesBytes));
const outputs = new Map(oracle.records.map(item => [item.id, item]));
for (const item of cases.cases) {
    const linked = mapping.calls.find(row => row.replayId === item.id);
    assert.ok(linked && linked.nativeMethod === 'clean_event');
    const bytes = Buffer.from(item.rawInputBase64, 'base64');
    assert.equal(item.replayInputUtf8Flag, false);
    assert.equal(item.rawInputSha256, sha(bytes));
    assert.equal(item.rawInputBytes, bytes.length);
    const output = outputs.get(item.id);
    assert.ok(output && !output.died);
    const rendered = Buffer.from(output.outputBase64, 'base64');
    assert.equal(output.inputSha256, item.rawInputSha256);
    assert.equal(output.outputSha256, sha(rendered));
    assert.equal(output.outputBytes, rendered.length);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-native-entry-'));
try {
    const newCases = path.join(temporary, 'cases.json');
    const newMap = path.join(temporary, 'map.json');
    const builder = spawnSync(process.execPath,
        [path.join(root, 'tools/cleaner-build-native-replay.mjs'), newCases, newMap],
        { encoding: 'utf8', timeout: 30000,
            env: { ...process.env, DW_CONTENT_CORPUS_ROOT: corpus } });
    assert.equal(builder.status, 0, builder.stderr);
    assert.deepEqual(fs.readFileSync(newCases), casesBytes);
    assert.deepEqual(fs.readFileSync(newMap), mapBytes);
    const perl = spawnSync('perl',
        [path.join(root, 'tools/cleaner-native-entry-oracle.pl'), casesPath],
        { cwd: path.resolve(root, '../..'), encoding: null, timeout: 30000,
            env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'} });
    assert.equal(perl.status, 0, perl.stderr.toString());
    assert.deepEqual(perl.stdout, oracleBytes);
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('1062 native calls mapped; 384 distinct html_raw0 replays match retained Perl bytes');

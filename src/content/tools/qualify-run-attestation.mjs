// qualify-run-attestation.mjs
//
// Exercise local attestation publication and fixed semantic refusal paths.
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
import { currentInventory, currentResults, verifyRunAttestation } from
    './run-attestation.mjs';

const [syntheticPath, nativePath] = process.argv.slice(2);
assert.ok(syntheticPath && nativePath && process.argv.length === 4,
    'usage: qualify-run-attestation.mjs synthetic-result.json native-result.json');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-run-attestation-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tool = name => path.join(root, 'tools', name);
const ledger = path.join(root, 'corpus/accepted-synthetic-ledger.json');
const negatives = [];

function run(name, args) {
    return spawnSync(process.execPath, [tool(name), ...args], {
        cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 512 * 1024,
    });
}
function passes(name, args) {
    const result = run(name, args);
    assert.equal(result.status, 0, result.stderr || result.stdout ||
        result.error?.message);
    return result;
}
function fails(name, args, pattern) {
    const result = run(name, args);
    assert.notEqual(result.status, 0, `${name}: unexpected success`);
    assert.match(result.stderr, pattern);
    negatives.push(pattern.source);
}
function writeResult(name, alter) {
    const value = JSON.parse(fs.readFileSync(syntheticPath));
    alter(value);
    const filename = path.join(temporary, `${name}.json`);
    fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
    return filename;
}
function issue(synthetic, output) {
    return ['--synthetic', synthetic, '--native', nativePath,
        '--output', output];
}

try {
    const inventory = currentInventory();
    currentResults(syntheticPath, nativePath, inventory);
    const good = path.join(temporary, 'good');
    passes('attest-corpus-run.mjs', issue(syntheticPath, good));
    verifyRunAttestation(good, { syntheticPath, nativePath });
    passes('check-difference-ledger.mjs', [syntheticPath, ledger,
        '--attestation', good]);
    fails('check-slice5-entry-ledger.mjs', ['--attestation', good],
        /Entry reports are missing; run .*tools\/attest-corpus-run\.mjs.*--entry/);
    fails('attest-corpus-run.mjs', issue(syntheticPath, good),
        /existing attestation root is not empty/);

    const changed = writeResult('changed-output', value => {
        const row = value.rows.find(item => item.kind === 'ok');
        assert.ok(row);
        const bytes = Buffer.from('<p>changed</p>');
        row.jsOutputBase64 = bytes.toString('base64');
        row.jsHtml = bytes.toString();
        row.jsSha256 = sha(bytes);
        row.jsBytes = bytes.length;
        row.rawEqual = false;
    });
    const changedRoot = path.join(temporary, 'changed-output-attestation');
    passes('attest-corpus-run.mjs', issue(changed, changedRoot));
    fails('check-difference-ledger.mjs', [changed, ledger,
        '--attestation', changedRoot], /TypeScript bytes changed/);
    assert.throws(() => verifyRunAttestation(good,
        { syntheticPath: changed, nativePath }), /Wrong synthetic result/);

    const refused = writeResult('changed-refusal', value => {
        const row = value.rows.find(item => item.kind === 'failure');
        assert.ok(row);
        const bytes = Buffer.from('');
        Object.assign(row, { kind: 'ok', reason: null, jsOutputBase64: '',
            jsHtml: '', jsSha256: sha(bytes), jsBytes: 0, rawEqual: false });
    });
    const refusedRoot = path.join(temporary, 'changed-refusal-attestation');
    passes('attest-corpus-run.mjs', issue(refused, refusedRoot));
    fails('check-difference-ledger.mjs', [refused, ledger,
        '--attestation', refusedRoot], /Expected values to be strictly equal|TypeScript bytes changed/);

    const missing = writeResult('missing-row', value => { value.rows.pop(); });
    assert.throws(() => currentResults(missing, nativePath, inventory),
        /missing rows/);
    const duplicate = writeResult('duplicate-row', value => {
        value.rows[1].id = value.rows[0].id;
    });
    assert.throws(() => currentResults(duplicate, nativePath, inventory),
        /duplicate IDs/);
    const staleBuild = writeResult('stale-build', value => {
        value.buildSha256 = '0'.repeat(64);
    });
    assert.throws(() => currentResults(staleBuild, nativePath, inventory),
        /stale build digest/);
    const staleLock = writeResult('stale-lock', value => {
        value.lockSha256 = '0'.repeat(64);
    });
    assert.throws(() => currentResults(staleLock, nativePath, inventory),
        /stale lock digest/);

    const link = path.join(temporary, 'link');
    fs.symlinkSync(good, link);
    fails('attest-corpus-run.mjs', issue(syntheticPath, link),
        /Symlink in corpus path/);
    fails('attest-corpus-run.mjs', issue(syntheticPath,
        '/var/tmp/dw-unsafe-attestation'), /Corpus output must be below/);
    assert.deepEqual(fs.readdirSync(good), ['run-attestation.json']);
    console.log(JSON.stringify({ schema: 1, cases: 410,
        negatives: negatives.length + 4, publication: 'atomic' }));
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

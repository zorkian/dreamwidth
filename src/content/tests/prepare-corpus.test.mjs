// prepare-corpus.test.mjs
//
// Verify deterministic, isolated expansion of the retained native corpus.
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputNames, suiteNames } from '../tools/corpus-paths.mjs';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(contentRoot, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-prep-corpus-'));
const mirror = path.join(temporary, 'fresh-export');
const content = path.join(mirror, 'src/content');
const tool = path.join(content, 'tools/prepare-corpus.mjs');
const first = path.join(temporary, 'first');
const second = path.join(temporary, 'second');

function copyFile(relative) {
    const target = path.join(mirror, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relative), target);
}

function run(output) {
    return spawnSync(process.execPath, [tool, '--output', output], {
        cwd: mirror, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, PATH: '/nonexistent', DW_CONTENT_CORPUS_ROOT: '' },
    });
}

function fails(output, pattern) {
    const result = run(output);
    assert.notEqual(result.status, 0, `unexpected success: ${output}`);
    assert.match(result.stderr, pattern);
}

try {
    for (const name of [
        'corpus-paths.mjs', 'prepare-corpus.mjs', 'build-native-inventory.mjs',
        'cleaner-build-native-replay.mjs',
    ]) copyFile(`src/content/tools/${name}`);
    copyFile('src/content/corpus/native-tap-spec.json');
    for (const name of suiteNames) copyFile(`t/${name}`);
    for (const name of fs.readdirSync(path.join(contentRoot, 'corpus/native-calls'))) {
        copyFile(`src/content/corpus/native-calls/${name}`);
    }
    assert.ok(!fs.existsSync(path.join(mirror, '.git')));
    assert.ok(!fs.existsSync(path.join(content, 'artifacts')));
    assert.ok(!fs.existsSync(path.join(content, 'corpus/native-inventory.json')));
    assert.equal(run(first).status, 0, 'fresh export prepares without old outputs or Git');
    assert.equal(run(second).status, 0, 'second fresh root prepares');
    const empty = path.join(temporary, 'empty-owned-root');
    fs.mkdirSync(empty);
    assert.equal(run(empty).status, 0, 'existing empty owned root is published atomically');
    assert.equal(run(first).status, 0, 'verified cache hit succeeds');
    for (const relative of [...outputNames, 'manifest.json']) {
        assert.deepEqual(fs.readFileSync(path.join(first, relative)),
            fs.readFileSync(path.join(second, relative)),
        `two fresh preparations differ: ${relative}`);
    }
    assert.deepEqual(fs.readdirSync(first).sort(), [
        'manifest.json', 'native-inventory.json', 'native-call-replay-map.json',
        'native-derived-entry-cases.json', 'native-logs',
    ].sort());

    const trace = path.join(content, 'corpus/native-calls/cleaner-comment.t.calls.jsonl');
    const traceBytes = fs.readFileSync(trace);
    fs.unlinkSync(trace);
    fails(first, /ENOENT/);
    fs.writeFileSync(trace, traceBytes.subarray(0, -1));
    fails(first, /Native call capture changed/);
    fs.writeFileSync(trace, traceBytes);
    const source = path.join(mirror, 't/cleaner-comment.t');
    const sourceBytes = fs.readFileSync(source);
    fs.appendFileSync(source, '\n');
    fails(first, /Native source changed/);
    fs.writeFileSync(source, sourceBytes);
    const output = path.join(first, 'native-inventory.json');
    const outputBytes = fs.readFileSync(output);
    fs.writeFileSync(output, outputBytes.subarray(0, -1));
    fails(first, /Generated corpus bytes changed/);
    fs.writeFileSync(output, outputBytes);
    fs.unlinkSync(output);
    fails(first, /Corpus root contains missing or unrelated files/);
    fs.writeFileSync(output, outputBytes);
    const manifest = path.join(first, 'manifest.json');
    const manifestBytes = fs.readFileSync(manifest);
    fs.writeFileSync(manifest, manifestBytes.subarray(0, -1));
    fails(first, /Corpus manifest is stale or tampered/);
    fs.writeFileSync(manifest, manifestBytes);
    assert.equal(run(first).status, 0, 'restored verified cache succeeds');
    fs.writeFileSync(path.join(first, 'unrelated'), 'keep');
    fails(first, /Corpus root contains missing or unrelated files/);
    fs.unlinkSync(path.join(first, 'unrelated'));

    const unrelated = path.join(temporary, 'unrelated');
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, 'keep'), 'leave me alone');
    fails(unrelated, /Corpus root contains missing or unrelated files/);
    assert.equal(fs.readFileSync(path.join(unrelated, 'keep'), 'utf8'), 'leave me alone');
    const link = path.join(temporary, 'link');
    fs.symlinkSync(unrelated, link);
    fails(link, /Symlink in corpus path/);
    fails(path.join(link, 'child'), /Symlink in corpus path/);
    fails('/var/tmp/dw-unsafe-corpus-output', /Corpus output must be below/);

    const specPath = path.join(content, 'corpus/native-tap-spec.json');
    const specBytes = fs.readFileSync(specPath);
    const spec = JSON.parse(specBytes);
    spec.outputsSha256['native-inventory.json'] = '0'.repeat(64);
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const failedRoot = path.join(temporary, 'failed-publication');
    fails(failedRoot, /Generated corpus bytes changed/);
    assert.ok(!fs.existsSync(failedRoot), 'failed generation did not publish a root');
    assert.ok(!fs.readdirSync(temporary).some(name =>
        name.startsWith('.failed-publication.prepare-')),
    'failed generation did not leave a task temporary tree');
    spec.outputsSha256['native-inventory.json'] =
        JSON.parse(specBytes).outputsSha256['native-inventory.json'];
    spec.vectors['xss-base'][0] = 'changed-vector';
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    fails(first, /Retained TAP bytes changed/);
    fs.writeFileSync(specPath, specBytes);
    assert.equal(run(first).status, 0, 'earlier valid publication survived failure');
    console.log('Fresh export, exact bytes, cache, mutation and atomic scope pass');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

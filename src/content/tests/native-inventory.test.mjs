// native-inventory.test.mjs
//
// Reject incomplete or misattributed retained cleaner call traces.
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

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(contentRoot, 'corpus/native-calls');
const builder = path.join(contentRoot, 'tools/build-native-inventory.mjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-native-inventory-'));
const traces = path.join(temporary, 'traces');
fs.mkdirSync(traces);
for (const name of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, name), path.join(traces, name));
}

function build() {
    return spawnSync(process.execPath, [builder, traces, path.join(temporary, 'out.json')],
        { encoding: 'utf8' });
}

try {
    assert.equal(build().status, 0, 'complete trace set builds');
    const inventory = JSON.parse(fs.readFileSync(path.join(temporary, 'out.json'), 'utf8'));
    assert.equal(inventory.cases.length, 1116);
    assert.equal(inventory.suites.reduce((n, suite) => n + (suite.capturedCalls?.count ?? 0), 0), 1062);
    const nested = fs.readFileSync(path.join(traces, 'cleaner-xss.t.calls.jsonl'), 'utf8')
        .trimEnd().split('\n').map(JSON.parse).filter(call => call.depth > 0);
    assert.equal(nested.length, 59);
    assert.ok(nested.every(call => call.parentOrdinal > call.callOrdinal &&
        call.directCallerFile === 'cgi-bin/LJ/CleanHTML.pm' &&
        call.sourceLine <= 396));

    const comment = path.join(traces, 'cleaner-comment.t.calls.jsonl');
    const original = fs.readFileSync(comment);
    fs.unlinkSync(comment);
    assert.notEqual(build().status, 0, 'missing expected suite is rejected');
    fs.writeFileSync(comment, original.subarray(0, original.lastIndexOf(10)));
    assert.notEqual(build().status, 0, 'truncated final record is rejected');
    const lines = original.toString('utf8').trimEnd().split('\n');
    fs.writeFileSync(comment, `${lines.slice(0, -1).join('\n')}\n`);
    assert.notEqual(build().status, 0, 'complete but short trace is rejected');
    fs.writeFileSync(comment, original);
    fs.writeFileSync(path.join(traces, 'cleaner-email.t.calls.jsonl'), '{}\n');
    assert.notEqual(build().status, 0, 'unexpected email trace is rejected');
    fs.unlinkSync(path.join(traces, 'cleaner-email.t.calls.jsonl'));
    assert.equal(build().status, 0, 'restored complete trace set builds');
    console.log('Native trace presence, count, provenance and truncation checks pass');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

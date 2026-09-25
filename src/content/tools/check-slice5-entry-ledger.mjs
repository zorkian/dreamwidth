// check-slice5-entry-ledger.mjs
//
// Recheck source-derived EntryPage body and inert metadata dispositions.
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
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.resolve(root, '../s2/target/javascript');
const ledgerPath = process.argv[2] ?? path.join(root, 'corpus/slice5-entry-ledger.json');
assert.ok(process.argv.length <= 3, 'usage: check-slice5-entry-ledger.mjs [ledger.json]');
const ledger = JSON.parse(fs.readFileSync(ledgerPath));
const binding = JSON.parse(fs.readFileSync(path.join(root, 'corpus/slice5-recent-binding.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(ledger.schema, 1);
assert.equal(ledger.purpose, 'slice5-entry-full-body-and-inert-metadata');
assert.equal(ledger.contentCandidate, binding.candidate);
assert.equal(ledger.buildSha256, binding.buildSha256);
assert.equal(ledger.common.length, 52);
assert.equal(ledger.adaptations.length, 6);
assert.equal(ledger.refusals.length, 4);

const dist = path.join(root, 'dist');
const compiled = [];
function collect(directory, relative = '') {
    for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name);
        const stat = fs.lstatSync(file);
        assert.ok(!stat.isSymbolicLink(), `compiled package symlink: ${file}`);
        const nested = relative ? `${relative}/${name}` : name;
        if (stat.isDirectory()) collect(file, nested);
        else {
            assert.ok(stat.isFile(), `compiled package non-file: ${file}`);
            if (name.endsWith('.js')) compiled.push({path: nested,
                sha256: sha(fs.readFileSync(file))});
        }
    }
}
collect(dist);
compiled.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
assert.deepEqual(compiled, binding.compiled, 'compiled content changed after binding');
assert.equal(sha(Buffer.from(JSON.stringify(compiled))), binding.buildSha256);
assert.equal(sha(fs.readFileSync(path.join(root, 'package-lock.json'))), binding.lockSha256);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slice5-entry-ledger-'));
try {
    const reportPath = path.join(temporary, 'metadata.json');
    const result = spawnSync(process.execPath,
        ['--test', path.join(project, 'dist/live/tests/entry-cleaner.test.js')], {
            cwd: project, env: {...process.env, SLICE5_METADATA_REPORT: reportPath},
            encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
        });
    assert.equal(result.status, 0, result.stderr || result.stdout ||
        result.error?.message);
    const common = JSON.parse(fs.readFileSync(reportPath));
    const adaptations = JSON.parse(fs.readFileSync(reportPath + '.adaptations.json'));
    const refusals = JSON.parse(fs.readFileSync(reportPath + '.refusals.json'));
    assert.equal(common.length, ledger.common.length);
    assert.equal(adaptations.length, ledger.adaptations.length);
    assert.equal(refusals.length, ledger.refusals.length);

    const require = createRequire(import.meta.url);
    const {createEntryCleaner} = require(dist);
    const {entryOgDescription} = require(path.join(project, 'dist/live/render/host.js'));
    const cleaner = createEntryCleaner({maxInputBytes: 65536, maxOutputBytes: 2097152,
        maxNodes: 4096, maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096,
        maxImageCandidates: 256, maxCuts: 16});
    const categories = Object.create(null);
    try {
        const seen = new Set();
        common.forEach((actual, index) => {
            const accepted = ledger.common[index];
            assert.ok(!seen.has(actual.id), `duplicate ${actual.id}`);
            seen.add(actual.id);
            assert.equal(actual.id, accepted.id);
            assert.equal(actual.raw, accepted.raw, `${actual.id}: source changed`);
            assert.equal(actual.rawSha256, sha(Buffer.from(actual.raw, 'utf8')));
            assert.equal(actual.rawSha256, accepted.rawSha256);
            assert.deepEqual(actual.perl, accepted.perl, `${actual.id}: retained Perl changed`);
            assert.deepEqual(actual.candidate, {kind: 'ok', metadata: accepted.metadata},
                `${actual.id}: inert helper changed`);
            assert.equal(actual.candidate.metadata.eventText, actual.perl.eventText);
            assert.equal(entryOgDescription(actual.candidate.metadata.eventText),
                actual.perl.og, `${actual.id}: final 300-scalar OG changed`);
            const full = cleaner.clean({body: actual.raw, format: 'html_raw0',
                context: ledger.context});
            const expected = accepted.fullBody;
            assert.deepEqual(Object.keys(expected).sort(),
                ['kind', 'html', 'reason', 'category', 'evidence'].sort());
            assert.ok(typeof expected.evidence === 'string' && expected.evidence.length > 15);
            assert.equal(full.kind, expected.kind, `${actual.id}: full body kind`);
            assert.equal(full.kind === 'ok' ? full.fragment.html : null, expected.html,
                `${actual.id}: full body bytes`);
            assert.equal(full.kind === 'failure' ? full.reason : null, expected.reason);
            assert.ok(['exact', 'serialization', 'whitespace-transform',
                'context-adaptation', 'origin-adaptation', 'parser-repair',
                'unsupported'].includes(expected.category));
            const equal = full.kind === 'ok' && full.fragment.html === actual.perl.full;
            assert.equal(expected.category === 'exact', equal,
                `${actual.id}: disposition no longer matches retained bytes`);
            assert.equal(expected.category === 'unsupported', full.kind === 'failure');
            categories[expected.category] = (categories[expected.category] ?? 0) + 1;
        });
        assert.equal(seen.size, 52);
        for (const [index, actual] of adaptations.entries()) {
            const {id, category, evidence, ...accepted} = ledger.adaptations[index];
            assert.equal(id, ['p-short', 'list-short', 'table-short',
                'p-near300', 'list-near300', 'table-near300'][index]);
            assert.equal(category, 'metadata-visible-parser-adaptation');
            assert.ok(evidence.includes('300-scalar'));
            assert.deepEqual(actual, accepted, `${id}: literal metadata or OG changed`);
            assert.notEqual(actual.perlHelper, actual.tsHelper);
            assert.notEqual(actual.perlOg, actual.tsOg);
            assert.equal(entryOgDescription(actual.tsHelper), actual.tsOg,
                `${id}: adapted final 300-scalar OG changed`);
            assert.ok(actual.tsHelper.indexOf('one') < actual.tsHelper.indexOf('two'));
        }
        for (const [index, actual] of refusals.entries()) {
            const {id, category, evidence, ...accepted} = ledger.refusals[index];
            assert.equal(id, ['pre-entity-linefeed', 'pre-bare-cr',
                'textarea-entity-linefeed', 'textarea-lf-rcdata'][index]);
            assert.equal(category, 'unsupported-source-location');
            assert.ok(evidence.includes('source location'));
            assert.deepEqual(actual, accepted, `${id}: proof or refusal changed`);
            assert.deepEqual(actual.candidate, {kind: 'failure', reason: 'unsupported'});
        }
    } finally {
        cleaner.close();
    }
    process.stdout.write(JSON.stringify({candidate: binding.candidate,
        buildSha256: binding.buildSha256, common: common.length, categories,
        metadataAdaptations: adaptations.length, sourceProofRefusals: refusals.length}) + '\n');
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}

// corpus-paths.mjs
//
// Resolve and verify the finite, generated native cleaner corpus.
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

export const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(contentRoot, '../..');
export const trackedCorpusRoot = path.join(contentRoot, 'corpus');
export const defaultPreparedRoot = path.join(contentRoot, 'artifacts/corpus');
export const prepCommand = '/opt/dw-node24/bin/node src/content/tools/prepare-corpus.mjs';
export const suiteNames = Object.freeze([
    'cleaner-comment.t', 'cleaner-email.t', 'cleaner-embed.t',
    'cleaner-event-embed.t', 'cleaner-event.t', 'cleaner-forms.t',
    'cleaner-invalid.t', 'cleaner-link.t', 'cleaner-ljtags.t',
    'cleaner-markdown.t', 'cleaner-resource-loading.t',
    'cleaner-subject.t', 'cleaner-tables.t', 'cleaner-xss.t',
]);
export const derivedNames = Object.freeze([
    'native-inventory.json', 'native-call-replay-map.json',
    'native-derived-entry-cases.json',
]);
export const outputNames = Object.freeze([
    ...derivedNames, ...suiteNames.map(name => `native-logs/${name}.log`),
]);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function within(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
}

function assertNoSymlinkComponents(target) {
    const absolute = path.resolve(target);
    let current = path.parse(absolute).root;
    for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        let stat;
        try { stat = fs.lstatSync(current); }
        catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        assert.ok(!stat.isSymbolicLink(), `Symlink in corpus path: ${current}`);
        assert.ok(stat.isDirectory() || current === absolute,
            `Non-directory corpus ancestor: ${current}`);
    }
}

export function resolveOutputRoot(candidate = process.env.DW_CONTENT_CORPUS_ROOT ||
    defaultPreparedRoot) {
    const root = path.resolve(candidate);
    const temporaryRoot = '/tmp';
    assert.ok(within(path.join(contentRoot, 'artifacts'), root) ||
        root === defaultPreparedRoot || within(temporaryRoot, root),
    `Corpus output must be below ${path.join(contentRoot, 'artifacts')} or ${temporaryRoot}`);
    assertNoSymlinkComponents(root);
    return root;
}

function readJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

export function readTapSpec() {
    const filename = path.join(trackedCorpusRoot, 'native-tap-spec.json');
    const bytes = fs.readFileSync(filename);
    const spec = JSON.parse(bytes);
    assert.equal(spec.schema, 1);
    assert.deepEqual(spec.suites.map(item => path.basename(item.source)), suiteNames);
    for (const [index, suite] of spec.suites.entries()) {
        assert.equal(suite.source, `t/${suiteNames[index]}`);
    }
    assert.deepEqual(Object.keys(spec.outputsSha256).sort(), [...derivedNames].sort());
    assert.equal(spec.suites.reduce((sum, item) => sum + item.assertions, 0), 1116);
    assert.equal(spec.suites.reduce((sum, item) => sum + (item.calls?.count ?? 0), 0),
        1062);
    return { spec, bytes };
}

function assertionLine(number, description, status = 'ok', todo = null) {
    assert.ok(status === 'ok' || status === 'not ok');
    assert.ok(description === null ||
        (typeof description === 'string' && !description.includes('\n')));
    assert.ok(todo === null ||
        (typeof todo === 'string' && !todo.includes('\n')));
    return `${status} ${number}${description === null ? '' : ` - ${description}`}` +
        `${todo === null ? '' : ` # TODO ${todo}`}`;
}

export function expandTapLogs(spec) {
    const logs = new Map();
    for (const suite of spec.suites) {
        assert.equal(suite.log, `native-logs/${path.basename(suite.source)}.log`);
        const lines = [];
        let count = 0;
        let plans = 0;
        const append = description => lines.push(assertionLine(++count, description));
        for (const event of suite.events) {
            if (typeof event === 'string') append(event);
            else if ('description' in event) {
                lines.push(assertionLine(++count, event.description, event.status,
                    event.todo));
            } else if ('comment' in event) {
                assert.ok(event.comment.startsWith('#') &&
                    !event.comment.includes('\n'));
                lines.push(event.comment);
            } else if ('plan' in event) {
                plans++;
                assert.equal(event.plan, suite.assertions);
                lines.push(`1..${event.plan}`);
            } else if ('matrix' in event) {
                const vectors = spec.vectors[event.matrix.vectors];
                assert.ok(Array.isArray(vectors) && vectors.length > 0);
                for (const context of event.matrix.contexts) {
                    assert.ok(typeof context === 'string' && !context.includes('\n'));
                    for (const vector of vectors) append(`${context} neutralizes ${vector}`);
                }
            } else if ('template' in event) {
                const vectors = spec.vectors[event.template.vectors];
                assert.ok(Array.isArray(vectors) && vectors.length > 0);
                for (const vector of vectors) {
                    append(`${event.template.context} neutralizes ${vector}`);
                }
            } else throw new Error(`Unknown TAP event in ${suite.source}`);
        }
        assert.equal(plans, 1, `TAP plan count: ${suite.source}`);
        assert.equal(count, suite.assertions, `TAP assertion count: ${suite.source}`);
        const bytes = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
        assert.equal(sha256(bytes), suite.logSha256,
            `Retained TAP bytes changed: ${suite.source}`);
        logs.set(suite.log, bytes);
    }
    return logs;
}

export function verifiedInputs(spec, specBytes) {
    const inputs = [{ path: 'src/content/corpus/native-tap-spec.json',
        sha256: sha256(specBytes), bytes: specBytes.length }];
    for (const suite of spec.suites) {
        const source = fs.readFileSync(path.join(repoRoot, suite.source));
        assert.equal(sha256(source), suite.sourceSha256,
            `Native source changed: ${suite.source}`);
        inputs.push({ path: suite.source, sha256: sha256(source), bytes: source.length });
        if (suite.calls) {
            assert.match(suite.calls.path, /^native-calls\/cleaner-[a-z-]+\.t\.calls\.jsonl$/);
            const trace = fs.readFileSync(path.join(trackedCorpusRoot, suite.calls.path));
            assert.equal(sha256(trace), suite.calls.sha256,
                `Native call capture changed: ${suite.calls.path}`);
            inputs.push({ path: `src/content/corpus/${suite.calls.path}`,
                sha256: sha256(trace), bytes: trace.length });
        }
    }
    return inputs.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function ownedFile(filename) {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(),
        `Corpus output is not a regular file: ${filename}`);
    if (process.getuid) assert.equal(stat.uid, process.getuid(),
        `Corpus output is not owned by this user: ${filename}`);
    return stat;
}

export function expectedManifest(root, spec, inputs) {
    const outputs = outputNames.map(relative => {
        const filename = path.join(root, relative);
        ownedFile(filename);
        const bytes = fs.readFileSync(filename);
        const digest = sha256(bytes);
        const pinned = relative.startsWith('native-logs/')
            ? spec.suites.find(item => item.log === relative)?.logSha256
            : spec.outputsSha256[relative];
        assert.equal(digest, pinned, `Generated corpus bytes changed: ${relative}`);
        return { path: relative, sha256: digest, bytes: bytes.length };
    });
    return Buffer.from(`${JSON.stringify({ schema: 1, inputs, outputs }, null, 2)}\n`);
}

export function verifyPublishedCorpus(root, spec, inputs) {
    assertNoSymlinkComponents(root);
    const rootStat = fs.lstatSync(root);
    assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
    if (process.getuid) assert.equal(rootStat.uid, process.getuid(),
        `Corpus root is not owned by this user: ${root}`);
    const expectedTop = [...derivedNames, 'native-logs', 'manifest.json'].sort();
    assert.deepEqual(fs.readdirSync(root).sort(), expectedTop,
        'Corpus root contains missing or unrelated files');
    const logsRoot = path.join(root, 'native-logs');
    const logsStat = fs.lstatSync(logsRoot);
    assert.ok(logsStat.isDirectory() && !logsStat.isSymbolicLink());
    if (process.getuid) assert.equal(logsStat.uid, process.getuid());
    assert.deepEqual(fs.readdirSync(logsRoot).sort(),
        suiteNames.map(name => `${name}.log`).sort(), 'Native TAP log set changed');
    const expected = expectedManifest(root, spec, inputs);
    ownedFile(path.join(root, 'manifest.json'));
    assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.json')), expected,
        'Corpus manifest is stale or tampered');
    return root;
}

export function preparedCorpusRoot() {
    try {
        const root = resolveOutputRoot();
        const { spec, bytes } = readTapSpec();
        const inputs = verifiedInputs(spec, bytes);
        return verifyPublishedCorpus(root, spec, inputs);
    } catch (error) {
        throw new Error(`Prepare the native corpus first: ${prepCommand}`,
            { cause: error });
    }
}

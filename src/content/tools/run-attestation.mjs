// run-attestation.mjs
//
// Bind corpus results to current local source, compiled files and fixed evidence.
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
import path from 'node:path';
import {
    contentRoot, preparedCorpusRoot, repoRoot, resolveOutputRoot, sha256,
    trackedCorpusRoot,
} from './corpus-paths.mjs';

export const s2Root = path.join(repoRoot, 'src/s2/target/javascript');
export const defaultAttestationRoot = path.join(contentRoot, 'artifacts/attestation');
export const entryReportNames = Object.freeze([
    'entry-common.json', 'entry-adaptations.json', 'entry-refusals.json',
]);
function entryCommand(results) {
    const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
    return `${process.execPath} tools/attest-corpus-run.mjs ` +
        `--synthetic ${quote(results.synthetic.path)} ` +
        `--native ${quote(results.native.path)} --entry ` +
        '--output "$(mktemp -d /tmp/dw-content-entry-attestation.XXXXXX)"';
}

function readRegular(filename) {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(),
        `Attestation input is not a regular file: ${filename}`);
    return fs.readFileSync(filename);
}

function fileRecord(filename, kind, logicalPath = null) {
    const bytes = readRegular(filename);
    const relative = logicalPath ?? path.relative(repoRoot, filename)
        .split(path.sep).join('/');
    assert.ok(relative && !relative.startsWith('../') && !path.isAbsolute(relative));
    return { path: relative, kind, sha256: sha256(bytes), bytes: bytes.length };
}

function walk(directory, kind, filter = () => true) {
    const found = [];
    function visit(current) {
        const stat = fs.lstatSync(current);
        assert.ok(!stat.isSymbolicLink(), `Symlink in attested inventory: ${current}`);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
        } else {
            assert.ok(stat.isFile(), `Non-file in attested inventory: ${current}`);
            if (filter(current)) found.push(fileRecord(current, kind));
        }
    }
    visit(directory);
    return found;
}

function canonicalS2Compiled() {
    // The normal tsconfig emits these paths. Prior targeted test compiles may
    // leave unrelated ignored directories below dist; they are not this build.
    const files = [];
    for (const directory of ['runtime', 'live', 'tools']) {
        const sources = walk(path.join(s2Root, directory), 'source-s2',
            filename => filename.endsWith('.ts') && !filename.endsWith('.d.ts'));
        for (const source of sources) {
            const relative = source.path.slice('src/s2/target/javascript/'.length);
            files.push(fileRecord(path.join(s2Root, 'dist',
                relative.replace(/\.ts$/, '.js')), 'compiled-s2'));
        }
    }
    return files;
}

function fixedPaths(prepared) {
    return new Map([
        ['syntheticLedger', path.join(trackedCorpusRoot, 'accepted-synthetic-ledger.json')],
        ['nativeLedger', path.join(trackedCorpusRoot, 'accepted-native-ledger.json')],
        ['entryLedger', path.join(trackedCorpusRoot, 'slice5-entry-ledger.json')],
        ['browserCases', path.join(trackedCorpusRoot, 'native-browser-cases.json')],
        ['syntheticManifest', path.join(trackedCorpusRoot, 'entry-replay-cases.json')],
        ['nativeManifest', path.join(prepared, 'native-derived-entry-cases.json')],
        ['syntheticPerl', path.join(trackedCorpusRoot, 'entry-replay-perl.json')],
        ['nativePerl', path.join(trackedCorpusRoot, 'native-derived-entry-perl.json')],
    ]);
}

function fixedEvidence(prepared) {
    const binding = JSON.parse(readRegular(path.join(trackedCorpusRoot,
        'slice5-recent-binding.json')));
    assert.equal(binding.schema, 2);
    assert.equal(binding.purpose, 'slice5-recent-cleaner-regression');
    assert.deepEqual(binding.expectedCounts, {
        synthetic: 26, native: 384, entryCommon: 52, entryAdaptations: 6,
        entryRefusals: 4, browserGroups: 72, browserCases: 219,
    });
    const paths = fixedPaths(prepared);
    assert.deepEqual(Object.keys(binding.expectationsSha256).sort(),
        [...paths.keys()].sort());
    const tapSpec = JSON.parse(readRegular(path.join(trackedCorpusRoot,
        'native-tap-spec.json')));
    assert.equal(binding.expectationsSha256.nativeManifest,
        tapSpec.outputsSha256['native-derived-entry-cases.json'],
    'The independent semantic and Phase 1 native manifest pins disagree');
    for (const [name, filename] of paths) {
        assert.equal(sha256(readRegular(filename)), binding.expectationsSha256[name],
            `Fixed semantic expectation changed: ${name}`);
    }
    const native = JSON.parse(readRegular(paths.get('nativeLedger')));
    const synthetic = JSON.parse(readRegular(paths.get('syntheticLedger')));
    const entry = JSON.parse(readRegular(paths.get('entryLedger')));
    const browser = JSON.parse(readRegular(paths.get('browserCases')));
    assert.equal(native.schema, 2);
    assert.equal(native.cases.length, 384);
    assert.equal(synthetic.schema, 2);
    assert.equal(synthetic.cases.length, 26);
    assert.equal(entry.schema, 2);
    assert.equal(entry.common.length, 52);
    assert.equal(entry.adaptations.length, 6);
    assert.equal(entry.refusals.length, 4);
    assert.equal(browser.schema, 2);
    assert.equal(browser.groups.length, 72);
    assert.equal(browser.coveredCases, 219);
    return { binding, paths };
}

export function currentInventory() {
    const prepared = preparedCorpusRoot();
    const { paths } = fixedEvidence(prepared);
    const files = [
        ...walk(path.join(contentRoot, 'src'), 'source'),
        ...walk(path.join(contentRoot, 'tools'), 'source'),
        ...walk(path.join(contentRoot, 'tests'), 'source'),
        ...walk(path.join(trackedCorpusRoot, 'native-calls'), 'fixed-input'),
        ...walk(path.join(contentRoot, 'dist'), 'compiled-content',
            filename => filename.endsWith('.js')),
        ...canonicalS2Compiled(),
        ...[
            'live/render/host.ts', 'live/tests/entry-cleaner.test.ts',
            'live/tests/fixtures.ts',
        ].map(name => fileRecord(path.join(s2Root, name), 'source-s2-entry')),
        ...[
            path.join(contentRoot, 'package.json'),
            path.join(contentRoot, 'package-lock.json'),
            path.join(trackedCorpusRoot, 'native-tap-spec.json'),
            path.join(trackedCorpusRoot, 'slice5-recent-binding.json'),
            ...[...paths.values()].filter(name => !name.startsWith(`${prepared}/`)),
        ].map(name => fileRecord(name, 'fixed-evidence')),
        fileRecord(path.join(prepared, 'manifest.json'), 'fixed-evidence',
            '@prepared/manifest.json'),
        fileRecord(paths.get('nativeManifest'), 'fixed-evidence',
            '@prepared/native-derived-entry-cases.json'),
    ];
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    assert.equal(new Set(files.map(item => item.path)).size, files.length,
        'Attested inventory repeats a file');
    const compiled = files.filter(item => item.kind === 'compiled-content')
        .map(item => ({ path: item.path.slice('src/content/dist/'.length),
            sha256: item.sha256 }));
    assert.ok(compiled.length >= 2 && compiled.some(item => item.path === 'index.js'));
    const buildSha256 = sha256(Buffer.from(JSON.stringify(compiled)));
    const lockSha256 = sha256(readRegular(path.join(contentRoot, 'package-lock.json')));
    return { files, compiled, buildSha256, lockSha256, fixed: paths };
}

function resultRecord(filename, corpus, inventory) {
    const absolute = path.resolve(filename);
    const bytes = readRegular(absolute);
    const value = JSON.parse(bytes);
    assert.equal(value.schema, 1);
    assert.equal(value.corpus, corpus);
    assert.deepEqual(value.compiled, inventory.compiled,
        `${corpus}: result does not match current compiled JS`);
    assert.equal(value.buildSha256, inventory.buildSha256,
        `${corpus}: result has a stale build digest`);
    assert.equal(value.lockSha256, inventory.lockSha256,
        `${corpus}: result has a stale lock digest`);
    const manifest = inventory.fixed.get(`${corpus}Manifest`);
    const oracle = inventory.fixed.get(`${corpus}Perl`);
    assert.equal(value.manifestSha256, sha256(readRegular(manifest)));
    assert.equal(value.oracleSha256, sha256(readRegular(oracle)));
    assert.ok(Array.isArray(value.rows));
    assert.equal(value.rows.length, corpus === 'native' ? 384 : 26,
        `${corpus}: result has missing rows`);
    assert.equal(new Set(value.rows.map(row => row.id)).size, value.rows.length,
        `${corpus}: result has duplicate IDs`);
    return { path: absolute, sha256: sha256(bytes), bytes: bytes.length };
}

export function currentResults(syntheticPath, nativePath, inventory) {
    return { synthetic: resultRecord(syntheticPath, 'synthetic', inventory),
        native: resultRecord(nativePath, 'native', inventory) };
}

export function resolveAttestationRoot(candidate = defaultAttestationRoot) {
    const root = resolveOutputRoot(candidate);
    const prepared = path.join(contentRoot, 'artifacts/corpus');
    assert.ok(root !== prepared && !root.startsWith(`${prepared}${path.sep}`),
        'Run attestation cannot write inside the finite prepared corpus');
    return root;
}

export function attestationRootKind(root) {
    let stat;
    try { stat = fs.lstatSync(root); }
    catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(),
        `Attestation root is not an ordinary directory: ${root}`);
    if (process.getuid) assert.equal(stat.uid, process.getuid(),
        `Attestation root is not owned by this user: ${root}`);
    return fs.readdirSync(root).length === 0 ? 'empty' : 'present';
}

function reportRecord(root, name) {
    const filename = path.join(root, name);
    const bytes = readRegular(filename);
    const records = JSON.parse(bytes);
    const count = name === 'entry-common.json' ? 52 :
        name === 'entry-adaptations.json' ? 6 : 4;
    assert.ok(Array.isArray(records) && records.length === count,
        `${name}: wrong Entry report count`);
    if (name === 'entry-common.json') assert.equal(
        new Set(records.map(item => item.id)).size, count,
        `${name}: duplicate Entry ID`);
    return { path: name, sha256: sha256(bytes), bytes: bytes.length };
}

export function entryReports(root) {
    return entryReportNames.map(name => reportRecord(root, name));
}

export function verifyFreshEmit() {
    const temporary = fs.mkdtempSync('/tmp/dw-content-fresh-emit-');
    try {
        for (const [project, output] of [
            [contentRoot, path.join(temporary, 'content')],
            [s2Root, path.join(temporary, 's2')],
        ]) {
            const compiler = path.join(project, 'node_modules/typescript/bin/tsc');
            readRegular(compiler);
            const installed = JSON.parse(readRegular(path.join(project,
                'node_modules/typescript/package.json')));
            const declared = JSON.parse(readRegular(path.join(project, 'package.json')));
            const lock = JSON.parse(readRegular(path.join(project, 'package-lock.json')));
            assert.equal(installed.version, declared.devDependencies.typescript,
                `Local TypeScript version differs from ${project} package`);
            assert.equal(installed.version,
                lock.packages['node_modules/typescript'].version,
                `Local TypeScript version differs from ${project} lock`);
            const run = spawnSync(process.execPath,
                [compiler, '-p', path.join(project, 'tsconfig.json'), '--outDir', output],
                { cwd: project, encoding: 'utf8', timeout: 120000,
                    maxBuffer: 2 * 1024 * 1024 });
            assert.equal(run.status, 0, run.stderr || run.stdout ||
                run.error?.message || `Fresh TypeScript emit failed in ${project}`);
            const existing = project === contentRoot ? jsTree(path.join(project, 'dist')) :
                canonicalS2Compiled().map(item => ({ path: item.path.slice(
                    'src/s2/target/javascript/dist/'.length), sha256: item.sha256 }))
                    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
            const fresh = jsTree(output);
            assert.deepEqual(existing, fresh,
                `Compiled JS differs from current source; rebuild ${project}`);
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

function jsTree(root) {
    const result = [];
    function visit(directory, relative = '') {
        for (const name of fs.readdirSync(directory).sort()) {
            const filename = path.join(directory, name);
            const nested = relative ? `${relative}/${name}` : name;
            const stat = fs.lstatSync(filename);
            assert.ok(!stat.isSymbolicLink(), `Compiled package symlink: ${filename}`);
            if (stat.isDirectory()) visit(filename, nested);
            else {
                assert.ok(stat.isFile());
                if (name.endsWith('.js')) result.push({ path: nested,
                    sha256: sha256(fs.readFileSync(filename)) });
            }
        }
    }
    visit(root);
    return result;
}

export function verifyRunAttestation(directory, {
    syntheticPath = null, nativePath = null, requireEntry = false,
} = {}) {
    const root = resolveAttestationRoot(directory ?? defaultAttestationRoot);
    assert.equal(attestationRootKind(root), 'present',
        'Run attestation is absent; use node tools/attest-corpus-run.mjs');
    const manifest = JSON.parse(readRegular(path.join(root, 'run-attestation.json')));
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.repoRoot, repoRoot,
        'Run attestation belongs to a different checkout');
    const expectedFiles = manifest.entry === null ? ['run-attestation.json'] :
        ['run-attestation.json', ...entryReportNames];
    assert.deepEqual(fs.readdirSync(root).sort(), expectedFiles.sort(),
        'Run attestation contains missing or unrelated files');
    for (const name of expectedFiles) {
        const stat = fs.lstatSync(path.join(root, name));
        assert.ok(stat.isFile() && !stat.isSymbolicLink());
        if (process.getuid) assert.equal(stat.uid, process.getuid(),
            `Run attestation file is not owned by this user: ${name}`);
    }
    const inventory = currentInventory();
    assert.deepEqual(manifest.files, inventory.files,
        'Run attestation is stale relative to local source, build or fixed corpus');
    assert.deepEqual(manifest.results, currentResults(manifest.results.synthetic.path,
        manifest.results.native.path, inventory), 'Run result files changed');
    if (syntheticPath) assert.equal(sha256(readRegular(syntheticPath)),
        manifest.results.synthetic.sha256, 'Wrong synthetic result for attestation');
    if (nativePath) assert.equal(sha256(readRegular(nativePath)),
        manifest.results.native.sha256, 'Wrong native result for attestation');
    if (requireEntry && manifest.entry === null) {
        throw new Error(`Entry reports are missing; run ${entryCommand(manifest.results)}`);
    }
    if (manifest.entry !== null) assert.deepEqual(manifest.entry,
        entryReports(root), 'Attested Entry reports changed');
    return { root, manifest, inventory };
}

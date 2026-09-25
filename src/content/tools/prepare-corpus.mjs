// prepare-corpus.mjs
//
// Expand the fixed native cleaner corpus into ignored test artifacts.
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
import fs from 'node:fs';
import path from 'node:path';
import { buildNativeInventory } from './build-native-inventory.mjs';
import { buildNativeReplay } from './cleaner-build-native-replay.mjs';
import {
    contentRoot, defaultPreparedRoot, expandTapLogs, expectedManifest,
    readTapSpec, resolveOutputRoot, trackedCorpusRoot, verifiedInputs,
    verifyPublishedCorpus,
} from './corpus-paths.mjs';

function parseOutput() {
    const args = process.argv.slice(2);
    if (args.length === 0) return defaultPreparedRoot;
    if (args.length === 2 && args[0] === '--output' && args[1]) return args[1];
    throw new Error('usage: prepare-corpus.mjs [--output DIR]');
}

function existingRootKind(root) {
    let stat;
    try { stat = fs.lstatSync(root); }
    catch (error) {
        if (error.code === 'ENOENT') return 'absent';
        throw error;
    }
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(),
        `Corpus output root is not an ordinary directory: ${root}`);
    if (process.getuid) assert.equal(stat.uid, process.getuid(),
        `Corpus output root is not owned by this user: ${root}`);
    return fs.readdirSync(root).length === 0 ? 'empty' : 'present';
}

const root = resolveOutputRoot(parseOutput());
const { spec, bytes: specBytes } = readTapSpec();
const inputs = verifiedInputs(spec, specBytes);
const logs = expandTapLogs(spec);
const parent = path.dirname(root);
if (root === defaultPreparedRoot) {
    fs.mkdirSync(path.join(contentRoot, 'artifacts'), { recursive: true });
} else {
    assert.ok(fs.statSync(parent).isDirectory(),
        `Create the corpus output parent first: ${parent}`);
}
// Recheck after any parent creation and before using a cached publication.
resolveOutputRoot(root);
const state = existingRootKind(root);
if (state === 'present') {
    verifyPublishedCorpus(root, spec, inputs);
    console.log(`Native corpus verified from cache: ${root}`);
} else {
    const temporary = fs.mkdtempSync(path.join(parent, `.${path.basename(root)}.prepare-`));
    let published = false;
    try {
        const logDir = path.join(temporary, 'native-logs');
        fs.mkdirSync(logDir);
        for (const [relative, bytes] of logs) {
            fs.writeFileSync(path.join(temporary, relative), bytes, { flag: 'wx' });
        }
        buildNativeInventory({
            callsRoot: path.join(trackedCorpusRoot, 'native-calls'),
            logsRoot: logDir,
            destination: path.join(temporary, 'native-inventory.json'),
        });
        buildNativeReplay({ corpus: temporary,
            callsRoot: path.join(trackedCorpusRoot, 'native-calls') });
        const manifest = expectedManifest(temporary, spec, inputs);
        fs.writeFileSync(path.join(temporary, 'manifest.json'), manifest, { flag: 'wx' });
        verifyPublishedCorpus(temporary, spec, inputs);
        assert.equal(existingRootKind(root), state,
            'Corpus output root changed during preparation');
        fs.renameSync(temporary, root);
        published = true;
        verifyPublishedCorpus(root, spec, inputs);
        console.log(`Prepared ${logs.size} TAP logs and three native JSON files: ${root}`);
    } finally {
        if (!published) fs.rmSync(temporary, { recursive: true, force: true });
    }
}

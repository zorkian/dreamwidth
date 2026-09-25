// attest-corpus-run.mjs
//
// Record one current cleaner comparison run without changing fixed expectations.
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
import { repoRoot } from './corpus-paths.mjs';
import {
    attestationRootKind, currentInventory, currentResults, defaultAttestationRoot,
    entryReports, resolveAttestationRoot, s2Root, verifyFreshEmit,
    verifyRunAttestation,
} from './run-attestation.mjs';

function argumentsFromCli() {
    const args = process.argv.slice(2);
    const values = new Map();
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        assert.ok(['--synthetic', '--native', '--output', '--entry'].includes(flag),
            'usage: attest-corpus-run.mjs --synthetic RESULT --native RESULT ' +
            '[--entry] [--output DIR]');
        assert.ok(!values.has(flag), `Repeated attestation option: ${flag}`);
        if (flag === '--entry') values.set(flag, true);
        else {
            assert.ok(args[index + 1] && !args[index + 1].startsWith('--'));
            values.set(flag, args[++index]);
        }
    }
    assert.ok(values.has('--synthetic') && values.has('--native'),
        'Both synthetic and native results are required');
    return { synthetic: values.get('--synthetic'), native: values.get('--native'),
        entry: values.has('--entry'), output: values.get('--output') ??
        defaultAttestationRoot };
}

const options = argumentsFromCli();
const root = resolveAttestationRoot(options.output);
const parent = path.dirname(root);
if (root === defaultAttestationRoot) fs.mkdirSync(parent, { recursive: true });
else assert.ok(fs.statSync(parent).isDirectory(),
    `Create the attestation parent first: ${parent}`);
resolveAttestationRoot(root);
const state = attestationRootKind(root);
assert.notEqual(state, 'present',
    `Use a fresh --output DIR; existing attestation root is not empty: ${root}`);

const inventory = currentInventory();
// A fresh local emit proves the current source actually produced this dist tree.
// Check both projects before accepting a caller's result envelope.
verifyFreshEmit();
const results = currentResults(options.synthetic, options.native, inventory);
const temporary = fs.mkdtempSync(path.join(parent, `.${path.basename(root)}.attest-`));
let published = false;
try {
    let entry = null;
    if (options.entry) {
        const prefix = path.join(temporary, 'entry-common.json');
        const test = path.join(s2Root, 'dist/live/tests/entry-cleaner.test.js');
        const run = spawnSync(process.execPath, ['--test', test], {
            cwd: s2Root, encoding: 'utf8', timeout: 60000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, SLICE5_METADATA_REPORT: prefix },
        });
        assert.equal(run.status, 0, run.stderr || run.stdout || run.error?.message);
        fs.renameSync(`${prefix}.adaptations.json`,
            path.join(temporary, 'entry-adaptations.json'));
        fs.renameSync(`${prefix}.refusals.json`,
            path.join(temporary, 'entry-refusals.json'));
        entry = entryReports(temporary);
    }
    // The repo identity is local provenance, never a Git or historic SHA lookup.
    const manifest = { schema: 1, repoRoot, files: inventory.files, results, entry };
    fs.writeFileSync(path.join(temporary, 'run-attestation.json'),
        `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    assert.equal(attestationRootKind(root), state,
        'Attestation output root changed during preparation');
    fs.renameSync(temporary, root);
    published = true;
    verifyRunAttestation(root, { syntheticPath: options.synthetic,
        nativePath: options.native, requireEntry: options.entry });
    console.log(JSON.stringify({ root, cases: 410, entryReports: entry?.length ?? 0 }));
} finally {
    if (!published) fs.rmSync(temporary, { recursive: true, force: true });
}

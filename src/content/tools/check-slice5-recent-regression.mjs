// check-slice5-recent-regression.mjs
//
// Require all retained Recent cleaner outcomes against fixed semantic ledgers.
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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultAttestationRoot, verifyRunAttestation } from './run-attestation.mjs';

const [bindingPath, syntheticPath, nativePath, flag, suppliedAttestation] =
    process.argv.slice(2);
if (!bindingPath || !syntheticPath || !nativePath ||
    (flag && (flag !== '--attestation' || !suppliedAttestation)) ||
    process.argv.length > (flag ? 7 : 5)) {
    throw new Error('usage: check-slice5-recent-regression.mjs ' +
        'binding.json synthetic-result.json native-result.json [--attestation DIR]');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attestation = suppliedAttestation ?? defaultAttestationRoot;
const verified = verifyRunAttestation(attestation,
    { syntheticPath, nativePath });
assert.equal(path.resolve(bindingPath),
    path.join(root, 'corpus/slice5-recent-binding.json'));
const binding = JSON.parse(fs.readFileSync(bindingPath));
assert.equal(binding.schema, 2);
assert.equal(binding.purpose, 'slice5-recent-cleaner-regression');
const summaries = [];
for (const [corpus, resultPath] of [['synthetic', syntheticPath],
    ['native', nativePath]]) {
    const ledgerPath = verified.inventory.fixed.get(`${corpus}Ledger`);
    const checked = execFileSync(process.execPath, [
        path.join(root, 'tools/check-difference-ledger.mjs'), resultPath,
        ledgerPath, '--attestation', attestation,
    ], { encoding: 'utf8' });
    summaries.push(JSON.parse(checked));
}
assert.equal(summaries[0].cases + summaries[1].cases, 410);
assert.equal(summaries[0].cases, binding.expectedCounts.synthetic);
assert.equal(summaries[1].cases, binding.expectedCounts.native);
process.stdout.write(JSON.stringify({ historicalCases: 410,
    unchanged: summaries}) + '\n');

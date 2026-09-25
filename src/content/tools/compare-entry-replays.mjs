// compare-entry-replays.mjs
//
// Record exact shared-cleaner output for retained html_raw0 replay inputs.
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
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparedCorpusRoot } from './corpus-paths.mjs';

const [moduleArg, candidate, corpusName] = process.argv.slice(2);
if (!moduleArg || !/^[0-9a-f]{40}$/.test(candidate ?? '') ||
    !['synthetic', 'native'].includes(corpusName)) {
    throw new Error('usage: compare-entry-replays.mjs <built-cleaner-index.js> ' +
        '<full-candidate-sha> synthetic|native > result.json');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'corpus');
const native = corpusName === 'native';
const manifestBytes = fs.readFileSync(path.join(native ? preparedCorpusRoot() : corpus,
    native ? 'native-derived-entry-cases.json' : 'entry-replay-cases.json'));
const oracleBytes = fs.readFileSync(path.join(corpus, native
    ? 'native-derived-entry-perl.json' : 'entry-replay-perl.json'));
const manifest = JSON.parse(manifestBytes);
const oracle = JSON.parse(oracleBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(oracle.manifestSha256, sha(manifestBytes));
assert.equal(manifest.cases.length, oracle.records.length);
assert.equal(manifest.cases.length, native ? 384 : 26);
const require = createRequire(import.meta.url);
const modulePath = path.resolve(moduleArg);
assert.equal(path.basename(modulePath), 'index.js');
const moduleStat = fs.lstatSync(modulePath);
assert.ok(moduleStat.isFile() && !moduleStat.isSymbolicLink(),
    'built cleaner entry must be a regular file');
const distRoot = path.dirname(modulePath);
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
            if (name.endsWith('.js')) {
                compiled.push({ path: nested, sha256: sha(fs.readFileSync(file)) });
            }
        }
    }
}
collect(distRoot);
assert.ok(compiled.length >= 2 && compiled.some(item => item.path === 'index.js'));
compiled.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const buildSha256 = sha(Buffer.from(JSON.stringify(compiled)));
const lockSha256 = sha(fs.readFileSync(path.join(root, 'package-lock.json')));
const { createEntryCleaner } = require(modulePath);
assert.equal(typeof createEntryCleaner, 'function');
const limits = { maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096,
    maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096,
    maxImageCandidates: 256, maxCuts: 16 };
const cleaner = createEntryCleaner(limits);
const decode = new TextDecoder('utf-8', { fatal: true });
const rows = [];
try {
    for (const [index, item] of manifest.cases.entries()) {
        const reference = oracle.records[index];
        assert.equal(reference.id, item.id);
        const inputBytes = native ? Buffer.from(item.rawInputBase64, 'base64')
            : Buffer.from(item.body, 'utf8');
        const inputSha256 = sha(inputBytes);
        assert.equal(inputSha256, native ? item.rawInputSha256 : reference.inputSha256);
        const body = decode.decode(inputBytes);
        assert.equal(sha(Buffer.from(body, 'utf8')), inputSha256,
            `${item.id}: UTF-8 input changed while decoding`);
        const options = native ? {} : item.options ?? {};
        const reader = {
            removeColors: Boolean(options.remove_colors),
            removeSizes: Boolean(options.remove_sizes),
            removeFonts: Boolean(options.remove_fonts),
            maxImageWidth: null, maxImageHeight: null,
            placeholderUndefinedImageSize: false, extractImages: false,
        };
        const input = { body, format: 'html_raw0', context: {
            policy: 'dreamwidth-entry-html-raw0-v1', insertionContext: 'html-div-flow',
            documentUrl: manifest.documentUrl, entryUrl: manifest.entryUrl,
            journalUsername: 's2js_slice3', journalId: 123, entryId: 123,
            reader, imagePlaceholder: { src: '/img/imageplaceholder2.png',
                width: 35, height: 35, alt: 'Image', title: 'Image' },
            cuts: 'source-compatible-recent', urls: { siteDomain: '',
                knownHttpsSites: [], formDomainBanned: [], imageProxy: 'not-configured' },
        } };
        const result = cleaner.clean(input);
        assert.ok(['ok', 'failure'].includes(result.kind),
            `${item.id}: image resolution is absent in this recorded context`);
        const perlBytes = Buffer.from(reference.outputBase64, 'base64');
        assert.equal(sha(perlBytes), reference.outputSha256);
        const html = result.kind === 'ok' ? result.fragment.html : null;
        const jsBytes = html === null ? null : Buffer.from(html, 'utf8');
        rows.push({ id: item.id,
            source: native ? item.nativeSource : item.source,
            nativeEditor: native ? item.nativeEditor : null,
            inputSha256, perlSha256: sha(perlBytes), perlBytes: perlBytes.length,
            kind: result.kind, reason: result.kind === 'failure' ? result.reason : null,
            jsSha256: jsBytes === null ? null : sha(jsBytes),
            jsBytes: jsBytes?.length ?? null,
            jsHtml: html,
            jsOutputBase64: jsBytes?.toString('base64') ?? null,
            rawEqual: jsBytes?.equals(perlBytes) ?? false });
    }
} finally {
    cleaner.close();
}
process.stdout.write(JSON.stringify({ schema: 1, corpus: corpusName, candidate,
    buildSha256, compiled, lockSha256, manifestSha256: sha(manifestBytes),
    oracleSha256: sha(oracleBytes), rows }, null, 2) + '\n');

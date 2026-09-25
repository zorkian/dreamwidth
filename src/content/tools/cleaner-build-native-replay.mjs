// cleaner-build-native-replay.mjs
//
// Derive new html_raw0 replay inputs from original clean_event call bytes.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'corpus');
const output = process.argv[2] || path.join(corpus, 'native-derived-entry-cases.json');
const mapOutput = process.argv[3] || path.join(corpus, 'native-call-replay-map.json');
const inventory = JSON.parse(fs.readFileSync(path.join(corpus, 'native-inventory.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true });
const records = [];
const omissions = [];
const sourceMap = [];
const nativeOnlyReason = new Map([
    ['clean_comment', 'comment cleaner context'],
    ['clean_embed', 'media embed cleaner context'],
    ['clean_subject', 'subject cleaner context'],
    ['clean_subject_all', 'subject cleaner context'],
    ['clean_and_trim_subject', 'subject cleaner context'],
    ['clean_userbio', 'user bio cleaner context'],
]);

for (const suite of inventory.suites) {
    if (!suite.capturedCalls) continue;
    const tracePath = path.join(corpus, suite.capturedCalls.path);
    const trace = fs.readFileSync(tracePath);
    if (sha(trace) !== suite.capturedCalls.sha256) {
        throw new Error(`Native trace changed: ${suite.source}`);
    }
    const calls = trace.toString('utf8').trimEnd().split('\n').map(JSON.parse);
    if (calls.length !== suite.capturedCalls.count) {
        throw new Error(`Native call count changed: ${suite.source}`);
    }
    for (const call of calls) {
        const ref = `${suite.source}#call-${String(call.callOrdinal).padStart(4, '0')}`;
        if (call.method !== 'clean_event') {
            const reason = nativeOnlyReason.get(call.method);
            if (!reason) throw new Error(`Unknown native cleaner method: ${call.method}`);
            sourceMap.push({ nativeCall: ref, nativeMethod: call.method,
                nativeContext: suite.nativeContext, disposition: 'native-only', reason });
            continue;
        }
        const raw = Buffer.from(call.inputBase64 ?? '', 'base64');
        if (!call.inputPresent || sha(raw) !== call.inputSha256 || raw.length > 65536) {
            omissions.push({ nativeCall: ref, reason: 'missing or oversized input' });
            sourceMap.push({ nativeCall: ref, nativeMethod: call.method,
                nativeContext: suite.nativeContext, disposition: 'native-only',
                reason: 'missing or oversized input outside strict entry domain' });
            continue;
        }
        try { decoder.decode(raw); }
        catch {
            omissions.push({ nativeCall: ref, reason: 'invalid UTF-8 outside strict entry domain' });
            sourceMap.push({ nativeCall: ref, nativeMethod: call.method,
                nativeContext: suite.nativeContext, disposition: 'native-only',
                reason: 'invalid UTF-8 outside strict entry domain' });
            continue;
        }
        sourceMap.push({ nativeCall: ref, nativeMethod: call.method,
            nativeContext: suite.nativeContext, disposition: 'new-html_raw0-replay',
            replayId: `${ref}:html_raw0` });
        records.push({
            id: `${ref}:html_raw0`,
            nativeSource: suite.source,
            nativeSourceSha256: suite.sourceSha256,
            nativeContext: suite.nativeContext,
            nativeTraceSha256: suite.capturedCalls.sha256,
            nativeCallOrdinal: call.callOrdinal,
            nativeBeforeTap: call.beforeTap,
            nativeTestLine: call.sourceLine,
            nativeDirectCaller: call.directCallerFile,
            nativeMethod: call.method,
            nativeEditor: call.scalarOptions.editor ?? null,
            originalInputUtf8Flag: call.inputUtf8Flag,
            rawInputBase64: call.inputBase64,
            rawInputSha256: call.inputSha256,
            rawInputBytes: raw.length,
            replayInputUtf8Flag: false,
            reparse: ['div.entry-content'],
        });
    }
}
if (records.length !== 384 || omissions.length !== 0 || sourceMap.length !== 1062 ||
    sourceMap.filter(item => item.disposition === 'native-only').length !== 678) {
    throw new Error(`Native-derived entry replay changed: ${records.length} records, ` +
        `${omissions.length} omissions`);
}
const manifest = {
    schema: 1,
    kind: 'native-call-derived-html_raw0-replay',
    base: inventory.base,
    nativeInventorySha256: sha(fs.readFileSync(path.join(corpus, 'native-inventory.json'))),
    perlInputEncoding: 'raw-utf8-bytes-from-logtext2',
    documentUrl: 'https://app.slice4.invalid/s2js_slice3/?skip=0',
    entryUrl: 'https://app.slice4.invalid/s2js_slice3/123.html',
    perlOptions: { editor: 'html_raw0',
        cuturl: 'https://app.slice4.invalid/s2js_slice3/123.html',
        journal: 's2js_slice3', ditemid: 123 },
    note: 'New entry replays from exact native input bytes; original suite outputs and TAP contexts are not reclassified or treated as these replay expectations.',
    omitted: omissions,
    cases: records,
};
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(mapOutput, `${JSON.stringify({ schema: 1,
    kind: 'native-cleaner-call-to-entry-replay-map',
    nativeInventorySha256: manifest.nativeInventorySha256,
    note: 'Original native calls keep their method/context; entry replays are new records.',
    calls: sourceMap }, null, 2)}\n`);
console.log(`Mapped ${sourceMap.length} native calls: ${records.length} new html_raw0 replays, ` +
    `${sourceMap.length - records.length} native-only, ${omissions.length} omissions`);

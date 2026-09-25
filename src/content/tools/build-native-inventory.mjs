// build-native-inventory.mjs
//
// Index every original cleaner TAP assertion without changing its source suite.
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

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(contentRoot, '../..');
const logsRoot = path.join(contentRoot, 'corpus/native-logs');
const destination = path.join(contentRoot, 'corpus/native-inventory.json');
const suites = [
    ['cleaner-comment.t', 'comment', 28],
    ['cleaner-email.t', 'email', 17],
    ['cleaner-embed.t', 'media embed', 189],
    ['cleaner-event-embed.t', 'event and media embed', 1],
    ['cleaner-event.t', 'entry default and options', 42],
    ['cleaner-forms.t', 'entry forms', 6],
    ['cleaner-invalid.t', 'invalid input', 4],
    ['cleaner-link.t', 'HTMLCleaner streaming link', 9],
    ['cleaner-ljtags.t', 'entry custom lj tags', 12],
    ['cleaner-markdown.t', 'Markdown entry and comment', 28],
    ['cleaner-resource-loading.t', 'entry and comment resources', 12],
    ['cleaner-subject.t', 'subject', 2],
    ['cleaner-tables.t', 'entry tables', 9],
    ['cleaner-xss.t', 'XSS surface matrix and oracle', 757],
];

function sha(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function sourceLocation(lines, name) {
    const exact = [];
    for (let index = 0; index < lines.length; index++) {
        if (lines[index].includes(name)) exact.push(index + 1);
    }
    if (exact.length) return { lines: exact, kind: 'literal-description' };
    const dynamic = /(?:neutralizes|strips) ([-a-z0-9]+)$/.exec(name);
    if (dynamic) {
        const key = `'${dynamic[1]}'`;
        const refs = [];
        for (let index = 0; index < lines.length; index++) {
            if (lines[index].includes(key)) refs.push(index + 1);
        }
        if (refs.length) return { lines: refs, kind: 'expanded-input-name' };
    }
    const assertionSites = [];
    for (let index = 0; index < lines.length; index++) {
        if (/\b(?:ok|is|isnt|like|unlike|cmp_ok|pass|fail)\s*\(/.test(lines[index])) {
            assertionSites.push(index + 1);
        }
    }
    return { lines: assertionSites, kind: 'runtime-expanded-assertion-sites' };
}

function caseContext(suite, description) {
    if (suite === 'cleaner-xss.t') {
        const surface = /^(event\/(?:default|preformatted|markdown|syndicated)|comment\/(?:default|anon|markdown|preformatted)|subject(?:_all|_trim)?|userbio) neutralizes /.exec(description);
        if (surface) return surface[1];
        if (description.startsWith('clean_embed ')) return 'media embed';
        if (description.startsWith('clean_event ')) return 'event/default TODO';
        if (description.startsWith('clean_comment ')) return 'comment/default';
        return 'XSS oracle self-check or positive control';
    }
    return suites.find(row => row[0] === suite)[1];
}

const output = {
    schema: 1,
    base: 'c725406eeed4b239dbb68af0a50f505f4b83b8df',
    note: 'Native TAP inventory. Exact cleaner input/output replay and diff ledger are separate artifacts.',
    mockContext: 't/lib/ljtestlib.pl fakes DW::Proxy::get_proxy_url to http://proxy.url and language helpers where imported; this is not the production proxy.',
    suites: [],
    cases: [],
};
for (const [filename, context, expected] of suites) {
    const sourcePath = `t/${filename}`;
    const source = fs.readFileSync(path.join(repoRoot, sourcePath));
    const sourceText = source.toString('utf8');
    const sourceLines = sourceText.split('\n');
    const logPath = `native-logs/${filename}.log`;
    const log = fs.readFileSync(path.join(contentRoot, 'corpus', logPath));
    const logText = log.toString('utf8');
    const plan = [...logText.matchAll(/^1\.\.(\d+)$/gm)];
    if (plan.length !== 1 || Number(plan[0][1]) !== expected) {
        throw new Error(`TAP plan mismatch for ${filename}`);
    }
    const assertions = [...logText.matchAll(/^(ok|not ok) (\d+)(?: - (.*?))?(?: # TODO (.*))?$/gm)];
    if (assertions.length !== expected) throw new Error(`TAP case count mismatch for ${filename}`);
    const sourceSha256 = sha(source);
    const logSha256 = sha(log);
    const callsPath = `native-calls/${filename}.calls.jsonl`;
    const callsFile = path.join(contentRoot, 'corpus', callsPath);
    let capturedCalls = null;
    const callByTap = new Map();
    if (fs.existsSync(callsFile)) {
        const callBytes = fs.readFileSync(callsFile);
        const records = callBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
        for (let index = 0; index < records.length; index++) {
            const call = records[index];
            if (call.suite !== filename || call.source !== sourcePath ||
                call.callOrdinal !== index + 1 || !Number.isSafeInteger(call.beforeTap) ||
                call.beforeTap < 0 || call.beforeTap > expected) {
                throw new Error(`Native call provenance mismatch in ${callsPath}`);
            }
            for (const field of ['input', 'output']) {
                if (call[`${field}Present`]) {
                    const raw = Buffer.from(call[`${field}Base64`], 'base64');
                    if (sha(raw) !== call[`${field}Sha256`]) {
                        throw new Error(`Native ${field} bytes mismatch in ${callsPath}`);
                    }
                }
            }
            const nextTap = call.beforeTap + 1;
            if (nextTap <= expected) {
                const ordinals = callByTap.get(nextTap) || [];
                ordinals.push(call.callOrdinal);
                callByTap.set(nextTap, ordinals);
            }
        }
        capturedCalls = { path: callsPath, sha256: sha(callBytes), count: records.length,
            captureMethod: 'temporary #line-preserving wrapper; original TAP must match byte-for-byte' };
    }
    const provenance = sourceText.includes('LiveJournal project owned and operated')
        ? 'inherited LiveJournal GPL notice' : 'Dreamwidth Perl-terms notice';
    output.suites.push({ source: sourcePath, sourceSha256, sourceLines: sourceLines.length,
        provenance, nativeContext: context, nativeLog: logPath, nativeLogSha256: logSha256,
        mockLJTestLib: sourceText.includes('ljtestlib.pl'), capturedCalls,
        sourceAssertionsOriginally: filename ===
            'cleaner-resource-loading.t' ? 8 : expected, runtimeAssertions: expected });
    for (let index = 0; index < assertions.length; index++) {
        const [, status, number, name = '', todo] = assertions[index];
        if (Number(number) !== index + 1) throw new Error(`TAP numbering gap in ${filename}`);
        const ref = sourceLocation(sourceLines, name);
        output.cases.push({ id: `${sourcePath}#tap-${String(number).padStart(4, '0')}`,
            source: sourcePath, sourceSha256, sourceLines: ref.lines,
            sourceLocationKind: ref.kind, nativeContext: caseContext(filename, name),
            nativePredicate: status, description: name, todo: todo || null,
            nativeTapLine: assertions[index][0], nativeLog: logPath,
            nativeCallOrdinals: callByTap.get(index + 1) || [],
            replayContext: 'native-only-until-explicit-entry-html_raw0-replay' });
    }
}
if (output.cases.length !== 1116 || output.suites.length !== 14) {
    throw new Error('Native suite inventory is incomplete');
}
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Indexed ${output.cases.length} native assertions from ${output.suites.length} suites`);

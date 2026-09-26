// entry-newlines.test.mjs
//
// Retained preformatted body newlines, repeated cleaning and browser geometry.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const requireContent = createRequire(resolve(here, '../../../../../content/package.json'));
const {chromium} = requireContent('playwright');
const {JSDOM, VirtualConsole} = requireContent('jsdom');
const {createEntryCleaner} = requireContent('./dist');
const {config} = requireContent(resolve(here, '../../dist/live/tests/fixtures.js'));
const limits = {maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096,
    maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096, maxImageCandidates: 256, maxCuts: 16};
const context = {
    policy: 'dreamwidth-entry-html-raw0-v1', insertionContext: 'html-div-flow',
    documentUrl: 'http://localhost:8080/~s2js_slice3/384.html',
    entryUrl: 'http://localhost:8080/~s2js_slice3/384.html',
    journalUsername: 's2js_slice3', journalId: 6, entryId: 384,
    reader: {removeColors: false, removeSizes: false, removeFonts: false,
        maxImageWidth: null, maxImageHeight: null, placeholderUndefinedImageSize: false,
        extractImages: false}, ...config.entryContent,
};
const input = (body, cuts) => ({body, format: 'html_raw0', context: {...context, cuts}});
const sha = value => createHash('sha256').update(value).digest('hex');
const cases = [];
for (const tag of ['pre', 'textarea']) {
    for (const [name, text] of [
        ['empty', ''], ['zero', 'one'], ['one', '\none'], ['two', '\n\none'], ['three', '\n\n\none'],
        ['crlf', '\r\none'], ['double-crlf', '\r\n\r\none'], ['cr', '\rone'], ['double-cr', '\r\rone'],
        ['lf-only', '\n'], ['double-lf-only', '\n\n'], ['crlf-only', '\r\n'], ['cr-only', '\r'],
        ['entity-only', '&#10;'], ['numeric', '&#10;one'], ['two-numeric', '&#10;&#10;one'],
        ['hex', '&#xA;\none'], ['named', '&NewLine;\none'], ['ordinary-entity', '&amp;one'],
        ['entity-after-lf', '\n&amp; &#10; one'], ['entity-after-entity', '&#10;&amp;one'],
        ['tag-after-lf', '\n<b>one</b>'], ['tag-after-entity', '&#10;<b>one</b>'],
        ['comment-first', '<!--x-->\n\none'], ['comment-after-lf', '\n<!--x-->\none'],
        ['eaten-first', '<script>ignored</script>\n\none'], ['eaten-after-lf', '\n<script>ignored</script>\none'],
        ['later-lf', 'one\n\ntwo'],
    ]) cases.push({id: `${tag}-${name}`, raw: `<${tag}>${text}</${tag}>`});
    cases.push({id: `${tag}-unclosed`, raw: `<${tag}>\n\none`});
    cases.push({id: `${tag}-cut`, raw: `<lj-cut><${tag}>\n\none</${tag}></lj-cut>`, cut: true});
}
cases.push({id: 'pre-child-first', raw: '<pre><b>\n\none</b></pre>'});
cases.push({id: 'pre-entity-gap-ignored-close', raw: '<pre>&#10;x</b>y</pre>'});
cases.push({id: 'pre-entity-comment', raw: '<pre>&#10;<!--x-->\none</pre>'});
cases.push({id: 'pre-entity-broken-location-ignored-close', raw: '<pre>&#10;&amp;x</b>y</pre>', unsupported: true});

test('source-proved displayed initial newlines match retained browser values and geometry, JS on/off', async t => {
    const native = spawnSync('perl', [resolve(here, 'entry-retained.pl')], {
        input: JSON.stringify(cases.map(row => ({body: row.raw, subject: 'subject'}))),
        encoding: 'utf8', timeout: 10000, env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'},
    });
    assert.equal(native.status, 0, native.stderr);
    const retained = JSON.parse(native.stdout);
    const cleaner = createEntryCleaner(limits);
    const browser = await chromium.launch({headless: true});
    const report = [];
    const refusals = [];
    t.diagnostic(`Chromium ${browser.version()}; raw/native body evidence, not metadata normalization`);
    try {
        for (const [i, row] of cases.entries()) {
            const dom = new JSDOM(row.raw, {includeNodeLocations: true, virtualConsole: new VirtualConsole()});
            const element = dom.window.document.querySelector('pre,textarea');
            const sourceProof = {element: dom.nodeLocation(element), first: element.firstChild ?
                {location: dom.nodeLocation(element.firstChild), text: element.firstChild.textContent} : null};
            if (row.unsupported) {
                const start = sourceProof.element.startTag.endOffset;
                const decoder = dom.window.document.createElement('textarea');
                const gap = row.raw.slice(start, sourceProof.first.location.startOffset);
                const extent = row.raw.slice(start, sourceProof.first.location.endOffset);
                decoder.innerHTML = gap;
                const gapDecoded = decoder.textContent;
                decoder.innerHTML = extent;
                sourceProof.failingProof = {gap, gapDecoded, extent, extentDecoded: decoder.textContent,
                    expected: '\n' + sourceProof.first.text};
                decoder.textContent = '';
            }
            dom.window.close();
            for (const cuts of ['source-compatible-recent', 'source-compatible-entry']) {
                if (row.cut && cuts === 'source-compatible-recent') {
                    const result = cleaner.clean(input(row.raw, cuts));
                    assert.equal(result.kind, 'ok');
                    assert.ok(!result.fragment.html.includes('<pre>') && !result.fragment.html.includes('<textarea>'));
                    continue;
                }
                const result = cleaner.clean(input(row.raw, cuts));
                if (row.unsupported) {
                    assert.deepEqual(result, {kind: 'failure', reason: 'unsupported'}, row.id);
                    refusals.push({...row, cuts, sourceProof, rawSha256: sha(row.raw), native: retained[i].full,
                        nativeSha256: sha(retained[i].full), result,
                        disposition: 'ambiguous-initial-newline-source-proof'});
                    continue;
                }
                assert.equal(result.kind, 'ok', row.id + ':' + cuts + ':' + JSON.stringify(result));
                const html = result.fragment.html;
                const again = cleaner.clean(input(html, cuts));
                assert.equal(again.kind, 'ok', row.id + ':second-clean');
                assert.equal(again.fragment.html, html, row.id + ':true-byte-idempotence');
                report.push({...row, cuts, sourceProof, rawSha256: sha(row.raw), native: retained[i].full,
                    nativeSha256: sha(retained[i].full), html, outputSha256: sha(html),
                    disposition: html === retained[i].full ? 'exact' : 'body-only-html-serialization', browsers: []});
            }
        }
        for (const javaScriptEnabled of [true, false]) {
            const bc = await browser.newContext({javaScriptEnabled});
            const page = await bc.newPage();
            const inspect = async html => {
                await page.setContent('<!doctype html><style>pre{font:16px/20px monospace}textarea{font:16px/20px monospace}</style>' +
                    '<div class="entry-content">' + html + '</div><div id="following">after</div>');
                return page.evaluate(() => {
                    const element = document.querySelector('.entry-content pre,.entry-content textarea');
                    return {text: element.textContent, value: element instanceof HTMLTextAreaElement ? element.value : null,
                        height: element.getBoundingClientRect().height,
                        followingTop: document.querySelector('#following').getBoundingClientRect().top,
                        whiteSpace: getComputedStyle(element).whiteSpace};
                });
            };
            for (const row of report) {
                const expected = await inspect(row.native);
                const actual = await inspect(row.html);
                assert.deepEqual(actual, expected, row.id + ':' + row.cuts + ':' + javaScriptEnabled);
                // Parse the same reviewed fragment afresh, and separately its
                // actual second-clean output. Never mistake repeating raw-input
                // cleaning for clean(clean(raw)) or strip LF for comparison.
                assert.deepEqual(await inspect(cleaner.clean(input(row.html, row.cuts)).fragment.html), actual);
                row.browsers.push({javaScriptEnabled, expected, actual});
            }
            // Positive control measures the reported missing-line/value defect.
            assert.notDeepEqual(await inspect('<pre>\n\none</pre>'), await inspect('<pre>\none</pre>'));
            assert.notDeepEqual(await inspect('<textarea>\n\none</textarea>'), await inspect('<textarea>\none</textarea>'));
            await bc.close();
        }
        for (const raw of ['<listing>\n\none</listing>', '<listing>one</listing>']) {
            assert.deepEqual(cleaner.clean(input(raw, 'source-compatible-entry')),
                {kind: 'failure', reason: 'unsupported'});
        }
        if (process.env.SLICE5_NEWLINES_REPORT) {
            writeFileSync(process.env.SLICE5_NEWLINES_REPORT, JSON.stringify(report, null, 2) + '\n');
            writeFileSync(process.env.SLICE5_NEWLINES_REPORT + '.refusals.json', JSON.stringify(refusals, null, 2) + '\n');
        }
    } finally {cleaner.close(); await browser.close();}
});

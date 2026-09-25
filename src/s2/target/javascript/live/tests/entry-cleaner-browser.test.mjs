// entry-cleaner-browser.test.mjs
//
// Browser reparse, inert metadata and full-cut named-anchor checks.
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
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const content = resolve(here, '../../../../../content');
const requireContent = createRequire(resolve(content, 'package.json'));
const {chromium} = requireContent('playwright');
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
        extractImages: false},
    ...config.entryContent, cuts: 'source-compatible-entry',
};
const input = body => ({body, format: 'html_raw0', context});
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const og = value => escape([...value.replace(/[\t\n\v\f\r ]+/g, ' ').replace(/^ +| +$/g, '')]
    .slice(0, 300).join('').replace(/^ +| +$/g, ''));

function retained(body) {
    const probe = spawnSync('perl', [resolve(here, 'entry-retained.pl')],
        {input: JSON.stringify([{subject: 'subject', body}]), encoding: 'utf8', timeout: 10000,
            env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'}});
    assert.equal(probe.status, 0, probe.stderr);
    return JSON.parse(probe.stdout)[0];
}

test('Chromium full-cut/metadata output stays inert and matches native anchor selection, JS on/off', async t => {
    const cleaner = createEntryCleaner(limits);
    const browser = await chromium.launch({headless: true});
    t.diagnostic(`Chromium ${browser.version()}; component evidence, not full-route acceptance`);
    try {
        for (const javaScriptEnabled of [true, false]) {
            const bc = await browser.newContext({javaScriptEnabled});
            const requests = [];
            await bc.route('**/*', async route => { requests.push(route.request().url()); await route.abort(); });
            const page = await bc.newPage();
            let dialogs = 0;
            page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
            const body = '<div style="height:1000px">before</div><a name="cutid1">SOURCE_FIRST</a>' +
                '<div style="height:1000px">between</div><lj-cut><p id="forged" onclick="alert(1)" ' +
                'style="position:fixed">CUT_BODY</p><script>alert(1)</script></lj-cut>';
            const clean = cleaner.clean(input(body));
            assert.equal(clean.kind, 'ok');
            const native = retained(body);
            assert.equal(clean.fragment.html, native.full);
            const inspect = async html => {
                await page.setContent('<!doctype html><div class="entry-content">' + html + '</div><div style="height:1000px">after</div>');
                await page.evaluate(() => { location.hash = ''; location.hash = 'cutid1'; });
                await page.waitForTimeout(50);
                return page.evaluate(() => ({
                    names: [...document.querySelectorAll('[name="cutid1"]')].map(e => e.textContent),
                    scroll: Math.round(scrollY),
                    firstTop: Math.round(document.querySelector('[name="cutid1"]').getBoundingClientRect().top),
                    bodyText: document.querySelector('.entry-content p').textContent,
                    position: getComputedStyle(document.querySelector('.entry-content p')).position,
                    ids: document.querySelectorAll('.entry-content [id]').length,
                    scripts: document.querySelectorAll('.entry-content script,[onclick]').length,
                }));
            };
            const observation = await inspect(clean.fragment.html);
            assert.deepEqual(observation.names, ['SOURCE_FIRST', '']);
            assert.equal(observation.firstTop, 0);
            assert.equal(observation.position, 'static');
            assert.equal(observation.ids, 0);
            assert.equal(observation.scripts, 0);
            assert.deepEqual(await inspect(native.full), observation);
            assert.deepEqual(await inspect(await page.locator('.entry-content').innerHTML()), observation);
            for (const raw of ['\n  <p>one &amp; two</p>', 'x'.repeat(297) + '&amp;Z',
                'x'.repeat(298) + '😀YZ', 'café\u00a0tea',
                '<head><title>x</title></head>\n<p>one</p>',
                '<html><body>one &amp; two</body>\n</html>',
                '<pre>\n\none</pre><textarea>\r\ntwo</textarea>',
                '<p title="&quot;><script>alert(1)</script>">safe</p>',
                '<img src="https://blocked.test/metadata-only" onerror="alert(1)">']) {
                const result = cleaner.metadata({subject: 'subject', entry: input(raw)});
                assert.equal(result.kind, 'ok', raw);
                const expected = retained(raw);
                assert.equal(og(result.metadata.eventText), expected.og, raw);
                await page.setContent('<!doctype html><head><meta property="og:description" content="' +
                    og(result.metadata.eventText) + '"></head><body><p>SAFE_BODY</p></body>');
                assert.equal(await page.locator('body').innerText(), 'SAFE_BODY');
                assert.equal(await page.locator('script,img,iframe,[onerror]').count(), 0);
                assert.equal(await page.locator('meta[property="og:description"]').count(), 1);
            }
            assert.equal(dialogs, 0);
            assert.equal(requests.length, 0, 'metadata is never a resource or HTML insertion');
            // Positive controls prove that the same browser detects author HTML
            // capabilities. Never submit a form or navigate to an external site.
            await page.setContent('<img src="https://blocked.test/control"><script>alert(1)</script>');
            await page.waitForTimeout(100);
            assert.ok(requests.length > 0);
            assert.equal(dialogs, javaScriptEnabled ? 1 : 0);
            await bc.close();
        }
    } finally { cleaner.close(); await browser.close(); }
});

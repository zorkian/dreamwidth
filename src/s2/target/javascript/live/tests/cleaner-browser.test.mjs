// cleaner-browser.test.mjs
//
// Chromium execution checks for retained CSS escape transformations.
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
    documentUrl: 'http://localhost:8080/~s2js_slice3/?skip=0',
    entryUrl: 'http://localhost:8080/~s2js_slice3/436.html',
    journalUsername: 's2js_slice3', journalId: 6, entryId: 436,
    reader: {removeColors: false, removeSizes: false, removeFonts: false,
        maxImageWidth: null, maxImageHeight: null, placeholderUndefinedImageSize: false,
        extractImages: false},
    ...config.entryContent, cuts: 'source-compatible-recent',
};
const styles = [
    ['position:\\66 ixed;top:0;left:0', 'fixed'],
    ['position:\\61 bsolute;top:0', 'absolute'],
    ['--p:\\66 ixed;position:var(--p)', 'fixed'],
    ['--p:\\61 bsolute;position:var(--p)', 'absolute'],
    ['posit\\69 on:fixed', 'fixed'],
    ['background:u\\72l(/x)', 'static'],
    ['width:e\\78pression(1)', 'static'],
    ['width:expres\\sion(1)', 'static'],
];
const raw = styles.map(([style]) => `<p style="${style}">x</p>`);

test('Chromium computes retained static positions after escape removal with JavaScript on/off', async t => {
    const probe = spawnSync('perl', [resolve(here, 'cleaner-retained.pl')],
        {input: JSON.stringify(raw), encoding: 'utf8', timeout: 10000,
            env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'}});
    assert.equal(probe.status, 0, probe.stderr);
    const retained = JSON.parse(probe.stdout);
    const cleaner = createEntryCleaner(limits);
    const browser = await chromium.launch({headless: true});
    t.diagnostic(`Chromium ${browser.version()}; actual cleaner and real Perl; no external fetch`);
    try {
        for (const javaScriptEnabled of [true, false]) {
            const browserContext = await browser.newContext({javaScriptEnabled});
            let requested = 0;
            await browserContext.route('**/*', async route => { requested++; await route.abort(); });
            const page = await browserContext.newPage();
            const inspect = async markup => {
                await page.setContent(`<base href="https://resource.test/"><div class="entry-content">${markup}</div>`);
                return page.locator('.entry-content > p').evaluate(element => ({
                    position: getComputedStyle(element).position,
                    background: getComputedStyle(element).backgroundImage,
                    style: element.getAttribute('style'),
                }));
            };
            for (const [index, body] of raw.entries()) {
                const clean = cleaner.clean({body, format: 'html_raw0', context});
                assert.equal(clean.kind, 'ok', body);
                assert.equal(clean.fragment.html, retained[index]);
                const measured = await inspect(clean.fragment.html);
                assert.equal(measured.position, 'static', `${styles[index][0]} JS=${javaScriptEnabled}`);
                assert.equal(measured.background, 'none');
                assert.ok(!measured.style?.includes('\\'));
                assert.deepEqual(await inspect(retained[index]), measured);
                // Reparse the emitted body into a fresh entry container as a browser
                // would. This checks structure, separately from cleaner idempotence.
                const serialized = await page.locator('.entry-content').innerHTML();
                assert.deepEqual(await inspect(serialized), measured);
            }
            assert.equal(requested, 0, 'cleaned output must not load the escaped URL');
            // Negative controls prove the browser really implements the escapes
            // and custom-property indirection that this policy must neutralize.
            for (const [index, [, position]] of styles.entries()) {
                const measured = await inspect(raw[index]);
                assert.equal(measured.position, position);
                if (index === 5) assert.equal(measured.background,
                    'url("https://resource.test/x")');
            }
            assert.ok(requested > 0, 'raw escaped URL must exercise the intercepted resource path');
            const form = cleaner.clean({format: 'html_raw0', context,
                body: '<form action="https://app.test/post"><input type="submit" name="submit" value="send">' +
                    '<p>VISIBLE_FORM_TEXT</p><a name="ordinary">VISIBLE_ANCHOR_TEXT</a></form>'});
            assert.equal(form.kind, 'ok');
            await page.setContent(`<div class="entry-content">${form.fragment.html}</div>`);
            const before = await page.locator('.entry-content').evaluate(element => ({
                text: element.textContent,
                inputName: element.querySelector('input').getAttribute('name'),
                value: element.querySelector('input').value,
                submit: typeof element.querySelector('form').submit,
                anchor: element.querySelector('a').name,
            }));
            assert.deepEqual(before, {text: 'VISIBLE_FORM_TEXTVISIBLE_ANCHOR_TEXT',
                inputName: null, value: 'send', submit: 'function', anchor: 'ordinary'});
            const reparsed = await page.locator('.entry-content').innerHTML();
            await page.setContent(`<div class="entry-content">${reparsed}</div>`);
            assert.equal(await page.locator('.entry-content').textContent(), before.text);
            await browserContext.close();
        }
    } finally { cleaner.close(); await browser.close(); }
});

test('formatting matrix retains browser text/font/color/link scopes in actual stock pages', async t => {
    const {readFileSync} = await import('node:fs');
    const {formattingCases} = requireContent(resolve(here, '../../dist/live/tests/formatting-cases.js'));
    const {renderStock} = requireContent(resolve(here, '../../dist/live/render/engine.js'));
    const {validateArtifact} = requireContent(resolve(here, '../../dist/live/render/artifact.js'));
    const {approveSnapshot} = requireContent(resolve(here, '../../dist/live/policy/cohort.js'));
    const {loadResourceTimes} = requireContent(resolve(here, '../../dist/live/render/resources.js'));
    const fixture = requireContent(resolve(here, '../../dist/live/tests/fixtures.js'));
    const artifact = validateArtifact(JSON.parse(readFileSync(
        process.env.S2_LIVE_TEST_ARTIFACT || '/tmp/slice3-stock.json', 'utf8')));
    const data = fixture.snapshot();
    const journal = approveSnapshot({...data, entries: [data.entries[0]]});
    const stockInput = {journal, config, skip: 0, skipPresent: false, nowSeconds: fixture.now,
        formChallenge: 'public-test-challenge', uniq: 'AAAAAAAAAAAAAAA', resourceTimes: loadResourceTimes()};
    // Offline assembly exercises unchanged prop_init/modules_init/Page.print.
    // It is deliberately separate from the real isolated-worker qualification.
    const assemble = fragment => renderStock(artifact, stockInput, 2097152, () => fragment);
    const retained = spawnSync('perl', [resolve(here, 'cleaner-retained.pl')],
        {input: JSON.stringify(formattingCases.map(row => row.raw)), encoding: 'utf8', timeout: 10000,
            env: {...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0'}});
    assert.equal(retained.status, 0, retained.stderr);
    assert.deepEqual(JSON.parse(retained.stdout), formattingCases.map(row => row.perl));
    const cleaner = createEntryCleaner(limits);
    const browser = await chromium.launch({headless: true});
    t.diagnostic(`Chromium ${browser.version()}; 98 raw/native rows; actual stock assembly; JS on/off`);
    try {
        for (const javaScriptEnabled of [true, false]) {
            const browserContext = await browser.newContext({javaScriptEnabled});
            await browserContext.route('**/*', route => route.abort());
            const page = await browserContext.newPage();
            const inspect = async markup => {
                await page.setContent(assemble(markup));
                assert.equal(await page.locator('.entry-content').count(), 1);
                return page.locator('.entry-content').evaluate(element => {
                    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                    const textScopes = [];
                    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                        const parent = node.parentElement;
                        const style = getComputedStyle(parent);
                        const href = parent.closest('a')?.getAttribute('href') ?? null;
                        for (const text of node.textContent) textScopes.push({text, href,
                            weight: style.fontWeight, font: style.fontFamily, size: style.fontSize,
                            italic: style.fontStyle, color: style.color});
                    }
                    return {html: element.innerHTML, visible: element.innerText, textScopes};
                });
            };
            for (const row of formattingCases) {
                const result = cleaner.clean({body: row.raw, format: 'html_raw0', context});
                if (row.classification === 'unsupported') {
                    assert.deepEqual(result, {kind: 'failure', reason: 'unsupported'}, row.id);
                    continue;
                }
                assert.equal(result.kind, 'ok', row.id);
                assert.equal(result.fragment.html, row.html, row.id);
                const measured = await inspect(result.fragment.html);
                assert.deepEqual(measured, await inspect(row.perl), `${row.id}; JS=${javaScriptEnabled}`);
                assert.deepEqual(await inspect(measured.html), measured, `${row.id}; assembled reparse`);
            }
            const boundary = formattingCases.find(row => row.id === 'b/across-p');
            assert.notDeepEqual((await inspect(boundary.raw)).textScopes,
                (await inspect(boundary.html)).textScopes, 'negative control exercises unwanted bold reconstruction');
            const color = formattingCases.find(row => row.id === 'font/across-p');
            assert.notDeepEqual((await inspect(color.raw)).textScopes,
                (await inspect(color.html)).textScopes, 'negative control exercises unwanted color reconstruction');
            for (const body of [
                '<body onload="globalThis.bodyExecuted=true" title="a]>b"><p>visible</p></body>']) {
                const result = cleaner.clean({body, format: 'html_raw0', context});
                assert.equal(result.kind, 'ok');
                const measured = await inspect(result.fragment.html);
                assert.deepEqual(await inspect(measured.html), measured);
                assert.equal(await page.evaluate(() => globalThis.bodyExecuted), undefined);
                assert.equal(result.fragment.html, '<p>visible</p>');
            }
            await browserContext.close();
        }
    } finally { cleaner.close(); await browser.close(); }
});

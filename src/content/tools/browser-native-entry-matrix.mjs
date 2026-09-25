// browser-native-entry-matrix.mjs
//
// Reparse every reviewed native XSS and nonexact entry output in real browsers.
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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { preparedCorpusRoot } from './corpus-paths.mjs';
import { defaultAttestationRoot, verifyRunAttestation } from './run-attestation.mjs';

const [resultPath, flag, suppliedAttestation] = process.argv.slice(2);
assert.ok(resultPath && (!flag || (flag === '--attestation' && suppliedAttestation)) &&
    process.argv.length <= (flag ? 5 : 3),
    'usage: browser-native-entry-matrix.mjs native-result.json [--attestation DIR]');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attestation = suppliedAttestation ?? defaultAttestationRoot;
verifyRunAttestation(attestation, { nativePath: resultPath });
execFileSync(process.execPath, [path.join(root, 'tools/check-difference-ledger.mjs'),
    resultPath, path.join(root, 'corpus/accepted-native-ledger.json'),
    '--attestation', attestation], { encoding: 'utf8' });
const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'corpus/native-browser-cases.json')));
const inputs = JSON.parse(fs.readFileSync(path.join(preparedCorpusRoot(),
    'native-derived-entry-cases.json')));
const ledger = JSON.parse(fs.readFileSync(
    path.join(root, 'corpus/accepted-native-ledger.json')));
const oracle = JSON.parse(fs.readFileSync(
    path.join(root, 'corpus/native-derived-entry-perl.json')));
const result = JSON.parse(fs.readFileSync(resultPath));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.schema, 2);
assert.equal(result.schema, 1);
assert.equal(result.corpus, 'native');
assert.equal(manifest.groups.length, 72);
assert.equal(manifest.coveredCases, 219);
const targeted = result.rows.filter(row => row.kind === 'ok' &&
    (row.source === 't/cleaner-xss.t' || !row.rawEqual));
assert.equal(targeted.length, manifest.coveredCases);
const byId = new Map(targeted.map(row => [row.id, row]));
assert.equal(byId.size, targeted.length);
const inputById = new Map(inputs.cases.map(row => [row.id, row]));
const ledgerById = new Map(ledger.cases.map(row => [row.id, row]));
const perlById = new Map(oracle.records.map(row => [row.id, row]));
assert.equal(inputById.size, 384);
assert.equal(ledgerById.size, 384);
assert.equal(perlById.size, 384);
const seen = new Set();
const groups = manifest.groups.map(group => {
    assert.ok(group.caseIds.length > 0);
    assert.ok(group.expectedResources.length <= 1);
    for (const resource of group.expectedResources) {
        assert.deepEqual(resource, {
            url: 'https://app.slice4.invalid/s2js_slice3/x',
            count: 1, kind: 'inert-pixel',
        });
    }
    const rows = group.caseIds.map(id => {
        assert.ok(!seen.has(id), `duplicate native browser case: ${id}`);
        seen.add(id);
        const row = byId.get(id);
        assert.ok(row, `unrequired or missing native browser case: ${id}`);
        const input = inputById.get(id);
        const perl = perlById.get(id);
        const accepted = ledgerById.get(id);
        assert.ok(input && perl && accepted, `${id}: missing fixed semantic join`);
        const inputSha256 = sha(Buffer.from(input.rawInputBase64, 'base64'));
        const perlBytes = Buffer.from(perl.outputBase64, 'base64');
        const perlSha256 = sha(perlBytes);
        const outputSha256 = accepted.expectedJs?.ref === 'perl' ? perlSha256 :
            accepted.expectedJs?.sha256;
        assert.equal(row.inputSha256, inputSha256);
        assert.equal(row.perlSha256, perlSha256);
        assert.equal(row.jsSha256, outputSha256);
        assert.equal(row.source, input.nativeSource);
        assert.equal(accepted.category === 'exact', row.rawEqual);
        assert.equal(accepted.kind, 'ok');
        return { row, inputSha256, perlSha256, outputSha256,
            category: accepted.category, perlHtml: perlBytes.toString('utf8') };
    });
    for (const joined of rows) {
        assert.deepEqual({ inputSha256: joined.inputSha256,
            perlSha256: joined.perlSha256, outputSha256: joined.outputSha256,
            category: joined.category },
        { inputSha256: rows[0].inputSha256,
            perlSha256: rows[0].perlSha256, outputSha256: rows[0].outputSha256,
            category: rows[0].category },
        `${joined.row.id}: browser group combines different fixed expectations`);
        assert.equal(joined.row.jsHtml, rows[0].row.jsHtml);
        assert.equal(joined.perlHtml, rows[0].perlHtml);
    }
    assert.equal(sha(Buffer.from(rows[0].row.jsHtml, 'utf8')),
        rows[0].outputSha256);
    assert.equal(sha(Buffer.from(rows[0].perlHtml, 'utf8')),
        rows[0].perlSha256);
    return { ...group, ...rows[0], html: rows[0].row.jsHtml,
        perlHtml: rows[0].perlHtml };
});
assert.equal(seen.size, targeted.length, 'every required native case needs a browser group');
assert.ok(targeted.every(row => seen.has(row.id)));
assert.equal(new Set(groups.map(group => [group.inputSha256, group.perlSha256,
    group.outputSha256].join(':'))).size, groups.length);

const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
    'base64');
const observations = [];
async function probe(context, label, html, insertion, expectedResources,
    { control = false, jsEnabled = false, retainedOrigin = false,
        interaction = null } = {}) {
    const target = `${retainedOrigin ? 'https://app.slice4.invalid/s2js_slice3/'
        : 'https://page.slice4.invalid/native/'}${encodeURIComponent(label)}`;
    const requests = [];
    const forbidden = [];
    const sockets = [];
    const popups = [];
    const dialogs = [];
    const errors = [];
    const resourceCounts = new Map(expectedResources.map(item => [item.url, 0]));
    const page = await context.newPage();
    await page.route('**/*', async route => {
        const url = route.request().url();
        requests.push(url);
        if (url === target) {
            const body = insertion === 'fragment'
                ? '<!doctype html><html><head><title>Native boundary</title></head>' +
                  '<body><div class="entry-content" id="entry"></div></body></html>'
                : `<!doctype html>${html}`;
            await route.fulfill({ status: 200, contentType: 'text/html', body });
        } else if (resourceCounts.has(url)) {
            resourceCounts.set(url, resourceCounts.get(url) + 1);
            await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
        } else {
            forbidden.push(url);
            await route.abort();
        }
    });
    await page.routeWebSocket('**/*', socket => {
        sockets.push(socket.url());
        socket.close();
    });
    page.on('popup', popup => popups.push(popup.url()));
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    page.on('pageerror', error => errors.push(error.message));
    try {
        const response = await page.goto(target, { waitUntil: 'load' });
        assert.equal(response?.status(), 200);
        if (insertion === 'fragment') {
            await page.locator('#entry').evaluate((element, fragment) => {
                element.innerHTML = fragment;
            }, html);
        }
        await page.waitForTimeout(30);
        const dom = await page.evaluate(() => {
            const entry = document.querySelector('#entry') ?? document.body;
            return {
                text: entry.textContent,
                visibleText: entry.innerText,
                active: [...entry.querySelectorAll('*')].flatMap(element =>
                    [...element.attributes].filter(attribute => /^on/i.test(attribute.name)
                        || ['srcdoc', 'ping'].includes(attribute.name.toLowerCase()))
                        .map(attribute => `${element.tagName}.${attribute.name}`)),
                activeElements: entry.querySelectorAll(
                    'script,iframe,object,embed,svg,math').length,
                headActive: document.head.querySelectorAll(
                    'meta[http-equiv],style,link[rel=stylesheet],base').length,
                links: [...entry.querySelectorAll('a[href]')].map(element =>
                    element.getAttribute('href')),
                linkDestinations: [...entry.querySelectorAll('a[href]')].map(element =>
                    element.href),
                executed: window.__slice4Executed === true,
                clobbered: typeof document.getElementById !== 'function',
                style: (() => {
                    const element = entry.querySelector('div.foo');
                    if (!element) return null;
                    const css = getComputedStyle(element);
                    return { fontFamily: css.fontFamily, fontSize: css.fontSize };
                })(),
            };
        });
        assert.equal(page.url(), target, `${label}: unexpected navigation`);
        assert.deepEqual(errors, [], `${label}: page error`);
        assert.deepEqual(popups, [], `${label}: popup`);
        assert.deepEqual(dialogs, [], `${label}: dialog`);
        assert.equal(dom.clobbered, false, `${label}: DOM API clobbering`);
        if (control) {
            assert.equal(dom.executed, jsEnabled, `${label}: raw script control`);
            assert.ok(forbidden.includes('https://evil.slice4.invalid/attack.png'));
            assert.equal(sockets.length, jsEnabled ? 1 : 0);
        } else {
            assert.deepEqual(forbidden, [], `${label}: undeclared resource`);
            assert.deepEqual(sockets, [], `${label}: websocket`);
            assert.equal(dom.executed, false, `${label}: script execution`);
            assert.equal(dom.activeElements, 0, `${label}: active entry element`);
            assert.deepEqual(dom.active, [], `${label}: active entry attribute`);
            assert.equal(dom.headActive, 0, `${label}: head hoist`);
            assert.ok(dom.links.every(link =>
                !/^\s*(?:javascript|vbscript|data|file):/i.test(link)),
            `${label}: active navigation URL`);
            for (const item of expectedResources) {
                assert.equal(resourceCounts.get(item.url), item.count,
                    `${label}: declared resource count changed`);
            }
            if (interaction === 'inert-anchor') {
                assert.deepEqual(dom.links, [], `${label}: script-like link survived`);
                await page.locator('a').first().click();
                assert.equal(page.url(), target, `${label}: inert anchor navigated`);
                assert.deepEqual(dialogs, [], `${label}: inert anchor opened a dialog`);
                assert.deepEqual(forbidden, [], `${label}: inert anchor requested a resource`);
            } else if (interaction === 'details-toggle' && jsEnabled) {
                await page.locator('details').evaluate(element => {
                    window.__slice4ToggleCount = 0;
                    element.addEventListener('toggle', () => {
                        window.__slice4ToggleCount++;
                    });
                    element.open = false;
                });
                await page.waitForTimeout(50);
                assert.ok(await page.evaluate(() => window.__slice4ToggleCount) >= 1,
                    `${label}: details close toggle did not fire`);
                await page.locator('details').evaluate(element => { element.open = true; });
                await page.waitForTimeout(50);
                assert.ok(await page.evaluate(() => window.__slice4ToggleCount) >= 2,
                    `${label}: details reopen toggle did not fire`);
                assert.equal(await page.evaluate(() => window.__slice4Executed), undefined,
                    `${label}: toggle executed entry code`);
                assert.deepEqual(dialogs, [], `${label}: toggle opened a dialog`);
                assert.deepEqual(forbidden, [], `${label}: toggle requested a resource`);
            }
        }
        observations.push({ label, requests, forbidden, sockets, popups, dialogs,
            pageErrors: errors, expectedResources, dom });
        return dom;
    } finally {
        await page.close();
    }
}

for (const [engineName, browserType] of [['chromium', chromium],
    ['firefox', firefox], ['webkit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
        for (const jsEnabled of [true, false]) {
            const context = await browser.newContext({ javaScriptEnabled: jsEnabled,
                serviceWorkers: 'block' });
            try {
                const raw = '<script>window.__slice4Executed=true;' +
                    'new WebSocket("wss://evil.slice4.invalid/ws")</script>' +
                    '<img src="https://evil.slice4.invalid/attack.png">';
                await probe(context, `${engineName}-${jsEnabled}-raw`, raw,
                    'document', [], { control: true, jsEnabled });
                for (const group of groups) {
                    for (const insertion of ['document', 'fragment']) {
                        const label = `${engineName}-${jsEnabled}-` +
                            `${group.inputSha256.slice(0, 12)}-` +
                            `${group.outputSha256.slice(0, 12)}-${insertion}`;
                        const interaction = group.perlHtml.includes('javasc&amp;Tab;')
                            ? 'inert-anchor' : group.perlHtml.includes(
                                '<details open="open">') ? 'details-toggle' : null;
                        const dom = await probe(context, label, group.html, insertion,
                            group.expectedResources, { jsEnabled, interaction });
                        if (['serialization', 'origin-adaptation'].includes(
                            group.category)) {
                            const retained = await probe(context, `${label}-perl`,
                                group.perlHtml, insertion, group.expectedResources,
                                { jsEnabled, retainedOrigin: true });
                            assert.equal(dom.visibleText, retained.visibleText,
                                `${label}: reviewed difference changed visible text`);
                            if (group.category === 'origin-adaptation') {
                                assert.deepEqual(dom.linkDestinations,
                                    retained.linkDestinations,
                                `${label}: resolved navigation destination changed`);
                            }
                            if (group.caseIds.includes(
                                't/cleaner-event.t#call-0017:html_raw0')) {
                                assert.deepEqual(dom.style, retained.style,
                                    `${label}: computed inline style changed`);
                            }
                        }
                        if (group.caseIds.includes(
                            't/cleaner-event.t#call-0017:html_raw0')) {
                            assert.ok(dom.style?.fontFamily.includes('Arial'),
                                `${label}: inline font family changed`);
                            assert.ok(dom.style?.fontSize !== '16px',
                                `${label}: inline larger font size changed`);
                        }
                    }
                }
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
}
process.stdout.write(JSON.stringify({ schema: 1,
    evidenceStatus: 'attested-current-build-browser-reparse',
    candidate: result.candidate, buildSha256: result.buildSha256,
    resultSha256: sha(fs.readFileSync(resultPath)), groups: groups.length,
    coveredCases: seen.size, observations: observations.length, rows: observations }) + '\n');

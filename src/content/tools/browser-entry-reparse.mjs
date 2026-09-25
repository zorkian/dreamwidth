// browser-entry-reparse.mjs
//
// Exercise retained entry replay results in isolated real browser DOM contexts.
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [resultsPath, assembledPath, resourcesPath] = process.argv.slice(2);
if (!resultsPath) {
    throw new Error('usage: browser-entry-reparse.mjs <result-json> ' +
        '[actual-stock-page.html exact-resource-map.json]');
}
if (Boolean(assembledPath) !== Boolean(resourcesPath)) {
    throw new Error('actual assembled page and exact resource map are required together');
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'corpus/entry-replay-cases.json')));
const results = JSON.parse(fs.readFileSync(resultsPath));
const rows = new Map(results.rows.map(row => [row.id, row]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(rows.size, manifest.cases.length, 'result set must cover every replay case');
assert.ok(typeof results.candidate === 'string' && results.candidate.length >= 7);
const unsupported = new Set(['cut-unclosed', 'cut-nested', 'rawtext-xmp',
    'rawtext-plaintext']);
for (const input of manifest.cases) {
    const row = rows.get(input.id);
    assert.ok(row, `missing replay ${input.id}`);
    if (unsupported.has(input.id)) {
        assert.equal(row.kind, 'failure', `${input.id} must refuse ambiguous input`);
        assert.equal(row.reason, 'unsupported');
    } else {
        assert.equal(row.kind, 'ok', `${input.id} must retain an admitted positive`);
        assert.equal(typeof row.jsHtml, 'string');
        assert.equal(row.jsSha256, sha(Buffer.from(row.jsHtml, 'utf8')));
    }
}

const assembled = assembledPath ? fs.readFileSync(assembledPath) : null;
let resources = new Map();
if (resourcesPath) {
    const data = JSON.parse(fs.readFileSync(resourcesPath));
    assert.equal(data.schema, 1);
    assert.equal(data.pageSha256, sha(assembled));
    assert.ok(data.resources.length > 0, 'actual stock resources cannot be vacuous');
    resources = new Map(data.resources.map(item => {
        assert.ok(/^(?:https:\/\/(?:page|asset|app)\.slice4\.invalid|http:\/\/(?:page\.slice4\.invalid|localhost:8080))\//
            .test(item.url));
        const body = Buffer.from(item.bodyBase64, 'base64');
        assert.equal(item.sha256, sha(body));
        assert.equal(typeof item.contentType, 'string');
        const original = new URL(item.url);
        assert.equal(item.sourceUrl,
            `http://localhost:8080${original.pathname}${original.search}`);
        return [item.url, { body, contentType: item.contentType }];
    }));
    assert.equal(resources.size, data.resources.length, 'resource URLs must be unique');
}

const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
    'base64');
const imageUrls = new Set([
    'https://asset.slice4.invalid/bg.png',
    'https://asset.slice4.invalid/var.png',
    'https://asset.slice4.invalid/map.png',
    'https://asset.slice4.invalid/a.png',
    'https://asset.slice4.invalid/a2.png',
    'https://asset.slice4.invalid/submit.png',
    'https://app.slice4.invalid/img/pixel.png',
    'https://app.slice4.invalid/img/a3.png',
]);
const observations = [];
const websocketState = new WeakMap();

async function runPage(context, label, html, insertion,
    { rawControl = false, stock = false } = {}) {
    const pageUrl = `${stock ? 'http' : 'https'}://page.slice4.invalid/` +
        encodeURIComponent(label);
    const requests = [];
    const forbidden = [];
    const sockets = [];
    const popups = [];
    const errors = [];
    const dialogs = [];
    websocketState.get(context).current = sockets;
    await context.route('**/*', async route => {
        const url = route.request().url();
        requests.push(url);
        if (url === pageUrl) {
            const body = insertion === 'div.entry-content'
                ? '<!doctype html><html><head><title>Boundary sentinel</title></head>' +
                  '<body><div class="entry-content" id="entry"></div></body></html>'
                : stock ? html : `<!doctype html>${html}`;
            await route.fulfill({ status: 200, contentType: 'text/html', body });
        } else if (!stock && imageUrls.has(url)) {
            await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
        } else if (stock && resources.has(url)) {
            const resource = resources.get(url);
            await route.fulfill({ status: 200, contentType: resource.contentType,
                body: resource.body });
        } else {
            forbidden.push(url);
            await route.abort();
        }
    });
    const page = await context.newPage();
    page.on('popup', popup => popups.push(popup.url()));
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
    });
    try {
        const response = await page.goto(pageUrl, { waitUntil: 'load' });
        assert.equal(response?.status(), 200);
        if (insertion === 'div.entry-content') {
            await page.locator('#entry').evaluate((element, fragment) => {
                element.innerHTML = fragment;
            }, html);
        }
        // Let CSS image requests and queued stock handlers reach the route trap.
        await page.waitForTimeout(100);
        const dom = await page.evaluate(() => {
            const entry = document.querySelector('#entry') ?? document.body;
            const active = [...entry.querySelectorAll('*')].flatMap(element =>
                [...element.attributes].filter(attribute => /^on/i.test(attribute.name) ||
                    attribute.name.toLowerCase() === 'srcdoc').map(attribute =>
                    `${element.tagName.toLowerCase()}.${attribute.name}`));
            const links = [...entry.querySelectorAll('a[href]')].map(element =>
                element.getAttribute('href'));
            return {
                text: entry.textContent,
                title: document.title,
                headActive: [...document.head.querySelectorAll(
                    'meta[http-equiv],link[rel=stylesheet],style,base')].length,
                scripts: entry.querySelectorAll('script,iframe,object,embed').length,
                active,
                links,
                ids: [...entry.querySelectorAll('[id]')].map(element => element.id),
                executed: window.__slice4Executed === true,
                clobbered: typeof document.getElementById !== 'function',
                escapedPositions: [...entry.querySelectorAll('[style]')]
                    .filter(element => element.textContent.includes('Escaped'))
                    .map(element => getComputedStyle(element).position),
                broad: (() => {
                    const element = entry.querySelector('.ordinary');
                    if (!element) return null;
                    const css = getComputedStyle(element);
                    return { position: css.position, display: css.display,
                        left: css.left, gap: css.gap, transform: css.transform };
                })(),
                stockJquery: typeof window.jQuery === 'function',
                stockCutControls: document.querySelectorAll('.module-cuttagcontrols').length,
            };
        });
        assert.equal(page.url(), pageUrl, `${label}: unexpected navigation`);
        if (rawControl) {
            assert.ok(forbidden.includes('https://evil.slice4.invalid/attack.png'),
                'raw image must exercise the forbidden-resource trap');
        } else {
            assert.deepEqual(forbidden, [], `${label}: unexpected browser resource`);
            assert.deepEqual(sockets, [], `${label}: websocket attempt`);
            assert.deepEqual(popups, [], `${label}: popup attempt`);
            assert.deepEqual(dialogs, [], `${label}: dialog attempt`);
            assert.equal(dom.executed, false, `${label}: script execution`);
            assert.equal(dom.clobbered, false, `${label}: DOM API clobbering`);
            if (!stock) {
                assert.equal(dom.scripts, 0, `${label}: active entry element`);
                assert.deepEqual(dom.active, [], `${label}: active entry attribute`);
                assert.equal(dom.headActive, 0, `${label}: head element hoist`);
                assert.ok(dom.links.every(link =>
                    !/^\s*(?:javascript|vbscript|data|file):/i.test(link)),
                    `${label}: active navigation URL`);
                assert.ok(!dom.text.includes('HIDDEN-'), `${label}: cut body exposed`);
            }
        }
        observations.push({ label, requests, forbidden, sockets, popups, dialogs,
            pageErrors: errors, dom });
        return dom;
    } finally {
        await page.close();
        await context.unroute('**/*');
        websocketState.get(context).current = null;
    }
}

for (const [engineName, engine] of [['chromium', chromium], ['firefox', firefox],
    ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
        for (const enabled of [true, false]) {
            const context = await browser.newContext({ javaScriptEnabled: enabled,
                serviceWorkers: 'block', deviceScaleFactor: 1 });
            try {
                const state = { current: null };
                websocketState.set(context, state);
                await context.routeWebSocket('**/*', socket => {
                    state.current?.push(socket.url());
                    socket.close();
                });
                const raw = '<script>window.__slice4Executed=true;' +
                    'new WebSocket("wss://evil.slice4.invalid/ws")</script>' +
                    '<img src="https://evil.slice4.invalid/attack.png">';
                const control = await runPage(context,
                    `${engineName}-${enabled}-raw-control`, raw, 'document',
                    { rawControl: true });
                assert.equal(control.executed, enabled,
                    'raw script control must distinguish JS-on/off');
                const rawObservation = observations.at(-1);
                assert.equal(rawObservation.sockets.length, enabled ? 1 : 0,
                    'raw websocket control must distinguish JS-on/off');
                for (const input of manifest.cases) {
                    const row = rows.get(input.id);
                    if (row.kind !== 'ok') continue;
                    for (const insertion of input.reparse) {
                        const label = `${engineName}-${enabled}-${input.id}-${insertion}`;
                        const dom = await runPage(context, label, row.jsHtml, insertion);
                        if (input.id === 'css-escaped-fixed') {
                            assert.deepEqual(dom.escapedPositions,
                                ['static', 'static', 'static'], label);
                        }
                        if (input.id === 'css-broad') {
                            assert.equal(dom.broad?.position, 'relative', label);
                            assert.equal(dom.broad?.display, 'grid', label);
                            assert.equal(dom.broad?.left, '4px', label);
                            assert.equal(dom.broad?.gap, '2px', label);
                            assert.equal(dom.broad?.transform,
                                'matrix(1, 0, 0, 1, 2, 0)', label);
                        }
                        if (input.id === 'cut-forged-id') {
                            assert.ok(!dom.ids.includes('span-cuttag_other_123_1'), label);
                            assert.ok(dom.ids.includes('span-cuttag_s2js_slice3_123_1'), label);
                        }
                        if (input.id === 'url-known-schemes') {
                            assert.deepEqual(dom.links.map(link => link.split(':', 1)[0]),
                                ['gopher', 'magnet', 'spotify', 'ftp', 'irc'], label);
                        }
                        if (input.id === 'head-hoist') {
                            assert.ok(!dom.title.includes('Forged title'), label);
                            if (insertion === 'div.entry-content') {
                                assert.equal(dom.title, 'Boundary sentinel', label);
                            }
                        }
                        const observation = observations.at(-1);
                        const intended = new Map([
                            ['css-broad', 'https://asset.slice4.invalid/bg.png'],
                            ['css-custom-url', 'https://asset.slice4.invalid/var.png'],
                            ['image-and-map', 'https://asset.slice4.invalid/map.png'],
                            ['image-srcset-longdesc', 'https://asset.slice4.invalid/a.png'],
                            ['url-relative-navigation',
                                'https://app.slice4.invalid/img/pixel.png'],
                        ]).get(input.id);
                        if (intended) assert.ok(observation.requests.includes(intended),
                            `${label}: intended resource did not load`);
                    }
                }
                if (assembled) {
                    const dom = await runPage(context,
                        `${engineName}-${enabled}-actual-stock`, assembled.toString('utf8'),
                        'document', { stock: true });
                    assert.ok(dom.text.includes('s2js_slice3'),
                        'actual assembled page must identify marked journal');
                    if (enabled) assert.equal(dom.stockJquery, true,
                        'actual stock script bundle must run');
                    assert.ok(dom.stockCutControls > 0,
                        'actual stock cut-control widget must be assembled');
                    const stockObservation = observations.at(-1);
                    assert.deepEqual(stockObservation.pageErrors, [],
                        'actual stock scripts must not throw');
                    assert.ok(stockObservation.requests.some(url =>
                        url.includes('/stc/??')), 'stock stylesheet must load');
                    assert.ok(stockObservation.requests.includes(
                        'http://page.slice4.invalid/img/controlstrip/bg-dark.gif'),
                    'stock CSS background must load');
                    assert.equal(stockObservation.requests.filter(url =>
                        url.includes('/js/??')).length, enabled ? 2 : 0,
                    'stock script bundles must follow JS-on/off');
                }
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
}
const report = { schema: 1, candidate: results.candidate,
    provisional: Boolean(results.provisional), assembledSha256: assembled && sha(assembled),
    engines: observations.length, observations };
console.log(JSON.stringify(report));

// capture-browser-resources.mjs
//
// Pin exact public stock resources for synthetic-origin browser tests.
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
import { JSDOM } from 'jsdom';

const [pagePath, outputPath, ...extraPaths] = process.argv.slice(2);
if (!pagePath || !outputPath) {
    throw new Error('usage: capture-browser-resources.mjs actual-stock-page.html ' +
        'resource-map.json [extra observed /stc,/js,/img path...]' +
        ' | actual-stock-page.html --check-style');
}
const checkStyleOnly = outputPath === '--check-style';
const page = fs.readFileSync(pagePath);
assert.ok(page.length > 1000 && page.length <= 2 * 1024 * 1024);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const appOrigin = 'http://localhost:8080';
const browserOrigin = 'http://page.slice4.invalid';
const document = new JSDOM(page.toString('utf8'), { url: browserOrigin + '/recent' }).window.document;
const stockStyle = [...document.querySelectorAll('link[rel]')].filter(element =>
    element.rel.toLowerCase().split(/\s+/).includes('stylesheet')).map(element =>
    new URL(element.getAttribute('href'), browserOrigin + '/recent')).filter(url =>
    /^\/~s2js_slice3\/res\/([1-9][0-9]*)\/stylesheet$/.test(url.pathname));
assert.equal(stockStyle.length, 1,
    'marked journal must emit exactly one stock stylesheet URL');
assert.ok([browserOrigin, appOrigin].includes(stockStyle[0].origin));
assert.equal(stockStyle[0].hash, '');
const stockStylePath = stockStyle[0].pathname;
if (checkStyleOnly) {
    assert.equal(extraPaths.length, 0);
    console.log(JSON.stringify({ stockStylePath }));
    process.exit(0);
}
const urls = new Set();
for (const element of document.querySelectorAll('script[src],link[href],img[src]')) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'link' && !['stylesheet', 'icon'].includes(element.rel.toLowerCase())) continue;
    const raw = element.getAttribute(tag === 'link' ? 'href' : 'src');
    assert.ok(raw && !raw.startsWith('//'), 'resource URL must have a fixed origin');
    const url = new URL(raw, browserOrigin + '/recent');
    assert.ok([browserOrigin, appOrigin].includes(url.origin),
        `unexpected stock resource origin: ${url.origin}`);
    urls.add(url.href);
}
for (const raw of extraPaths) {
    assert.match(raw, /^\/(?:stc|js|img)\/[^\s?#]+(?:\?[^\s#]*)?$/);
    urls.add(browserOrigin + raw);
}
assert.ok(urls.size > 0 && urls.size <= 80);
const resources = [];
let total = 0;
for (const browserUrl of [...urls].sort()) {
    const url = new URL(browserUrl);
    assert.ok(/^\/(?:stc|js|img)\//.test(url.pathname) ||
        url.pathname === stockStylePath,
    `unsupported stock resource path: ${url.pathname}`);
    const sourceUrl = appOrigin + url.pathname + url.search;
    const response = await fetch(sourceUrl, { redirect: 'manual',
        headers: { cookie: '', authorization: '' }, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `retained public resource ${sourceUrl}`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? '';
    assert.match(contentType, /^(?:text\/css|text\/javascript|application\/javascript|image\/|font\/|application\/font)/,
        sourceUrl);
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.length > 0 && body.length <= 2 * 1024 * 1024, sourceUrl);
    total += body.length;
    assert.ok(total <= 8 * 1024 * 1024, 'stock resource map exceeded 8MiB');
    resources.push({ url: browserUrl, sourceUrl, contentType,
        sha256: sha(body), bodyBase64: body.toString('base64') });
}
const map = { schema: 1, pageSha256: sha(page), resources };
fs.writeFileSync(outputPath, JSON.stringify(map) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ pageSha256: map.pageSha256,
    resources: resources.length, bytes: total }));

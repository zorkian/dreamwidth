// qualify-browsers.mjs
//
// Check isolated synthetic-origin browser availability for later cleaner tests.
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
import { chromium, firefox, webkit } from '@playwright/test';

const pageUrl = 'https://page.slice4.invalid/recent';
const imageUrl = 'https://asset.slice4.invalid/pixel.png';
const html = `<!doctype html><html><body><script>
document.body.setAttribute('data-executed', '1');
</script><p>synthetic browser qualification</p><img src="${imageUrl}"></body></html>`;
const transparentPixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
    'base64');
const results = [];

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
        for (const enabled of [true, false]) {
            const context = await browser.newContext({ javaScriptEnabled: enabled });
            const requests = [];
            const blocked = [];
            try {
                await context.route('**/*', async route => {
                    const url = route.request().url();
                    requests.push(url);
                    if (url === pageUrl) {
                        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
                    } else if (url === imageUrl) {
                        await route.fulfill({ status: 200, contentType: 'image/png',
                            body: transparentPixel });
                    } else {
                        blocked.push(url);
                        await route.abort();
                    }
                });
                const page = await context.newPage();
                const response = await page.goto(pageUrl, { waitUntil: 'load' });
                assert.equal(response?.status(), 200);
                assert.equal(await page.locator('body').getAttribute('data-executed'),
                    enabled ? '1' : null);
                assert.deepEqual(blocked, [], 'all browser traffic must use synthetic routes');
                assert.equal(requests.filter(url => url === pageUrl).length, 1);
                assert.equal(requests.filter(url => url === imageUrl).length, 1);
                results.push({ engine: name, version: browser.version(), javaScriptEnabled: enabled,
                    documentRequests: 1, allowedImageRequests: 1, blockedRequests: 0 });
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
}
console.log(JSON.stringify(results));

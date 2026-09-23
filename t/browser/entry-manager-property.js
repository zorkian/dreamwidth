// Browser acceptance for the callable legacy manager-property POST adapter.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = Number(process.env.MANAGER_PROPERTY_PORT || 18129);
const output = process.argv[2] || '/tmp/entry-manager-property-browser';

function portUnused() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(new Error(`refusing occupied manager-property port ${port}`));
        });
        socket.once('error', error => {
            socket.destroy();
            error.code === 'ECONNREFUSED' ? resolve() : reject(error);
        });
    });
}

function waitForPort() {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const attempt = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', error => {
                socket.destroy();
                if (Date.now() >= deadline) reject(new Error(`manager-property server did not listen: ${error.code}`));
                else setTimeout(attempt, 100);
            });
        };
        attempt();
    });
}

function fixtureClient(child) {
    const lines = [];
    const waiters = [];
    let buffer = '';
    let terminal;
    const drain = () => {
        while (lines.length && waiters.length) waiters.shift().resolve(lines.shift());
    };
    const fail = error => {
        terminal = error;
        while (waiters.length) waiters.shift().reject(error);
    };
    const done = new Promise((resolve, reject) => {
        child.once('error', error => { fail(error); reject(error); });
        child.once('exit', (code, signal) => {
            const eof = new Error(`fixture EOF: ${code}/${signal || 'none'}`);
            fail(eof);
            if (code === 0 && !signal) resolve();
            else reject(eof);
        });
    });
    child.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            lines.push(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
        }
        drain();
    });
    const next = () => new Promise((resolve, reject) => {
        if (terminal) return reject(terminal);
        if (lines.length) return resolve(lines.shift());
        waiters.push({resolve, reject});
    });
    const json = async label => {
        const line = await next();
        try { return JSON.parse(line); }
        catch (error) { throw new Error(`${label}: ${error.message}: ${line}`); }
    };
    return {
        done,
        json,
        state: async () => {
            if (terminal) throw terminal;
            child.stdin.write(JSON.stringify({state: true}) + '\n');
            return json('fixture state');
        },
    };
}

async function login(page, base, user, password) {
    await page.goto(`${base}/mobile/login`, {waitUntil: 'networkidle0'});
    await page.type('[name=user]', user);
    await page.type('[name=password]', password);
    await Promise.all([
        page.waitForNavigation({waitUntil: 'networkidle0'}),
        page.click('[type=submit]'),
    ]);
}

async function clickSave(page) {
    const expected = new URL(await page.$eval('[name="action:savemaintainer"]', node => node.form.action)).pathname;
    const response = page.waitForResponse(item => item.request().method() === 'POST'
        && new URL(item.url()).pathname === expected);
    const navigation = page.waitForNavigation({waitUntil: 'load'});
    await page.click('[name="action:savemaintainer"]');
    const [result] = await Promise.all([response, navigation]);
    assert.equal(result.status(), 302, 'manager settings click receives the retained redirect status');
    return result;
}

async function visible(page, selector) {
    await page.$eval(selector, node => node.scrollIntoView({block: 'center'}));
    return page.$eval(selector, node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= -2 && rect.right <= innerWidth + 2
            && rect.top >= 0 && rect.bottom <= innerHeight;
    });
}

async function finishWithin(promise, label) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} did not finish within 10 seconds`)), 10000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function closeOwnedBrowser(browser) {
    if (!browser) return;
    try {
        await finishWithin(browser.close(), 'owned browser close');
    } catch (error) {
        const process = browser.process();
        if (process && process.exitCode === null) process.kill('SIGTERM');
        throw error;
    }
}

(async () => {
    let fixture;
    let client;
    let server;
    let serverDone;
    let browser;
    let stderr = '';
    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-manager-property-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        client = fixtureClient(fixture);
        const data = await client.json('fixture startup');
        await portUnused();
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-manager-property-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'pipe']});
        server.stderr.on('data', chunk => { stderr += chunk; });
        serverDone = new Promise(resolve => server.once('exit', (code, signal) => resolve({code, signal, stderr})));
        const startup = await Promise.race([waitForPort().then(() => true), serverDone]);
        if (startup !== true) throw new Error(`manager-property server exited before startup: ${JSON.stringify(startup)}`);

        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        page.on('pageerror', error => errors.push(`${page.url()}: ${error.stack || error.message}`));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
        });
        fs.mkdirSync(output, {recursive: true});
        const base = `http://127.0.0.1:${port}`;
        const query = `usejournal=${data.community}&itemid=${data.ditemid}&encoded=one%2Ftwo&repeated=a&repeated=b`;
        const oldURL = `${base}/editjournal?${query}`;
        const before = await client.state();
        await login(page, base, data.user, data.password);

        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.goto(oldURL, {waitUntil: 'networkidle0'});
            assert.ok(await page.$('#updateForm'), `${width}px retained manager form renders`);
            for (const selector of [
                '[name=prop_adult_content_maintainer_reason]',
                '[name=prop_adult_content_maintainer]',
                '[name=prop_opt_nocomments_maintainer]',
                '[name="action:savemaintainer"]',
            ]) assert.ok(await visible(page, selector), `${width}px ${selector} is visible and usable`);
            await page.screenshot({path: `${output}/manager-properties-${width}.png`, fullPage: true});
        }

        await page.setViewport({width: 1280, height: 900, deviceScaleFactor: 1});
        await page.goto(oldURL, {waitUntil: 'networkidle0'});
        await page.$eval('[name=prop_adult_content_maintainer_reason]', node => { node.value = 'Browser administrator reason'; });
        await page.select('[name=prop_adult_content_maintainer]', 'concepts');
        const comments = await page.$('[name=prop_opt_nocomments_maintainer]');
        if (!await page.$eval('[name=prop_opt_nocomments_maintainer]', node => node.checked)) await comments.click();
        const setResponse = await clickSave(page);
        assert.equal(new URL(setResponse.headers().location, base).pathname,
            new URL(data.target_url, base).pathname,
            'manager settings redirect uses the public entry destination');
        const afterSet = await client.state();
        assert.deepEqual(afterSet.target, {
            ...before.target,
            reason: 'Browser administrator reason', adult: 'concepts', nocomments: '1',
        }, 'fresh helper sees all three saved manager properties and unchanged entry state');
        assert.deepEqual(afterSet.unrelated, before.unrelated, 'manager settings save preserves unrelated entry state');

        if (process.env.MANAGER_PROPERTY_INTENTIONAL_FAIL) {
            throw new Error('intentional manager-property cleanup probe after property save');
        }

        await page.goto(oldURL, {waitUntil: 'networkidle0'});
        await page.$eval('[name=prop_adult_content_maintainer_reason]', node => { node.value = ''; });
        await page.select('[name=prop_adult_content_maintainer]', '');
        if (await page.$eval('[name=prop_opt_nocomments_maintainer]', node => node.checked)) {
            await page.click('[name=prop_opt_nocomments_maintainer]');
        }
        const clearResponse = await clickSave(page);
        assert.equal(new URL(clearResponse.headers().location, base).pathname,
            new URL(data.target_url, base).pathname,
            'manager property clear keeps the public entry redirect');
        const afterClear = await client.state();
        assert.deepEqual(afterClear.target, before.target,
            'fresh helper sees all three manager properties cleared with entry state unchanged');
        assert.deepEqual(afterClear.unrelated, before.unrelated, 'manager property clear preserves unrelated entry state');
        assert.deepEqual(errors, [], 'manager property browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'manager property browser flow has no failed resources');
        console.log('PASS: retained manager form uses only the callable savemaintainer adapter');
    } finally {
        try {
            await closeOwnedBrowser(browser);
        } finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) {
                    const result = await finishWithin(serverDone, 'owned manager-property server shutdown');
                    if (result.code !== 0 && result.signal !== 'SIGTERM') {
                        throw new Error(`manager-property server cleanup failed: ${JSON.stringify(result)}`);
                    }
                }
            } finally {
                if (fixture) fixture.stdin.end();
                if (client) await finishWithin(client.done, 'manager-property fixture cleanup');
            }
        }
    }
})().catch(error => { console.error(error); process.exit(1); });

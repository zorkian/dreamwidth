// Browser acceptance for the callable same-poster community legacy edit resolver.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = Number(process.env.SAME_POSTER_COMMUNITY_EDIT_PORT || 18112);
const output = process.argv[2] || '/tmp/same-poster-community-edit-browser';

function portUnused() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); reject(new Error(`port ${port} is occupied`)); });
        socket.once('error', error => {
            socket.destroy();
            error.code === 'ECONNREFUSED' ? resolve() : reject(error);
        });
    });
}

function waitForPort() {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const check = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', error => {
                socket.destroy();
                if (Date.now() > deadline) reject(new Error(`server did not listen: ${error.code}`));
                else setTimeout(check, 100);
            });
        };
        check();
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
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
            lines.push(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
        }
        drain();
    });
    const next = () => new Promise((resolve, reject) => {
        if (terminal) return reject(terminal);
        waiters.push({resolve, reject});
        drain();
    });
    const json = async label => {
        const line = await next();
        try { return JSON.parse(line); }
        catch (error) { throw new Error(`${label}: ${error.message}: ${line}`); }
    };
    return {done, json, state: async () => {
        child.stdin.write(JSON.stringify({state: true}) + '\n');
        return json('fixture state');
    }};
}

async function login(page, base, user, password) {
    await page.goto(`${base}/mobile/login`, {waitUntil: 'networkidle0'});
    await page.type('[name=user]', user);
    await page.type('[name=password]', password);
    await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('[type=submit]')]);
}

async function submit(page, selector) {
    const action = await page.$eval(selector, element => element.form.action);
    const expectedPath = new URL(action).pathname;
    const response = page.waitForResponse(item => item.request().method() === 'POST'
        && new URL(item.url()).pathname === expectedPath);
    const navigation = page.waitForNavigation({waitUntil: 'load'});
    await page.click(selector);
    const [result] = await Promise.all([response, navigation]);
    assert.equal(result.status(), 200, `${expectedPath} returns native response`);
}

(async () => {
    let fixture;
    let client;
    let server;
    let serverDone;
    let browser;
    let stderr = '';
    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-same-poster-community-edit-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        client = fixtureClient(fixture);
        const data = await client.json('fixture startup');
        await portUnused();
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-same-poster-community-edit-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'pipe']});
        server.stderr.on('data', chunk => { stderr += chunk; });
        serverDone = new Promise(resolve => server.once('exit', (code, signal) => resolve({code, signal, stderr})));
        const startup = await Promise.race([waitForPort().then(() => true), serverDone.then(value => value)]);
        if (startup !== true) throw new Error(`server exited before startup: ${JSON.stringify(startup)}`);
        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        page.on('pageerror', error => errors.push(`${page.url()}: ${error.stack || error.message}`));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`); });
        fs.mkdirSync(output, {recursive: true});
        const base = `http://127.0.0.1:${port}`;
        const query = id => `usejournal=${data.community}&itemid=${id}&encoded=a%2Fb%26c&repeated=one&repeated=two`;
        const oldURL = id => `${base}/editjournal?${query(id)}`;
        const before = await client.state();
        await login(page, base, data.user, data.password);

        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.goto(oldURL(data.target_id), {waitUntil: 'networkidle0'});
            assert.ok(await page.$('#updateForm'), `${width}px uses retained community edit form`);
            assert.ok(await page.$('[name="action:save"]'), `${width}px retained save is visible`);
            await page.screenshot({path: `${output}/retained-community-edit-${width}.png`, fullPage: true});
        }
        await page.goto(oldURL(data.target_id), {waitUntil: 'networkidle0'});
        await page.$eval('[name=subject]', element => { element.value = 'Browser community saved subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Browser community saved body'; });
        await page.select('[name=security]', 'friends');
        await submit(page, 'input[name="action:save"][value="Save Changes"], input[name="action:save"][value="Save"]');
        assert.ok(await page.$(`.successlinks a[href="/entry/${data.community}/${data.target_id}/edit"]`), 'save renders native success');
        let after = await client.state();
        assert.deepEqual(after.target, {
            valid: true, subject: 'Browser community saved subject', body: 'Browser community saved body',
            security: 'usemask', allowmask: 1
        }, 'retained save reaches callable resolver and persists canonical state');
        assert.deepEqual(after.unrelated, before.unrelated, 'save preserves unrelated community entry');

        await page.goto(oldURL(data.retry_id), {waitUntil: 'networkidle0'});
        await page.$eval('[name=date_ymd_mm]', element => { element.value = '02'; });
        await page.$eval('[name=date_ymd_dd]', element => { element.value = '03'; });
        await page.$eval('[name=date_ymd_yyyy]', element => { element.value = 'not-a-year'; });
        await page.$eval('[name=subject]', element => { element.value = 'Browser invalid retry subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Browser invalid retry body'; });
        await submit(page, 'input[name="action:save"][value="Save Changes"], input[name="action:save"][value="Save"]');
        assert.ok(await page.$('#js-post-entry'), 'invalid legacy date renders native retry');
        assert.equal(await page.$eval('[name=entrytime_date]', element => element.value), 'not-a-year-02-03', 'retry retains raw invalid date');
        const retryErrors = await page.$$eval('.alert-box.alert', elements => elements.filter(item => item.offsetParent).map(item => item.textContent.trim()));
        assert.equal(retryErrors.length, 1, 'retry has one visible validation error');
        const retryAction = new URL(await page.$eval('#js-post-entry', form => form.action));
        assert.equal(retryAction.pathname, `/entry/${data.community}/${data.retry_id}/edit`,
            'retry uses the canonical community edit action');
        assert.equal(retryAction.searchParams.get('usejournal'), data.community,
            'retry retains the community journal context');
        assert.deepEqual((await client.state()).retry, before.retry, 'invalid retry leaves persisted entry unchanged');
        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.$eval('#js-post-entry', element => element.scrollIntoView({block: 'center'}));
            for (const selector of ['[name=subject]', '[name=event]', '[name="action:post"]']) {
                await page.$eval(selector, element => element.scrollIntoView({block: 'center'}));
                const inViewport = await page.$eval(selector, element => {
                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && rect.left >= -2 && rect.right <= innerWidth + 2
                        && rect.top >= 0 && rect.bottom <= innerHeight;
                });
                assert.ok(inViewport, `${width}px native retry ${selector} is visible and usable`);
            }
            const formFits = await page.$eval('#js-post-entry', element => {
                const rect = element.getBoundingClientRect();
                return rect.left >= -2 && rect.right <= innerWidth + 2;
            });
            assert.ok(formFits, `${width}px native retry form fits horizontally`);
            await page.screenshot({path: `${output}/native-community-retry-${width}.png`, fullPage: true});
        }
        await page.$eval('[name=entrytime_date]', element => { element.value = '2020-02-03'; });
        await page.$eval('[name=entrytime_time]', element => { element.value = '04:05'; });
        await page.$eval('[name=subject]', element => { element.value = 'Browser corrected retry subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Browser corrected retry body'; });
        await submit(page, '[name="action:post"]');
        assert.ok(await page.$(`.successlinks a[href="/entry/${data.community}/${data.retry_id}/edit"]`), 'corrected retry renders native success');
        after = await client.state();
        assert.equal(after.retry.subject, 'Browser corrected retry subject', 'corrected retry persists subject');
        assert.equal(after.retry.body, 'Browser corrected retry body', 'corrected retry persists body');

        await page.goto(`${base}/mobile/login`, {waitUntil: 'networkidle0'});
        await page.type('[name=user]', data.manager);
        await page.type('[name=password]', data.manager_password);
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('[type=submit]')]);
        await page.goto(oldURL(data.other_id), {waitUntil: 'networkidle0'});
        for (const action of ['delete', 'deletespam', 'savemaintainer']) {
            assert.ok(await page.$(`[name="action:${action}"]`), `manager BML fallback retains ${action}`);
        }
        assert.deepEqual(await client.state(), after, 'manager fallback GET does not mutate entries');
        if (process.env.SAME_POSTER_COMMUNITY_EDIT_INTENTIONAL_FAIL) throw new Error('intentional same-poster community edit cleanup probe');
        assert.deepEqual(errors, [], 'browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'browser flow has no failed resources');
        console.log('PASS: retained same-poster community edit form uses the callable native POST resolver');
    } finally {
        try { if (browser) await browser.close(); }
        finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) {
                    const result = await serverDone;
                    if (result.code !== 0 && result.signal !== 'SIGTERM') throw new Error(`server cleanup failed: ${JSON.stringify(result)}`);
                }
            } finally {
                if (fixture) fixture.stdin.end();
                if (client) await client.done;
            }
        }
    }
})().catch(error => { console.error(error); process.exit(1); });

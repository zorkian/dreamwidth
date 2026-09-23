// Browser acceptance for the callable retained owned-edit GET composition.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = Number(process.env.ENTRY_LEGACY_EDIT_GET_PORT || 18103);
const output = process.argv[2] || '/tmp/legacy-owned-edit-get-browser';

function assertPortUnused() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(new Error(`refusing occupied callable owned-edit GET port ${port}`));
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
        const tryPort = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            socket.once('error', error => {
                socket.destroy();
                if (Date.now() >= deadline) {
                    reject(new Error(`callable owned-edit GET server did not listen: ${error.code}`));
                } else {
                    setTimeout(tryPort, 100);
                }
            });
        };
        tryPort();
    });
}

(async () => {
    let fixture;
    let fixtureDone;
    let server;
    let serverDone;
    let browser;
    let serverStderr = '';
    const lines = [];
    const waiters = [];
    let fixtureTerminal;
    let buffer = '';

    const rejectWaiters = error => {
        fixtureTerminal = error;
        while (waiters.length) waiters.shift().reject(error);
    };
    const nextLine = () => new Promise((resolve, reject) => {
        if (fixtureTerminal) return reject(fixtureTerminal);
        if (lines.length) return resolve(lines.shift());
        waiters.push({resolve, reject});
    });
    const fixtureJSON = async label => {
        const line = await nextLine();
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`${label}: ${error.message}: ${line}`);
        }
    };

    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-edit-get-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        fixtureDone = new Promise((resolve, reject) => {
            fixture.once('error', reject);
            fixture.once('exit', (code, signal) => {
                if (code === 0 && !signal) resolve();
                else reject(new Error(`owned-edit GET fixture cleanup failed: ${code}/${signal}`));
            });
        });
        fixtureDone.catch(rejectWaiters);
        fixture.stdout.on('data', chunk => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const waiter = waiters.shift();
                if (waiter) waiter.resolve(line);
                else lines.push(line);
            }
        });
        const data = await fixtureJSON('fixture startup');
        const state = async () => {
            fixture.stdin.write(JSON.stringify({state: true}) + '\n');
            return fixtureJSON('fixture state');
        };

        await assertPortUnused();
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-edit-get-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'pipe']});
        server.stderr.on('data', chunk => { serverStderr += chunk; });
        serverDone = new Promise((resolve, reject) => {
            server.once('error', reject);
            server.once('exit', (code, signal) => resolve({code, signal, stderr: serverStderr}));
        });
        const startup = await Promise.race([
            waitForPort().then(() => ({ready: true})),
            serverDone.then(result => ({result})),
        ]);
        if (!startup.ready) {
            throw new Error(`owned-edit GET server exited before startup: ${JSON.stringify(startup.result)}`);
        }

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        page.on('pageerror', error => errors.push(error.stack || error.message));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
        });
        fs.mkdirSync(output, {recursive: true});

        const base = `http://127.0.0.1:${port}`;
        const query = `itemid=${data.id}&encoded=a%2Fb%26c&repeated=one&repeated=two`;
        const legacyURL = `${base}/editjournal?${query}`;
        const expectedAction = `/entry/${data.user}/${data.id}/edit?${query}`;
        const visible = async selector => {
            await page.$eval(selector, element => element.scrollIntoView({block: 'center'}));
            return page.$eval(selector, element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0
                    && rect.bottom > 0 && rect.right > 0
                    && rect.top < innerHeight && rect.left < innerWidth;
            });
        };
        const capture = async (width, name) => {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.goto(legacyURL, {waitUntil: 'networkidle0'});
            assert.ok(await page.$('#js-post-entry'), `${width}px callable GET renders native edit form`);
            assert.equal(await page.$eval('#js-post-entry', form => {
                const action = new URL(form.action);
                return action.pathname + action.search;
            }), expectedAction, `${width}px native action keeps raw query`);
            assert.equal(await page.$eval('[name=subject]', element => element.value),
                data.state.target_subject, `${width}px retained subject renders`);
            assert.equal(await page.$eval('[name=event]', element => element.value),
                data.state.target_body, `${width}px retained body renders`);
            assert.equal(await page.$eval('[name=security]', element => element.value),
                data.state.target_security, `${width}px retained security renders`);
            assert.equal(await page.$eval('[name=editor]', element => element.value),
                data.state.target_editor, `${width}px selected stored editor renders`);
            assert.ok(await visible('[name=subject]'), `${width}px subject control is visible`);
            assert.ok(await visible('[name=event]'), `${width}px body control is visible`);
            await page.screenshot({path: `${output}/${name}-${width}.png`, fullPage: true});
        };

        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', data.user);
        await page.type('[name=password]', data.password);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.click('[type=submit]'),
        ]);

        const before = await state();
        await capture(1280, 'callable-get');
        await capture(390, 'callable-get');
        const afterGET = await state();
        assert.deepEqual(afterGET, before, 'GET leaves entry and draft state unchanged');

        await page.goto(legacyURL, {waitUntil: 'networkidle0'});
        await page.$eval('[name=subject]', element => { element.value = 'Browser callable GET saved subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Browser callable GET saved body'; });
        const expectedPath = new URL(await page.$eval('[name="action:post"]', element => element.form.action)).pathname;
        const responsePromise = page.waitForResponse(response =>
            response.request().method() === 'POST' && new URL(response.url()).pathname === expectedPath,
        {timeout: 15000});
        const navigation = page.waitForNavigation({waitUntil: 'networkidle0', timeout: 15000});
        await page.click('[name="action:post"]');
        const [response] = await Promise.all([responsePromise, navigation]);
        assert.equal(response.status(), 200, 'parsed callable native action POST succeeds');
        assert.ok(await page.$('.successlinks'), 'canonical action returns native success representation');
        const afterSave = await state();
        assert.equal(afterSave.target_subject, 'Browser callable GET saved subject', 'canonical action saves distinct subject');
        assert.equal(afterSave.target_body, 'Browser callable GET saved body', 'canonical action saves distinct body');
        assert.equal(afterSave.other_subject, before.other_subject, 'canonical action preserves unrelated entry');
        if (process.env.ENTRY_LEGACY_EDIT_GET_FAIL_AFTER_SAVE) {
            throw new Error('intentional callable owned-edit GET cleanup probe');
        }
        assert.deepEqual(errors, [], 'callable GET browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'callable GET browser flow has no resource or network errors');
        console.log('PASS: callable retained owned-edit GET renders native form and canonical action');
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) {
                    const result = await serverDone;
                    if (result.code !== 0 && result.signal !== 'SIGTERM') {
                        throw new Error(`owned-edit GET server cleanup failed: ${JSON.stringify(result)}`);
                    }
                }
            } finally {
                if (fixture) {
                    fixture.stdin.end();
                    await fixtureDone;
                }
            }
        }
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});

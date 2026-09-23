// Browser acceptance for the callable retained community edit GET composition.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = Number(process.env.ENTRY_COMMUNITY_EDIT_GET_PORT || 18104);
const output = process.argv[2] || '/tmp/legacy-community-edit-get-browser';

function assertPortUnused() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(new Error(`refusing occupied callable community edit GET port ${port}`));
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
                    reject(new Error(`callable community edit GET server did not listen: ${error.code}`));
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
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-community-edit-get-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        fixtureDone = new Promise((resolve, reject) => {
            fixture.once('error', reject);
            fixture.once('exit', (code, signal) => {
                if (code === 0 && !signal) resolve();
                else reject(new Error(`community edit GET fixture cleanup failed: ${code}/${signal}`));
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
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-community-edit-get-server.pl', String(port)],
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
            throw new Error(`community edit GET server exited before startup: ${JSON.stringify(startup.result)}`);
        }

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox'],
        });
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
        const query = `usejournal=${data.community}&itemid=${data.own_id}&encoded=a%2Fb%26c&repeated=one&repeated=two`;
        const legacyURL = `${base}/editjournal?${query}`;
        const expectedAction = `/entry/${data.community}/${data.own_id}/edit?${query}`;
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
                data.state.own_subject, `${width}px retained subject renders`);
            assert.equal(await page.$eval('[name=event]', element => element.value),
                data.state.own_body, `${width}px retained body renders`);
            assert.equal(await page.$eval('[name=security]', element => element.value),
                'access', `${width}px retained security renders`);
            assert.equal(await page.$eval('[name=editor]', element => element.value),
                'html_casual1', `${width}px selected stored editor renders`);
            assert.ok(await visible('[name=subject]'), `${width}px subject control is visible`);
            assert.ok(await visible('[name=event]'), `${width}px body control is visible`);
            assert.ok(await page.$eval('#js-post-entry', form => { const r=form.getBoundingClientRect(); return r.left >= -2 && r.right <= innerWidth + 2; }), `${width}px same-poster form fits viewport`);
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
        assert.equal(before.manager_draft, 'Community browser draft sentinel', 'fresh manager draft starts seeded');
        assert.deepEqual(before.manager_draft_props, {subject: 'Community draft subject', editor: 'markdown0'}, 'fresh manager frozen draft properties start seeded');
        assert.equal(before.manager_editor, 'always_rich', 'fresh manager editor preference starts seeded');
        assert.equal(before.manager_editor2, 'markdown0', 'fresh manager native editor preference starts seeded');
        assert.equal(before.own_allowmask, 1, 'fresh same-poster access mask starts seeded');
        assert.equal(before.other_override, 'concepts', 'fresh manager override starts seeded');
        assert.equal(before.other_comments, '1', 'fresh manager comment override starts seeded');
        await capture(1280, 'community-same-poster');
        await capture(390, 'community-same-poster');
        const managerQuery = `usejournal=${data.community}&itemid=${data.other_id}&encoded=a%2Fb%26c&repeated=one&repeated=two`;
        const managerURL = `${base}/editjournal?${managerQuery}`;
        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.goto(managerURL, {waitUntil: 'networkidle0'});
            assert.ok(await page.$('[name="action:delete"]'), `${width}px manager stays on retained BML delete surface`);
            assert.ok(await page.$('[name="action:deletespam"]'), `${width}px manager retains delete-spam action`);
            assert.ok(await page.$('[name="action:savemaintainer"]'), `${width}px manager retains maintainer action`);
            assert.ok(await visible('[name="action:delete"]'), `${width}px manager delete action is visible`);
            await page.screenshot({path: `${output}/community-manager-bml-${width}.png`, fullPage: true});
        }
        const afterGET = await state();
        assert.deepEqual(afterGET, before, 'GET leaves entry and draft state unchanged');

        if (process.env.ENTRY_COMMUNITY_EDIT_GET_FAIL_AFTER_GET) {
            throw new Error('intentional callable community edit GET cleanup probe');
        }
        assert.deepEqual(errors, [], 'callable GET browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'callable GET browser flow has no resource or network errors');
        console.log('PASS: callable retained community edit GET renders native form and canonical action');
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) {
                    const result = await serverDone;
                    if (result.code !== 0 && result.signal !== 'SIGTERM') {
                        throw new Error(`community edit GET server cleanup failed: ${JSON.stringify(result)}`);
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

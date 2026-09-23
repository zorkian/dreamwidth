// Exercise the callable legacy update adapter through its isolated test server.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

(async () => {
    const port = 18083;
    const output = process.argv[2] || '/tmp/entry-legacy-update-adapter-browser';
    let fixture;
    let fixtureDone;
    let server;
    let serverDone;
    let browser;
    let serverStderr = '';
    const lines = [];
    const waiters = [];
    let buffer = '';

    const portMustBeUnused = () => new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(new Error(`refusing occupied legacy-update adapter port ${port}`));
        });
        socket.once('error', error => {
            socket.destroy();
            if (error.code === 'ECONNREFUSED') resolve();
            else reject(error);
        });
    });
    const waitForPort = () => new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const attempt = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() >= deadline) reject(new Error('legacy-update adapter server did not listen'));
                else setTimeout(attempt, 100);
            });
        };
        attempt();
    });
    const nextLine = () => new Promise((resolve, reject) => {
        const line = lines.shift();
        if (line !== undefined) return resolve(line);
        waiters.push({resolve, reject});
    });
    const fixtureJSON = async label => {
        const line = await Promise.race([nextLine(), fixtureDone]);
        try { return JSON.parse(line); }
        catch (error) { throw new Error(`${label}: ${error.message}`); }
    };

    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-update-adapter-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        fixtureDone = new Promise((resolve, reject) => {
            fixture.once('exit', (code, signal) => {
                if (code === 0) resolve();
                else reject(new Error(`fixture cleanup failed: ${code}/${signal}`));
            });
            fixture.once('error', reject);
        });
        fixtureDone.catch(() => {});
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

        await portMustBeUnused();
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-update-adapter-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'pipe']});
        server.stderr.on('data', chunk => { serverStderr += chunk; });
        serverDone = new Promise(resolve => {
            server.once('exit', (code, signal) => resolve({code, signal, stderr: serverStderr}));
            server.once('error', error => resolve({error, stderr: serverStderr}));
        });
        const ready = await Promise.race([
            waitForPort().then(() => ({ready: true})),
            serverDone.then(result => ({result})),
        ]);
        if (!ready.ready) {
            throw new Error(`legacy-update adapter server exited before startup: ${JSON.stringify(ready.result)}`);
        }

        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        const posts = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('request', request => {
            if (request.method() === 'POST') posts.push(request.url());
        });
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
        });
        fs.mkdirSync(output, {recursive: true});
        const readinessState = async textarea => page.evaluate(textarea => ({
            api: !!window.FCKeditorAPI,
            instances: window.FCKeditorAPI ? Object.keys(FCKeditorAPI.Instances || {}).map(name => ({
                name,
                status: FCKeditorAPI.GetInstance(name)?.Status ?? null,
            })) : [],
            requested: textarea,
            editor: document.querySelector('#editor')?.value || null,
            event: {
                id: document.querySelector('[name=event]')?.id || null,
                visible: (() => {
                    const element = document.querySelector('[name=event]');
                    if (!element) return null;
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none';
                })(),
            },
            iframes: [...document.querySelectorAll('iframe')].map(frame => frame.id),
        }), textarea);
        const waitForFCK = async (label, textarea) => {
            try {
                await page.waitForFunction(textarea => window.FCKeditorAPI
                    && FCKeditorAPI.GetInstance(textarea)?.Status === 2, {timeout: 15000}, textarea);
            } catch (error) {
                const state = await readinessState(textarea);
                throw new Error(`${label} FCK readiness: ${JSON.stringify({state, errors, failures})}; ${error.message}`);
            }
        };
        const waitForDocumentLoad = async label => {
            try {
                await page.waitForFunction(() => document.readyState === 'complete', {timeout: 15000});
            } catch (error) {
                throw new Error(`${label} did not finish loading: ${JSON.stringify({errors, failures})}; ${error.message}`);
            }
        };
        const submit = async (selector, path) => {
            const responsePromise = page.waitForResponse(response =>
                response.request().method() === 'POST'
                && new URL(response.url()).pathname === path,
            {timeout: 15000});
            const navigationPromise = page.waitForNavigation({waitUntil: 'load', timeout: 15000});
            await page.click(selector);
            let response;
            try {
                [response] = await Promise.all([responsePromise, navigationPromise]);
            } catch (error) {
                const state = await page.$eval(selector, button => {
                    const form = button.form;
                    return {
                        action: form?.action,
                        disabled: button.disabled,
                        formValid: form?.checkValidity(),
                        submitValue: form?.querySelector('[name=submit_value]')?.value,
                        eventValue: form?.querySelector('[name=event]')?.value,
                    };
                });
                throw new Error(`real ${path} submit was not observed: ${JSON.stringify({state, posts, errors, failures})}; ${error.message}`);
            }
            assert.equal(response.status(), 200, `real ${path} form submit returns HTTP 200`);
            await waitForDocumentLoad(`real ${path} form response`);
        };
        const visibleCapture = async (label, selector, width, height) => {
            await page.setViewport({width, height, deviceScaleFactor: 1});
            await page.$eval(selector, element => element.scrollIntoView({block: 'center'}));
            const visible = await page.$eval(selector, element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0
                    && rect.bottom > 0 && rect.right > 0
                    && rect.top < innerHeight && rect.left < innerWidth;
            });
            assert.ok(visible, `${label} is visible at ${width}px`);
            await page.screenshot({path: `${output}/${label}-${width}.png`, fullPage: true});
        };

        const base = `http://127.0.0.1:${port}`;
        assert.deepEqual(data.state, {count: 0}, 'disposable account starts with no entries');
        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', data.user);
        await page.type('[name=password]', data.password);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.click('[type=submit]'),
        ]);

        await page.goto(base + '/update.bml', {waitUntil: 'domcontentloaded'});
        assert.ok(await page.$('#updateForm'), 'retained BML update form remains rendered before POST interception');
        assert.ok(await page.$('#formsubmit'), 'retained update form renders its visible update submit');
        await visibleCapture('legacy-update-form', '#updateForm', 1280, 900);
        await page.$eval('[name=subject]', el => { el.value = 'Browser legacy native subject'; });
        await waitForFCK('legacy success form', 'draft');
        await page.evaluate(body => FCKeditorAPI.GetInstance('draft').SetHTML(body),
            '<p>Browser legacy native body</p>');
        await page.select('[name=security]', 'private');
        await page.$eval('[name=date_ymd_mm]', el => { el.value = '02'; });
        await page.$eval('[name=date_ymd_dd]', el => { el.value = '03'; });
        await page.$eval('[name=date_ymd_yyyy]', el => { el.value = '2020'; });
        await page.$eval('[name=hour]', el => { el.value = '04'; });
        await page.$eval('[name=min]', el => { el.value = '05'; });
        await page.$eval('[name=switched_rte_on]', el => { el.value = '1'; });
        const dateDiff = await page.$('[name=date_diff]');
        if (dateDiff) await page.$eval('[name=date_diff]', el => { el.value = '1'; });
        await waitForDocumentLoad('retained legacy form');
        const oldFormAction = new URL(await page.$eval('#updateForm', form => form.action)).pathname;
        assert.equal(oldFormAction, '/update', 'retained .bml form preserves its extensionless submit action');
        await submit('#formsubmit', oldFormAction);
        await page.waitForSelector('.successlinks', {timeout: 15000});
        assert.match(await page.content(), /successlinks/, 'old form POST receives the native success rendering');
        const first = await state();
        assert.deepEqual(first, {
            count: 1,
            subject: 'Browser legacy native subject',
            body: '<p>Browser legacy native body</p>',
            security: 'private',
            date: '2020-02-03 04:05:00',
            used_rte: true,
        }, 'retained old form persists exact canonical fields through the adapter');

        await page.goto(base + '/update', {waitUntil: 'domcontentloaded'});
        assert.ok(await page.$('#updateForm'), 'extensionless retained update form still renders before error POST');
        await page.$eval('[name=subject]', el => { el.value = 'Browser correction subject'; });
        await waitForFCK('legacy empty-body form', 'draft');
        await page.evaluate(() => FCKeditorAPI.GetInstance('draft').SetHTML(''));
        await submit('#formsubmit', '/update');
        await page.waitForSelector('#js-post-entry', {timeout: 15000});
        assert.ok(await page.$('#js-post-entry'), 'empty old body rerenders the shared modern correction form');
        assert.equal(new URL(page.url()).pathname, '/update', 'error response retains the old request URL');
        assert.equal(await page.$eval('[name=subject]', el => el.value), 'Browser correction subject',
            'modern correction form retains old submitted subject');
        assert.equal(await page.$eval('[name=event]', el => el.value), '&nbsp;',
            'modern correction form retains legacy FCK blank-body serialization');
        assert.equal((await state()).count, 1, 'empty old body cannot create a duplicate entry');
        await visibleCapture('modern-correction-form', '#js-post-entry', 390, 844);

        await waitForDocumentLoad('modern correction form');
        assert.equal(new URL(await page.$eval('#js-post-entry', form => form.action)).pathname, '/entry/new',
            'native correction form posts its retry to the modern route');
        const correctionEditor = await page.$eval('#editor', element => element.value);
        assert.equal(correctionEditor, 'rte0', 'modern correction form preserves the selected native RTE mode');
        const correctionBeforeFCK = await readinessState('entry-body');
        console.log(`CORRECTION_EDITOR_STATE=${JSON.stringify({
            correctionBeforeFCK,
            errors,
            failures,
        })}`);
        await waitForFCK('modern correction form', 'entry-body');
        const correctionAfterFCK = await readinessState('entry-body');
        assert.equal(correctionAfterFCK.event.visible, false,
            'modern RTE correction hides its source textarea behind the entry-body FCK instance');
        await page.evaluate(body => FCKeditorAPI.GetInstance('entry-body').SetHTML(body),
            '<p>Browser correction body</p>');
        await submit('[name="action:post"]', '/entry/new');
        await page.waitForSelector('.successlinks', {timeout: 15000});
        const retry = await state();
        assert.equal(retry.count, 2, 'modern correction retry creates exactly one additional entry');
        assert.equal(retry.subject, 'Browser correction subject', 'modern correction retry persists retained subject');
        assert.equal(retry.body, '<p>Browser correction body</p>',
            'modern correction retry persists the entry-body FCK XHTML');
        assert.deepEqual(errors, [], 'legacy adapter browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'legacy adapter browser flow has no network failures');
        if (process.env.ENTRY_LEGACY_UPDATE_ADAPTER_FAIL_AFTER_RETRY) {
            throw new Error('intentional legacy update adapter cleanup failure');
        }
        console.log('PASS: retained old update form uses native owner adapter and modern retry');
    } finally {
        try { if (browser) await browser.close(); }
        finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) {
                    const result = await serverDone;
                    if (result.error) throw result.error;
                }
            } finally {
                if (fixture) {
                    fixture.stdin.end();
                    await fixtureDone;
                }
            }
        }
    }
})().catch(error => { console.error(error); process.exit(1); });

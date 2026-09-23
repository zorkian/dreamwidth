// Exercise the registered native owned-edit dispatch through retained controls.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = 18091;
const output = process.argv[2] || '/tmp/legacy-owned-edit-browser';

function unusedPort() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(new Error(`refusing occupied native owned-edit port ${port}`));
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
            socket.once('error', () => {
                socket.destroy();
                Date.now() >= deadline
                    ? reject(new Error('public owned-edit server did not listen'))
                    : setTimeout(tryPort, 100);
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
    let terminal;
    let buffer = '';

    const rejectWaiters = error => {
        terminal = error;
        while (waiters.length) waiters.shift().reject(error);
    };
    const nextLine = () => new Promise((resolve, reject) => {
        if (terminal) return reject(terminal);
        const line = lines.shift();
        if (line !== undefined) return resolve(line);
        waiters.push({resolve, reject});
    });
    const fixtureJSON = async label => {
        const line = await nextLine();
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`${label}: ${error.message}`);
        }
    };

    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-edit-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        fixtureDone = new Promise((resolve, reject) => {
            fixture.once('exit', (code, signal) => code === 0
                ? resolve()
                : reject(new Error(`fixture cleanup failed: ${code}/${signal}`)));
            fixture.once('error', reject);
        });
        fixtureDone.catch(rejectWaiters);
        fixture.stdout.on('data', chunk => {
            buffer += chunk;
            let at;
            while ((at = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, at);
                buffer = buffer.slice(at + 1);
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

        await unusedPort();
        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-edit-adapter-server.pl', String(port)],
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
            throw new Error(`public owned-edit server exited before startup: ${JSON.stringify(ready.result)}`);
        }

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage();
        const errors = [];
        const failures = [];
        const unexpectedDialogs = [];
        let allowDeleteDialog = false;
        page.on('pageerror', error => errors.push(error.stack || error.message));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
        });
        page.on('dialog', async dialog => {
            if (allowDeleteDialog && dialog.type() === 'confirm' && /delete/i.test(dialog.message())) {
                allowDeleteDialog = false;
                await dialog.accept();
                return;
            }
            unexpectedDialogs.push(`${dialog.type()}: ${dialog.message()}`);
            await dialog.dismiss();
        });
        fs.mkdirSync(output, {recursive: true});

        const base = `http://127.0.0.1:${port}`;
        const path = `/editjournal?itemid=${data.id}`;
        const url = base + path;
        const submit = async selector => {
            const expectedPath = new URL(await page.$eval(selector, element => element.form.action)).pathname;
            const responsePromise = page.waitForResponse(response =>
                response.request().method() === 'POST'
                && new URL(response.url()).pathname === expectedPath, {timeout: 15000});
            const navigation = page.waitForNavigation({waitUntil: 'load', timeout: 15000});
            await page.click(selector);
            const [response] = await Promise.all([responsePromise, navigation]);
            assert.equal(response.status(), 200, `${expectedPath} form POST returns HTTP 200`);
        };
        const capture = async (name, width) => {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.goto(url, {waitUntil: 'networkidle0'});
            assert.ok(await page.$('#updateForm'), 'retained GET falls through to the BML edit form');
            await page.screenshot({path: `${output}/${name}-${width}.png`, fullPage: true});
        };

        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', data.user);
        await page.type('[name=password]', data.password);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.click('[type=submit]'),
        ]);

        await capture('legacy-edit-form', 1280);
        await capture('legacy-edit-form', 390);
        await page.goto(url, {waitUntil: 'networkidle0'});
        await page.$eval('[name=subject]', element => { element.value = 'Native adapter browser subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Native adapter browser body'; });
        await submit('input[name="action:save"][value="Save Changes"], input[name="action:save"][value="Save"]');
        assert.ok(await page.$(`.successlinks a[href="/entry/${data.user}/${data.id}/edit"]`),
            'registered dispatch success renders the modern entry edit link');
        let after = await state();
        assert.equal(after.target_subject, 'Native adapter browser subject', 'registered dispatch persists subject');
        assert.equal(after.target_body, 'Native adapter browser body', 'registered dispatch persists body');
        if (process.env.ENTRY_LEGACY_EDIT_FAIL_AFTER_SAVE) {
            throw new Error('intentional native owned-edit cleanup probe');
        }

        await page.goto(url, {waitUntil: 'networkidle0'});
        await page.$eval('[name=date_ymd_mm]', element => { element.value = '02'; });
        await page.$eval('[name=date_ymd_dd]', element => { element.value = '03'; });
        await page.$eval('[name=date_ymd_yyyy]', element => { element.value = 'not-a-year'; });
        const dateDiff = await page.$('[name=date_diff]');
        if (dateDiff) await page.$eval('[name=date_diff]', element => { element.value = '1'; });
        await submit('input[name="action:save"][value="Save Changes"], input[name="action:save"][value="Save"]');
        assert.ok(await page.$('#js-post-entry'), 'invalid legacy date rerenders the native retry form');
        assert.equal(await page.$eval('[name=entrytime_date]', element => element.value), 'not-a-year-02-03',
            'native retry retains the raw invalid legacy date');
        const retryErrors = await page.$$eval('.alert-box.alert', elements => elements
            .filter(element => element.offsetParent && element.textContent.trim()).map(element => element.textContent.trim()));
        assert.equal(retryErrors.length, 1, 'native retry renders exactly one visible validation error');
        assert.equal((await state()).target_subject, 'Native adapter browser subject',
            'failed native retry leaves the persisted subject unchanged');
        assert.equal((await state()).target_body, 'Native adapter browser body',
            'failed native retry leaves the persisted body unchanged');
        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844, deviceScaleFactor: 1});
            await page.$eval('#js-post-entry', element => element.scrollIntoView({block: 'center'}));
            await page.screenshot({path: `${output}/native-retry-${width}.png`, fullPage: true});
        }
        assert.equal(new URL(await page.$eval('#js-post-entry', form => form.action)).pathname,
            `/entry/${data.user}/${data.id}/edit`, 'native retry posts to the modern edit action');
        await page.$eval('[name=entrytime_date]', element => { element.value = '2020-02-03'; });
        await page.$eval('[name=entrytime_time]', element => { element.value = '04:05'; });
        await page.$eval('[name=subject]', element => { element.value = 'Native retry browser subject'; });
        await page.$eval('[name=event]', element => { element.value = 'Native retry browser body'; });
        await submit('[name="action:post"]');
        assert.ok(await page.$(`.successlinks a[href="/entry/${data.user}/${data.id}/edit"]`),
            'native retry save renders the modern entry edit link');
        after = await state();
        assert.equal(after.target_subject, 'Native retry browser subject',
            'native retry persists its distinct retained subject');
        assert.equal(after.target_body, 'Native retry browser body',
            'native retry persists its distinct retained body');

        await page.goto(url, {waitUntil: 'networkidle0'});
        allowDeleteDialog = true;
        await submit('input[name="action:delete"]');
        allowDeleteDialog = false;
        after = await state();
        assert.equal(after.target_valid, false, 'registered dispatch delete removes only the target entry');
        assert.equal(after.other_valid, true, 'registered dispatch delete preserves the unrelated entry');
        assert.deepEqual(unexpectedDialogs, [], 'retained edit actions raise no unexpected browser dialogs');
        assert.deepEqual(errors, [], 'registered owned-edit browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'registered owned-edit browser flow has no network failures');
        console.log('PASS: retained owned edit uses the registered production dispatch and modern retry');
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            try {
                if (server && server.exitCode === null) server.kill('SIGTERM');
                if (serverDone) await serverDone;
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

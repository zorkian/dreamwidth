// Exercise retained owned-entry edit controls with disposable persisted fixtures.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

(async () => {
    let fixture, browser;
    let done;
    const waiters = [], lines = [];
    let terminal;
    const next = () => new Promise((resolve, reject) => {
        if (terminal) return reject(terminal);
        const line = lines.shift();
        if (line !== undefined) return resolve(line);
        waiters.push({resolve, reject});
    });
    try {
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-legacy-edit-fixture.pl'], {stdio: ['pipe', 'pipe', 'inherit']});
        done = new Promise((resolve, reject) => {
            fixture.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`fixture cleanup failed: ${code}/${signal}`)));
            fixture.once('error', reject);
        });
        done.catch(error => { terminal = error; while (waiters.length) waiters.shift().reject(error); });
        let buffer = '';
        fixture.stdout.on('data', chunk => {
            buffer += chunk;
            let at;
            while ((at = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
                const waiter = waiters.shift(); if (waiter) waiter.resolve(line); else lines.push(line);
            }
        });
        const json = async label => { try { return JSON.parse(await Promise.race([next(), done])); } catch (error) { throw new Error(`${label}: ${error.message}`); } };
        const data = await json('startup');
        const state = async () => { fixture.stdin.write(JSON.stringify({state: true}) + '\n'); return json('state'); };
        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        const errors = [], failed = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', req => failed.push(req.url()));
        page.on('response', res => { if (res.status() >= 400) failed.push(`${res.status()}: ${res.url()}`); });
        const base = 'http://127.0.0.1:8080';
        const output = process.argv[2] || '/tmp/legacy-owned-edit-browser';
        fs.mkdirSync(output, {recursive: true});
        await page.goto(base + '/mobile/login', {waitUntil: 'networkidle0'});
        await page.type('[name=user]', data.user); await page.type('[name=password]', data.password);
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('[type=submit]')]);
        const url = `${base}/editjournal?itemid=${data.id}`;
        for (const [width, shot] of [[1280, 'desktop.png'], [390, 'narrow.png']]) {
            await page.setViewport({width, height: 844}); await page.goto(url, {waitUntil: 'networkidle0'});
            await page.screenshot({path: `${output}/${shot}`, fullPage: true});
        }
        page.on('dialog', async dialog => {
            if (dialog.type() === 'confirm') await dialog.accept();
            else await dialog.dismiss();
        });
        await page.goto(url, {waitUntil: 'networkidle0'});
        await page.$eval('[name=subject]', el => { el.value = 'Browser legacy saved subject'; });
        await page.$eval('[name=event]', el => { el.value = 'Browser legacy saved body'; });
        await Promise.all([page.waitForNavigation({waitUntil: 'networkidle0'}), page.click('input[name="action:save"][value="Save Changes"], input[name="action:save"][value="Save"]')]);
        let after = await state();
        assert.equal(after.target_subject, 'Browser legacy saved subject');
        assert.equal(after.target_body, 'Browser legacy saved body');
        if (process.env.ENTRY_LEGACY_EDIT_FAIL_AFTER_SAVE) throw new Error('intentional legacy edit cleanup probe');
        await page.goto(url, {waitUntil: 'networkidle0'});
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.evaluate(() => {
                const input = [...document.querySelectorAll('input[name="action:delete"]')]
                    .find(element => element.offsetParent && element.value);
                if (!input) throw new Error('visible retained delete control missing');
                input.click();
            }),
        ]);
        after = await state();
        assert.equal(after.target_valid, false, 'visible retained delete removes only the target');
        assert.equal(after.other_valid, true, 'visible retained delete preserves the unrelated entry');
        assert.deepEqual(errors, [], 'no JS errors'); assert.deepEqual(failed, [], 'no failed resources');
        console.log('PASS: retained owned edit saves disposable entry');
    } finally {
        try { if (browser) await browser.close(); }
        finally { if (fixture) { fixture.stdin.end(); await done; } }
    }
})().catch(error => { console.error(error); process.exit(1); });

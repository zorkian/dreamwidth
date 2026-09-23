// Browser acceptance for callable anonymous retained update posting.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = 18117;
const output = process.argv[2] || '/tmp/entry-anonymous-update-adapter-browser';
let fixture;
let fixtureDone;
let server;
let serverDone;
let browser;
let terminal;
let buffer = '';
const lines = [];
const waiters = [];

function drain() {
    while (lines.length && waiters.length) waiters.shift().resolve(lines.shift());
}
function endFixture(error) {
    terminal = error;
    while (waiters.length) waiters.shift().reject(error);
}
function nextLine() {
    return new Promise((resolve, reject) => {
        if (terminal) return reject(terminal);
        waiters.push({resolve, reject});
        drain();
    });
}
async function state(label) {
    fixture.stdin.write(JSON.stringify({state: true}) + '\n');
    const line = await nextLine();
    try { return JSON.parse(line); }
    catch (error) { throw Error(`${label}: malformed fixture JSON: ${line}`); }
}
function unusedPort() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); reject(Error(`port ${port} occupied`)); });
        socket.once('error', error => {
            socket.destroy();
            error.code === 'ECONNREFUSED' ? resolve() : reject(error);
        });
    });
}
function waitPort() {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const retry = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', error => {
                socket.destroy();
                Date.now() >= deadline ? reject(Error(`server did not listen: ${error.code}`)) : setTimeout(retry, 100);
            });
        };
        retry();
    });
}
async function clickVisible(page, selector) {
    const handles = await page.$$(selector);
    for (const handle of handles) {
        await handle.evaluate(element => element.scrollIntoView({block: 'center'}));
        const box = await handle.boundingBox();
        const clickable = box && await handle.evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const target = document.elementFromPoint(
                rect.left + rect.width / 2, rect.top + rect.height / 2,
            );
            return style.visibility !== 'hidden' && style.display !== 'none'
                && !element.disabled && rect.width > 0 && rect.height > 0
                && (target === element || element.contains(target));
        });
        if (clickable) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            return;
        }
    }
    throw Error(`no visible control for ${selector}`);
}

async function closeChild(child, done, label) {
    if (!child) return;
    if (child.exitCode === null) child.kill('SIGTERM');
    const result = await done;
    console.log(`CLEANUP_${label.toUpperCase()} ${JSON.stringify(result)}`);
    if (result.code !== 0 && result.signal !== 'SIGTERM') {
        throw Error(`${label} cleanup: ${JSON.stringify(result)}`);
    }
}

(async () => {
    const errors = [];
    const failures = [];
    const posts = [];
    try {
        await unusedPort();
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/entry-anonymous-update-adapter-fixture.pl'],
            {stdio: ['pipe', 'pipe', 'inherit']});
        fixtureDone = new Promise((resolve, reject) => {
            fixture.once('error', reject);
            fixture.once('exit', (code, signal) => {
                const result = {code, signal};
                code === 0 && !signal ? resolve(result) : reject(Error(`fixture exit ${code}/${signal}`));
            });
        });
        fixtureDone.then(
            () => endFixture(Error('fixture EOF')),
            endFixture,
        );
        fixture.stdout.on('data', chunk => {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                lines.push(buffer.slice(0, end));
                buffer = buffer.slice(end + 1);
            }
            drain();
        });
        const startupLine = await nextLine();
        const startup = JSON.parse(startupLine);

        server = spawn('perl', [process.env.LJHOME + '/t/browser/entry-anonymous-update-adapter-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'inherit']});
        serverDone = new Promise((resolve, reject) => {
            server.once('error', reject);
            server.once('exit', (code, signal) => resolve({code, signal}));
        });
        await Promise.race([waitPort(), serverDone.then(result => Promise.reject(Error(`server exited early: ${JSON.stringify(result)}`)))]);

        browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox']});
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.stack || error.message));
        page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('request', request => {
            if (request.method() === 'POST') posts.push([request.url(), request.postData()]);
        });
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
        });
        fs.mkdirSync(output, {recursive: true});
        const base = `http://127.0.0.1:${port}`;
        const legacyURL = `${base}/update`;

        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844});
            await page.goto(legacyURL, {waitUntil: 'networkidle0', timeout: 60000});
            assert.ok(await page.$('#updateForm'), `${width}px retained form renders`);
            await page.waitForFunction(
                () => window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('draft'),
                {timeout: 60000},
            );
            await page.screenshot({path: `${output}/retained-${width}.png`, fullPage: true});
        }

        const before = await state('before wrong-password attempt');
        assert.equal(before.draft, 'anonymous browser draft sentinel', 'fixture seeds a nonempty draft');
        assert.deepEqual(before.draft_properties, {subject: 'anonymous browser frozen subject'},
            'fixture seeds frozen draft properties');
        assert.equal(before.displaydate, 1, 'fixture seeds displaydate on before the off/absent invalid attempt');

        // A newly loaded retained form must reach the real public dispatcher
        // directly, rather than relying only on the later native retry submit.
        const directSubject = 'Anonymous browser direct public subject';
        const directBody = 'Anonymous browser direct public body';
        await page.setViewport({width: 1280, height: 844});
        await page.goto(legacyURL, {waitUntil: 'networkidle0', timeout: 60000});
        await page.$eval('#updateForm #altlogin_username', (input, value) => { input.value = value; }, startup.user);
        await page.$eval('#updateForm #altlogin_password', (input, value) => { input.value = value; }, startup.password);
        await page.$eval('#updateForm [name=subject]', (input, value) => { input.value = value; }, directSubject);
        await page.waitForFunction(
            () => window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('draft'),
            {timeout: 60000},
        );
        await page.evaluate(value => window.FCKeditorAPI.GetInstance('draft').SetHTML(value), directBody);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0', timeout: 60000}),
            clickVisible(page, '#updateForm [name="action:update"]'),
        ]);
        assert.ok(await page.$('.successlinks'), 'direct retained public post renders native success');
        assert.equal(await page.$('#updateForm'), null, 'direct retained public post does not return to BML');
        const afterDirect = await state('after direct retained public post');
        assert.equal(afterDirect.count, before.count + 1,
            'direct retained public post creates exactly one entry');
        assert.equal(afterDirect.subject, directSubject, 'direct retained public post persists its subject');
        assert.equal(afterDirect.body, directBody, 'direct retained public post persists its body');
        assert.equal(afterDirect.draft, before.draft,
            'direct retained public post preserves the remote-only draft body');
        assert.deepEqual(afterDirect.draft_properties, before.draft_properties,
            'direct retained public post preserves frozen draft properties');

        const wrongPassword = 'wrong-anonymous-browser-password';
        const wrongSubject = 'Anonymous browser wrong-password subject';
        const wrongBody = 'Anonymous browser wrong-password body';
        await page.setViewport({width: 1280, height: 844});
        await page.goto(legacyURL, {waitUntil: 'networkidle0', timeout: 60000});
        await page.$eval('#updateForm #altlogin_username', (input, value) => { input.value = value; }, startup.user);
        await page.$eval('#updateForm #altlogin_password', (input, value) => { input.value = value; }, wrongPassword);
        await page.$eval('#updateForm [name=subject]', (input, value) => { input.value = value; }, wrongSubject);
        await page.waitForFunction(
            () => window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('draft'),
            {timeout: 60000},
        );
        await page.evaluate(value => window.FCKeditorAPI.GetInstance('draft').SetHTML(value), wrongBody);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0', timeout: 60000}),
            clickVisible(page, '#updateForm [name="action:update"]'),
        ]);
        assert.ok(await page.$('#js-post-entry'), 'wrong password renders the native retry form');
        assert.equal(await page.$eval('#js-post-entry', form => {
            const action = new URL(form.action); return action.pathname + action.search;
        }), '/entry/new', 'wrong-password retry uses the canonical new-entry action');
        const wrongErrors = await page.$$eval('.alert-box.alert', alerts => alerts.map(alert => alert.textContent.trim()));
        assert.equal(wrongErrors.filter(error => /Error logging on:\s+Invalid password/.test(error)).length, 1,
            'wrong-password retry renders one meaningful localized protocol error');
        assert.equal(await page.$eval('[name=subject]', input => input.value), wrongSubject,
            'wrong-password retry retains the submitted subject');
        assert.equal(await page.$eval('[name=event]', input => input.value), wrongBody,
            'wrong-password retry retains the submitted body');
        assert.equal(await page.$eval('input[name=username][type=text]', input => input.value), startup.user,
            'wrong-password retry retains the visible username');
        assert.ok(await page.$$eval('input[name=password]', inputs =>
            inputs.length >= 2 && inputs.every(input => input.value === ''),
        ), 'wrong-password retry blanks every password control');
        assert.equal(await page.content().then(content => content.includes(wrongPassword)), false,
            'wrong-password retry does not return the submitted password');
        await page.screenshot({path: `${output}/wrong-password-retry-1280.png`, fullPage: true});
        await page.setViewport({width: 390, height: 844});
        await page.screenshot({path: `${output}/wrong-password-retry-390.png`, fullPage: true});
        await page.setViewport({width: 1280, height: 844});
        const afterWrongPassword = await state('after wrong-password attempt');
        assert.deepEqual(afterWrongPassword, afterDirect,
            'wrong-password retry leaves entries and nonblank draft/editor/displaydate state unchanged');

        await page.goto(legacyURL, {waitUntil: 'networkidle0', timeout: 60000});
        await page.$eval('#updateForm #altlogin_username', (input, value) => { input.value = value; }, startup.user);
        await page.$eval('#updateForm #altlogin_password', (input, value) => { input.value = value; }, startup.password);
        assert.deepEqual(await page.$$eval('#updateForm [name=user], #updateForm [name=password]', inputs => inputs.map(input => ({
            id: input.id, name: input.name, nonempty: Boolean(input.value), form: input.form?.id,
        }))), [
            {id: 'altlogin_username', name: 'user', nonempty: true, form: 'updateForm'},
            {id: 'altlogin_password', name: 'password', nonempty: true, form: 'updateForm'},
        ], 'retained form owns the nonempty anonymous credentials');
        await page.$eval('[name=subject]', input => { input.value = 'Anonymous browser invalid subject'; });
        await page.$eval('[name=event]', input => { input.value = 'Anonymous browser invalid body'; });
        await page.evaluate(value => window.FCKeditorAPI.GetInstance('draft').SetHTML(value),
            'Anonymous browser invalid body');
        await page.evaluate(() => settime('', false));
        assert.equal(await page.$eval('#updateForm [name=date_diff]', input => input.value), '1',
            'retained time control marks the edited timestamp as authoritative');
        await page.$eval('[name=date_ymd_yyyy]', input => { input.value = 'not-a-year'; });
        await page.$eval('[name=date_ymd_mm]', input => { input.value = '02'; });
        await page.$eval('[name=date_ymd_dd]', input => { input.value = '03'; });
        await page.$eval('[name=hour]', input => { input.value = '04'; });
        await page.$eval('[name=min]', input => { input.value = '05'; });
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0', timeout: 60000}),
            clickVisible(page, '#updateForm [name="action:update"]'),
        ]);
        await page.screenshot({path: `${output}/native-retry-1280.png`, fullPage: true});
        await page.setViewport({width: 390, height: 844});
        await page.screenshot({path: `${output}/native-retry-390.png`, fullPage: true});
        await page.setViewport({width: 1280, height: 844});
        const retryError = await page.$$eval('.alert-box.alert', alerts => alerts.map(alert => alert.textContent.trim()));
        assert.ok(await page.$('#js-post-entry'),
            `invalid retained post renders native retry form: ${JSON.stringify(retryError)}`);
        assert.equal(await page.$eval('#js-post-entry', form => {
            const action = new URL(form.action); return action.pathname + action.search;
        }), '/entry/new', 'native retry uses the canonical new-entry action without invented query');
        assert.equal(await page.$eval('[name=subject]', input => input.value), 'Anonymous browser invalid subject');
        assert.equal(await page.$eval('[name=event]', input => input.value), 'Anonymous browser invalid body');
        assert.equal(await page.$eval('input[name=username][type=text]', input => input.value), startup.user);
        const retryPasswords = await page.$$eval('input[name=password]', inputs => inputs.map(input => input.value));
        assert.ok(retryPasswords.length >= 2 && retryPasswords.every(value => value === ''),
            'native retry blanks every anonymous password control');
        assert.equal(await page.$$eval('.alert-box.alert', alerts => alerts.filter(alert => /year|date/i.test(alert.textContent)).length), 1,
            'native retry displays one useful date error');
        const afterRetry = await state('after invalid attempt');
        assert.deepEqual(afterRetry, afterDirect, 'callable invalid retry preserves user draft/editor/displaydate state');

        await page.click('[name="action:post"]');
        await page.waitForSelector('#js-post-entry-login input[name=username][type=text]', {visible: true});
        assert.equal(await page.$eval('#js-post-entry-login input[name=username][type=text]', input => input.value), startup.user);
        await page.$eval('#js-post-entry-login input[name=password]', (input, value) => { input.value = value; }, startup.password);
        await page.$eval('[name=subject]', input => { input.value = 'Anonymous browser corrected subject'; });
        await page.$eval('[name=event]', input => { input.value = 'Anonymous browser corrected body'; });
        await page.waitForFunction(
            () => window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('entry-body'),
            {timeout: 60000},
        );
        await page.evaluate(value => window.FCKeditorAPI.GetInstance('entry-body').SetHTML(value),
            'Anonymous browser corrected body');
        await page.$eval('[name=entrytime_date]', input => { input.value = '2020-02-03'; });
        await page.$eval('[name=entrytime_time]', input => { input.value = '04:05'; });
        await page.$eval('input[name=update_displaydate][type=checkbox]', input => { input.checked = false; });
        assert.equal(await page.$eval('input[name=update_displaydate][type=checkbox]', input => input.checked), false,
            'corrected native post explicitly clears the visible displaydate preference');
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0', timeout: 60000}),
            page.click('#js-post-entry-login input[name=login]'),
        ]);
        assert.ok(await page.$('.successlinks'), 'corrected native retry posts successfully');
        assert.deepEqual(posts.filter(([url]) => url.includes('/entry/new')).map(([, post]) =>
            (post || '').split('&').filter(pair => pair.startsWith('update_displaydate='))), [[]],
            'unchecked corrected native post omits displaydate');
        const afterSuccess = await state('after corrected native post');
        assert.equal(afterSuccess.count, afterDirect.count + 1, 'corrected native retry creates exactly one entry');
        assert.equal(afterSuccess.subject, 'Anonymous browser corrected subject');
        assert.equal(afterSuccess.body, 'Anonymous browser corrected body');
        assert.equal(afterSuccess.draft, '', 'native corrected post clears the saved draft body');
        assert.deepEqual(afterSuccess.draft_properties, {}, 'native corrected post clears frozen draft properties');
        assert.equal(afterSuccess.displaydate, 0, 'native corrected post persists the explicit displaydate-off choice');
        assert.equal(afterSuccess.legacy_editor, before.legacy_editor, 'native corrected post preserves legacy editor preference');
        assert.equal(afterSuccess.editor, before.editor, 'native corrected post preserves current editor preference');
        if (process.env.ANONYMOUS_UPDATE_INTENTIONAL_FAIL) throw Error('intentional anonymous update cleanup failure');
        assert.deepEqual(errors, [], 'anonymous update browser flow has no JavaScript errors');
        assert.deepEqual(failures, [], 'anonymous update browser flow has no failed or error resources');
        console.log('PASS anonymous update callable browser');
    } finally {
        try { if (browser) await browser.close(); }
        finally {
            try {
                await closeChild(server, serverDone, 'server');
                await unusedPort();
            }
            finally {
                if (fixture) {
                    if (fixture.exitCode === null && !fixture.stdin.destroyed) fixture.stdin.end();
                    await fixtureDone;
                }
            }
        }
    }
})().catch(error => { console.error(error); process.exit(1); });

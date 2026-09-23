// Browser acceptance for callable alternate-login update GET rendering.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = Number(process.env.UPDATE_ALTLOGIN_PORT || 18145);
const output = process.argv[2] || '/tmp/update-altlogin-browser';

function unusedPort() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(Error(`alternate-login port ${port} occupied`));
        });
        socket.once('error', error => {
            socket.destroy();
            error.code === 'ECONNREFUSED' ? resolve() : reject(error);
        });
    });
}

function waitPort() {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const connect = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            socket.once('error', () => {
                socket.destroy();
                Date.now() > deadline
                    ? reject(Error('alternate-login server did not listen'))
                    : setTimeout(connect, 100);
            });
        };
        connect();
    });
}

function childDone(child, label) {
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            code === 0 && !signal
                ? resolve({code, signal})
                : reject(Error(`${label} EOF ${code}/${signal || 'none'}`));
        });
    });
}

function lines(child, done) {
    let buffer = '';
    const queued = [];
    const waiters = [];
    let stopped;

    const drain = () => {
        while (queued.length && waiters.length) {
            waiters.shift().resolve(queued.shift());
        }
    };

    child.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            queued.push(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
        }
        drain();
    });

    done.catch(error => {
        stopped = error;
        while (waiters.length) {
            waiters.shift().reject(error);
        }
    });

    return () => new Promise((resolve, reject) => {
        if (stopped) return reject(stopped);
        if (queued.length) return resolve(queued.shift());
        waiters.push({resolve, reject});
    });
}

function nextOrExit(next, done, label) {
    return Promise.race([
        next(),
        done.then(() => Promise.reject(Error(`fixture exited before ${label}`))),
    ]);
}

async function stop(child, done) {
    if (!child) return;
    if (child.exitCode === null) child.kill('SIGTERM');
    try {
        await done;
    }
    catch (error) {
        if (!/SIGTERM/.test(error.message)) throw error;
    }
}

async function assertUsableControl(page, selector, width) {
    await page.$eval(selector, element => element.scrollIntoView({block: 'center', inline: 'nearest'}));
    await page.waitForFunction(
        target => {
            const rect = document.querySelector(target).getBoundingClientRect();
            return rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
        },
        {},
        selector,
    );

    const geometry = await page.$eval(selector, element => {
        const rect = element.getBoundingClientRect();
        const ancestors = [];
        let ancestor = element.parentElement;
        while (ancestor && ancestors.length < 4) {
            const ancestorRect = ancestor.getBoundingClientRect();
            const style = getComputedStyle(ancestor);
            ancestors.push({
                tag: ancestor.tagName,
                id: ancestor.id,
                display: style.display,
                visibility: style.visibility,
                left: ancestorRect.left,
                right: ancestorRect.right,
                width: ancestorRect.width,
            });
            ancestor = ancestor.parentElement;
        }
        const style = getComputedStyle(element);
        return {
            rect: {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
            },
            innerWidth,
            innerHeight,
            scrollY,
            display: style.display,
            visibility: style.visibility,
            ancestors,
        };
    });
    console.log(`GEOMETRY ${selector} ${width} ${JSON.stringify(geometry)}`);
    assert.ok(geometry.rect.width > 0, `${selector} has width at ${width}`);
    assert.ok(geometry.rect.top >= 0 && geometry.rect.bottom <= geometry.innerHeight, `${selector} visible at ${width}`);
    assert.ok(geometry.rect.left >= 0 && geometry.rect.right <= geometry.innerWidth, `${selector} horizontally visible at ${width}`);
}

(async () => {
    let fixture;
    let server;
    let browser;
    let fixtureDone;
    let serverDone;
    const errors = [];
    const failures = [];

    try {
        await unusedPort();

        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/update-altlogin-fixture.pl'], {
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        fixtureDone = childDone(fixture, 'fixture');
        const next = lines(fixture, fixtureDone);
        const startup = JSON.parse(await nextOrExit(next, fixtureDone, 'startup'));
        const fixtureState = async (command, label) => {
            fixture.stdin.write(JSON.stringify(command) + '\n');
            return JSON.parse(await nextOrExit(next, fixtureDone, label));
        };

        server = spawn(
            'perl',
            [process.env.LJHOME + '/t/browser/update-altlogin-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'inherit']},
        );
        serverDone = childDone(server, 'server');
        await Promise.race([
            waitPort(),
            serverDone.then(() => Promise.reject(Error('server exited before listening'))),
        ]);

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => failures.push(request.url()));
        page.on('response', response => {
            if (response.status() >= 400) failures.push(`${response.status()}:${response.url()}`);
        });

        fs.mkdirSync(output, {recursive: true});
        await page.goto(`http://127.0.0.1:${port}/mobile/login`, {waitUntil: 'networkidle0'});
        await page.type('[name=user]', startup.user);
        await page.type('[name=password]', startup.password);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.click('[type=submit]'),
        ]);

        const before = await fixtureState({state: 1}, 'initial state');

        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844});
            await page.goto(
                `http://127.0.0.1:${port}/__test_update_altlogin?altlogin=1&user=browser%3Cuser%3E&password=marker%3Csecret%3E`,
                {waitUntil: 'networkidle0'},
            );
            await page.waitForSelector('#altlogin_wrapper');
            await page.waitForFunction(() => {
                const editor = window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('entry-body');
                return editor && editor.Status >= 2;
            });

            assert.equal(await page.$eval('#altlogin_username', element => element.value), 'browser<user>');
            assert.equal(await page.$eval('#altlogin_password', element => element.value), '');
            assert.equal(
                await page.$eval('#js-post-entry', element => element.action),
                `http://127.0.0.1:${port}/update?altlogin=1`,
            );
            assert.ok(await page.$('#js-remote'));
            assert.equal(await page.$('#js-post-entry-login'), null);
            assert.equal(await page.$('.crosspost-component'), null);
            assert.equal(await page.$('#js-crosspost-entry'), null);
            await assertUsableControl(page, '#altlogin_username', width);
            await assertUsableControl(page, '#altlogin_password', width);
            await page.screenshot({path: `${output}/altlogin-${width}.png`, fullPage: true});
        }

        const after = await fixtureState({state: 1}, 'final state');
        assert.deepEqual(after, before, 'alternate-login GET leaves draft/editor state unchanged');

        const seeded = await fixtureState({seed_draft: 1}, 'seeded draft state');
        assert.equal(seeded.draft, '"update GET draft"', 'fixture persisted a nonblank draft body');
        assert.deepEqual(
            seeded.props,
            {
                subject: 'update GET draft subject',
                taglist: 'update-get-draft-tag',
                editor: 'markdown0',
            },
            'fixture persisted complete frozen draft properties',
        );
        assert.equal(seeded.legacy_editor, 'always_rich', 'fixture preserves legacy editor property');
        assert.equal(seeded.editor, 'markdown0', 'fixture preserves editor2 property');

        const dialogPromise = new Promise(resolve => page.once('dialog', resolve));
        const restoreNavigation = page.goto(
            `http://127.0.0.1:${port}/__test_update_altlogin?altlogin=1&user=browser%3Cuser%3E`,
            {waitUntil: 'domcontentloaded'},
        );
        const dialog = await dialogPromise;
        assert.equal(dialog.type(), 'confirm', 'saved draft uses the retained confirmation dialog');
        assert.match(dialog.message(), /Restore from saved draft/, 'saved draft confirmation is shown');
        const whileDialog = await fixtureState({state: 1}, 'draft state while restore dialog is open');
        assert.deepEqual(whileDialog, seeded, 'opening alternate-login GET does not mutate saved draft state');
        await dialog.dismiss();
        await restoreNavigation;

        if (process.env.UPDATE_ALTLOGIN_INTENTIONAL_FAIL) {
            throw Error('intentional alternate-login cleanup failure');
        }

        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        console.log('PASS alternate-login browser');
    }
    finally {
        try {
            if (browser) await browser.close();
        }
        finally {
            try {
                await stop(server, serverDone);
            }
            finally {
                if (fixture) {
                    if (fixture.exitCode === null && !fixture.stdin.destroyed) fixture.stdin.end();
                    await fixtureDone;
                }
            }
        }
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});

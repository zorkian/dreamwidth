// Browser acceptance for public authenticated update share GET activation.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');
const port = Number(process.env.UPDATE_SHARE_PUBLIC_PORT || 18144);
const output = process.argv[2] || '/tmp/update-share-public-browser';

function unusedPort() {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            reject(Error(`share port ${port} occupied`));
        });
        socket.once('error', error => {
            socket.destroy();
            error.code === 'ECONNREFUSED' ? resolve() : reject(error);
        });
    });
}

function waitPort() {
    return new Promise((resolve, reject) => {
        const end = Date.now() + 15000;
        const connect = () => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            socket.once('error', () => {
                socket.destroy();
                Date.now() > end ? reject(Error('public share server did not listen')) : setTimeout(connect, 100);
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
    const queue = [];
    const waiters = [];
    let stopped;

    const drain = () => {
        while (queue.length && waiters.length) {
            waiters.shift().resolve(queue.shift());
        }
    };

    child.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            queue.push(buffer.slice(0, newline));
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
        if (queue.length) return resolve(queue.shift());
        waiters.push({resolve, reject});
    });
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

        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/update-get-fixture.pl'], {
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        fixtureDone = childDone(fixture, 'fixture');
        const next = lines(fixture, fixtureDone);
        const startup = JSON.parse(await Promise.race([
            next(),
            fixtureDone.then(() => Promise.reject(Error('fixture exited before startup'))),
        ]));

        server = spawn(
            'perl',
            [process.env.LJHOME + '/t/browser/update-share-public-server.pl', String(port)],
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

        fixture.stdin.write(JSON.stringify({state: 1}) + '\n');
        const before = JSON.parse(await Promise.race([next(), fixtureDone]));

        for (const width of [1280, 390]) {
            await page.setViewport({width, height: 844});
            await page.goto(
                `http://127.0.0.1:${port}/update?share=https%3A%2F%2Fexample.invalid%2Finput&prop_taglist=browser-tag&encoded=a%2Fb&repeated=one&repeated=two`,
                {waitUntil: 'networkidle0'},
            );
            await page.waitForSelector('#js-post-entry');

            assert.equal(await page.title(), 'Post an Entry');
            assert.equal(await page.$eval('[name=subject]', element => element.value), 'Browser shared title');
            assert.match(
                await page.$eval('[name=event]', element => element.value),
                /https:\/\/example\.invalid\/browser-share/,
            );
            assert.equal(await page.$eval('[name=taglist]', element => element.value), 'browser-tag');
            assert.equal(await page.$eval('[name=editor]', element => element.value), 'rte0');
            assert.match(await page.$eval('#js-post-entry', element => element.action), /\/entry\/new\?share=/);

            const usable = await page.$eval('[name=subject]', element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
            });
            assert.ok(usable, `subject usable ${width}`);
            await page.screenshot({path: `${output}/share-${width}.png`, fullPage: true});
        }

        fixture.stdin.write(JSON.stringify({state: 1}) + '\n');
        const after = JSON.parse(await Promise.race([next(), fixtureDone]));
        assert.deepEqual(after, before, 'share GET leaves draft/editor state unchanged');

        if (process.env.UPDATE_SHARE_INTENTIONAL_FAIL) {
            throw Error('intentional public share cleanup failure');
        }

        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        console.log('PASS public update share browser');
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

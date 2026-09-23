// Browser acceptance for callable alternate-login error rerendering.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');
const port = Number(process.env.UPDATE_ALTLOGIN_RERENDER_PORT || 18156);
const output = process.argv[2] || '/tmp/update-altlogin-rerender-browser';
function unusedPort() { return new Promise((resolve,reject) => { const s=net.connect(port,'127.0.0.1'); s.once('connect',()=>{s.destroy();reject(Error('rerender port occupied'));}); s.once('error',e=>{s.destroy();e.code==='ECONNREFUSED'?resolve():reject(e);}); }); }
function waitPort() { return new Promise((resolve,reject) => { const end=Date.now()+15000; const f=()=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve();});s.once('error',()=>{s.destroy();Date.now()>end?reject(Error('rerender server did not listen')):setTimeout(f,100);});};f(); }); }
function childDone(c,label) { return new Promise((resolve,reject)=>{c.once('error',reject);c.once('exit',(code,signal)=>code===0&&!signal?resolve({code,signal}):reject(Error(`${label} exit ${code}/${signal||'none'}`)));}); }
function lines(c,done) { let buf='', terminal, q=[], w=[]; const drain=()=>{while(q.length&&w.length)w.shift().resolve(q.shift());}; c.stdout.on('data',x=>{buf+=x;let i;while((i=buf.indexOf('\n'))>=0){q.push(buf.slice(0,i));buf=buf.slice(i+1);}drain();}); done.then(()=>{terminal=Error('fixture EOF');while(w.length)w.shift().reject(terminal);},e=>{terminal=e;while(w.length)w.shift().reject(e);}); return ()=>new Promise((resolve,reject)=>{if(terminal)return reject(terminal);if(q.length)return resolve(q.shift());w.push({resolve,reject});}); }
async function stop(c,done,label) { if(!c)return; if(c.exitCode===null)c.kill('SIGTERM'); try {await done;} catch(e) {if(!e.message.includes('SIGTERM'))throw e;} }
async function state(next,done){return JSON.parse(await Promise.race([next(),done.then(()=>Promise.reject(Error('fixture ended before state')))]));}
async function visible(page,selector,width){await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));const box=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,iw:innerWidth,ih:innerHeight};});assert.ok(box.w>0&&box.left>=0&&box.right<=box.iw&&box.top>=0&&box.bottom<=box.ih,`${selector} visible at ${width}`);}
async function loadRerender(page, url, requestState, before, width) {
    const dialogPromise = new Promise(resolve => page.once('dialog', resolve));
    const navigation = page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
    const dialog = await Promise.race([
        dialogPromise,
        navigation.then(() => Promise.reject(Error('missing saved-draft dialog'))),
    ]);

    assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /saved draft/i);
    assert.deepEqual(
        await requestState(), before,
        `draft/editor state remains persisted while the ${width}px restore dialog is open`,
    );
    await dialog.dismiss();
    return navigation;
}

(async () => {
    let fixture, server, browser, fixtureDone, serverDone;
    const errors = [];
    const fails = [];

    try {
        fs.mkdirSync(output, {recursive: true});
        await unusedPort();
        fixture = spawn('perl', [process.env.LJHOME + '/t/browser/update-altlogin-rerender-fixture.pl'], {
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        fixtureDone = childDone(fixture, 'fixture');
        fixtureDone.catch(() => {});
        const next = lines(fixture, fixtureDone);
        const startup = JSON.parse(await Promise.race([
            next(),
            fixtureDone.then(() => Promise.reject(Error('fixture exited before startup'))),
        ]));

        server = spawn(
            'perl',
            [process.env.LJHOME + '/t/browser/update-altlogin-rerender-server.pl', String(port)],
            {stdio: ['ignore', 'ignore', 'inherit']},
        );
        serverDone = childDone(server, 'server');
        serverDone.catch(() => {});
        await Promise.race([
            waitPort(),
            serverDone.then(() => Promise.reject(Error('server exited early'))),
        ]);

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox'],
        });
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(`${page.url()} ${error.stack || error.message}`));
        page.on('requestfailed', request => fails.push(request.url()));
        page.on('response', response => {
            if (response.status() >= 400) fails.push(`${response.status()}:${response.url()}`);
        });

        await page.goto(`http://127.0.0.1:${port}/mobile/login`, {waitUntil: 'networkidle0'});
        await page.type('[name=user]', startup.user);
        await page.type('[name=password]', startup.password);
        await Promise.all([
            page.waitForNavigation({waitUntil: 'networkidle0'}),
            page.click('[type=submit]'),
        ]);

        const requestState = async command => {
            fixture.stdin.write(JSON.stringify(command || {state: 1}) + '\n');
            return state(next, fixtureDone);
        };
        const url = `http://127.0.0.1:${port}/__test_altlogin_rerender?user=${encodeURIComponent(startup.poster)}`;

        for (const width of [1280, 390]) {
            const before = await requestState({seed_draft: 1});
            assert.equal(before.session.draft, '"A draft"');
            assert.equal(before.poster.draft, '"B draft"');
            await page.setViewport({width, height: 844});
            const response = await loadRerender(page, url, requestState, before, width);
            const rawMarkup = await response.text();
            await page.waitForSelector('#altlogin_wrapper');
            assert.equal(await page.$eval('#altlogin_username', element => element.value), startup.poster);
            assert.equal(await page.$eval('#altlogin_password', element => element.value), '');
            assert.equal(
                await page.$eval('#altlogin_wrapper', element => element.closest('.js-only')),
                null,
            );
            assert.equal(
                await page.$eval('#js-post-entry', element => element.action),
                `http://127.0.0.1:${port}/update?altlogin=1`,
            );
            assert.ok(await page.$('[name="action:update"]'));
            assert.equal(await page.$('[name="action:post"]'), null);
            assert.equal(await page.$('.crosspost-component'), null);
            assert.equal(await page.$eval('[name=subject]', element => element.value), 'Browser alternate subject');
            assert.equal(await page.$eval('[name=event]', element => element.value), 'Browser alternate body');
            assert.equal(await page.$eval('[name=security]', element => element.value), 'access');
            await page.waitForFunction(() => document.querySelector('[name=entrytime_date]'));
            assert.match(rawMarkup, /(?:name="entrytime_date"[^>]*value="not-a-year-02-03"|value="not-a-year-02-03"[^>]*name="entrytime_date")/);
            const initializedDate = await page.$eval('[name=entrytime_date]', element => {
                const zeropad = n => (n < 10 ? '0' + n : String(n));
                const d = new Date();
                return {
                    value: element.value,
                    today: [d.getFullYear(), zeropad(d.getMonth() + 1), zeropad(d.getDate())].join('-'),
                    trusted: document.querySelector('#js-trust-datetime').value,
                };
            });
            // Native initialization replaces an untrusted legacy timestamp with local today;
            // compute the expected value from local date components, not UTC, to match
            // htdocs/js/pages/entry/new.js's setTimeToNow().
            assert.equal(initializedDate.value, initializedDate.today);
            assert.equal(initializedDate.trusted, '1');
            assert.match(await page.$eval('body', element => element.innerText), /browser alternate-login retry marker/);
            assert.equal(await page.$$eval('.alert-box.alert', elements => elements.length), 1);
            await visible(page, '#altlogin_username', width);
            await visible(page, '#altlogin_password', width);
            await visible(page, '[name="action:update"]', width);
            await page.screenshot({path: `${output}/rerender-${width}.png`, fullPage: true});
        }

        if (process.env.UPDATE_ALTLOGIN_RERENDER_INTENTIONAL_FAIL) {
            throw Error('intentional alternate-login rerender cleanup failure');
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(fails, []);
        console.log('PASS alternate-login rerender browser');
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            try {
                await stop(server, serverDone, 'server');
            } finally {
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

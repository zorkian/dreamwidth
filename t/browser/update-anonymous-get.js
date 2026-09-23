// Browser acceptance for the callable-only anonymous retained update GET renderer.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = 18098;
const output = process.argv[2] || '/tmp/update-anonymous-get-browser';
let fixture;
let server;
let browser;
let fixtureDone;
let serverDone;
let buffer = '';
const lines = [];
const waiters = [];

function drain() {
  while (lines.length && waiters.length) waiters.shift().resolve(lines.shift());
}

function nextLine() {
  return new Promise((resolve, reject) => {
    waiters.push({resolve, reject});
    drain();
  });
}

async function fixtureJSON(label) {
  const line = await Promise.race([
    nextLine(),
    fixtureDone.then(() => Promise.reject(Error(`fixture exited before ${label}`))),
  ]);
  return JSON.parse(line);
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      reject(Error(`port ${port} occupied`));
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
    const check = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        Date.now() > deadline ? reject(Error('server did not listen')) : setTimeout(check, 100);
      });
    };
    check();
  });
}

async function stop(child, done, label) {
  if (!child) return;
  if (child.exitCode === null) child.kill('SIGTERM');
  const result = await done;
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw Error(`${label} cleanup failed: ${result.code}/${result.signal}`);
  }
}

(async () => {
  const errors = [];
  const failures = [];
  try {
    await unusedPort();
    fixture = spawn('perl', [process.env.LJHOME + '/t/browser/update-anonymous-get-fixture.pl'],
      {stdio: ['pipe', 'pipe', 'inherit']});
    fixtureDone = new Promise((resolve, reject) => {
      fixture.once('exit', (code, signal) => {
        code === 0 ? resolve({code, signal}) : reject(Error(`fixture exit ${code}/${signal}`));
      });
      fixture.once('error', reject);
    });
    fixtureDone.catch(() => {});
    fixture.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      drain();
    });
    const startup = await fixtureJSON('startup JSON');
    const before = startup.state;

    server = spawn('perl', [process.env.LJHOME + '/t/browser/update-anonymous-get-server.pl', String(port)],
      {stdio: ['ignore', 'ignore', 'inherit']});
    serverDone = new Promise((resolve, reject) => {
      server.once('exit', (code, signal) => resolve({code, signal}));
      server.once('error', reject);
    });
    await Promise.race([
      waitPort(),
      serverDone.then(result => Promise.reject(Error(`server exited early: ${JSON.stringify(result)}`))),
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

    const query = [
      'subject=hello%20%3Csubject%3E%20%26%20%22quote%22',
      'event=%3Cstrong%3Ebody%3C%2Fstrong%3E%20%26%20%22quote%22',
      'prop_taglist=tag%20%3Ctag%3E%20%26%20%22quote%22',
      'user=anon%20%3Cuser%3E%20%26%20%22quote%22',
      `usejournal=${encodeURIComponent(startup.target)}`,
      'repeated=first',
      'repeated=second',
    ].join('&');
    for (const width of [1280, 390]) {
      await page.setViewport({width, height: 844});
      await page.goto(`http://127.0.0.1:${port}/__test/anonymous-update?${query}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForSelector('#js-post-entry');
      await page.waitForFunction(() => {
        const editor = window.FCKeditorAPI && window.FCKeditorAPI.GetInstance('entry-body');
        return editor && editor.Status === 2;
      }, {timeout: 15000});
      assert.equal(await page.title(), 'Anonymous browser legacy title');
      assert.equal(await page.$eval('#js-post-entry', form => form.action),
        `http://127.0.0.1:${port}/__test/anonymous-update-submit`);
      assert.equal(await page.$eval('[name=subject]', element => element.value),
        'hello <subject> & "quote"');
      assert.equal(await page.$eval('[name=event]', element => element.value),
        '<strong>body</strong> & "quote"');
      assert.equal(await page.$eval('[name=taglist]', element => element.value),
        'tag <tag> & "quote"');
      assert.equal(await page.$eval('input[name=username][type=text]', element => element.value),
        'anon <user> & "quote"');
      assert.equal(await page.$eval('input[name=password][type=password]', element => element.value), '');
      assert.equal(await page.$eval('#editor', element => element.value), 'rte0');
      assert.equal(await page.evaluate(() => window.FCKeditorAPI.GetInstance('entry-body').GetXHTML()),
        '<strong>body</strong> &amp; &quot;quote&quot;');
      assert.equal(await page.$eval('[name=usejournal]', element => element.value), startup.target);
      const visible = await page.evaluate(() => {
        const subject = document.querySelector('[name=subject]');
        const editor = FCKeditorAPI.GetInstance('entry-body');
        const iframe = editor.EditorDocument.defaultView.frameElement;
        const login = document.querySelector('#js-post-entry-login');
        const usable = element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
        };
        return {
          subject: usable(subject),
          editor: usable(iframe),
          loginHidden: login && !usable(login),
        };
      });
      assert.ok(visible.subject, `subject control usable at ${width}`);
      assert.ok(visible.editor, `RTE iframe usable at ${width}`);
      assert.ok(visible.loginHidden, `anonymous login modal remains closed at ${width}`);
      await page.screenshot({path: `${output}/anonymous-update-${width}.png`, fullPage: true});
    }

    fixture.stdin.write(JSON.stringify({state: 1}) + '\n');
    const after = (await fixtureJSON('state response')).state;
    assert.deepEqual(after, before, 'anonymous GET does not mutate disposable draft or editor state');
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    if (process.env.ANONYMOUS_UPDATE_INTENTIONAL_FAIL) {
      throw Error('intentional anonymous update cleanup failure');
    }
    console.log('PASS anonymous update GET browser');
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

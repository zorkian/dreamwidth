// Browser acceptance for public legacy /update terminal responses.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');
const port = 18094;
const output = process.argv[2] || '/tmp/update-terminal-browser';
let fixture, server, browser, fixtureDone, serverDone;
let buffer = ''; const lines = []; const waiters = [];
function drain() { while (lines.length && waiters.length) waiters.shift().resolve(lines.shift()); }
function nextLine() { return new Promise((resolve, reject) => { waiters.push({resolve, reject}); drain(); }); }
function unusedPort() { return new Promise((resolve, reject) => { const s=net.connect(port,'127.0.0.1'); s.once('connect',()=>{s.destroy();reject(Error(`port ${port} occupied`));}); s.once('error',e=>{s.destroy();e.code==='ECONNREFUSED'?resolve():reject(e);}); }); }
function waitPort() { return new Promise((resolve,reject)=>{ const until=Date.now()+15000; const go=()=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve();});s.once('error',()=>{s.destroy();Date.now()>until?reject(Error('server did not listen')):setTimeout(go,100);});};go();}); }
async function stop(child, done, name) { if (!child) return; if (child.exitCode === null) child.kill('SIGTERM'); const result=await done; if (result.code !== 0 && result.signal !== 'SIGTERM') throw Error(`${name} cleanup failed: ${result.code}/${result.signal}`); }
(async () => {
  const errors=[]; const failures=[];
  try {
    await unusedPort();
    fixture=spawn('perl',[process.env.LJHOME+'/t/browser/update-get-fixture.pl'],{stdio:['pipe','pipe','inherit']});
    fixtureDone=new Promise((resolve,reject)=>{fixture.once('exit',(code,signal)=>code===0?resolve({code,signal}):reject(Error(`fixture exit ${code}/${signal}`)));fixture.once('error',reject);}); fixtureDone.catch(()=>{});
    fixture.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(buffer.slice(0,i));buffer=buffer.slice(i+1);}drain();});
    const startup=JSON.parse(await nextLine());
    server=spawn('perl',[process.env.LJHOME+'/t/browser/update-terminal-server.pl',String(port)],{stdio:['ignore','ignore','inherit']});
    serverDone=new Promise((resolve,reject)=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',reject);});
    await Promise.race([waitPort(),serverDone.then(r=>Promise.reject(Error(`server exited early: ${JSON.stringify(r)}`)))]);
    browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome-stable',args:['--no-sandbox']});
    const page=await browser.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('requestfailed',r=>failures.push(r.url())); page.on('response',r=>{if(r.status()>=400) failures.push(`${r.status()}:${r.url()}`);});
    fs.mkdirSync(output,{recursive:true});
    await page.goto(`http://127.0.0.1:${port}/mobile/login`,{waitUntil:'domcontentloaded',timeout:15000});
    await page.type('[name=user]',startup.user); await page.type('[name=password]',startup.password);
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('[type=submit]')]);
    for (const [variant,title,message] of [['identity','Sorry',/Non-.*users can't post entries/],['cantpost',"Can't Post", /Configured cannot post/]]) {
      for (const width of [1280,390]) {
        await page.setViewport({width,height:844});
        await page.goto(`http://127.0.0.1:${port}/update?${variant}=1`,{waitUntil:'networkidle0',timeout:15000});
        assert.equal(await page.title(),title); assert.equal(await page.$('#js-post-entry'),null); assert.equal(await page.$('#updateForm'),null);
        const text=await page.$eval('#content',e=>e.innerText); assert.match(text,message);
        const usable=await page.$eval('#content',e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;}); assert.ok(usable,`${variant} content usable at ${width}`);
        await page.screenshot({path:`${output}/${variant}-${width}.png`,fullPage:true});
      }
    }
    if (process.env.UPDATE_TERMINAL_INTENTIONAL_FAIL) throw Error('intentional update terminal cleanup failure');
    assert.deepEqual(errors,[]); assert.deepEqual(failures,[]); console.log('PASS update terminal browser');
  } finally { try { if(browser) await browser.close(); } finally { try { await stop(server,serverDone,'server'); } finally { if(fixture){fixture.stdin.end();await fixtureDone;} } } }
})().catch(error=>{console.error(error);process.exit(1)});

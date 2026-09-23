// Browser acceptance for the callable-only retained update GET wrapper.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = 18092;
const output = process.argv[2] || '/tmp/update-get-browser';
let fixture, server, browser, fixtureDone, serverDone;
let buffer = ''; const lines = [], waiters = [];
function drain() { while (lines.length && waiters.length) waiters.shift().resolve(lines.shift()); }
function nextLine() { return new Promise((resolve, reject) => { waiters.push({resolve, reject}); drain(); }); }
async function fixtureJSON(label) { try { return JSON.parse(await Promise.race([nextLine(), fixtureDone])); } catch (e) { throw Error(`${label}: ${e.message}`); } }
function unusedPort() { return new Promise((resolve, reject) => { const s=net.connect(port,'127.0.0.1'); s.once('connect',()=>{s.destroy();reject(Error(`port ${port} occupied`));}); s.once('error',e=>{s.destroy(); e.code==='ECONNREFUSED'?resolve():reject(e);}); }); }
function waitPort() { return new Promise((resolve,reject)=>{ const end=Date.now()+15000; const go=()=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve();});s.once('error',()=>{s.destroy();Date.now()>end?reject(Error('server did not listen')):setTimeout(go,100);});};go();}); }
async function stop(child, done, label) { if (!child) return; if (child.exitCode === null) child.kill('SIGTERM'); const r=await done; if (r.code !== 0 && r.signal !== 'SIGTERM') throw Error(`${label} cleanup failed: ${r.code}/${r.signal}`); }
(async () => {
  const errors=[], failures=[];
  try {
    await unusedPort();
    fixture=spawn('perl',[process.env.LJHOME+'/t/browser/update-get-fixture.pl'],{stdio:['pipe','pipe','inherit']});
    fixtureDone=new Promise((resolve,reject)=>{fixture.once('exit',(code,signal)=>code===0?resolve({code,signal}):reject(Error(`fixture exit ${code}/${signal}`)));fixture.once('error',reject);}); fixtureDone.catch(()=>{});
    fixture.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(buffer.slice(0,i));buffer=buffer.slice(i+1);}drain();});
    const data=await fixtureJSON('fixture startup');
    const state=async command=>{fixture.stdin.write(JSON.stringify(command||{state:1})+'\n');return fixtureJSON('fixture state');};
    server=spawn('perl',[process.env.LJHOME+'/t/browser/update-get-server.pl',String(port)],{stdio:['ignore','ignore','inherit']});
    serverDone=new Promise(resolve=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',error=>resolve({error}));});
    await Promise.race([waitPort(),serverDone.then(r=>Promise.reject(Error(`server exited early: ${JSON.stringify(r)}`)))]);
    browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome-stable',args:['--no-sandbox']});
    const page=await browser.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('requestfailed',r=>failures.push(r.url())); page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()}:${r.url()}`);}); fs.mkdirSync(output,{recursive:true});
    await page.goto(`http://127.0.0.1:${port}/mobile/login`,{waitUntil:'domcontentloaded',timeout:15000}); await page.type('[name=user]',data.user); await page.type('[name=password]',data.password); await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('[type=submit]')]);
    const before=await state();
    const path='/update?subject=raw&event=raw&prop_taglist=raw&encoded=one%2Ftwo&repeated=a&repeated=b';
    for(const width of [1280,390]) { await page.setViewport({width,height:844}); await page.goto(`http://127.0.0.1:${port}${path}`,{waitUntil:'domcontentloaded',timeout:15000}); await page.waitForSelector('#js-post-entry'); assert.equal(await page.$eval('[name=subject]',e=>e.value),'raw'); assert.equal(await page.$eval('[name=event]',e=>e.value),'raw'); assert.equal(await page.$eval('[name=taglist]',e=>e.value),'raw'); assert.equal(await page.$eval('#editor',e=>e.value),'rte0'); assert.equal(await page.$eval('#js-post-entry',e=>e.action),`http://127.0.0.1:${port}/entry/new?subject=raw&event=raw&prop_taglist=raw&encoded=one%2Ftwo&repeated=a&repeated=b`); const usable=await page.$eval('#js-post-entry',e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;});assert.ok(usable,`form usable at ${width}`);await page.screenshot({path:`${output}/update-get-${width}.png`,fullPage:true}); }
    assert.deepEqual(await state(),before,'GET preserves draft and editor properties before draft interaction');
    await state({seed_draft:1});
    const dialogPromise=new Promise(resolve=>page.once('dialog',resolve));
    const restoreNavigation=page.goto(`http://127.0.0.1:${port}${path}`,{waitUntil:'domcontentloaded',timeout:15000});
    const dialog=await dialogPromise;
    assert.match(dialog.message(),/Restore from saved draft/);
    assert.equal((await state()).draft, '"update GET draft"', 'saved draft remains persisted while restore dialog is open');
    await dialog.dismiss();
    await restoreNavigation;

    if(process.env.UPDATE_GET_INTENTIONAL_FAIL) throw Error('intentional update GET cleanup failure'); assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS update GET browser');
  } finally { try { if(browser) await browser.close(); } finally { try { await stop(server,serverDone,'server'); } finally { if(fixture){fixture.stdin.end();await fixtureDone;} } } }
})().catch(e=>{console.error(e);process.exit(1)});

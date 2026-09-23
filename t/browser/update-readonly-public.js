// Browser acceptance for public retained readonly /update GET rendering.
// Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const puppeteer = require('/opt/dw-screenshot/node_modules/puppeteer-core');

const port = 18097;
const output = process.argv[2] || '/tmp/update-readonly-public-browser';
let fixture, server, browser, fixtureDone, serverDone;
let buffer = ''; const lines = []; const waiters = [];
function drain() { while (lines.length && waiters.length) waiters.shift().resolve(lines.shift()); }
function nextLine() { return new Promise((resolve, reject) => { waiters.push({resolve, reject}); drain(); }); }
function unusedPort() { return new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();reject(Error(`port ${port} occupied`));});s.once('error',e=>{s.destroy();e.code==='ECONNREFUSED'?resolve():reject(e);});}); }
function waitPort() { return new Promise((resolve,reject)=>{const end=Date.now()+15000;const go=()=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve();});s.once('error',()=>{s.destroy();Date.now()>end?reject(Error('server did not listen')):setTimeout(go,100);});};go();}); }
async function stop(child, done, label) { if (!child) return; if (child.exitCode === null) child.kill('SIGTERM'); const result=await done; if (result.code !== 0 && result.signal !== 'SIGTERM') throw Error(`${label} cleanup failed: ${result.code}/${result.signal}`); }
(async () => {
  const errors=[]; const failures=[];
  try {
    await unusedPort();
    fixture=spawn('perl',[process.env.LJHOME+'/t/browser/update-readonly-public-fixture.pl'],{stdio:['pipe','pipe','inherit']});
    fixtureDone=new Promise((resolve,reject)=>{fixture.once('exit',(code,signal)=>code===0?resolve({code,signal}):reject(Error(`fixture exit ${code}/${signal}`)));fixture.once('error',reject);}); fixtureDone.catch(()=>{});
    fixture.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(buffer.slice(0,i));buffer=buffer.slice(i+1);}drain();});
    const startup=JSON.parse(await Promise.race([nextLine(),fixtureDone.then(()=>Promise.reject(Error('fixture exited before startup JSON')))]));
    server=spawn('perl',[process.env.LJHOME+'/t/browser/update-get-server.pl',String(port)],{stdio:['ignore','ignore','inherit']});
    serverDone=new Promise((resolve,reject)=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',reject);});
    await Promise.race([waitPort(),serverDone.then(result=>Promise.reject(Error(`server exited early: ${JSON.stringify(result)}`)))]);
    browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome-stable',args:['--no-sandbox']});
    const page=await browser.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('requestfailed',r=>failures.push(r.url())); page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()}:${r.url()}`);}); fs.mkdirSync(output,{recursive:true});
    await page.goto(`http://127.0.0.1:${port}/mobile/login`,{waitUntil:'domcontentloaded',timeout:15000}); await page.type('[name=user]',startup.user); await page.type('[name=password]',startup.password); await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('[type=submit]')]);
    fixture.stdin.write(JSON.stringify({state:1})+'\n');
    const before=JSON.parse(await nextLine());
    for (const width of [1280,390]) { await page.setViewport({width,height:844}); await page.goto(`http://127.0.0.1:${port}/update?readonly=1&subject=readonly-subject&event=readonly-body`,{waitUntil:'networkidle0',timeout:15000}); await page.waitForSelector('#js-post-entry'); assert.equal(await page.$eval('[name=subject]',e=>e.value),'readonly-subject'); assert.equal(await page.$eval('[name=event]',e=>e.value),'readonly-body'); const warning=await page.$$eval('.alert-box',els=>els.map(e=>e.innerText).find(text=>/read-only mode/i.test(text))); assert.match(warning,/Warning:.*read-only mode/s); const visible=await page.$$eval('.alert-box',els=>{const e=els.find(element=>/read-only mode/i.test(element.innerText));if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;});assert.ok(visible,`warning usable at ${width}`); const formVisible=await page.$eval('#js-post-entry',e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;});assert.ok(formVisible,`form usable at ${width}`);await page.screenshot({path:`${output}/readonly-${width}.png`,fullPage:true}); }
    fixture.stdin.write(JSON.stringify({state:1})+'\n'); const after=JSON.parse(await nextLine()); assert.deepEqual(after,before,'readonly GET leaves draft and editor state unchanged');
    if(process.env.UPDATE_READONLY_PUBLIC_INTENTIONAL_FAIL) throw Error('intentional public readonly cleanup failure'); assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS public update readonly browser');
  } finally { try { if(browser) await browser.close(); } finally { try { await stop(server,serverDone,'server'); } finally { if(fixture){if(fixture.exitCode===null&&!fixture.stdin.destroyed)fixture.stdin.end();await fixtureDone;} } } }
})().catch(error=>{console.error(error);process.exit(1)});

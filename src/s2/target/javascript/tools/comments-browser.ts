// comments-browser.ts
//
// Representative actual comment read expansion with finite stock resource interception.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";

export async function commentsBrowser(html:string,port:number,fixtureImages:ReadonlyMap<string,Buffer>=new Map()):Promise<void> {
    const output=process.env.S2_COMMENTS_BROWSER_OUTPUT;
    if(!output) return;
    const appOrigin="http://localhost:8080";
    const pageUrl=`http://localhost:${port}/users/ordinary6/76801.html`;
    assert.ok(process.env.S2_COMMENTS_STOCK_PAGE,"Set S2_COMMENTS_STOCK_PAGE from current entry-comparison.json");
    const prior=readFileSync(process.env.S2_COMMENTS_STOCK_PAGE,"utf8");
    const style=(value:string)=>[...value.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/g)]
        .map(match=>match[1]!).filter(href=>/\/res\/[0-9]+\/stylesheet/.test(href));
    const expectedStyle=style(html),retainedStyle=style(prior);
    assert.equal(expectedStyle.length,1);assert.equal(retainedStyle.length,1);
    const assets=new Map<string,{body:Buffer;type:string;source:string}>();
    const requested=new Set<string>();
    const urls=[...html.matchAll(/<(?:link|script|img)\b[^>]*(?:href|src)=["']([^"']+)["']/g)]
        .filter(match=>!match[0].startsWith("<link") || /rel=["'](?:stylesheet|shortcut icon|icon|apple-touch-icon)["']/.test(match[0]))
        .map(match=>new URL(match[1]!.replaceAll("&amp;","&"),pageUrl));
    assert.ok(fixtureImages.size<=1,"Only the declared fixture picture");
    const imageUrls=new Set([...html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/g)]
        .map(match=>new URL(match[1]!.replaceAll("&amp;","&"),pageUrl).href));
    for(const [url,body] of fixtureImages) {
        const parsed=new URL(url);
        assert.ok(parsed.href===url&&!parsed.username&&!parsed.password&&
            [new URL(pageUrl).origin,appOrigin].includes(parsed.origin)&&imageUrls.has(url),
            "Fixture picture must match an exact emitted configured URL");
        assert.ok(body.length<=2048&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
            "Declared inert fixture PNG");
        assets.set(url,{body,type:"image/png",source:"declared inert fixture picture; no native binary route parity"});
    }
    const queue=urls.filter(url=>!assets.has(url.href));
    const siteMatch=/Site = Object\.assign\(Site, (\{[^\n]*\})\);/.exec(html);
    assert.ok(siteMatch,'Unique emitted stock Site configuration');
    const site=JSON.parse(siteMatch[1]!);assert.equal(typeof site.imgprefix,'string');
    // dw/dw-core.js $.throbber names these two finite local resources.
    queue.push(new URL(site.imgprefix+'/ajax-loader.gif',pageUrl),
        new URL(site.imgprefix+'/silk/site/error.png',pageUrl));
    for(let index=0;index<queue.length;index++) {
        assert.ok(queue.length<=100,"Bounded observed stock resource closure");
        const url=queue[index]!;if(assets.has(url.href))continue;
        assert.ok([new URL(pageUrl).origin,appOrigin].includes(url.origin),url.href);
        const source=url.href===new URL(expectedStyle[0]!,pageUrl).href ?
            new URL(retainedStyle[0]!.replaceAll("&amp;","&"),appOrigin):
            new URL(url.pathname+url.search,appOrigin);
        assert.equal(source.origin,appOrigin);
        assert.ok(source.pathname.includes("/res/") || /^\/(stc|js|img|palimg)\//.test(source.pathname),source.href);
        // Only the finite emitted/captured stock closure is fetched, from the retained local app.
        const response=await fetch(source.href.replace(appOrigin,"http://127.0.0.1:8080"),
            {headers:{Host:"localhost:8080"},redirect:"error"});
        assert.equal(response.status,200,source.href);
        const body=Buffer.from(await response.arrayBuffer());assert.ok(body.length<=5242880);
        const type=response.headers.get("content-type") || "application/octet-stream";
        assets.set(url.href,{body,type,source:source.href});
        if(type.includes("css")) for(const match of body.toString().matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
            if(match[1]!.startsWith("data:"))continue;
            queue.push(new URL(match[1]!,url));
        }
    }
    const {chromium}=require(path.resolve("../../../content/node_modules/playwright"));
    const browser=await chromium.launch({headless:true});
    const reports:unknown[]=[];
    try {
        for(const javaScriptEnabled of [false,true]) {
            const context=await browser.newContext({javaScriptEnabled,serviceWorkers:"block",viewport:{width:1280,height:900}});
            const failures:string[]=[],ajax:string[]=[],fallback:string[]=[],responses:unknown[]=[];
            const reply=new URL('/~ordinary6/76801.html?replyto=257',appOrigin).href;
            try {
                await context.routeWebSocket("**/*",(socket:any)=>{failures.push("websocket");socket.close();});
                await context.route("**/*",async(route:any)=>{
                    const request=route.request(),url=request.url();
                    if(url===pageUrl&&request.isNavigationRequest())return route.continue();
                    if(url===reply&&request.isNavigationRequest()) {
                        fallback.push(url);return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><p>Retained app reply fallback</p>'});
                    }
                    if([pageUrl+'?thread=1025&destination_thread=0',pageUrl+'?expand_all=1'].includes(url)&&!request.isNavigationRequest()) {
                        ajax.push(url);
                        const response=await route.fetch({maxRedirects:0});
                        const body=await response.body();assert.ok(body.length<=2097152);
                        responses.push({url,status:response.status(),body:body.toString('utf8')});
                        return route.fulfill({response});
                    }
                    const asset=assets.get(url);
                    if(!asset){failures.push(url);return route.abort();}
                    requested.add(url);return route.fulfill({status:200,contentType:asset.type,body:asset.body});
                });
                const page=await context.newPage();page.on('pageerror',(error:Error)=>failures.push(error.message));
                assert.equal((await page.goto(pageUrl,{waitUntil:'networkidle'})).status(),200);
                assert.equal(await page.locator('#qrform').count(),0);
                if(fixtureImages.size) {
                    const badge=page.locator('#cmt257 span.ljuser').first();
                    assert.ok((await badge.evaluate((node:Element)=>getComputedStyle(node).textDecorationLine)).includes('line-through'));
                    const icon=badge.locator('img').first();
                    assert.ok((await icon.getAttribute('src')).endsWith('/silk/identity/user_staff.png'));
                    assert.equal(await icon.getAttribute('width'),'17');assert.equal(await icon.getAttribute('height'),'17');
                    for(const url of fixtureImages.keys()) {
                        const dimensions=await page.locator('img').evaluateAll((images:HTMLImageElement[],source:string)=>{
                            const image=images.find(node=>node.src===source);
                            return image?[image.getAttribute('width'),image.getAttribute('height')]:null;
                        },url);
                        assert.deepEqual(dimensions,['40','30']);
                    }
                }
                assert.ok(!(await page.locator('body').innerText()).includes('Public body 4'));
                if(javaScriptEnabled) {
                    await page.locator('#cmt1025 a[onclick*="Expander.make"]').first().click();
                    await page.waitForFunction(()=>document.querySelector('#cmt1025')?.textContent?.includes('Public body 4'));
                    assert.ok(ajax.includes(pageUrl+'?thread=1025&destination_thread=0'));
                    assert.equal(await page.locator('#cmt257_hide a').textContent(),'Hide 2 comments');
                    await page.locator('#cmt257_hide a').click();
                    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#cmt513')!).display==='none');
                    assert.equal(await page.locator('#cmt257_unhide a').textContent(),'Show 2 comments');
                    await page.locator('#cmt257_unhide a').click();
                    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#cmt513')!).display!=='none');
                    // Reload the real page to exercise the distinct expand-all path.
                    await page.goto(pageUrl,{waitUntil:'networkidle'});
                    await page.locator('a[onclick*="-1,false"]').first().click();
                    await page.waitForFunction(()=>document.querySelector('#cmt1025')?.textContent?.includes('Public body 4'));
                    assert.ok(ajax.includes(pageUrl+'?expand_all=1'));
                } else {
                    assert.equal(await page.locator('#cmt1025 a[onclick*="Expander.make"]').first().getAttribute('href'),
                        appOrigin+'/~ordinary6/76801.html?thread=1025#cmt1025');
                    assert.deepEqual(ajax,[]);
                }
                for(const marker of ['PRIVATE_IP_MARKER','PRIVATE_NAME','IDENTITY_NAME'])
                    assert.ok(!(await page.content()).includes(marker));
                mkdirSync(output,{recursive:true});
                await page.screenshot({path:path.join(output,`comments-js-${javaScriptEnabled?'on':'off'}.png`),fullPage:true});
                await page.locator('#cmt257 a[href*="replyto=257"]').first().click();
                await page.waitForURL(reply);assert.deepEqual(fallback,[reply]);
                assert.deepEqual(failures,[]);
                reports.push({javaScriptEnabled,ajax,fallback,failures});
            }catch(error) {
                mkdirSync(output,{recursive:true});
                writeFileSync(path.join(output,'failure.json'),JSON.stringify({javaScriptEnabled,ajax,fallback,failures,responses},null,2)+'\n');
                throw error;
            }finally {await context.close();}
        }
        writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({pageUrl,pageSource:'actual-isolated-fixture-HTTP',
            engine:browser.version(),stylesheetMapping:{fixture:expectedStyle[0],retained:retainedStyle[0]},
            fixtureImages:[...fixtureImages].map(([url,body])=>({url,bytes:body.length,
                sha256:createHash('sha256').update(body).digest('hex'),adaptation:'inert PNG; layout and URL selection only'})),
            htmlSha256:createHash('sha256').update(html).digest('hex'),reports,
            assets:[...assets].map(([url,asset])=>({url,source:asset.source,sha256:createHash('sha256').update(asset.body).digest('hex')})),
            requested:[...requested]},null,2)+'\n');
    }finally {await browser.close();}
}

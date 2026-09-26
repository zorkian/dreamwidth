// editors-browser.ts
//
// Representative actual entry newline/link/style/cut display qualification.
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

export async function editorsBrowser(port:number, html:string):Promise<void> {
    const output=process.env.S2_EDITORS_BROWSER_OUTPUT;
    if(!output) return;
    const appOrigin="http://localhost:8080";
    const pageUrl=`http://localhost:${port}/users/ordinary6/76801.html`;
    assert.ok(process.env.S2_EDITORS_STOCK_PAGE,"Set S2_EDITORS_STOCK_PAGE from current entry-comparison.json");
    const prior=readFileSync(process.env.S2_EDITORS_STOCK_PAGE,"utf8");
    const style=(value:string)=>[...value.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/g)]
        .map(match=>match[1]!).filter(href=>/\/res\/[0-9]+\/stylesheet/.test(href));
    const expectedStyle=style(html),retainedStyle=style(prior);
    assert.equal(expectedStyle.length,1);assert.equal(retainedStyle.length,1);
    const assets=new Map<string,{body:Buffer;type:string;source:string}>();
    const requested=new Set<string>();
    const urls=[...html.matchAll(/<(?:link|script|img)\b[^>]*(?:href|src)=["']([^"']+)["']/g)]
        .filter(match=>!match[0].startsWith("<link") || /rel=["'](?:stylesheet|shortcut icon|icon|apple-touch-icon)["']/.test(match[0]))
        .map(match=>new URL(match[1]!.replaceAll("&amp;","&"),pageUrl));
    const queue=urls.filter(url=>!assets.has(url.href));
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
    const context=await browser.newContext({serviceWorkers:"block",viewport:{width:1280,height:900}});
    const failures:string[]=[];
    try {
        await context.routeWebSocket("**/*",(socket:any)=>{failures.push("websocket");socket.close();});
        await context.route("**/*",async(route:any)=>{
            const url=route.request().url();
            if(url===pageUrl && route.request().isNavigationRequest())return route.continue();
            if(url==="https://editor.slice16.invalid/?x=1&y=2" && route.request().isNavigationRequest())
                return route.fulfill({status:200,contentType:"text/plain",body:"Intercepted declared editor destination"});
            const asset=assets.get(url);
            if(!asset){failures.push(url);return route.abort();}
            requested.add(url);return route.fulfill({status:200,contentType:asset.type,body:asset.body});
        });
        const page=await context.newPage();page.on("pageerror",(error:Error)=>failures.push(error.message));
        assert.equal((await page.goto(pageUrl,{waitUntil:"networkidle"})).status(),200);
        const body=page.locator('.entry-content').first();
        assert.ok((await body.innerText()).includes('First\nStyled editor'));
        const state=await body.locator('b').filter({hasText:'Styled editor'}).evaluate((node:HTMLElement)=>{
            const style=getComputedStyle(node);return {color:style.color,weight:style.fontWeight};});
        assert.deepEqual(state,{color:'rgb(255, 0, 0)',weight:'700'});
        assert.ok((await body.innerText()).includes('Cut editor body'));
        assert.equal(await body.locator('a[name="cutid1"]').count(),1);
        const link=body.locator('a[href="https://editor.slice16.invalid/?x=1&y=2"]');
        assert.equal(await link.count(),1);
        const og=await page.locator('meta[property="og:description"]').getAttribute('content');
        assert.ok(og.includes('<br />'));assert.ok(!og.includes('cutid1'));
        mkdirSync(output,{recursive:true});
        await page.screenshot({path:path.join(output,'entry-editors.png'),fullPage:true});
        await link.click();await page.waitForURL('https://editor.slice16.invalid/?x=1&y=2');
        assert.deepEqual(failures,[]);
        mkdirSync(output,{recursive:true});
        writeFileSync(path.join(output,"browser.json"),JSON.stringify({pageUrl,fixtureStyle:44,
            htmlSha256:createHash("sha256").update(html).digest("hex"),
            retainedPageSha256:createHash("sha256").update(prior).digest("hex"),
            stylesheetMapping:{emitted:expectedStyle[0],retained:retainedStyle[0]},computedBody:state,
            bodyDestination:"https://editor.slice16.invalid/?x=1&y=2",
            resources:[...requested].map(url=>({url,source:assets.get(url)!.source,
                sha256:createHash("sha256").update(assets.get(url)!.body).digest("hex")})),failures},null,2)+"\n");
    }finally{await context.close();await browser.close();}
}

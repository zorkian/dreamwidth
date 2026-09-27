// styles-browser.test.ts
//
// Representative actual stock inline stylesheet with finite stock resource interception.
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

export async function stylesBrowser(html:string,port:number, layout?:"easyread", modules=false):Promise<void> {
    const baseOutput=process.env.S2_STYLES_BROWSER_OUTPUT;
    const output=baseOutput&&layout?path.join(baseOutput,layout+(modules?"-modules":"")):baseOutput;
    if(!output) return;
    const appOrigin="http://localhost:8080";
    const pageUrl=`http://localhost:${port}/users/ordinary6/76801.html`;
    assert.ok(!/\/res\/[0-9]+\/stylesheet/.test(html));
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
        const source=new URL(url.pathname+url.search,appOrigin);
        assert.equal(source.origin,appOrigin);
        assert.ok(/^\/(stc|js|img|palimg)\//.test(source.pathname),source.href);
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

            const asset=assets.get(url);
            if(!asset){failures.push(url);return route.abort();}
            requested.add(url);return route.fulfill({status:200,contentType:asset.type,body:asset.body});
        });
        const page=await context.newPage();page.on("pageerror",(error:Error)=>failures.push(error.message));
        assert.equal((await page.goto(pageUrl,{waitUntil:"networkidle"})).status(),200);
        const state=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,
            font:getComputedStyle(document.body).fontFamily,
            moduleFont:getComputedStyle(document.querySelector('.module-content')!).fontFamily,
            sectionOrder:[...document.querySelectorAll('#secondary,#primary,#tertiary')].map(node=>node.id),
            padding:getComputedStyle(document.querySelector('.entry .inner')!).padding,
            tags:document.querySelector('.module-tags_list, .module-tags_cloud, .module-tags_multilevel')?.textContent,
            moduleOrder:[...document.querySelectorAll(".module")].map(node=>node.className),
            calendar:document.querySelector(".module-calendar")?.textContent,
            tagAfterCredit:!!(document.querySelector('.module-credit')!.compareDocumentPosition(document.querySelector('.module-tags_list, .module-tags_cloud, .module-tags_multilevel')!)&Node.DOCUMENT_POSITION_FOLLOWING),
            journalStyles:[...document.querySelectorAll('link[rel=stylesheet]')].map(node=>(node as HTMLLinkElement).href).filter(url=>/\/res\//.test(url))}));
        assert.equal(state.background,'rgb(18, 52, 86)');
        if(layout==='easyread'){assert.equal(state.font,'"Times New Roman"');assert.ok(state.moduleFont.startsWith('Georgia'));assert.deepEqual(state.sectionOrder,['secondary','primary','tertiary']);}
        else{assert.ok(state.font.includes('Georgia'));assert.equal(state.padding,'8px');}
        assert.deepEqual(state.journalStyles,[]);
        assert.ok(state.tags?.includes('Visible tag'));
        if(modules) {
            assert.ok(state.calendar?.includes('2026'));
            const calendar=state.moduleOrder.findIndex((name:string)=>name.includes('module-calendar'));
            const summary=state.moduleOrder.findIndex((name:string)=>name.includes('module-pagesummary'));
            assert.ok(calendar>=0&&summary>calendar);assert.ok(!state.moduleOrder.some((name:string)=>name.includes('module-userprofile')));
        }else assert.equal(state.tagAfterCredit,true);
        mkdirSync(output,{recursive:true});
        await page.screenshot({path:path.join(output,"entry-styles.png"),fullPage:true});

        assert.deepEqual(failures,[]);
        mkdirSync(output,{recursive:true});
        writeFileSync(path.join(output,"browser.json"),JSON.stringify({pageUrl,fixtureStyle:44,
            htmlSha256:createHash("sha256").update(html).digest("hex"),
            retainedPageSha256:null,screenshot:path.join(output,"entry-styles.png"),
            stylesheetMapping:{inline:true,retainedJournalStylesheet:false},links:state,
            resources:[...requested].map(url=>({url,source:assets.get(url)!.source,
                sha256:createHash("sha256").update(assets.get(url)!.body).digest("hex")})),failures},null,2)+"\n");
    }finally{await context.close();await browser.close();}
}

// links-http.test.ts
//
// Actual owner links, stock worker and HTTP freshness qualification.
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
import test from "node:test";
import {request as httpRequest} from "node:http";
import {withSelectedFixture} from "./selected-fixture";
import {createAnonymousRecentService} from "../live/policy/service";
import {createLiveApp} from "../live/server/app";
import {linksBrowser} from "./links-browser";
import {Renderer} from "../live/render/child";
import {config,capabilities,limits} from "../live/tests/fixtures";
import type {RenderInput} from "../live/render/types";

function get(port:number,path:string):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port,path,headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),
                headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Links HTTP deadline")));call.on("error",reject);call.end();
    });
}

test("actual owner links and website reach both stock pages and revoke on persistent edits",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",
},async t=>withSelectedFixture(async f=>{
    const {admin,g,c,other,table,store}=f;
    await admin.query(`INSERT INTO ${table(c,"links")} (journalid,ordernum,parentnum,title,url,hover) VALUES
        (900001,1,0,'Heading',NULL,NULL),
        (900001,2,0,'Target','https://target.synthetic.invalid/?x=1&y=2',?),
        (900001,2,7,'Literal','?literal=&amp;#39;',NULL),
        (900001,3,0,'-',NULL,NULL)`,["A 'quote' & tea"]);
    await admin.query(`INSERT INTO ${table(other,"links")} (journalid,ordernum,title,url)
        VALUES (900002,2,'FOREIGN_SECRET_LINK','https://foreign.synthetic.invalid/')`);
    const setProp=async(name:string,value:string)=>{
        const [defs]=await admin.query<any[]>(`SELECT upropid,datatype FROM ${table(g,"userproplist")} WHERE name=?`,[name]);
        assert.equal(defs.length,1);assert.equal(defs[0].datatype,"char");
        await admin.query(`INSERT INTO ${table(c,"userproplite2")} (userid,upropid,value) VALUES (900001,?,CONVERT(? USING latin1))
            ON DUPLICATE KEY UPDATE value=VALUES(value)`,[defs[0].upropid,Buffer.from(value)]);
    };
    await setProp("url","/website?q=1&x=2");await setProp("urlname","Owner & website");
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);assert.equal(baseline.links.length,4);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
    const app=createLiveApp(config,service);
    try{
        await app.listen({host:"127.0.0.1",port:process.env.S2_LINKS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=="string");
        for(const path of ["/users/ordinary6/","/users/ordinary6/76801.html"]){
            const response=await get(address.port,path);assert.equal(response.status,200);
            assert.equal(response.headers["cache-control"],"private, no-store");
            assert.ok(response.body.includes("href='/website?q=1&amp;x=2'"));
            assert.ok(response.body.includes('title="A &#39;quote&#39; &amp; tea"'));
            assert.ok(!response.body.includes("FOREIGN_SECRET_LINK"));
            if(path.endsWith("html"))await linksBrowser(address.port,response.body);
        }
        assert.equal(await store.revalidateFingerprint(baseline),true);
        const render=Renderer.prototype.render;
        for(const feature of ["link","website"]){
            let changed=false;
            const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
                const html=await render.call(this,input);
                if(feature==="link")await admin.query(`UPDATE ${table(c,"links")} SET hover='Changed hover' WHERE journalid=900001 AND title='Target'`);
                else await setProp("urlname","Changed website");
                changed=true;return html;
            });
            try{const response=await get(address.port,"/users/ordinary6/76801.html");assert.equal(changed,true);assert.equal(response.status,409);}
            finally{hook.mock.restore();
                if(feature==="link")await admin.query(`UPDATE ${table(c,"links")} SET hover=? WHERE journalid=900001 AND title='Target'`,["A 'quote' & tea"]);
                else await setProp("urlname","Owner & website");}
            assert.equal(await store.revalidateFingerprint(baseline),true);
            assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,200);
        }
        for(const unsafe of ["javascript:1","data:text/html,x","/bad\ncontrol"]){
            await setProp("url",unsafe);assert.equal((await get(address.port,"/users/ordinary6/")).status,422);
        }
        await setProp("url","/website?q=1&x=2");
        await admin.query(`UPDATE ${table(c,"links")} SET url='data:text/html,x' WHERE journalid=900001 AND title='Target'`);
        assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,422);
        await admin.query(`UPDATE ${table(c,"links")} SET url='https://target.synthetic.invalid/?x=1&y=2' WHERE journalid=900001 AND title='Target'`);
        assert.equal(await store.revalidateFingerprint(baseline),true);
    }finally{await app.close();await service.close();}
}));

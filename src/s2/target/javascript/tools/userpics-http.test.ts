// userpics-http.test.ts
//
// Actual selected userpic SQL, stock worker and HTTP freshness qualification.
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
import {userpicBrowser} from "./userpic-browser";
import {Renderer} from "../live/render/child";
import {config,capabilities,limits} from "../live/tests/fixtures";
import type {RenderInput} from "../live/render/types";

function get(port:number,path:string):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port,path,headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),
                headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Userpic HTTP deadline")));call.on("error",reject);call.end();
    });
}

test("actual owner-scoped pictures render default and selected icons and revoke before release",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",
},async t=>withSelectedFixture(async f=>{
    const {admin,g,c,other,table,store}=f;
    await admin.query(`UPDATE ${table(g,"user")} SET defaultpicid=11 WHERE userid=900001`);
    await admin.query(`INSERT INTO ${table(c,"userpic2")} (userid,picid,width,height,state,description)
        VALUES (900001,11,100,80,'N','Default & description'),(900001,22,75,90,'N','Selected description')`);
    await admin.query(`INSERT INTO ${table(c,"userkeywords")} (userid,kwid,keyword) VALUES (900001,7,'chosen')`);
    await admin.query(`INSERT INTO ${table(c,"userpicmap3")} (userid,mapid,kwid,picid) VALUES (900001,1,7,22)`);
    await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value)
        VALUES (900001,300,?,'1'),(900001,302,?,'1')`,[f.logProp("picture_mapid"),f.logProp("picture_mapid")]);
    // Same numeric image ID in an unrelated configured cluster is never joined.
    await admin.query(`INSERT INTO ${table(other,"userpic2")} (userid,picid,width,height,state,description)
        VALUES (900002,22,200,200,'N','FOREIGN_SECRET_PICTURE')`);
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
    assert.equal(baseline.userpics.pictures.length,2);assert.equal(baseline.userpics.mappings.length,1);
    assert.equal(await store.loadRawSnapshot(f.request("ordinary6",{kind:"entry",ditemid:302*256+1})),null);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
    const app=createLiveApp(config,service);
    try {
        await app.listen({host:"127.0.0.1",port:process.env.S2_USERPIC_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=="string");
        const recent=await get(address.port,"/users/ordinary6/");
        const entry=await get(address.port,"/users/ordinary6/76801.html");
        for(const response of [recent,entry]){
            assert.equal(response.status,200);assert.equal(response.headers["cache-control"],"private, no-store");
            assert.ok(response.body.includes('/userpic/11/900001'));assert.ok(response.body.includes('/userpic/22/900001'));
            assert.ok(response.body.includes('ordinary6: Selected description (chosen)'));
            assert.ok(!response.body.includes('FOREIGN_SECRET_PICTURE'));
        }
        assert.ok(entry.body.includes('<meta property="og:image" content="/userpic/22/900001"/>'));
        assert.ok(entry.body.includes('height="90"'));assert.ok(entry.body.includes('width="75"'));
        await userpicBrowser(address.port,entry.body);
        assert.equal(await store.revalidateFingerprint(baseline),true);
        const render=Renderer.prototype.render;
        let changed=false;
        const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
            const html=await render.call(this,input);
            await admin.query(`UPDATE ${table(c,"userpic2")} SET description='Changed description'
                WHERE userid=900001 AND picid=22`);changed=true;return html;
        });
        try {
            const blocked=await get(address.port,"/users/ordinary6/76801.html");
            assert.equal(changed,true);assert.equal(blocked.status,409);
            assert.equal(blocked.body,"Journal changed during render\n");
            assert.equal(blocked.headers["set-cookie"],undefined);assert.equal(blocked.headers.location,undefined);
            assert.ok(!blocked.body.includes("Selected description"));
        } finally {
            hook.mock.restore();await admin.query(`UPDATE ${table(c,"userpic2")} SET description='Selected description'
                WHERE userid=900001 AND picid=22`);
        }
        assert.equal(await store.revalidateFingerprint(baseline),true);
        assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,200);
        // Configured unported URL hook affects only Entry OG helpers that need a picture.
        const hookService=await createAnonymousRecentService({repository:store,secretSource:store,
            config:{...config,userpicUrlHookConfigured:true},capabilities,limits,
            artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
        try {
            const req={method:"GET" as const,username:"ordinary6",uniqCookie:null};
            assert.equal((await hookService.serve({...req,skip:0,skipPresent:false})).ok,true);
            assert.deepEqual(await hookService.serveEntry({...req,ditemid:76801}),{ok:false,reason:"unsupported"});
        } finally {await hookService.close();}
    } finally {await app.close();await service.close();}
}));

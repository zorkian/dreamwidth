// tags-http.test.ts
//
// Actual public tag projection, stock worker and final SQL dependency rereads.
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
import {writeFileSync} from "node:fs";
import {request as httpRequest} from "node:http";
import {withSelectedFixture} from "./selected-fixture";
import {createAnonymousRecentService} from "../live/policy/service";
import {createLiveApp} from "../live/server/app";
import {tagsBrowser} from "./tags-browser";
import {Renderer} from "../live/render/child";
import {config,capabilities,limits} from "../live/tests/fixtures";
import type {RenderInput} from "../live/render/types";

function get(port:number,path:string):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port,path,headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),
                headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Tags HTTP deadline")));call.on("error",reject);call.end();
    });
}


test("actual public sidebar and selected associations stay isolated and revoke persistent changes",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",
},async t=>withSelectedFixture(async f=>{
    const {admin,c,other,table,store}=f;
    const names=["public café & 😀","SELECTED_PRIVATE_SUMMARY","DISPLAY_OFF_SELECTED","NEVER_PROJECT_PRIVATE_TAXONOMY","zero-public"];
    for(const [index,name] of names.entries()){
        await admin.query(`INSERT INTO ${table(c,"userkeywords")} (userid,kwid,keyword) VALUES (900001,?,CONVERT(? USING latin1))`,[index+1,Buffer.from(name)]);
        await admin.query(`INSERT INTO ${table(c,"usertags")} (journalid,kwid,display) VALUES (900001,?,?)`,[index+1,index===2?"0":"1"]);
    }
    await admin.query(`INSERT INTO ${table(c,"logkwsum")} (journalid,kwid,security,entryct) VALUES
        (900001,1,9223372036854775808,7),(900001,1,0,87654321),
        (900001,2,0,3),(900001,3,9223372036854775808,2),(900001,4,0,4),(900001,5,9223372036854775808,0)`);
    await admin.query(`INSERT INTO ${table(c,"logtags")} (journalid,jitemid,kwid) VALUES
        (900001,300,1),(900001,300,2),(900001,300,3),(900001,280,4),(900001,301,4),(900001,302,4)`);
    await admin.query(`INSERT INTO ${table(other,"userkeywords")} (userid,kwid,keyword) VALUES (900002,1,'FOREIGN_TAG_SECRET')`);
    await admin.query(`INSERT INTO ${table(other,"usertags")} (journalid,kwid) VALUES (900002,1)`);
    await admin.query(`INSERT INTO ${table(other,"logtags")} (journalid,jitemid,kwid) VALUES (900002,300,1)`);
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
    assert.equal(baseline.tags.definitions.length,5);assert.deepEqual(baseline.tags.associations.map(row=>row.jitemid),[300,300,300]);
    const artifact={path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"};
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,artifact});
    const app=createLiveApp(config,service);const render=Renderer.prototype.render;
    let childInputs=0;
    const capture=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
        const wire=JSON.stringify(input);assert.ok(!wire.includes("NEVER_PROJECT_PRIVATE_TAXONOMY"));
        assert.ok(!wire.includes("FOREIGN_TAG_SECRET"));assert.ok(!wire.includes("87654321"));
        assert.deepEqual(input.journal.sidebarTags.map(tag=>[tag.id,tag.count]),[[1,7],[5,0]]);
        assert.ok(input.journal.entries.some(entry=>entry.tags.some(tag=>tag.name==="SELECTED_PRIVATE_SUMMARY")));
        if(process.env.S2_TAGS_DIAGNOSTIC)writeFileSync(process.env.S2_TAGS_DIAGNOSTIC,wire);
        childInputs++;return render.call(this,input);
    });
    try{
        await app.listen({host:"127.0.0.1",port:process.env.S2_TAGS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=="string");
        for(const path of ["/users/ordinary6/","/users/ordinary6/76801.html"]){
            const response=await get(address.port,path);assert.equal(response.status,200);
            assert.equal(response.headers["cache-control"],"private, no-store");
            assert.ok(response.body.includes("SELECTED_PRIVATE_SUMMARY"));assert.ok(response.body.includes("DISPLAY_OFF_SELECTED"));
            assert.ok(response.body.includes("caf%C3%A9"));assert.ok(response.body.includes("zero-public"));
            assert.ok(!response.body.includes("NEVER_PROJECT_PRIVATE_TAXONOMY"));assert.ok(!response.body.includes("87654321"));
            if(path.endsWith("html"))await tagsBrowser(address.port,response.body);
        }
        assert.equal(childInputs,process.env.S2_TAGS_BROWSER_OUTPUT?3:2);capture.mock.restore();
        const target="/go?dir=next&itemid=76801&journal=ordinary6&redir_key="+encodeURIComponent(names[0]!);
        const go=await get(address.port,target);assert.equal(go.status,307);
        assert.equal(go.headers.location,config.canonicalAppOrigin+target);assert.equal(go.body,"");
        for(const id of [301,302]){const request=f.request("ordinary6",{kind:"entry",ditemid:id*256+1});
            assert.equal(await store.loadRawSnapshot(request),null);
            assert.equal((await get(address.port,`/users/ordinary6/${id*256+1}.html`)).status,404);}
        assert.equal(await store.revalidateFingerprint(baseline),true);
        const mutations=[
            ["hidden-summary",`UPDATE ${table(c,"logkwsum")} SET entryct=5 WHERE journalid=900001 AND kwid=4 AND security=0`,
                `UPDATE ${table(c,"logkwsum")} SET entryct=4 WHERE journalid=900001 AND kwid=4 AND security=0`],
            ["mask",`UPDATE ${table(c,"logkwsum")} SET security=1 WHERE journalid=900001 AND kwid=1 AND security=9223372036854775808`,
                `UPDATE ${table(c,"logkwsum")} SET security=9223372036854775808 WHERE journalid=900001 AND kwid=1 AND security=1`],
            ["count",`UPDATE ${table(c,"logkwsum")} SET entryct=8 WHERE journalid=900001 AND kwid=1 AND security=9223372036854775808`,
                `UPDATE ${table(c,"logkwsum")} SET entryct=7 WHERE journalid=900001 AND kwid=1 AND security=9223372036854775808`],
            ["name",`UPDATE ${table(c,"userkeywords")} SET keyword='CHANGED' WHERE userid=900001 AND kwid=2`,
                `UPDATE ${table(c,"userkeywords")} SET keyword='SELECTED_PRIVATE_SUMMARY' WHERE userid=900001 AND kwid=2`],
            ["association",`DELETE FROM ${table(c,"logtags")} WHERE journalid=900001 AND jitemid=300 AND kwid=2`,
                `INSERT INTO ${table(c,"logtags")} (journalid,jitemid,kwid) VALUES (900001,300,2)`]];
        for(const [kind,change,restore] of mutations){
            let changed=false;
            const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
                const html=await render.call(this,input);await admin.query(change!);changed=true;return html;});
            try{const response=await get(address.port,"/users/ordinary6/76801.html");
                assert.equal(changed,true,kind);assert.equal(response.status,409,kind);assert.ok(!response.body.includes(names[0]!));}
            finally{hook.mock.restore();await admin.query(restore!);}
            assert.equal(await store.revalidateFingerprint(baseline),true,kind);
            assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,200,kind);
        }
        // Missing unfiltered taxonomy is a malformed native selected result,
        // not permission to manufacture a name or silently drop the tuple.
        await admin.query(`DELETE FROM ${table(c,"usertags")} WHERE journalid=900001 AND kwid=2`);
        assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,422);
        await admin.query(`INSERT INTO ${table(c,"usertags")} (journalid,kwid,display) VALUES (900001,2,'1')`);
        await admin.query(`DELETE FROM ${table(c,"userkeywords")} WHERE userid=900001 AND kwid=2`);
        assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,422);
    }finally{capture.mock.restore();await app.close();await service.close();}
}));

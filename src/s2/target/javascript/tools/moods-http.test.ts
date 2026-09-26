// moods-http.test.ts
//
// Actual selected mood/theme and coordinate SQL, child and HTTP qualification.
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
import {Renderer} from "../live/render/child";
import type {RenderInput} from "../live/render/types";
import {config,capabilities,limits} from "../live/tests/fixtures";
import {moodsBrowser} from "./moods-browser";
test("actual selected numeric mood/icons/coords, isolation and final dependency rereads",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",timeout:120000},async t=>withSelectedFixture(async f=>{
    const {admin,store,table,g,c,other}=f;
    await admin.query(`INSERT INTO ${table(g,"moods")} (moodid,mood,parentmood) VALUES (1,'Happy',0),(2,'Child',1),(3,'UNRELATED_PRIVATE_MOOD',0)`);
    await admin.query(`INSERT INTO ${table(g,"moodthemes")} (moodthemeid,ownerid,name,is_public) VALUES (1,900001,'Private selected theme','N'),(2,900002,'Other theme','N')`);
    await admin.query(`INSERT INTO ${table(g,"moodthemedata")} (moodthemeid,moodid,picurl,width,height)
        VALUES (1,1,'https://mood.slice11.invalid/pixel.png',16,16),(2,3,'https://private.invalid/PRIVATE_MOOD',32,32)`);
    for(const [name,value] of Object.entries({current_moodid:"2",current_coords:"-0.03125,0.03125",current_mood:"<i>custom mood</i>"}))
        await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,300,?,?)`,[f.logProp(name),value]);
    for(const id of [301,302])await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,?,?,3)`,[id,f.logProp("current_moodid")]);
    await admin.query(`INSERT INTO ${table(other,"logprop2")} (journalid,jitemid,propid,value) VALUES (900002,300,?,3)`,[f.logProp("current_moodid")]);
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
    assert.deepEqual(baseline.moods.moods.map(row=>row.id),[1,2]);
    assert.deepEqual(baseline.moods.pictures.map(row=>row.moodid),[1]);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT||"artifacts/live/stock.json"}});
    const app=createLiveApp(config,service);const render=Renderer.prototype.render;
    const capture=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
        const wire=JSON.stringify(input);assert.ok(!wire.includes("UNRELATED_PRIVATE_MOOD"));
        assert.ok(!wire.includes("PRIVATE_MOOD"));return render.call(this,input);
    });
    await app.listen({host:"127.0.0.1",port:process.env.S2_MOODS_BROWSER_OUTPUT?8081:0});
    const address=app.server.address();assert.ok(address&&typeof address!=="string");
    const get=(url:string):Promise<{statusCode:number;body:string;headers:Record<string,unknown>}>=>new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port:address.port,path:url,method:"GET",headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({statusCode:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Mood HTTP deadline")));call.on("error",reject);call.end();
    });
    try{
        for(const url of ["/users/ordinary6/","/users/ordinary6/76801.html"]){
            const reply=await get(url);assert.equal(reply.statusCode,200,reply.body);
            assert.ok(reply.body.includes('src="https://mood.slice11.invalid/pixel.png"'));
            assert.ok(reply.body.includes("custom mood"));assert.ok(reply.body.includes("-0.0312,0.0312"));
            assert.equal(reply.headers["cache-control"],"private, no-store");
            if(url.endsWith("html"))await moodsBrowser(reply.body,address.port);
        }
        for(const id of [301*256+1,302*256+1])assert.equal((await get(`/users/ordinary6/${id}.html`)).statusCode,404);
        const mutations=[
            ["theme",`UPDATE ${table(g,"moodthemedata")} SET width=17 WHERE moodthemeid=1 AND moodid=1`,
                `UPDATE ${table(g,"moodthemedata")} SET width=16 WHERE moodthemeid=1 AND moodid=1`],
            ["parent",`UPDATE ${table(g,"moods")} SET parentmood=0 WHERE moodid=2`,
                `UPDATE ${table(g,"moods")} SET parentmood=1 WHERE moodid=2`],
            ["coords",`UPDATE ${table(c,"logprop2")} SET value='1.0,2.0' WHERE journalid=900001 AND jitemid=300 AND propid=${f.logProp("current_coords")}`,
                `UPDATE ${table(c,"logprop2")} SET value='-0.03125,0.03125' WHERE journalid=900001 AND jitemid=300 AND propid=${f.logProp("current_coords")}`],
        ];
        for(const [name,change,restore] of mutations){
            let changed=false;
            const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
                const html=await render.call(this,input);await admin.query(change!);changed=true;return html;
            });
            try{const response=await get("/users/ordinary6/76801.html");assert.ok(changed);
                assert.equal(response.statusCode,409,name);assert.ok(!response.body.includes("custom mood"));}
            finally{hook.mock.restore();await admin.query(restore!);}
            assert.equal(await store.revalidateFingerprint(baseline),true,name);
            assert.equal((await get("/users/ordinary6/76801.html")).statusCode,200);
        }
        await admin.query(`UPDATE ${table(c,"logprop2")} SET value='<font>0</font>' WHERE journalid=900001 AND jitemid=300 AND propid=?`,[f.logProp("current_mood")]);
        assert.ok((await get("/users/ordinary6/76801.html")).body.includes("Child"),"cleaned Perl-false zero numeric fallback");
        await admin.query(`UPDATE ${table(c,"logprop2")} SET value='<script>gone</script>' WHERE journalid=900001 AND jitemid=300 AND propid=?`,[f.logProp("current_mood")]);
        assert.ok((await get("/users/ordinary6/76801.html")).body.includes("Child"),"cleaned-empty numeric fallback");
        await admin.query(`UPDATE ${table(c,"logprop2")} SET value='bad' WHERE journalid=900001 AND jitemid=300 AND propid=?`,[f.logProp("current_coords")]);
        const invalid=await get("/users/ordinary6/76801.html");assert.equal(invalid.statusCode,200);
        assert.ok(!invalid.body.includes("-0.0312"));
    }finally{capture.mock.restore();await app.close();await service.close();}
}));

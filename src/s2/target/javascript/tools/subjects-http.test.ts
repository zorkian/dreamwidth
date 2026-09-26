// subjects-http.test.ts
//
// Actual rich subjects, textual currents and selected-data final rereads.
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
import {subjectsBrowser} from "./subjects-browser";
import {Renderer} from "../live/render/child";
import {config,capabilities,limits} from "../live/tests/fixtures";
import type {RenderInput} from "../live/render/types";
const rich='<b style="color:r\\65 d;font-weight:bold;font-style:italic">Rich café 😀</b> ' +
    '<a href="https://subject.slice10.invalid/?x=1&amp;y=2">subject link</a>';
function get(port:number,path:string):Promise<{status:number;body:string;headers:Record<string,unknown>}> {
    return new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port,path,headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({status:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Subject HTTP deadline")));call.on("error",reject);call.end();
    });
}
test("actual selected rich subject/currents, privacy, fresh child and mutation refusals",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",timeout:120000},async t=>withSelectedFixture(async f=>{
    const {admin,store,table,g,c,other}=f;
    await admin.query(`UPDATE ${table(c,"logtext2")} SET subject=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=300`,[Buffer.from(rich)]);
    const [definitions]:any=await admin.query(`SELECT propid,name FROM ${table(g,"logproplist")} WHERE name IN
        ('current_mood','current_music','current_location','current_moodid','current_coords')`);
    const prop=(name:string)=>{const row=definitions.find((item:any)=>item.name===name);assert.ok(row,name);return row.propid;};
    const values={current_mood:'<i style="width:expression(alert(1))">custom mood</i>',current_music:'<strong>music &amp; melody</strong>',
        current_location:'<cite style="position:fixed;left:0">location</cite><a href="javascript:alert(1)">blocked</a>'};
    for(const [name,value] of Object.entries(values))await admin.query(`INSERT INTO ${table(c,"logprop2")}
        (journalid,jitemid,propid,value) VALUES (900001,300,?,CONVERT(? USING latin1))`,[prop(name),Buffer.from(value)]);
    // Private/usemask and same-ID foreign text must never reach this worker.
    for(const id of [301,302])await admin.query(`UPDATE ${table(c,"logtext2")} SET subject='PRIVATE_SUBJECT_CAPABILITY',event='<lj user="secret">'
        WHERE journalid=900001 AND jitemid=?`,[id]);
    await admin.query(`UPDATE ${table(other,"logtext2")} SET subject='FOREIGN_SUBJECT_SECRET' WHERE journalid=900002`);
    const baseline=await store.loadRawSnapshot(f.request("ordinary6"));assert.ok(baseline);
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT||"artifacts/live/stock.json"}});
    const app=createLiveApp(config,service);const render=Renderer.prototype.render;
    const capture=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
        const wire=JSON.stringify(input);assert.ok(!wire.includes("PRIVATE_SUBJECT_CAPABILITY"));
        assert.ok(!wire.includes("FOREIGN_SUBJECT_SECRET"));assert.ok(!wire.includes('secret'));
        assert.equal(input.journal.entries.find(entry=>entry.id===76801)!.subject,rich);
        return render.call(this,input);
    });
    try{
        await app.listen({host:"127.0.0.1",port:process.env.S2_SUBJECTS_BROWSER_OUTPUT?8081:0});
        const address=app.server.address();assert.ok(address&&typeof address!=="string");
        for(const path of ["/users/ordinary6/","/users/ordinary6/76801.html"]){
            const response=await get(address.port,path);assert.equal(response.status,200,response.body);
            assert.equal(response.headers["cache-control"],"private, no-store");
            for(const value of ["Rich café 😀","custom mood","music &amp; melody","location"])
                assert.ok(response.body.includes(value),value);
            assert.ok(!response.body.includes("PRIVATE_SUBJECT_CAPABILITY"));
            if(path.endsWith("html")){
                assert.ok(response.body.includes('<meta property="og:title" content="Rich café 😀 subject link"/>'));
                assert.ok(response.body.includes('href="https://subject.slice10.invalid/?x=1&amp;y=2"'));
                await subjectsBrowser(address.port,response.body);
            }else{
                // Recent's subject permalink does not contain a nested source anchor.
                assert.ok(!response.body.includes('href="https://subject.slice10.invalid/'));
            }
        }
        capture.mock.restore();assert.equal(await store.revalidateFingerprint(baseline),true);
        for(const id of [301,302])assert.equal((await get(address.port,`/users/ordinary6/${id*256+1}.html`)).status,404);
        const mutations=[
            ["subject",`UPDATE ${table(c,"logtext2")} SET subject='CHANGED SUBJECT' WHERE journalid=900001 AND jitemid=300`,
                ()=>admin.query(`UPDATE ${table(c,"logtext2")} SET subject=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=300`,[Buffer.from(rich)])],
            ["property",`UPDATE ${table(c,"logprop2")} SET value='CHANGED MUSIC' WHERE journalid=900001 AND jitemid=300 AND propid=${prop("current_music")}`,
                ()=>admin.query(`UPDATE ${table(c,"logprop2")} SET value=CONVERT(? USING latin1) WHERE journalid=900001 AND jitemid=300 AND propid=?`,[Buffer.from(values.current_music),prop("current_music")])],
        ] as const;
        for(const [name,change,restore] of mutations){
            let changed=false;const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
                const html=await render.call(this,input);await admin.query(change);changed=true;return html;});
            try{const response=await get(address.port,"/users/ordinary6/76801.html");
                assert.equal(changed,true);assert.equal(response.status,409,name);assert.ok(!response.body.includes("Rich café"));}
            finally{hook.mock.restore();await restore();}
            assert.equal(await store.revalidateFingerprint(baseline),true,name);
            assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,200);
        }
        // Raw truthy cleaning to empty keeps the metadata key and stock empty UL.
        await admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=300 AND propid IN (?,?)`,
            [prop("current_mood"),prop("current_location")]);
        await admin.query(`UPDATE ${table(c,"logprop2")} SET value='<script>removed</script>' WHERE journalid=900001 AND jitemid=300 AND propid=?`,[prop("current_music")]);
        const empty=await get(address.port,"/users/ordinary6/76801.html");assert.equal(empty.status,200);
        assert.match(empty.body,/<div class="metadata bottom-metadata">\n<ul>\n<\/ul>/);
        for(const name of ["current_coords","current_moodid"]){
            await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,300,?,'1')`,[prop(name)]);
            assert.equal((await get(address.port,"/users/ordinary6/76801.html")).status,200,
                "Slice11 expands absent numeric mood and caught malformed coords without removing key");
            await admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=300 AND propid=?`,[prop(name)]);
        }
    }finally{capture.mock.restore();await app.close();await service.close();}
}));

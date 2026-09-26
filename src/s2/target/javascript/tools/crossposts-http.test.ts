// crossposts-http.test.ts
//
// Actual selected binary crosspost isolation, current child and HTTP freshness.
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
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {request as httpRequest} from "node:http";
import {withSelectedFixture} from "./selected-fixture";
import {createAnonymousRecentService} from "../live/policy/service";
import {createLiveApp} from "../live/server/app";
import {Renderer} from "../live/render/child";
import type {RenderInput} from "../live/render/types";
import {config,capabilities,limits} from "../live/tests/fixtures";
import {crosspostsBrowser} from "./crossposts-browser";

test("actual BOTH binary properties, public selection, URL metadata and complete reread",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",timeout:120000},async t=>withSelectedFixture(async f=>{
    const {admin,store,table,g,c,other}=f;
    const native=spawnSync("perl",[resolve(__dirname,"../../tools/crossposts-native.pl")],
        {encoding:"utf8",timeout:10000,env:{...process.env,PERL_HASH_SEED:"0",PERL_PERTURB_KEYS:"0"}});
    assert.equal(native.status,0,native.stderr);const records=JSON.parse(native.stdout);
    const sample=(id:string):Buffer=>Buffer.from(records.rows.find((row:any)=>row.id===id).hex,"hex");
    const detail=sample("feature"),opaque=Buffer.from(records.opaqueHex,"hex");
    assert.ok(detail.length<=255,"real VARCHAR255 fixture, not an invented blob column");
    const set=async(schema:string,journal:number,id:number,name:string,value:Buffer)=>
        admin.query(`REPLACE INTO ${table(schema,"logprop2")} (journalid,jitemid,propid,value)
            VALUES (?,?,?,CONVERT(? USING latin1))`,[journal,id,f.logProp(name),value]);
    await set(c,900001,300,"xpost",opaque);await set(c,900001,300,"xpostdetail",detail);
    for(const id of [301,302])for(const name of ["xpost","xpostdetail"])
        await set(c,900001,id,name,Buffer.from([255]));
    await set(other,900002,300,"xpost",Buffer.from([255]));
    await set(other,900002,300,"xpostdetail",Buffer.from("FOREIGN_SECRET"));
    const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
    const selected=baseline.entries.find(entry=>entry.jitemid===300)!;
    assert.equal(selected.xpostDetail?.base64,detail.toString("base64"));
    assert.equal(selected.xpostOpaque?.base64,opaque.toString("base64"));
    assert.ok(!Object.hasOwn(selected.props,"xpost")&&!Object.hasOwn(selected.props,"xpostdetail"));
    const service=await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT||"artifacts/live/stock.json"}});
    const app=createLiveApp(config,service),render=Renderer.prototype.render;
    const capture=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
        const wire=JSON.stringify(input);
        for(const value of ["xpostOpaque","xpostDetail","storable-network","FOREIGN_SECRET",opaque.toString("base64")])
            assert.ok(!wire.includes(value),"parent binary/account facts must not reach child");
        return render.call(this,input);
    });
    await app.listen({host:"127.0.0.1",port:process.env.S2_XPOST_BROWSER_OUTPUT?8081:0});
    const address=app.server.address();assert.ok(address&&typeof address!=="string");
    const get=(url:string):Promise<{statusCode:number;body:string;headers:Record<string,unknown>}>=>new Promise((resolve,reject)=>{
        const call=httpRequest({hostname:"127.0.0.1",port:address.port,path:url,method:"GET",headers:{Host:"localhost:8081"}},response=>{
            const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);
            response.on("end",()=>resolve({statusCode:response.statusCode??0,body:Buffer.concat(chunks).toString("utf8"),headers:response.headers}));
        });call.setTimeout(20000,()=>call.destroy(Error("Crosspost HTTP deadline")));call.on("error",reject);call.end();
    });
    try{
        for(const url of ["/users/ordinary6/","/users/ordinary6/76801.html"]){
            const reply=await get(url);assert.equal(reply.statusCode,200,reply.body);
            assert.equal(reply.headers["cache-control"],"private, no-store");
            assert.ok(reply.body.includes("metadata-item-xpost"));
            assert.ok(reply.body.includes("&amp;quot;&amp;y=&lt;a&gt;"));
            assert.ok(reply.body.includes("https://example.test/a&#39;"));
            assert.ok(!reply.body.includes("FOREIGN_SECRET"));
            if(url.endsWith("html"))await crosspostsBrowser(reply.body,address.port);
        }
        for(const id of [301*256+1,302*256+1])assert.equal((await get(`/users/ordinary6/${id}.html`)).statusCode,404);
        for(const name of ["xpost","xpostdetail"]){
            let changed=false;
            const hook=t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput){
                const html=await render.call(this,input);await set(c,900001,300,name,name==="xpost"?Buffer.from([255]):sample("simple"));
                changed=true;return html;
            });
            try{const reply=await get("/users/ordinary6/76801.html");assert.ok(changed);assert.equal(reply.statusCode,409,name);
                assert.ok(!reply.body.includes("example.test"));}
            finally{hook.mock.restore();await set(c,900001,300,name,name==="xpost"?opaque:detail);}
            assert.equal(await store.revalidateFingerprint(baseline),true,name);
            assert.equal((await get("/users/ordinary6/76801.html")).statusCode,200);
        }
        for(const bad of ["active","alias","invalidbyte","truncated"]){
            await set(c,900001,300,"xpostdetail",sample(bad));
            const reply=await get("/users/ordinary6/76801.html");assert.equal(reply.statusCode,422,bad);
            assert.ok(!reply.body.includes("metadata-item-xpost"));
        }
        await set(c,900001,300,"xpostdetail",sample("false"));
        const empty=await get("/users/ordinary6/76801.html");assert.equal(empty.statusCode,200);
        assert.ok(!empty.body.includes("metadata-item-xpost"));
        await set(c,900001,300,"xpostdetail",detail);
        assert.equal(await store.revalidateFingerprint(baseline),true);
    }finally{capture.mock.restore();await app.close();await service.close();}
}));

// selected-worker.test.ts
//
// Actual primary, current sandboxed worker and HTTP visibility integration.
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
import {request as httpRequest, type IncomingHttpHeaders} from "node:http";
import {withSelectedFixture} from "../../tools/selected-fixture";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";
import {Renderer} from "../render/child";
import type {RenderInput} from "../render/types";
import {config, capabilities, limits} from "./fixtures";

interface Response {status: number; body: string; headers: IncomingHttpHeaders;}
function get(port: number, path: string, method = "GET"): Promise<Response> {
    return new Promise((resolve,reject) => {
        const request = httpRequest({hostname:"127.0.0.1",port,path,method,headers:{Host:"localhost:8081"}}, response => {
            const chunks: Buffer[] = [];
            response.on("data",chunk=>chunks.push(chunk)); response.on("error",reject);
            response.on("end",()=>resolve({status:response.statusCode??0,headers:response.headers,
                body:Buffer.concat(chunks).toString("utf8")}));
        });
        request.setTimeout(15000,()=>request.destroy(new Error("Selected HTTP deadline")));
        request.on("error",reject); request.end();
    });
}

test("real configured primaries and current child serve two journals and revoke before HTTP send", {
    skip: process.env.S2_SELECTED_FIXTURE !== "1",
}, async t => withSelectedFixture(async fixture => {
    const {store,admin,g,c,table} = fixture;
    const baseline = await store.loadRawSnapshot(fixture.request()); assert.ok(baseline);
    const old = await store.loadRawSnapshot(fixture.request("ordinary6",{kind:"entry",ditemid:257})); assert.ok(old);
    const service = await createAnonymousRecentService({repository:store,secretSource:store,config,capabilities,limits,
        artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT || "artifacts/live/stock.json"}});
    const app = createLiveApp(config,service);
    try {
        await app.listen({host:"127.0.0.1",port:0});
        const address = app.server.address(); assert.ok(address && typeof address!=="string");
        const ordinary = "/users/ordinary6/", entry = ordinary+(17*256+1)+".html";
        for (const [path,positive,negative] of [[ordinary,"Public body 300","Foreign same ID"],
            [entry,"Public body 17","Public body 300"],
            ["/users/second6/","Foreign same ID","Public body 300"]]) {
            const response = await get(address.port,path!);
            assert.equal(response.status,200,path);
            assert.ok(response.body.includes(positive!) && !response.body.includes(negative!));
            assert.ok(response.body.startsWith("<!DOCTYPE"));
            assert.equal(response.headers["cache-control"],"private, no-store");
            const head = await get(address.port,path!,"HEAD");
            assert.equal(head.status,200); assert.equal(head.body,"");
            assert.ok(Number(head.headers["content-length"])>0);
        }
        for (const id of [301*256+1,302*256+1,17*256+2]) {
            const denied = await get(address.port,ordinary+id+".html");
            assert.equal(denied.status,404); assert.equal(denied.body,"Journal not found\n");
        }
        const mutations = [
            {name:"private",path:entry,next:404,
                change:()=>admin.query(`UPDATE ${table(c,"log2")} SET security='private' WHERE journalid=900001 AND jitemid=17`),
                restore:()=>admin.query(`UPDATE ${table(c,"log2")} SET security='public' WHERE journalid=900001 AND jitemid=17`)},
            {name:"rename",path:entry,next:404,change:async()=>{
                await admin.query(`UPDATE ${table(g,"user")} SET user='renamed6' WHERE userid=900001`);
                await admin.query(`UPDATE ${table(g,"useridmap")} SET user='renamed6' WHERE userid=900001`);
            },restore:async()=>{
                await admin.query(`UPDATE ${table(g,"user")} SET user='ordinary6' WHERE userid=900001`);
                await admin.query(`UPDATE ${table(g,"useridmap")} SET user='ordinary6' WHERE userid=900001`);
            }},
            {name:"move",path:entry,next:404,
                change:()=>admin.query(`UPDATE ${table(g,"user")} SET clusterid=19 WHERE userid=900001`),
                restore:()=>admin.query(`UPDATE ${table(g,"user")} SET clusterid=7 WHERE userid=900001`)},
            {name:"window",path:ordinary,next:200,
                change:()=>admin.query(`UPDATE ${table(c,"log2")} SET revttime=0 WHERE journalid=900001 AND jitemid=1`),
                restore:()=>admin.query(`UPDATE ${table(c,"log2")} SET revttime=? WHERE journalid=900001 AND jitemid=1`,
                    [old.entries[0]!.revttime])},
        ];
        const original = Renderer.prototype.render;
        for (const mutation of mutations) {
            let fired = false;
            // Run the real renderer unchanged. Commit while its complete output
            // is pending, and await both before returning to the real service's
            // final primary reread. No fabricated HTML or database generation.
            const hook = t.mock.method(Renderer.prototype,"render",async function(this:Renderer,input:RenderInput) {
                const rendering = original.call(this,input);
                if (!fired) {
                    fired=true;
                    const [html] = await Promise.all([rendering,mutation.change()]);
                    return html;
                }
                return rendering;
            });
            try {
                const refused = await get(address.port,mutation.path);
                assert.equal(fired,true,mutation.name);
                assert.equal(refused.status,409,mutation.name);
                assert.equal(refused.body,"Journal changed during render\n");
                assert.equal(refused.headers["cache-control"],"private, no-store");
                assert.equal(refused.headers["set-cookie"],undefined);
                assert.equal(refused.headers.location,undefined);
                const next = await get(address.port,mutation.path);
                assert.equal(next.status,mutation.next,mutation.name);
                if (mutation.name==="window") assert.match(next.body,/Public body 1</);
            } finally {
                hook.mock.restore(); await mutation.restore();
                assert.equal(await store.revalidateFingerprint(baseline),true,mutation.name+" restored");
            }
            assert.equal((await get(address.port,mutation.path)).status,200,mutation.name+" recovery");
        }
    } finally {await app.close(); await service.close();}
}));

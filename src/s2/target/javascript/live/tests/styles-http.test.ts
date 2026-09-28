// styles-http.test.ts
//
// Existing stock theme and temporary user-layer refusal through SQL and HTTP.
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

import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {readStartupConfig} from "../server/startup-config";
import {withSelectedFixture} from "../../tools/selected-fixture";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";
import {config,capabilities,limits} from "./fixtures";

test("stock theme remains public; selected user layer refuses before stored Perl reads",{
    skip:process.env.S2_SELECTED_FIXTURE!=="1",timeout:120000},async()=>withSelectedFixture(async f=>{
    const {admin,table,g,c,store}=f;
    const run=spawnSync("perl",["tools/styles-native.pl"],{encoding:"utf8",timeout:20000});
    assert.equal(run.status,0,run.stderr);
    const theme=JSON.parse(run.stdout).find((row:any)=>row.name==="dazzle");
    assert.ok(theme);
    const [layouts]=await admin.query<any[]>(`SELECT s2lid,userid FROM ${table(g,"s2layers")} WHERE type='layout'`);
    const layout=Number(layouts[0]!.s2lid),system=Number(layouts[0]!.userid);
    await admin.query(`INSERT INTO ${table(g,"s2layers")} (s2lid,userid,b2lid,type)
        VALUES(980003,?,?,'theme')`,[system,layout]);
    await admin.query(`INSERT INTO ${table(g,"s2info")} (s2lid,infokey,value)
        VALUES(980003,'type','theme')`);
    await admin.query(`INSERT INTO ${table(g,"s2source_inno")} (s2lid,s2code)
        VALUES(980003,?)`,[theme.source]);
    await admin.query(`INSERT INTO ${table(g,"s2compiled")} (s2lid,comptime)
        VALUES(980003,123)`);
    await admin.query(`INSERT INTO ${table(c,"s2stylelayers2")} (userid,styleid,type,s2lid)
        VALUES(900001,44,'theme',980003)`);

    const exported=mkdtempSync("/tmp/stock-theme-site-");
    let hook;
    try {
        const output=path.join(exported,"site.json");
        const result=spawnSync("perl",["-I",path.join(process.env.LJHOME!,"cgi-bin"),
            "tools/site-config.pl","--output",output,"--artifact",process.env.S2_LIVE_TEST_ARTIFACT!,
            "--app-origin",config.canonicalAppOrigin,"--listen-origin",config.listenOrigin],
        {encoding:"utf8",timeout:15000});
        assert.equal(result.status,0,result.stderr);
        hook=readStartupConfig(output).app.cssCleanerHookKind;
        assert.equal(hook,"proxy-css-links-only");
    } finally {rmSync(exported,{recursive:true,force:true});}
    const appConfig={...config,cssCleanerHookKind:hook};
    const service=await createAnonymousRecentService({repository:store,secretSource:store,
        config:appConfig,capabilities,limits,artifact:{path:process.env.S2_LIVE_TEST_ARTIFACT!}});
    const app=createLiveApp(appConfig,service);
    const get=(url:string)=>app.inject({url,headers:{host:"localhost:8081"}});
    const routes=["/users/ordinary6/","/users/ordinary6/76801.html"];
    try {
        const baseline=await store.loadRawSnapshot(f.request());assert.ok(baseline);
        for(const route of routes) {
            const response=await get(route);
            assert.equal(response.statusCode,200,response.body);
            assert.ok(response.body.includes("class='theme-name'>Dazzle</span>"));
            assert.ok(response.body.includes('<style type="text/css">'));
            assert.ok(response.body.includes(".entry .inner,.module{padding:.5em}"));
            assert.equal(response.headers["cache-control"],"private, no-store");
        }

        await admin.query(`INSERT INTO ${table(g,"s2layers")} (s2lid,userid,b2lid,type)
            VALUES(980005,900001,?,'user')`,[layout]);
        await admin.query(`INSERT INTO ${table(g,"s2source_inno")} (s2lid,s2code)
            VALUES(980005,'set text_module_customtext = "Private";')`);
        await admin.query(`INSERT INTO ${table(c,"s2stylelayers2")} (userid,styleid,type,s2lid)
            VALUES(900001,44,'user',980005)`);
        // There is deliberately no s2compiled2 row: serving must never need it.
        for(const route of routes) {
            const response=await get(route);
            assert.equal(response.statusCode,422);
            assert.equal(response.body,"Unsupported journal state\n");
            assert.equal(response.headers["cache-control"],"private, no-store");
            assert.equal(response.headers["set-cookie"],undefined);
            assert.ok(!response.body.includes("Private"));
            const head=await app.inject({method:"HEAD",url:route,headers:{host:"localhost:8081"}});
            assert.equal(head.statusCode,422);
            assert.ok(!head.rawPayload.includes(Buffer.from("Private")));
        }
        await admin.query(`DELETE FROM ${table(c,"s2stylelayers2")}
            WHERE userid=900001 AND styleid=44 AND type='user'`);
        assert.equal(await store.revalidateFingerprint(baseline),true);
        for(const route of routes)assert.equal((await get(route)).statusCode,200);
    } finally {await app.close();await service.close();}
}));

// privacy-db.ts
//
// Actual local HTTP privacy refusals and exact marked-account restoration.
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
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {get, type IncomingHttpHeaders} from "node:http";
import {resolve} from "node:path";
import type {PublicAppConfig, AnonymousRecentService} from "../contracts";
import {MysqlLiveStore} from "../data/mysql";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";

const cases = ["suspended", "deleted", "locked", "unvalidated", "reply_setting",
    "adult_setting", "custom_blob", "analytics", "legacy_style", "missing_style"] as const;

function helper(args: readonly string[], input?: string): void {
    // Offline fixture control only, between completed HTTP requests. Serving
    // modules never import this executable or invoke this Perl driver.
    execFileSync("perl", [resolve("live/tests/privacy-mutate.pl"), ...args], {
        cwd: process.cwd(), stdio: "pipe", timeout: 10000, input,
    });
}
interface Response {status: number; body: string; headers: IncomingHttpHeaders;}
function request(port: number): Promise<Response> {
    return new Promise((resolveResponse, reject) => {
        const req = get({hostname: "127.0.0.1", port, path: "/users/s2js_slice3/",
            headers: {Host: "localhost:8081"}}, response => {
            const parts: Buffer[] = [];
            response.on("data", part => parts.push(part));
            response.on("error", reject);
            response.on("end", () => resolveResponse({status: response.statusCode ?? 0,
                headers: response.headers, body: Buffer.concat(parts).toString("utf8")}));
        });
        req.setTimeout(15000, () => req.destroy(new Error("Privacy HTTP deadline")));
        req.on("error", reject);
    });
}
function accepted(response: Response): void {
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.match(response.body, /<!DOCTYPE html/);
    assert.ok(!response.body.includes("PRIVACY_PROBE_"));
}

async function main(): Promise<void> {
    assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--recover"));
    const config = JSON.parse(readFileSync("artifacts/live/public-config.json", "utf8")) as PublicAppConfig;
    const store = await MysqlLiveStore.open(JSON.parse(readFileSync("artifacts/live/mysql-readonly.json", "utf8")));
    let service: AnonymousRecentService | undefined;
    let app: ReturnType<typeof createLiveApp> | undefined;
    let begun = false;
    let baseline: Awaited<ReturnType<typeof store.loadRawSnapshot>> = null;
    try {
        if (process.argv[2] === "--recover") {
            helper(["--restore"]);
            const saved = JSON.parse(readFileSync("artifacts/live/privacy-state.json", "utf8")) as {fingerprint: string};
            const restored = await store.loadRawSnapshot("s2js_slice3");
            assert.equal(restored?.fingerprint, saved.fingerprint, "Recovery exact primary fingerprint");
            helper(["--finish"]);
            console.log("real privacy recovery: exact baseline " + saved.fingerprint);
            return;
        }
        baseline = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(baseline, "Seeded marked owner required");
        service = await createAnonymousRecentService({repository: store, secretSource: store,
            artifact: {path: resolve("artifacts/live/stock.json")}, config,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128}});
        app = createLiveApp(config, service);
        // Ephemeral loopback socket avoids colliding with an ordinary listener;
        // the actual HTTP Host remains the configured, strictly admitted origin.
        await app.listen({host: "127.0.0.1", port: 0});
        const address = app.server.address();
        assert.ok(address && typeof address !== "string");
        accepted(await request(address.port));
        const owner = baseline.owner;
        const primary = JSON.stringify({userid: owner.userid, fingerprint: baseline.fingerprint,
            fields: {status: owner.status, statusvis: owner.statusvis,
            opt_whocanreply: owner.optWhocanReply,
            ...Object.fromEntries(["adult_content", "customtext_content", "ga4_analytics", "stylesys", "s2_style"]
                .map(key => [key, owner.publicSettings[key as keyof typeof owner.publicSettings]]))}});
        helper(["--begin"], primary);
        begun = true;
        assert.throws(() => helper(["--begin"], primary), "Existing recovery state must not be overwritten");
        for (const name of cases) {
            try {
                helper(["--case", name]);
                assert.equal(await store.revalidateFingerprint(baseline), false, name + " revokes baseline");
                const response = await request(address.port);
                assert.equal(response.status, 422, name);
                assert.equal(response.body, "Unsupported journal state\n", name);
                assert.equal(response.headers["content-type"], "text/plain; charset=utf-8", name);
                assert.equal(response.headers["cache-control"], "private, no-store", name);
                assert.equal(response.headers["set-cookie"], undefined, name);
                assert.equal(response.headers.location, undefined, name);
                assert.equal(response.headers["content-length"], String(Buffer.byteLength(response.body)), name);
            } finally {
                // Recovery also accepts the saved intent with no mutation yet.
                helper(["--restore"]);
            }
            assert.equal(await store.revalidateFingerprint(baseline), true, name + " restores exact raw baseline");
            accepted(await request(address.port));
            console.log("real HTTP privacy refusal and restoration: " + name);
        }
        // Emulate an interrupted test between mutation and the next HTTP call;
        // invoke the same explicit recovery command documented for operators.
        helper(["--case", "custom_blob"]);
        helper(["--restore"]);
        helper(["--restore"]); // idempotent recovery
        assert.equal(await store.revalidateFingerprint(baseline), true);
        console.log("real privacy recovery: exact baseline " + baseline.fingerprint);
    } finally {
        try {
            if (begun) {
                helper(["--restore"]);
                assert.ok(baseline);
                assert.equal(await store.revalidateFingerprint(baseline), true, "Final exact restoration");
                helper(["--finish"]);
            }
        } finally {
            if (app) await app.close();
            if (service) await service.close();
            await store.close();
        }
    }
}
void main().catch(() => {
    // Do not print child stderr, repository details, account fields or secrets.
    console.error("Real privacy checks failed; inspect scoped recovery state and run privacy-db.js --recover");
    process.exitCode = 1;
});

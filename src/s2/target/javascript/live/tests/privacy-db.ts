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
import type {AnonymousRecentService} from "../contracts";
import {MysqlLiveStore} from "../data/mysql";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "../server/app";
import {readStartupConfig} from "../server/startup-config";
import {recentRequest, regressionConfig, regressionConfigPath} from "../../tools/regression-config";

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
function request(port: number, host: string, target = "/users/s2js_slice3/", method: "GET" | "HEAD" = "GET"): Promise<Response> {
    return new Promise((resolveResponse, reject) => {
        const req = get({hostname: "127.0.0.1", port, path: target, method,
            headers: {Host: host}}, response => {
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
function accepted(response: Response, head = false): void {
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    if (head) {
        assert.equal(response.body, "");
        assert.ok(Number(response.headers["content-length"]) > 0);
    } else assert.match(response.body, /<!DOCTYPE html/);
    assert.ok(!response.body.includes("PRIVACY_PROBE_"));
}

async function main(): Promise<void> {
    assert.ok(process.argv.length === 2 || (process.argv.length === 3 &&
        ["--recover", "--entry"].includes(process.argv[2]!)));
    const mode = process.argv[2];
    const project = resolve(".");
    const startup = readStartupConfig(regressionConfigPath(project));
    const resolved = await regressionConfig(project);
    const entryMode = mode === "--entry";
    const store = await MysqlLiveStore.open(resolved.credential);
    const rawRequest = recentRequest("s2js_slice3");
    let service: AnonymousRecentService | undefined;
    let app: ReturnType<typeof createLiveApp> | undefined;
    let begun = false;
    let baseline: Awaited<ReturnType<typeof store.loadRawSnapshot>> = null;
    try {
        if (mode === "--recover") {
            helper(["--restore"]);
            const saved = JSON.parse(readFileSync("artifacts/live/privacy-state.json", "utf8")) as {
                fingerprint: string; calendarNow: {year: number; month: number}};
            assert.ok(Number.isSafeInteger(saved.calendarNow?.year) && saved.calendarNow.year >= 1 &&
                saved.calendarNow.year <= 9999 && Number.isSafeInteger(saved.calendarNow.month) &&
                saved.calendarNow.month >= 1 && saved.calendarNow.month <= 12, "Saved calendar boundary required");
            const restored = await store.loadRawSnapshot({...rawRequest, calendarNow: saved.calendarNow});
            assert.equal(restored?.fingerprint, saved.fingerprint, "Recovery exact primary fingerprint");
            helper(["--finish"]);
            console.log("real privacy recovery: exact baseline " + saved.fingerprint);
            return;
        }
        baseline = await store.loadRawSnapshot(rawRequest);
        assert.ok(baseline, "Seeded marked owner required");
        const selected = baseline.entries.find(entry => entry.security === "public");
        if (entryMode) assert.ok(selected, "Public entry required");
        const target = entryMode ? `/users/s2js_slice3/${selected!.jitemid * 256 + selected!.anum}.html` :
            "/users/s2js_slice3/";
        // Native non-S2/missing-style dispatch uses configured DEFAULT_STYLE.
        // The default dev core1 is unsupported; a qualified stock core2 default
        // is supported without changing the journal's persisted properties.
        const supportedDefault = startup.styles.defaultStyle.core === "core2" &&
            startup.styles.defaultStyle.layout === "core2base/layout";
        const config = resolved.public;
        const host = new URL(config.listenOrigin).host;
        service = await createAnonymousRecentService({repository: store, secretSource: store,
            capabilities: startup.capabilities,
            artifact: {path: resolve(process.env.S2_LIVE_TEST_ARTIFACT || startup.artifactPath)}, config,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128}});
        app = createLiveApp(config, service);
        // Ephemeral loopback socket avoids colliding with an ordinary listener;
        // the actual HTTP Host remains the configured, strictly admitted origin.
        await app.listen({host: "127.0.0.1", port: 0});
        const address = app.server.address();
        assert.ok(address && typeof address !== "string");
        const methods: readonly ("GET" | "HEAD")[] = entryMode ? ["GET", "HEAD"] : ["GET"];
        const checkAccepted = async (): Promise<void> => {
            for (const method of methods) accepted(await request(address.port, host, target, method), method === "HEAD");
        };
        await checkAccepted();
        const owner = baseline.owner;
        const primary = JSON.stringify({userid: owner.userid, fingerprint: baseline.fingerprint,
            calendarNow: baseline.request.calendarNow,
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
                for (const method of methods) {
                    const response = await request(address.port, host, target, method);
                    const label = name + ":" + method;
                    if (supportedDefault && (name === "legacy_style" || name === "missing_style")) {
                        accepted(response, method === "HEAD");
                        continue;
                    }
                    assert.equal(response.status, 422, label);
                    assert.equal(response.body, method === "HEAD" ? "" : "Unsupported journal state\n", label);
                    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8", label);
                    assert.equal(response.headers["cache-control"], "private, no-store", label);
                    assert.equal(response.headers["set-cookie"], undefined, label);
                    assert.equal(response.headers.location, undefined, label);
                    assert.equal(response.headers["content-length"], String(Buffer.byteLength("Unsupported journal state\n")), label);
                }
            } finally {
                // Recovery also accepts the saved intent with no mutation yet.
                helper(["--restore"]);
            }
            assert.equal(await store.revalidateFingerprint(baseline), true, name + " restores exact raw baseline");
            await checkAccepted();
            console.log("real HTTP policy decision and restoration: " + (entryMode ? "entry:" : "") + name);
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

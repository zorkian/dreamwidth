// check-cleaner.ts
//
// Exercise marked rich html_raw0 entries through the actual anonymous TS route.
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
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import type {PublicAppConfig} from "../live/contracts";
import {MysqlLiveStore, type MysqlStoreConfig} from "../live/data/mysql";
import {createAnonymousRecentService} from "../live/policy/service";
import {createLiveApp} from "../live/server/app";

const project = path.resolve(__dirname, "../..");
const root = path.resolve(project, "../../../..");
const artifacts = path.join(project, "artifacts/live");
const helper = path.join(project, "tools/live-content-post.pl");
const route = "http://localhost:8081/users/s2js_slice3/";
const marker = "S2JS4 rich content probe v1";
const variants = ["rich", "edited", "forged-cut", "escaped-css", "schemes",
    "unsafe-anchor"] as const;

function helperRun(args: string[]): void {
    const result = spawnSync("/usr/bin/perl", [helper, ...args], {
        cwd: root, timeout: 30000, maxBuffer: 1024 * 1024, encoding: "utf8",
        env: {...process.env, LJHOME: root,
            PERL5LIB: "/opt/dreamwidth-extlib/lib/perl5"},
    });
    if (result.error || result.status !== 0) {
        throw new Error("normal content helper failed: " +
            (result.error?.message ?? "status " + result.status) + "\n" +
            result.stderr);
    }
    process.stdout.write(result.stdout);
}

function setup(): void {
    mkdirSync(artifacts, {recursive: true});
    const result = spawnSync(process.execPath,
        [path.join(project, "dist/tools/check-live.js"), "missing"], {
            cwd: project, timeout: 180000, maxBuffer: 1024 * 1024,
            encoding: "utf8", env: process.env,
        });
    if (result.error || result.status !== 0) {
        throw new Error("live setup failed: " +
            (result.error?.message ?? "status " + result.status) + "\n" +
            result.stderr);
    }
    process.stdout.write(result.stdout);
}

function config(): {public: PublicAppConfig; credential: MysqlStoreConfig} {
    return {
        public: JSON.parse(readFileSync(path.join(artifacts, "public-config.json"), "utf8")),
        credential: JSON.parse(readFileSync(path.join(artifacts, "mysql-readonly.json"), "utf8")),
    };
}

function sha(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

async function getPage(): Promise<{body: Buffer; headers: Headers}> {
    const response = await fetch(route, {
        redirect: "manual", signal: AbortSignal.timeout(20000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, body.toString("utf8").slice(0, 120));
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-length"), String(body.length));
    return {body, headers: response.headers};
}

async function main(): Promise<void> {
    assert.equal(process.argv.length, 2,
        "Usage: node dist/tools/check-cleaner.js");
    helperRun(["--restore"]); // Recover only this helper's exact marked entry.
    setup(); // Rebuild and verify A.runtime after each fresh live stock compile.
    const {public: publicConfig, credential} = config();
    const store = await MysqlLiveStore.open(credential);
    const before = await store.loadRawSnapshot("s2js_slice3");
    assert.ok(before && before.entries.length === 2);
    const seedIds = before.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
    let app: ReturnType<typeof createLiveApp> | undefined;
    try {
        const service = await createAnonymousRecentService({
            repository: store, secretSource: store,
            artifact: {path: path.join(artifacts, "stock.json")}, config: publicConfig,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
        });
        app = createLiveApp(publicConfig, service);
        app.addHook("onClose", async () => { await service.close(); });
        await app.listen({host: "127.0.0.1", port: 8081});
        try {
            helperRun(["--create"]);
            const state = JSON.parse(readFileSync(
                path.join(artifacts, "content-post-state.json"), "utf8"));
            assert.equal(state.username, "s2js_slice3");
            assert.equal(state.marker, marker);
            assert.match(state.run, /^[A-Za-z0-9]{16}$/);
            assert.match(String(state.jitemid), /^[1-9][0-9]*$/);
            const observed: Array<{variant: string; bytes: number; sha256: string;
                fingerprint: string}> = [];
            for (const variant of variants) {
                if (variant !== "rich") helperRun(["--set", variant]);
                const snapshot = await store.loadRawSnapshot("s2js_slice3");
                assert.ok(snapshot && snapshot.entries.length === 3);
                const entry = snapshot.entries.find(item => item.jitemid === state.jitemid);
                assert.ok(entry && entry.props.editor === "html_raw0");
                assert.ok(entry.subjectText.startsWith(marker + " " + state.run));
                const {body, headers} = await getPage();
                const html = body.toString("utf8");
                assert.ok(html.includes(marker + " " + state.run));
                assert.ok(!html.includes("HIDDEN-"));
                assert.ok(!html.includes("source-id-discarded"));
                assert.ok(!html.includes("span-cuttag_other_123_1"));
                assert.ok(!html.includes('href="javascript:'));
                assert.equal((await store.loadRawSnapshot("s2js_slice3"))?.fingerprint,
                    snapshot.fingerprint, "TS rich GET wrote journal data");
                if (variant === "rich") {
                    assert.ok(html.includes("After cut visible"));
                    assert.ok(html.includes("Rich café 😀"));
                    for (const image of ["pixel.png", "map.png", "bg.png"]) {
                        assert.ok(html.includes("https://asset.slice4.invalid/" + image));
                    }
                    writeFileSync(path.join(artifacts, "slice4-rich-page.html"), body);
                } else if (variant === "edited") {
                    assert.ok(html.includes("Edited rich café 😀"));
                    assert.ok(!html.includes("After cut visible"));
                } else if (variant === "forged-cut") {
                    assert.ok(html.includes("Forged cut control"));
                    assert.ok(html.includes("Visible after cut"));
                    writeFileSync(path.join(artifacts, "slice4-forged-page.html"), body);
                } else if (variant === "escaped-css") {
                    assert.ok(html.includes("Escaped fixed"));
                    assert.ok(!html.includes("\\66 ixed"));
                } else if (variant === "schemes") {
                    for (const scheme of ["gopher:", "magnet:", "spotify:"]) {
                        assert.ok(html.includes(scheme));
                    }
                } else {
                    assert.ok(html.includes("Inert link text"));
                    assert.ok(!html.includes("javascript:alert"));
                }
                observed.push({variant, bytes: body.length, sha256: sha(body),
                    fingerprint: snapshot.fingerprint});
                assert.ok(headers.get("set-cookie")?.includes("ljuniq="),
                    "live anonymous token cookie missing");
            }
            writeFileSync(path.join(artifacts, "slice4-rich-http.json"),
                JSON.stringify({schema: 1, marker, run: state.run, jitemid: state.jitemid,
                    variants: observed}, null, 2) + "\n");
        } finally {
            helperRun(["--restore"]);
        }
        const after = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(after && after.entries.length === 2);
        assert.deepEqual(after.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
        assert.equal(after.fingerprint, before.fingerprint);
        const restored = await getPage();
        assert.ok(!restored.body.includes(Buffer.from(marker)));
    } finally {
        if (app) await app.close();
        await store.close();
    }
    process.stdout.write("real marked rich post/edit variants, read-only HTTP and " +
        "exact normal-helper restoration: pass\n");
}

void main().catch(error => {
    process.stderr.write("cleaner live check failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});

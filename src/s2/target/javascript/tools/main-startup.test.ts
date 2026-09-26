// main-startup.test.ts
//
// Standalone executable failure and private-config disclosure checks.
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
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {regressionConfig, regressionConfigPath, recentRequest} from "./regression-config";
import {MysqlLiveStore} from "../live/data/mysql";
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("standalone main rejects invalid startup without exposing input", () => {
    const main = path.resolve(__dirname, "../live/server/main.js");
    const dir = mkdtempSync(path.join(os.tmpdir(), "s6-main-negative-"));
    try {
        const file = path.join(dir, "private.json");
        const secret = "must-never-appear-credential";
        writeFileSync(file, JSON.stringify({password: secret}), {mode: 0o600});
        const link = path.join(dir, "link.json");
        symlinkSync(file, link);
        for (const args of [[], ["--config", file], ["--config", link],
            ["--config", path.join(dir, secret)], ["--password", secret]]) {
            const result = spawnSync(process.execPath, [main, ...args],
                {encoding: "utf8", timeout: 5000});
            assert.equal(result.status, 1);
            assert.equal(result.error, undefined);
            assert.equal(result.stdout, "");
            assert.ok(!result.stderr.includes(secret));
            assert.ok(!result.stderr.includes(dir));
            assert.match(result.stderr, /^(Usage: main --config <private-json-file>|Invalid private startup configuration|Cannot read private startup config; check file, permissions and JSON)\n$/);
        }
    } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("ordinary standalone main serves GET/HEAD from fresh stage without changing data", {
    skip: process.env.S2_STANDALONE_MAIN !== "1",
}, async () => {
    const project = path.resolve(__dirname, "../..");
    const config = await regressionConfig(project);
    const username = process.env.S2_LIVE_JOURNAL ?? "s2js_slice3";
    assert.match(username, /^[a-z0-9_]{1,25}$/);
    const repository = await MysqlLiveStore.open(config.credential);
    let child: ReturnType<typeof spawn> | undefined;
    try {
        const baseline = await repository.loadRawSnapshot(recentRequest(username));
        assert.ok(baseline);
        child = spawn(process.execPath, [path.join(project, "dist/live/server/main.js"),
            "--config", regressionConfigPath(project)], {stdio: ["ignore", "pipe", "pipe"]});
        const listener = child;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("Main readiness timed out")), 10000);
            listener.stdout!.on("data", chunk => {
                if (String(chunk).includes("Private S2 listener ready")) {
                    clearTimeout(timer); resolve();
                }
            });
            listener.once("error", error => {clearTimeout(timer); reject(error);});
            listener.once("exit", code => {clearTimeout(timer); reject(Error("Main exited " + code));});
        });
        const headers = {Cookie: "ljuniq=AAAAAAAAAAAAAAA:" + Math.floor(Date.now()/1000) + ":x"};
        const base = config.public.listenOrigin + "/users/" + username + "/";
        for (const suffix of ["", ...baseline.entries.slice(0, 1).map(entry =>
            (entry.jitemid*256+entry.anum) + ".html")]) {
            const get = await fetch(base+suffix, {headers, redirect: "manual",
                signal: AbortSignal.timeout(20000)});
            const html = Buffer.from(await get.arrayBuffer());
            assert.equal(get.status, 200);
            assert.equal(get.headers.get("content-type"), "text/html; charset=utf-8");
            assert.equal(get.headers.get("cache-control"), "private, no-store");
            assert.equal(get.headers.get("set-cookie"), null);
            assert.equal(get.headers.get("location"), null);
            assert.equal(get.headers.get("content-length"), String(html.length));
            assert.ok(html.includes(Buffer.from("</html>")));
            const head = await fetch(base+suffix, {method: "HEAD", headers, redirect: "manual",
                signal: AbortSignal.timeout(20000)});
            assert.equal(head.status, 200);
            assert.equal(head.headers.get("content-length"), String(html.length));
            assert.equal((await head.arrayBuffer()).byteLength, 0);
            for (const name of ["content-type", "cache-control", "set-cookie", "location"]) {
                assert.equal(head.headers.get(name), get.headers.get(name));
            }
            assert.equal(await repository.revalidateFingerprint(baseline), true);
            console.log("ordinary main " + (suffix ? "Entry" : "Recent") + ": " + html.length +
                " bytes sha256=" + createHash("sha256").update(html).digest("hex"));
        }
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
            const listener = child;
            listener.kill("SIGTERM");
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    listener.kill("SIGKILL"); reject(Error("Main shutdown timed out"));
                }, 5000);
                listener.once("exit", () => {clearTimeout(timer); resolve();});
            });
        }
        await repository.close();
    }
});

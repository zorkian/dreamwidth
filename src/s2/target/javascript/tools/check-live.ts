// check-live.ts
//
// First live HTTP request and exact retained-Perl comparison for the marked journal.
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
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PublicAppConfig, RawRecentRepository } from "../live/contracts";
import { MysqlLiveStore, type MysqlStoreConfig } from "../live/data/mysql";
import { createComparisonRecentService } from "../live/policy/comparison";
import { createAnonymousRecentService } from "../live/policy/service";
import { createLiveApp } from "../live/server/app";

const project = path.resolve(__dirname, "../..");
const root = path.resolve(project, "../../../..");
const tools = path.join(project, "tools");
const artifacts = path.join(project, "artifacts/live");
const cookie = "AAAAAAAAAAAAAAA:1790294400:x";
const clock = 1790294400;
const route = "http://localhost:8081/users/s2js_slice3/";
const perlEnv = {
    ...process.env, LJHOME: root, PERL5LIB: "/opt/dreamwidth-extlib/lib/perl5",
    PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0",
};

function perl(script: string, args: string[] = []): void {
    const result = spawnSync("/usr/bin/perl", [path.join(tools, script), ...args], {
        cwd: root, env: perlEnv, timeout: 60000, maxBuffer: 2097152,
        encoding: "utf8", killSignal: "SIGKILL",
    });
    if (result.error || result.status !== 0) {
        throw new Error(script + " failed: " +
            (result.error?.message ?? "status " + result.status + ", signal " + result.signal) +
            "\n" + result.stderr);
    }
    process.stdout.write(result.stdout);
}

function setup(): void {
    mkdirSync(artifacts, {recursive: true});
    perl("live-seed.pl");
    perl("live-config.pl");
    perl("live-grants.pl");
    perl("live-compile.pl", [path.join(artifacts, "stock.json")]);
}

function config(): {public: PublicAppConfig; credential: MysqlStoreConfig} {
    return {
        public: JSON.parse(readFileSync(path.join(artifacts, "public-config.json"), "utf8")),
        credential: JSON.parse(readFileSync(path.join(artifacts, "mysql-readonly.json"), "utf8")),
    };
}

async function request(uniq: string | null = null, url = route): Promise<{
    status: number; headers: Headers; body: Buffer;
}> {
    const response = await fetch(url, {
        redirect: "manual", signal: AbortSignal.timeout(20000),
        headers: uniq === null ? {} : {Cookie: "ljuniq=" + uniq},
    });
    return {status: response.status, headers: response.headers,
        body: Buffer.from(await response.arrayBuffer())};
}

async function ready(child: ChildProcess): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        let stderr = "";
        let stdout = "";
        const timer = setTimeout(() => reject(new Error("TS listener startup timed out")), 10000);
        const finish = (error?: Error) => {
            clearTimeout(timer);
            child.stdout?.removeAllListeners("data");
            child.stderr?.removeAllListeners("data");
            child.removeAllListeners("error");
            child.removeAllListeners("exit");
            if (error) reject(error); else resolve();
        };
        child.stdout?.on("data", chunk => {
            stdout += String(chunk).slice(0, 1024);
            if (stdout.includes("Live S2 loopback listener ready")) finish();
        });
        child.stderr?.on("data", chunk => { stderr += String(chunk).slice(0, 1024); });
        child.once("error", finish);
        child.once("exit", code => finish(new Error("TS listener exited " + code + ": " + stderr)));
    });
}

async function stop(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("TS listener did not shut down"));
        }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
}

async function liveServer(run: () => Promise<void>): Promise<void> {
    const child = spawn(process.execPath, [path.join(project, "dist/live/server/main.js")], {
        cwd: project, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    try {
        await ready(child);
        await run();
    } finally {
        await stop(child);
    }
}

function sha(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function assertExactHtml(oracle: Buffer, rendered: Buffer): void {
    if (rendered.equals(oracle)) return;
    const limit = Math.min(rendered.length, oracle.length);
    let offset = 0;
    while (offset < limit && rendered[offset] === oracle[offset]) offset++;
    throw new Error("Exact HTML differs at byte " + offset + ": TS " +
        rendered.length + "/" + sha(rendered) + " Perl " +
        oracle.length + "/" + sha(oracle));
}

async function first(): Promise<void> {
    setup();
    const {credential} = config();
    const store = await MysqlLiveStore.open(credential);
    let beforeHash: string;
    try {
        const before = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(before);
        for (const key of ["customtext_title", "customtext_url", "customtext_content"] as const) {
            assert.equal(before.owner.publicSettings[key], null,
                key + ": first-request proof requires untouched marked journal");
        }
        beforeHash = before.fingerprint;
    } finally {
        await store.close();
    }
    await liveServer(async () => {
        const response = await request();
        assert.equal(response.status, 200, response.body.toString("utf8").slice(0, 120));
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("content-length"), String(response.body.length));
        assert.ok(response.body.includes(Buffer.from("Live sample 1 café")));
        assert.ok(response.body.includes(Buffer.from("Live sample 2 😀")));
        const check = await MysqlLiveStore.open(credential);
        try {
            assert.equal((await check.loadRawSnapshot("s2js_slice3"))?.fingerprint,
                beforeHash, "TS GET wrote journal state");
        } finally {
            await check.close();
        }
        writeFileSync(path.join(artifacts, "first-live.json"), JSON.stringify({
            status: response.status, bytes: response.body.length, sha256: sha(response.body),
            beforePerlGet: true,
        }, null, 2) + "\n");
    });
    process.stdout.write("first TS HTTP 200 before Perl journal GET; DB unchanged: pass\n");
}

async function update(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    await liveServer(async () => {
        const baseline = await request();
        assert.equal(baseline.status, 200);
        assert.ok(!baseline.body.includes(Buffer.from("S2JS3 live probe v1")));
        try {
            perl("live-probes.pl", ["--create-single"]);
            const state = JSON.parse(readFileSync(path.join(artifacts, "probe-state.json"), "utf8"));
            const posted = await request();
            assert.equal(posted.status, 200);
            assert.ok(posted.body.includes(Buffer.from(state.marker + " " + state.run + " public 1")));
            assert.ok(posted.body.includes(Buffer.from("Probe public 1 café 😀")));
            perl("live-probes.pl", ["--edit-single"]);
            const edited = await request();
            assert.equal(edited.status, 200);
            assert.ok(edited.body.includes(Buffer.from(state.marker + " " + state.run + " edited 1")));
            assert.ok(edited.body.includes(Buffer.from("Probe edited 1 café 😀")));
            assert.ok(!edited.body.includes(Buffer.from("Probe public 1 café 😀")));
        } finally {
            perl("live-probes.pl", ["--restore"]);
        }
        const restored = await request();
        assert.equal(restored.status, 200);
        assert.ok(!restored.body.includes(Buffer.from("S2JS3 live probe v1")));
        assert.ok(restored.body.includes(Buffer.from("Live sample 1 café")));
        assert.ok(restored.body.includes(Buffer.from("Live sample 2 😀")));
    });
    process.stdout.write("normal Perl post/edit appears on next TS HTTP GET; exact probe restored: pass\n");
}

async function recovery(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    const {credential} = config();
    const store = await MysqlLiveStore.open(credential);
    let seedIds: number[];
    try {
        const before = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(before && before.entries.length === 2);
        seedIds = before.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
    } finally {
        await store.close();
    }
    const marker = path.join(artifacts, "probe-posted.marker");
    const state = path.join(artifacts, "probe-state.json");
    for (const kind of ["single", "mixed"] as const) {
        const child = spawn("/usr/bin/perl",
            [path.join(tools, "live-probes.pl"), "--create-" + kind + "-pause-after-post"],
            {cwd: root, env: perlEnv, stdio: ["ignore", "ignore", "pipe"]});
        let stderr = "";
        child.stderr?.on("data", chunk => { stderr += String(chunk).slice(0, 2048); });
        const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); });
        try {
            const deadline = Date.now() + 10000;
            while (!existsSync(marker) && Date.now() < deadline && child.exitCode === null) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            assert.ok(existsSync(marker), "No committed-post handshake: " + stderr);
            assert.ok(existsSync(state), "Missing prewrite recovery intent");
            child.kill("SIGKILL");
            await exited;
            assert.equal(child.signalCode, "SIGKILL");
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            await exited;
            perl("live-probes.pl", ["--restore"]);
        }
        assert.equal(existsSync(state), false);
        assert.equal(existsSync(marker), false);
    }
    perl("live-probes.pl", ["--create-single"]);
    const suspendedMarker = path.join(artifacts, "probe-suspended.marker");
    const child = spawn("/usr/bin/perl",
        [path.join(tools, "live-probes.pl"), "--suspend-single-pause-after-set"],
        {cwd: root, env: perlEnv, stdio: ["ignore", "ignore", "pipe"]});
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk).slice(0, 2048); });
    const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); });
    try {
        const deadline = Date.now() + 10000;
        while (!existsSync(suspendedMarker) && Date.now() < deadline &&
            child.exitCode === null) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(existsSync(suspendedMarker), "No committed-suspension handshake: " + stderr);
        assert.ok(existsSync(state), "Missing presuspension recovery intent");
        child.kill("SIGKILL");
        await exited;
        assert.equal(child.signalCode, "SIGKILL");
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
        perl("live-probes.pl", ["--restore"]);
    }
    assert.equal(existsSync(state), false);
    assert.equal(existsSync(suspendedMarker), false);
    const restored = await MysqlLiveStore.open(credential);
    try {
        const snapshot = await restored.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot);
        assert.deepEqual(snapshot.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
    } finally {
        await restored.close();
    }
    process.stdout.write(
        "single/mixed post and entry suspension SIGKILL recovery: pass\n");
}

async function pagination(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    const {public: publicConfig, credential} = config();
    const baselineStore = await MysqlLiveStore.open(credential);
    let seedIds: number[];
    try {
        const snapshot = await baselineStore.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot && snapshot.entries.length === 2);
        seedIds = snapshot.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
    } finally {
        await baselineStore.close();
    }
    try {
        perl("live-probes.pl", ["--create-mixed"]);
        const state = JSON.parse(readFileSync(path.join(artifacts, "probe-state.json"), "utf8"));
        const marker = state.marker + " " + state.run;
        const populated = await MysqlLiveStore.open(credential);
        try {
            const snapshot = await populated.loadRawSnapshot("s2js_slice3");
            assert.ok(snapshot);
            assert.equal(snapshot.entries.length, 26);
            assert.equal(snapshot.entries.filter(entry => entry.security === "public").length, 24);
            assert.equal(snapshot.entries.filter(entry => entry.security === "private").length, 1);
            assert.equal(snapshot.entries.filter(entry => entry.security === "usemask").length, 1);
        } finally {
            await populated.close();
        }
        await liveServer(async () => {
            const page = await request();
            assert.equal(page.status, 200, page.body.toString("utf8").slice(0, 120));
            assert.equal(page.headers.get("cache-control"), "private, no-store");
            assert.ok(page.body.includes(Buffer.from(marker + " public 22")));
            assert.ok(!page.body.includes(Buffer.from(marker + " private 23")));
            assert.ok(!page.body.includes(Buffer.from(marker + " usemask 24")));
        });
        const store = await MysqlLiveStore.open(credential);
        let app: ReturnType<typeof createLiveApp> | undefined;
        try {
            const service = await createComparisonRecentService({
                repository: store, secretSource: store,
                artifact: {path: path.join(artifacts, "stock.json")}, config: publicConfig,
                limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
            }, {
                purpose: "offline-perl-comparison",
                clock: {nowSeconds: () => clock},
                random: {randomBytes: length => new Uint8Array(length)},
            });
            app = createLiveApp(publicConfig, service);
            app.addHook("onClose", async () => { await service.close(); });
            await app.listen({host: "127.0.0.1", port: 8081});
            for (const skip of [null, 0, 20, 79, 80, 81, 200] as const) {
                const label = skip === null ? "absent" : String(skip);
                const directory = path.join(artifacts, "oracle-mixed-" + label);
                mkdirSync(directory, {recursive: true});
                const args = [publicConfig.canonicalAppOrigin, directory,
                    "--comparison", cookie, "--cohort-variant"];
                if (skip !== null) args.push("--skip", String(skip));
                perl("live-oracle.pl", args);
                const oracle = readFileSync(path.join(directory, "page-oracle.html"));
                const result = await request(cookie, route +
                    (skip === null ? "" : "?skip=" + skip));
                assert.equal(result.status, 200, label);
                assert.equal(result.headers.get("cache-control"), "private, no-store");
                assert.ok(!result.body.includes(Buffer.from(marker + " private 23")));
                assert.ok(!result.body.includes(Buffer.from(marker + " usemask 24")));
                assertExactHtml(oracle, result.body);
                process.stdout.write("mixed skip " + label + ": exact " + oracle.length + " bytes\n");
            }
        } finally {
            if (app) await app.close();
            await store.close();
        }
    } finally {
        perl("live-probes.pl", ["--restore"]);
    }
    const restored = await MysqlLiveStore.open(credential);
    try {
        const snapshot = await restored.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot);
        assert.deepEqual(snapshot.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
    } finally {
        await restored.close();
    }
    process.stdout.write("mixed public/private/usemask pagination and exact cleanup: pass\n");
}

async function compare(): Promise<void> {
    setup();
    const {public: publicConfig, credential} = config();
    const one = path.join(artifacts, "oracle-one");
    const two = path.join(artifacts, "oracle-two");
    mkdirSync(one, {recursive: true});
    mkdirSync(two, {recursive: true});
    perl("live-oracle.pl", [publicConfig.canonicalAppOrigin, one, "--comparison", cookie]);
    perl("live-oracle.pl", [publicConfig.canonicalAppOrigin, two, "--comparison", cookie]);
    const oracle = readFileSync(path.join(one, "page-oracle.html"));
    assert.ok(oracle.equals(readFileSync(path.join(two, "page-oracle.html"))),
        "Controlled real Perl HTML changed");
    assert.ok(readFileSync(path.join(one, "response-metadata.json")).equals(
        readFileSync(path.join(two, "response-metadata.json"))),
    "Controlled real Perl response metadata changed");
    const metadata = JSON.parse(readFileSync(path.join(one, "response-metadata.json"), "utf8"));
    assert.equal(metadata.status, "200");
    assert.equal(metadata.bytes, oracle.length);
    assert.equal(metadata.sha256, sha(oracle));
    assert.equal(metadata.comparison, true);
    assert.equal(metadata.comparison_time, clock);
    assert.equal(metadata.comparison_cookie, cookie);
    assert.equal(metadata.comparison_random10, "aaaaaaaaaa");
    assert.equal(metadata.perl_hash_seed, "0");
    assert.equal(metadata.perl_perturb_keys, "0");
    assert.ok(Array.isArray(metadata.response_headers));
    assert.ok(!metadata.response_headers.some((header: [string, string]) =>
        header[0].toLowerCase() === "set-cookie"));
    const store = await MysqlLiveStore.open(credential);
    let app: ReturnType<typeof createLiveApp> | undefined;
    try {
        const before = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(before);
        const service = await createComparisonRecentService({
            repository: store, secretSource: store,
            artifact: {path: path.join(artifacts, "stock.json")}, config: publicConfig,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
        }, {
            purpose: "offline-perl-comparison",
            clock: {nowSeconds: () => clock},
            random: {randomBytes: length => new Uint8Array(length)},
        });
        app = createLiveApp(publicConfig, service);
        app.addHook("onClose", async () => { await service.close(); });
        await app.listen({host: "127.0.0.1", port: 8081});
        const rendered = await request(cookie);
        writeFileSync(path.join(artifacts, "page-ts.html"), rendered.body);
        assert.equal(rendered.status, 200, rendered.body.toString("utf8").slice(0, 120));
        assert.equal(rendered.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(rendered.headers.get("cache-control"), "private, no-store");
        assert.equal(rendered.headers.get("content-length"), String(rendered.body.length));
        assert.equal(rendered.headers.get("set-cookie"), null);
        assertExactHtml(oracle, rendered.body);
        const head = await fetch(route, {
            method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(20000),
            headers: {Cookie: "ljuniq=" + cookie},
        });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-type"), rendered.headers.get("content-type"));
        assert.equal(head.headers.get("cache-control"), rendered.headers.get("cache-control"));
        assert.equal(head.headers.get("content-length"), String(rendered.body.length));
        assert.equal(head.headers.get("set-cookie"), null);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        assert.equal((await store.loadRawSnapshot("s2js_slice3"))?.fingerprint,
            before.fingerprint, "Compared GET/HEAD wrote journal state");
        const deliberatelyChanged = Buffer.from(rendered.body);
        assert.ok(deliberatelyChanged.length > 10);
        deliberatelyChanged[10] = deliberatelyChanged[10]! ^ 1;
        assert.throws(() => assertExactHtml(oracle, deliberatelyChanged),
            /Exact HTML differs at byte 10:/,
            "Exact comparison must detect a same-length byte mutation");
    } finally {
        if (app) await app.close();
        await store.close();
    }
    process.stdout.write("real Perl/TS exact recent HTML " + oracle.length + " bytes: pass\n");
}

async function resources(): Promise<void> {
    setup();
    const {public: publicConfig} = config();
    await liveServer(async () => {
        const page = await request();
        assert.equal(page.status, 200);
        const html = page.body.toString("utf8");
        const destinations = new Map<string, {method: "GET" | "POST"; target: string}>();
        const attribute = /\b(href|src|action)\s*=\s*(["'])(.*?)\2/gi;
        const attributes = [...html.matchAll(attribute)];
        assert.equal(attributes.length,
            [...html.matchAll(/\b(?:href|src|action)\s*=/gi)].length,
            "Stock URL attribute was not quoted and enumerated");
        for (const match of attributes) {
            const value = match[3]!;
            if (!value.startsWith("/") || value.startsWith("//")) continue;
            const tagStart = html.lastIndexOf("<", match.index);
            const tagEnd = html.indexOf(">", tagStart);
            assert.ok(tagStart >= 0 && tagEnd > match.index,
                "Root-relative URL is outside a stock HTML tag");
            const tag = html.slice(tagStart, tagEnd + 1);
            let method: "GET" | "POST" = "GET";
            if (match[1]!.toLowerCase() === "action") {
                assert.match(tag, /^<form\b/i);
                const methodAttribute = /\bmethod\s*=\s*(["'])(.*?)\1/i.exec(tag);
                assert.equal(methodAttribute?.[2]?.toLowerCase(), "post");
                method = "POST";
            }
            // Browser attribute parsing decodes the only entity in the pinned
            // stock URL inventory before making the request.
            assert.ok(!/&(?:#|[A-Za-z][A-Za-z0-9]*;)/.test(
                value.replaceAll("&amp;", "")),
                "Unsupported URL entity in emitted stock markup");
            const target = value.replaceAll("&amp;", "&");
            assert.equal(new URL(target, publicConfig.listenOrigin).pathname +
                new URL(target, publicConfig.listenOrigin).search, target);
            destinations.set(method + "\0" + target, {method, target});
        }
        assert.ok(destinations.size >= 26, "Stock page URL inventory was incomplete");
        const posts = [...destinations.values()].filter(item => item.method === "POST")
            .map(item => item.target).sort();
        assert.deepEqual(posts, ["/login", "/multisearch"]);
        let staticCount = 0;
        for (const {method, target} of destinations.values()) {
            const response = await fetch(publicConfig.listenOrigin + target, {
                method, redirect: "manual", signal: AbortSignal.timeout(10000),
                headers: method === "POST" ? {Origin: publicConfig.listenOrigin} : {},
            });
            assert.equal(response.status, 307, method + " " + target);
            assert.equal(response.headers.get("location"),
                publicConfig.canonicalAppOrigin + target, method + " " + target);
            assert.equal(response.headers.get("cache-control"), "private, no-store");
            await response.arrayBuffer();
            if (/^\/(?:stc|js|img)\//.test(target)) {
                staticCount++;
                const retained = await fetch(publicConfig.canonicalAppOrigin + target, {
                    redirect: "manual", signal: AbortSignal.timeout(10000),
                });
                assert.equal(retained.status, 200, "Retained static " + target);
                await retained.arrayBuffer();
            }
        }
        assert.ok(staticCount > 0, "No stock static resources were checked");
        process.stdout.write("all " + destinations.size + " emitted root-relative URLs " +
            "redirect exactly; " + staticCount + " retained static targets 200: pass\n");
    });
}

async function appAvailable(): Promise<boolean> {
    try {
        const response = await fetch("http://127.0.0.1:8080/users/s2js_slice3/", {
            signal: AbortSignal.timeout(1500),
        });
        await response.arrayBuffer();
        return response.status === 200;
    } catch {
        return false;
    }
}

async function noPerl(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    assert.equal(await appAvailable(), true, "Retained app must start available");
    await liveServer(async () => {
        const kill = spawnSync("/usr/bin/pkill", ["starman"], {
            cwd: root, timeout: 5000, encoding: "utf8",
        });
        assert.equal(kill.status, 0, "Cannot stop only own Starman processes");
        try {
            let absent = false;
            for (let attempt = 0; attempt < 30; attempt++) {
                if (!await appAvailable()) { absent = true; break; }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.equal(absent, true, "Retained Perl listener stayed available");
            const live = await request();
            assert.equal(live.status, 200, live.body.toString("utf8").slice(0, 120));
            assert.equal(live.headers.get("cache-control"), "private, no-store");
            assert.ok(live.body.includes(Buffer.from("Live sample 1 café")));
            assert.ok(live.body.includes(Buffer.from("Live sample 2 😀")));
            const head = await fetch(route, {
                method: "HEAD", signal: AbortSignal.timeout(20000),
            });
            assert.equal(head.status, 200);
            assert.equal(head.headers.get("cache-control"), "private, no-store");
            assert.ok(Number(head.headers.get("content-length")) > 10000);
            assert.equal((await head.arrayBuffer()).byteLength, 0);
        } finally {
            const start = spawnSync("/usr/bin/bash", [".devcontainer/start.sh"], {
                cwd: root, env: process.env, timeout: 30000,
                maxBuffer: 1024 * 1024, encoding: "utf8",
            });
            assert.equal(start.status, 0, "Cannot restore retained Perl listener: " +
                start.stderr.slice(0, 500));
        }
    });
    assert.equal(await appAvailable(), true, "Retained Perl listener did not recover");
    process.stdout.write("actual TS recent HTTP 200 while Perl listener unavailable: pass\n");
}

async function crossJournal(): Promise<void> {
    perl("live-other-probe.pl", ["--restore"]);
    setup();
    perl("live-seed.pl", ["--other"]);
    const {public: publicConfig, credential} = config();
    const store = await MysqlLiveStore.open(credential);
    try {
        const original = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(original && original.entries.length === 2);
        const seedIds = original.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
        try {
            perl("live-other-probe.pl", ["--create-primary"]);
            const baseline = await store.loadRawSnapshot("s2js_slice3");
            assert.ok(baseline && baseline.entries.length === 3);
            const service = await createComparisonRecentService({
                repository: store, secretSource: store,
                artifact: {path: path.join(artifacts, "stock.json")}, config: publicConfig,
                limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
            }, {
                purpose: "offline-perl-comparison",
                clock: {nowSeconds: () => clock},
                random: {randomBytes: length => new Uint8Array(length)},
            });
            const app = createLiveApp(publicConfig, service);
            app.addHook("onClose", async () => { await service.close(); });
            try {
                await app.listen({host: "127.0.0.1", port: 8081});
                const primaryHtml = await request(cookie);
                assert.equal(primaryHtml.status, 200);
                perl("live-other-probe.pl", ["--create-other"]);
                const state = JSON.parse(readFileSync(
                    path.join(artifacts, "other-probe-state.json"), "utf8"));
                assert.notEqual(state.other_ownerid, original.owner.userid);
                assert.equal(state.ids.s2js_slice3.jitemid,
                    state.ids.s2js_slice3_other.jitemid);
                const refreshed = await store.loadRawSnapshot("s2js_slice3");
                assert.ok(refreshed);
                assert.equal(refreshed.fingerprint, baseline.fingerprint);
                assert.equal(refreshed.entries.length, 3);
                const primary = await request(cookie);
                assert.equal(primary.status, 200);
                assert.ok(primary.body.equals(primaryHtml.body));
                assert.ok(!primary.body.includes(Buffer.from(
                    state.marker + " " + state.run + " s2js_slice3_other")));
                const alternate = await request(cookie,
                    "http://localhost:8081/users/s2js_slice3_other/");
                assert.equal(alternate.status, 400);
                assert.equal(alternate.body.toString("utf8"), "Unsupported request\n");
            } finally {
                await app.close();
            }
        } finally {
            perl("live-other-probe.pl", ["--restore"]);
        }
        const restored = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(restored);
        assert.deepEqual(restored.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
    } finally {
        await store.close();
    }
    process.stdout.write("same-ID cross-journal row isolated; other probe restored: pass\n");
}

async function empty(): Promise<void> {
    perl("live-empty.pl", ["--restore"]);
    setup();
    const {public: publicConfig, credential} = config();
    const baseline = await MysqlLiveStore.open(credential);
    let seedIds: number[];
    try {
        const snapshot = await baseline.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot && snapshot.entries.length === 2);
        seedIds = snapshot.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
    } finally {
        await baseline.close();
    }
    try {
        perl("live-empty.pl", ["--hide"]);
        const reader = await MysqlLiveStore.open(credential);
        try {
            const hidden = await reader.loadRawSnapshot("s2js_slice3");
            assert.ok(hidden && hidden.entries.length === 2);
            assert.ok(hidden.entries.every(entry => entry.security === "private"));
        } finally {
            await reader.close();
        }
        await liveServer(async () => {
            const page = await request();
            assert.equal(page.status, 200, page.body.toString("utf8").slice(0, 120));
            assert.ok(!page.body.includes(Buffer.from("Live sample 1")));
            assert.ok(!page.body.includes(Buffer.from("Live sample 2")));
            assert.ok(!page.body.includes(Buffer.from(
                '/~s2js_slice3/2026/09/24/" title=')));
            assert.equal(page.headers.get("cache-control"), "private, no-store");
        });
        const directory = path.join(artifacts, "oracle-empty");
        mkdirSync(directory, {recursive: true});
        perl("live-oracle.pl", [
            publicConfig.canonicalAppOrigin, directory, "--comparison", cookie,
            "--cohort-variant",
        ]);
        const oracle = readFileSync(path.join(directory, "page-oracle.html"));
        const store = await MysqlLiveStore.open(credential);
        let app: ReturnType<typeof createLiveApp> | undefined;
        try {
            const service = await createComparisonRecentService({
                repository: store, secretSource: store,
                artifact: {path: path.join(artifacts, "stock.json")}, config: publicConfig,
                limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
            }, {
                purpose: "offline-perl-comparison",
                clock: {nowSeconds: () => clock},
                random: {randomBytes: length => new Uint8Array(length)},
            });
            app = createLiveApp(publicConfig, service);
            app.addHook("onClose", async () => { await service.close(); });
            await app.listen({host: "127.0.0.1", port: 8081});
            const rendered = await request(cookie);
            assert.equal(rendered.status, 200);
            assertExactHtml(oracle, rendered.body);
        } finally {
            if (app) await app.close();
            await store.close();
        }
    } finally {
        perl("live-empty.pl", ["--restore"]);
    }
    const restored = await MysqlLiveStore.open(credential);
    try {
        const snapshot = await restored.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot);
        assert.deepEqual(snapshot.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
        assert.ok(snapshot.entries.every(entry => entry.security === "public"));
    } finally {
        await restored.close();
    }
    process.stdout.write("empty real public cohort, hidden calendar and exact Perl HTML: pass\n");
}

async function entryStates(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    const {credential} = config();
    const store = await MysqlLiveStore.open(credential);
    const seed = await store.loadRawSnapshot("s2js_slice3");
    assert.ok(seed && seed.entries.length === 2);
    const seedIds = seed.entries.map(entry => entry.jitemid).sort((a, b) => a - b);
    try {
        await liveServer(async () => {
            try {
                perl("live-probes.pl", ["--create-single"]);
                const state = JSON.parse(readFileSync(
                    path.join(artifacts, "probe-state.json"), "utf8"));
                const marker = state.marker + " " + state.run;
                const dayLink = '/~s2js_slice3/2026/09/23/" title=';
                const publicPage = await request();
                assert.equal(publicPage.status, 200);
                assert.ok(publicPage.body.includes(Buffer.from(marker)));
                assert.ok(publicPage.body.includes(Buffer.from(dayLink)));
                const beforeSuspend = await store.loadRawSnapshot("s2js_slice3");
                assert.ok(beforeSuspend);
                perl("live-probes.pl", ["--suspend-single"]);
                const suspended = await store.loadRawSnapshot("s2js_slice3");
                assert.ok(suspended);
                assert.notEqual(suspended.fingerprint, beforeSuspend.fingerprint,
                    "Suspended entry must revoke the primary fingerprint");
                assert.equal(suspended.entries.find(entry =>
                    entry.jitemid === state.ids["1"].jitemid)?.props.statusvis, "S");
                const refused = await request();
                assert.equal(refused.status, 422);
                assert.equal(refused.body.toString("utf8"), "Unsupported journal state\n");
                assert.equal(refused.headers.get("content-type"), "text/plain; charset=utf-8");
                assert.equal(refused.headers.get("cache-control"), "private, no-store");
                assert.equal(refused.headers.get("set-cookie"), null);
                assert.equal(refused.headers.get("location"), null);
                assert.ok(!refused.body.includes(Buffer.from(marker)));
                assert.ok(!refused.body.includes(Buffer.from("<html")));
                perl("live-probes.pl", ["--unsuspend-single"]);
                assert.equal((await store.loadRawSnapshot("s2js_slice3"))?.fingerprint,
                    beforeSuspend.fingerprint, "Original entry status property was not restored");
                const unsuspended = await request();
                assert.equal(unsuspended.status, 200);
                assert.ok(unsuspended.body.includes(Buffer.from(marker)));
                for (const security of ["private", "usemask"] as const) {
                    perl("live-probes.pl", ["--" + security + "-single"]);
                    const snapshot = await store.loadRawSnapshot("s2js_slice3");
                    assert.ok(snapshot && snapshot.entries.some(entry =>
                        entry.jitemid === state.ids["1"].jitemid &&
                        entry.security === security));
                    const hidden = await request();
                    assert.equal(hidden.status, 200);
                    assert.ok(!hidden.body.includes(Buffer.from(marker)));
                    assert.ok(!hidden.body.includes(Buffer.from(dayLink)));
                    assert.ok(hidden.body.includes(Buffer.from("Live sample 1 café")));
                }
                perl("live-probes.pl", ["--public-single"]);
                assert.ok((await request()).body.includes(Buffer.from(marker)));
                perl("live-probes.pl", ["--delete-single"]);
                const deleted = await request();
                assert.equal(deleted.status, 200);
                assert.ok(!deleted.body.includes(Buffer.from(marker)));
                assert.ok(!deleted.body.includes(Buffer.from(dayLink)));
            } finally {
                perl("live-probes.pl", ["--restore"]);
            }
        });
        const restored = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(restored);
        assert.deepEqual(restored.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            seedIds);
    } finally {
        await store.close();
    }
    process.stdout.write(
        "public/suspended/private/usemask/deleted entry and calendar disclosure: pass\n");
}

async function contentRefusal(): Promise<void> {
    perl("live-probes.pl", ["--restore"]);
    setup();
    const {credential} = config();
    const store = await MysqlLiveStore.open(credential);
    const baseline = await store.loadRawSnapshot("s2js_slice3");
    assert.ok(baseline && baseline.entries.length === 2);
    try {
        await liveServer(async () => {
            for (const kind of ["bad-malformed", "bad-url", "bad-script"] as const) {
                try {
                    perl("live-probes.pl", ["--create-" + kind]);
                    const state = JSON.parse(readFileSync(
                        path.join(artifacts, "probe-state.json"), "utf8"));
                    const snapshot = await store.loadRawSnapshot("s2js_slice3");
                    assert.ok(snapshot && snapshot.entries.length === 3);
                    assert.ok(snapshot.entries.some(entry =>
                        entry.jitemid === state.ids["1"].jitemid &&
                        entry.subjectText.includes(kind)));
                    const response = await request();
                    assert.equal(response.status, 422, kind);
                    assert.equal(response.body.toString("utf8"), "Unsupported journal state\n");
                    assert.equal(response.headers.get("cache-control"), "private, no-store");
                    assert.equal(response.headers.get("set-cookie"), null);
                    assert.ok(!response.body.includes(Buffer.from(state.run)));
                } finally {
                    perl("live-probes.pl", ["--restore"]);
                }
                const restoredPage = await request();
                assert.equal(restoredPage.status, 200);
                assert.ok(restoredPage.body.includes(Buffer.from("Live sample 1 café")));
            }
        });
        const after = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(after && after.entries.length === 2);
        assert.deepEqual(after.entries.map(entry => entry.jitemid).sort((a, b) => a - b),
            baseline.entries.map(entry => entry.jitemid).sort((a, b) => a - b));
    } finally {
        await store.close();
    }
    process.stdout.write("malformed body, URL attribute and script real HTTP refusal: pass\n");
}

async function missing(): Promise<void> {
    setup();
    const {credential} = config();
    const store = await MysqlLiveStore.open(credential);
    try {
        assert.equal(await store.loadRawSnapshot("s2js_slice3_missing"), null);
        await liveServer(async () => {
            const response = await request(null,
                "http://localhost:8081/users/s2js_slice3_missing/");
            assert.equal(response.status, 400);
            assert.equal(response.body.toString("utf8"), "Unsupported request\n");
            assert.equal(response.headers.get("cache-control"), "private, no-store");
            assert.equal(response.headers.get("set-cookie"), null);
        });
    } finally {
        await store.close();
    }
    process.stdout.write("missing primary mapping and unadmitted HTTP journal: pass\n");
}

async function recheck(): Promise<void> {
    perl("live-mutate.pl", ["--restore"]);
    setup();
    const {public: publicConfig, credential} = config();
    const store = await MysqlLiveStore.open(credential);
    const baseline = await store.loadRawSnapshot("s2js_slice3");
    assert.ok(baseline);
    let changed = false;
    const repository: RawRecentRepository = {
        loadRawSnapshot: username => store.loadRawSnapshot(username),
        revalidateFingerprint: async snapshot => {
            if (!changed) {
                changed = true;
                perl("live-mutate.pl", ["--mutate"]);
            }
            return store.revalidateFingerprint(snapshot);
        },
        close: () => store.close(),
    };
    let app: ReturnType<typeof createLiveApp> | undefined;
    try {
        const service = await createAnonymousRecentService({
            repository, secretSource: store,
            artifact: {path: path.join(artifacts, "stock.json")},
            config: publicConfig,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128},
        });
        app = createLiveApp(publicConfig, service);
        app.addHook("onClose", async () => { await service.close(); });
        await app.listen({host: "127.0.0.1", port: 8081});
        const blocked = await request();
        assert.equal(changed, true);
        assert.equal(blocked.status, 409);
        assert.equal(blocked.body.toString("utf8"), "Journal changed during render\n");
        assert.equal(blocked.headers.get("cache-control"), "private, no-store");
        assert.equal(blocked.headers.get("set-cookie"), null);
        const next = await request();
        assert.equal(next.status, 200);
        assert.ok(next.body.includes(Buffer.from("S2 slice 3 mutation probe")));
        perl("live-mutate.pl", ["--restore"]);
        const restoredPage = await request();
        assert.equal(restoredPage.status, 200);
        assert.ok(restoredPage.body.includes(Buffer.from("S2 slice 3 fixture")));
        assert.equal(await store.revalidateFingerprint(baseline), true);
    } finally {
        perl("live-mutate.pl", ["--restore"]);
        if (app) await app.close();
        await store.close();
    }
    process.stdout.write("real primary mutation before final recheck blocks partial HTML: pass\n");
}

async function main(): Promise<void> {
    const mode = process.argv[2];
    assert.ok(mode === "first" || mode === "compare" ||
        mode === "update" || mode === "recovery" || mode === "pagination" ||
        mode === "resources" ||
        mode === "no-perl" || mode === "cross-journal" ||
        mode === "empty" || mode === "entry-states" ||
        mode === "content-refusal" || mode === "missing" || mode === "recheck",
    "Usage: node dist/tools/check-live.js first|compare|resources|update|recovery|pagination|no-perl|cross-journal|empty|entry-states|content-refusal|missing|recheck");
    if (mode === "first") await first();
    else if (mode === "compare") await compare();
    else if (mode === "update") await update();
    else if (mode === "pagination") await pagination();
    else if (mode === "resources") await resources();
    else if (mode === "recovery") await recovery();
    else if (mode === "no-perl") await noPerl();
    else if (mode === "cross-journal") await crossJournal();
    else if (mode === "empty") await empty();
    else if (mode === "entry-states") await entryStates();
    else if (mode === "content-refusal") await contentRefusal();
    else if (mode === "missing") await missing();
    else await recheck();
}

void main().catch(error => {
    process.stderr.write("live check failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});

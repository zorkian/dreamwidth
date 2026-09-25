// image-qualification.test.ts
//
// Independent offline membership authority and synthetic image signing qualification.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {spawn, spawnSync} from "node:child_process";
import {resolve} from "node:path";
import type {EntryContentInput, ImageRequestSet, ImageResolutionSet, ContentWireInput,
    ContentWireImages, ContentWireResult} from "@dreamwidth/content/contracts";
import {verifyRuntime} from "../render/manifest";
import {childArguments} from "../render/child";
import {config, limits} from "./fixtures";

const proxy = "https://proxy.example.test";
// Deliberately public synthetic test material. Never copy it into the stage or
// child environment/IPC. No production/local configured proxy secret is used.
const salt = Buffer.from("DECLARED-OFFLINE-SYNTHETIC-PROXY-KEY-ONLY-v1");
const artifact = process.env.S2_LIVE_TEST_ARTIFACT || "/tmp/slice3-stock.json";
const jobId = "synthetic-image-test";
const context: EntryContentInput["context"] = {
    policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow",
    documentUrl: "http://localhost:8080/~s2js_slice3/?skip=0",
    entryUrl: "http://localhost:8080/~s2js_slice3/436.html", journalUsername: "s2js_slice3",
    journalId: 6, entryId: 436, cuts: "source-compatible-recent",
    reader: {removeColors: false, removeSizes: false, removeFonts: false,
        maxImageWidth: null, maxImageHeight: null, placeholderUndefinedImageSize: false, extractImages: false},
    ...config.entryContent,
    urls: {...config.entryContent.urls, imageProxy: "host-resolved", siteDomain: "site.org",
        knownHttpsSites: ["known.org"]},
};
interface NativePlan {
    readonly kind: "plan";
    readonly requests: readonly {ordinal: number; attribute: "src" | "srcset";
        byteStart: number; byteEnd: number; url: string}[];
    readonly images: ImageResolutionSet["images"];
    readonly all: readonly {url: string; resolved: string}[];
    readonly nativeHtml: string;
}
interface ApprovedPlan {
    readonly inputSha256: string;
    readonly requests: ImageRequestSet["requests"];
    readonly native: NativePlan;
}
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) freeze(item);
        Object.freeze(value);
    }
    return value;
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ":" +
            canonical((value as Record<string, unknown>)[key])).join(",")}}`;
    }
    return JSON.stringify(value);
}
function digest(input: EntryContentInput): string {
    return createHash("sha256").update(canonical(input)).digest("hex");
}
function byteOffset(raw: Buffer, offset: number): number {
    assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset <= raw.length);
    return new TextDecoder("utf-8", {fatal: true}).decode(raw.subarray(0, offset)).length;
}
function nativePlan(input: EntryContentInput, saltPath: string): NativePlan | {kind: "unsupported"} {
    const result = spawnSync("perl", [resolve(__dirname, "../../../live/tests/image-plan.pl")], {
        input: JSON.stringify({input, proxy, saltPath}), encoding: "utf8", timeout: 10000, maxBuffer: 2097152,
        env: {...process.env, PERL_HASH_SEED: "0", PERL_PERTURB_KEYS: "0"},
    });
    assert.equal(result.status, 0, "offline native helper must complete without raw diagnostics");
    return JSON.parse(result.stdout) as NativePlan | {kind: "unsupported"};
}
function approve(input: EntryContentInput, native: NativePlan): ApprovedPlan {
    const raw = Buffer.from(input.body, "utf8");
    const requests = native.requests.map((item, ordinal) => {
        assert.equal(item.ordinal, ordinal);
        assert.ok(item.byteEnd >= item.byteStart);
        const sourceStart = byteOffset(raw, item.byteStart);
        const sourceEnd = byteOffset(raw, item.byteEnd);
        const sourceText = new TextDecoder("utf-8", {fatal: true}).decode(raw.subarray(item.byteStart, item.byteEnd));
        assert.equal(input.body.slice(sourceStart, sourceEnd), sourceText);
        return {ordinal, attribute: item.attribute, url: item.url, sourceStart, sourceEnd, sourceText};
    });
    return freeze({inputSha256: digest(input), requests, native});
}
function authorizeAndSign(input: EntryContentInput, plan: ApprovedPlan, untrusted: unknown,
    sign: (url: string) => string): ImageResolutionSet {
    // All authority comes from the original input and offline independently
    // parsed plan, never a worker-provided slice/hash or URL accepted in isolation.
    assert.equal(digest(input), plan.inputSha256);
    assert.deepEqual(untrusted, {inputSha256: plan.inputSha256, requests: plan.requests});
    return {inputSha256: plan.inputSha256,
        images: plan.requests.map(item => ({ordinal: item.ordinal, url: sign(item.url)}))};
}
function signSynthetic(url: string): string {
    assert.ok(url.startsWith("http://"));
    const encoded = url.replaceAll(" ", "%20");
    const signature = createHash("md5").update(salt).update(encoded, "utf8").digest("hex").slice(0, 12);
    // The native offline oracle supplies no journal; its actual source path is
    // '-'. This is not an assertion about production journal/account resolution.
    return `${proxy}/${signature}/-/${encoded.slice(7)}`;
}
async function exchange(input: EntryContentInput, plan: ApprovedPlan, saltPath: string): Promise<string> {
    const runtime = verifyRuntime(artifact);
    const script = resolve(__dirname, "image-worker.js");
    const args = childArguments(limits, runtime, script);
    args.splice(args.length - 1, 0, "--allow-fs-read=" + script);
    args.push(runtime.root, saltPath);
    const request: ContentWireInput = {version: 1, kind: "clean-entries", jobId, entries: [{key: "entry", input}]};
    let launches = 0;
    const result = await new Promise<string>((resolveResult, reject) => {
        launches++;
        const child = spawn(artifact + ".sandbox", args, {cwd: runtime.root,
            env: {LANG: "C.UTF-8", TZ: "UTC"}, stdio: ["pipe", "pipe", "ignore"]});
        let pending = Buffer.alloc(0), received = 0, frames = 0;
        let completed: string | undefined;
        let failed = false;
        const fail = (): void => {
            failed = true; child.kill("SIGKILL"); reject(new Error("Synthetic exchange failed"));
        };
        const timer = setTimeout(fail, limits.timeoutMs); // Entire exchange, not per message.
        child.on("error", fail);
        child.stdin.on("error", fail);
        child.stdout.on("data", (chunk: Buffer) => {
            try {
                received += chunk.length;
                assert.ok(received <= limits.maxOutputBytes);
                pending = Buffer.concat([pending, chunk]);
                let newline: number;
                while ((newline = pending.indexOf(10)) >= 0) {
                    const wire = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(pending.subarray(0, newline))) as ContentWireResult;
                    pending = pending.subarray(newline + 1);
                    assert.deepEqual(Object.keys(wire).sort(), ["entries", "jobId", "kind", "version"]);
                    assert.equal(wire.version, 1); assert.equal(wire.jobId, jobId);
                    assert.ok("entries" in wire && wire.entries.length === 1 && wire.entries[0]!.key === "entry");
                    if (++frames === 1 && wire.kind === "image-resolution-required") {
                        assert.deepEqual(Object.keys(wire.entries[0]!).sort(), ["images", "key"]);
                        const resolutions = authorizeAndSign(input, plan, wire.entries[0]!.images, signSynthetic);
                        assert.deepEqual(resolutions.images, plan.native.images, "actual retained signature/source path");
                        const reply: ContentWireImages = {version: 1, kind: "resolve-images", jobId,
                            entries: [{key: "entry", resolutions}]};
                        child.stdin.end(JSON.stringify(reply) + "\n");
                    } else if (frames === 2 && wire.kind === "complete") {
                        assert.deepEqual(Object.keys(wire.entries[0]!).sort(), ["html", "key", "provenance"]);
                        completed = wire.entries[0]!.html;
                        assert.equal(wire.entries[0]!.provenance.inputSha256, plan.inputSha256);
                        assert.equal(wire.entries[0]!.provenance.outputSha256,
                            createHash("sha256").update(completed).digest("hex"));
                    } else throw new Error();
                }
            } catch { fail(); }
        });
        child.on("close", code => {
            clearTimeout(timer);
            if (failed) return;
            if (code !== 0 || frames !== 2 || pending.length || completed === undefined) { fail(); return; }
            resolveResult(completed);
        });
        child.stdin.write(JSON.stringify(request) + "\n");
    });
    assert.equal(launches, 1, "one bounded child for the whole exchange");
    return result;
}
function fixture(): {directory: string; saltPath: string; input: EntryContentInput} {
    const directory = mkdtempSync("/tmp/slice4-image-test-");
    const saltPath = directory + "/salt";
    writeFileSync(saltPath, salt, {mode: 0o600});
    const body = '<div>😀 café <p style="background:url(http://css.test/decoy)">CSS</p>' +
        '<a href="http://nav.test/decoy">navigation</a>' +
        '<span title="http://attribute.test/decoy">attribute</span><!-- http://comment.test/decoy -->' +
        '<script><img src="http://eaten.test/decoy"></script>' +
        '<img src="http://img.test/a?x=1&amp;y=2" srcset="http://img.test/b 1x, http://img.test/c 2x">' +
        '<img src="http://img.test/a?x=1&amp;y=2">' +
        '<img src="http://img.known.org/upgrade"><img src="http://img.site.org/upgrade">' +
        '<img src="https://secure.test/a"><img src="//scheme.test/a"><img src="/relative.png">' +
        '<img src="https://proxy.example.test/already-public"></div>';
    return {directory, saltPath, input: freeze({body, format: "html_raw0", context: structuredClone(context)})};
}

test("independent native plan authorizes one isolated exchange and retained synthetic signatures", async () => {
    const f = fixture();
    try {
        const native = nativePlan(f.input, f.saltPath);
        assert.equal(native.kind, "plan"); if (native.kind !== "plan") throw new Error();
        assert.equal(native.requests.length, 4);
        const plan = approve(f.input, native);
        assert.notEqual(native.requests[0]!.byteStart, plan.requests[0]!.sourceStart, "non-BMP UTF8/UTF16 differ");
        assert.equal(plan.requests[0]!.url, 'http://img.test/a?x=1&y=2');
        assert.ok(plan.requests[0]!.sourceText.includes('&amp;'));
        assert.equal(plan.requests[0]!.url, plan.requests[3]!.url, "repeated URL has distinct source membership");
        const html = await exchange(f.input, plan, f.saltPath);
        for (const image of native.images) assert.ok(html.includes(image.url.replaceAll('&', '&amp;')));
        for (const url of ['https://img.known.org/upgrade', 'https://img.site.org/upgrade',
            'https://secure.test/a', '//scheme.test/a', 'http://localhost:8080/relative.png',
            'https://proxy.example.test/already-public']) assert.ok(html.includes(url), url);
        assert.ok(html.includes('background:url(http://css.test/decoy)'));
        assert.ok(native.nativeHtml.includes('background:url(http://css.test/decoy)'));
        assert.ok(!html.includes('eaten.test') && !html.includes(salt.toString()));
        assert.deepEqual(readFileSync(f.saltPath), salt, "synthetic file remains unchanged");
        assert.ok(!Object.keys(require.cache).some(path => /node_modules\/(?:jsdom|dompurify|css-tree)\//.test(path)),
            "offline host never loads DOM/CSS libraries");
    } finally {rmSync(f.directory, {recursive: true});}
});

test("forged worker claims fail full independent membership validation before any signing", () => {
    const f = fixture();
    try {
        const native = nativePlan(f.input, f.saltPath);
        assert.equal(native.kind, "plan"); if (native.kind !== "plan") throw new Error();
        const plan = approve(f.input, native);
        const valid: ImageRequestSet = {inputSha256: plan.inputSha256, requests: plan.requests};
        const changed = (fn: (value: any) => void): unknown => {const value = structuredClone(valid); fn(value); return value;};
        const claims = [
            changed(v => v.requests[0].url = 'http://forged.test/a'),
            changed(v => v.requests.reverse()), changed(v => v.requests[0].ordinal = 1),
            changed(v => v.requests.pop()), changed(v => v.requests.push(v.requests[0])),
            changed(v => v.inputSha256 = '0'.repeat(64)),
            changed(v => v.requests[0].sourceStart++), changed(v => v.requests[0].attribute = 'srcset'),
            changed(v => {v.requests[0].sourceStart = 6; v.requests[0].sourceEnd = 7; v.requests[0].sourceText = f.input.body.slice(6,7);}),
            ...['http://css.test/decoy', 'http://nav.test/decoy', 'http://eaten.test/decoy',
                'http://attribute.test/decoy', 'http://comment.test/decoy'].map(url => changed(v => {
                const start = f.input.body.indexOf(url);
                Object.assign(v.requests[0], {url, sourceStart: start, sourceEnd: start + url.length, sourceText: url});
            })),
        ];
        for (const claim of claims) {
            let calls = 0;
            assert.throws(() => authorizeAndSign(f.input, plan, claim, url => {calls++; return signSynthetic(url);}));
            assert.equal(calls, 0);
        }
        for (const input of [{...f.input, body: f.input.body + 'changed'},
            {...f.input, context: {...f.input.context, entryId: 999}},
            {...f.input, context: {...f.input.context, urls: {...f.input.context.urls, siteDomain: ''}}}]) {
            let calls = 0;
            assert.throws(() => authorizeAndSign(input, plan, valid, url => {calls++; return signSynthetic(url);}));
            assert.equal(calls, 0);
        }
        let positiveCalls = 0;
        const signed = authorizeAndSign(f.input, plan, valid, url => {positiveCalls++; return signSynthetic(url);});
        assert.equal(positiveCalls, 4); assert.deepEqual(signed.images, native.images);
        assert.throws(() => byteOffset(Buffer.from('😀'), 1), "no partial UTF8-prefix conversion");
    } finally {rmSync(f.directory, {recursive: true});}
});

test("offline plan refuses ambiguous markup and candidate associations", () => {
    const f = fixture();
    try {
        for (const body of ['<img src="http://a.test/x" src="http://b.test/x">',
            '<img src="http://a.test/unclosed>', '<img src=http://a.test/unquoted>',
            '<p><img src="http://a.test/x">', '<p><div>repair</div></p>',
            '<img src="http://a.test/x" srcset="http://b.test/x,ambiguous 1x">',
            '<img src="http://a.test/x" srcset="http://b.test/x">',
            '<lj-cut><img src="http://a.test/x"></lj-cut>',
            '<table><img src="http://a.test/x"></table>']) {
            assert.deepEqual(nativePlan({...f.input, body}, f.saltPath), {kind: "unsupported"}, body);
        }
    } finally {rmSync(f.directory, {recursive: true});}
});

test("empty source domain cannot become an image upgrade wildcard", async () => {
    const f = fixture();
    try {
        const input = {...f.input, body: '<img src="http://unknown.test/a">', context: {...context,
            urls: {...context.urls, siteDomain: '', knownHttpsSites: []}}};
        const native = nativePlan(input, f.saltPath);
        assert.equal(native.kind, "plan"); if (native.kind !== "plan") throw new Error();
        assert.equal(native.requests.length, 1);
        const html = await exchange(input, approve(input, native), f.saltPath);
        assert.ok(html.includes(native.images[0]!.url));
        assert.ok(!html.includes('https://unknown.test/a'));
    } finally {rmSync(f.directory, {recursive: true});}
});

test("key-file denial has an actual readable-file negative control under the same sandbox", () => {
    const f = fixture();
    try {
        const runtime = verifyRuntime(artifact);
        const script = resolve(__dirname, "image-worker.js");
        const args = childArguments(limits, runtime, script);
        args.splice(args.length - 1, 0, "--allow-fs-read=" + script, "--allow-fs-read=" + f.saltPath);
        args.push(runtime.root, f.saltPath);
        const result = spawnSync(artifact + '.sandbox', args, {cwd: runtime.root,
            env: {LANG: 'C.UTF-8', TZ: 'UTC'}, input: '', encoding: 'utf8', timeout: limits.timeoutMs,
            maxBuffer: limits.maxOutputBytes});
        assert.equal(result.status, 70, "granting just the synthetic file makes the worker denial probe fail");
        assert.equal(result.stdout, '');
        assert.ok(!result.stderr.includes(salt.toString()));
    } finally {rmSync(f.directory, {recursive: true});}
});

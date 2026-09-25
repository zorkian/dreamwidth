// image-worker.ts
//
// One offline sandboxed child for the reviewed optional image exchange contract.
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

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {EntryContentInput, EntryCleaner, ContentWireRequest, ContentWireResult} from "@dreamwidth/content/contracts";

const root = process.argv[2]!;
const deniedPath = process.argv[3]!;
let denied = false;
try { readFileSync(deniedPath); }
catch (error) { denied = (error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED"; }
if (!denied) process.exit(70);
// This single explicitly verified closure grant supplies the actual production
// library. The host/key file is outside it; nothing from that file is in IPC.
const {createEntryCleaner} = require(resolve(root, "app/node_modules/@dreamwidth/content")) as
    typeof import("@dreamwidth/content");
const cleaner: EntryCleaner = createEntryCleaner({maxInputBytes: 65536, maxOutputBytes: 2097152,
    maxNodes: 4096, maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096,
    maxImageCandidates: 256, maxCuts: 16});
let input: EntryContentInput | undefined;
let bytes = 0;
let outputBytes = 0;
let pending = Buffer.alloc(0);
let finished = false;
let frames = 0;
const jobId = "synthetic-image-test";
const key = "entry";
const exact = (value: object, keys: string[]): boolean =>
    Object.keys(value).sort().join(",") === keys.sort().join(",");
function send(result: ContentWireResult, last: boolean): void {
    if (finished) return;
    const line = JSON.stringify(result) + "\n";
    outputBytes += Buffer.byteLength(line);
    if (outputBytes > 2097152) process.exit(71);
    if (last) { finished = true; cleaner.close(); }
    process.stdout.write(line, () => { if (last) process.exit(0); });
}
function fail(): void {
    send({version: 1, kind: "failure", jobId, reason: "unsupported"}, true);
}
function handle(raw: unknown): void {
    if (++frames > 2 || !raw || typeof raw !== "object") throw new Error();
    const request = raw as ContentWireRequest;
    if (!exact(request, ["version", "kind", "jobId", "entries"]) || request.version !== 1 ||
        request.jobId !== jobId || !Array.isArray(request.entries) || request.entries.length !== 1 ||
        !request.entries[0] || request.entries[0].key !== key) throw new Error();
    if (request.kind === "clean-entries" && !input && frames === 1 &&
        exact(request.entries[0], ["key", "input"])) {
        input = request.entries[0].input;
        const result = cleaner.clean(input!);
        if (result.kind === "image-resolution-required") {
            send({version: 1, kind: result.kind, jobId, entries: [{key, images: result.images}]}, false);
        } else if (result.kind === "ok") {
            send({version: 1, kind: "complete", jobId,
                entries: [{key, html: result.fragment.html, provenance: result.provenance}]}, true);
        } else send({version: 1, kind: "failure", jobId, reason: result.reason}, true);
    } else if (request.kind === "resolve-images" && input && frames === 2 &&
        exact(request.entries[0], ["key", "resolutions"])) {
        const result = cleaner.clean(input, request.entries[0].resolutions);
        if (result.kind !== "ok") { fail(); return; }
        send({version: 1, kind: "complete", jobId,
            entries: [{key, html: result.fragment.html, provenance: result.provenance}]}, true);
    } else throw new Error();
}
process.stdin.on("data", (chunk: Buffer) => {
    try {
        bytes += chunk.length;
        if (bytes > 2097152) throw new Error();
        pending = Buffer.concat([pending, chunk]);
        let newline: number;
        while (!finished && (newline = pending.indexOf(10)) >= 0) {
            const line = pending.subarray(0, newline);
            pending = pending.subarray(newline + 1);
            handle(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(line)));
        }
        if (finished && pending.length) throw new Error();
    } catch { fail(); }
});
process.stdin.on("end", () => { if (!finished) fail(); });
process.stdin.on("error", fail);

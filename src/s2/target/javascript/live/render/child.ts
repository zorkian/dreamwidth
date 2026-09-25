// child.ts
//
// Bounded credential-free local stock renderer execution.
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

import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { RenderLimits } from "../contracts";
import type { Artifact, RenderInput } from "./types";

export function childArguments(limits: RenderLimits, script = resolve(__dirname, "worker.js")): string[] {
    const policy = resolve(__dirname, "../policy");
    return [process.execPath, "--experimental-permission", "--no-addons",
        "--disable-proto=throw", "--max-old-space-size=" + limits.maxHeapMiB,
        "--allow-fs-read=" + __dirname,
        "--allow-fs-read=" + resolve(__dirname, "../../runtime"),
        "--allow-fs-read=" + resolve(policy, "cohort.js"),
        "--allow-fs-read=" + resolve(policy, "content.js"),
        script];
}

export class Renderer {
    private closed = false;
    private readonly children = new Set<ChildProcess>();
    constructor(private readonly artifact: Artifact, private readonly sandbox: string,
        private readonly limits: RenderLimits) {}

    render(input: RenderInput): Promise<string> {
        if (this.closed || this.children.size >= 2) return Promise.reject(new Error("Renderer unavailable"));
        return new Promise((resolveResult, reject) => {
            const child = spawn(this.sandbox, childArguments(this.limits), {
                env: {LANG: "C.UTF-8", TZ: "UTC"}, cwd: __dirname,
                stdio: ["pipe", "pipe", "ignore"],
            });
            this.children.add(child);
            let settled = false;
            let bytes = 0;
            const chunks: Buffer[] = [];
            const fail = () => {
                if (!settled) { settled = true; reject(new Error("Renderer unavailable")); }
                child.kill("SIGKILL");
            };
            const timeout = setTimeout(fail, this.limits.timeoutMs);
            child.once("error", fail);
            child.stdin.once("error", fail);
            child.stdout.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > this.limits.maxOutputBytes) fail();
                else if (!settled) chunks.push(chunk);
            });
            child.once("close", code => {
                clearTimeout(timeout);
                this.children.delete(child);
                if (settled) return;
                settled = true;
                if (code !== 0 || this.closed || !bytes) reject(new Error("Renderer unavailable"));
                else {
                    try { resolveResult(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks))); }
                    catch { reject(new Error("Renderer unavailable")); }
                }
            });
            child.stdin.end(JSON.stringify({artifact: this.artifact, input, maxBytes: this.limits.maxOutputBytes}));
        });
    }
    async close(): Promise<void> {
        this.closed = true;
        await Promise.all([...this.children].map(child => new Promise<void>(done => {
            child.once("close", () => done());
            child.kill("SIGKILL");
        })));
    }
}

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
import {Unsupported} from "../policy/content";
import type {VerifiedRuntime} from "./manifest";
import type { RenderLimits } from "../contracts";
import type { Artifact, RenderInput } from "./types";

export function childArguments(limits: RenderLimits, runtime: VerifiedRuntime,
    script = runtime.entry): string[] {
    return [runtime.node, "--permission", "--no-addons",
        "--disable-proto=throw", "--max-old-space-size=" + limits.maxHeapMiB,
        "--allow-fs-read=" + runtime.root, script];
}

export class Renderer {
    private closed = false;
    private readonly children = new Set<ChildProcess>();
    constructor(private readonly artifact: Artifact, private readonly sandbox: string,
        private readonly limits: RenderLimits, private readonly runtime: VerifiedRuntime) {}

    render(input: RenderInput): Promise<string> {
        if (this.closed || this.children.size >= 2) return Promise.reject(new Error("Renderer unavailable"));
        return new Promise((resolveResult, reject) => {
            const child = spawn(this.sandbox, childArguments(this.limits, this.runtime), {
                env: {LANG: "C.UTF-8", TZ: "UTC"}, cwd: this.runtime.root,
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
                if (bytes > this.limits.maxOutputBytes + 128) fail();
                else if (!settled) chunks.push(chunk);
            });
            child.once("close", code => {
                clearTimeout(timeout);
                this.children.delete(child);
                if (settled) return;
                settled = true;
                if (code !== 0 || this.closed || !bytes) reject(new Error("Renderer unavailable"));
                else {
                    try {
                        const output = Buffer.concat(chunks);
                        const newline = output.indexOf(10);
                        if (newline < 0 || newline >= 128) throw new Error("Invalid worker framing");
                        const wire = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(output.subarray(0, newline)));
                        const body = output.subarray(newline + 1);
                        if (!wire || wire.version !== 2) {
                            throw new Error("Invalid worker result");
                        }
                        if (wire.kind === "failure") {
                            if (body.length || Object.keys(wire).length !== 3) throw new Error("Invalid worker failure");
                            if (wire.reason === "unsupported") { reject(new Unsupported()); return; }
                            throw new Error("Renderer unavailable");
                        }
                        if (wire.kind !== "complete" || Object.keys(wire).length !== 2 ||
                            !body.length || body.length > this.limits.maxOutputBytes) {
                            throw new Error("Invalid worker output");
                        }
                        resolveResult(new TextDecoder("utf-8", {fatal: true}).decode(body));
                    }
                    catch { reject(new Error("Renderer unavailable")); }
                }
            });
            child.stdin.end(JSON.stringify({version: 2, artifact: this.artifact, input,
                maxBytes: this.limits.maxOutputBytes}));
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

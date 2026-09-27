// general-child.ts
//
// Private initialization/data/host conversation with one sandboxed worker.
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

import {spawn, type ChildProcess} from "node:child_process";
import {PrivateFrameDecoder, encodePrivateFrame, PrivateTransportError} from "./private-transport";
import {PrivateMessageChannel, type SessionPhase} from "./private-protocol";
import {childArguments} from "./child";
import type {VerifiedRuntime} from "./manifest";
import type {RenderLimits} from "../contracts";
import type {GeneralHostOperation} from "./general-worker-channel";
import {initializedRecentCount} from "./general-selection";

const hostNames = new Set<GeneralHostOperation>(["user-lite", "expand-user", "template-error",
    "video-error", "markup-error", "valid-stylesheet", "embed-transform", "expand-site-url",
    "rewrite-blocked-href", "normalize-image-url"]);
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        throw new PrivateTransportError();
    }
    return value as Record<string, unknown>;
}
export interface GeneralConversation {
    readonly start: unknown;
    // Called only AFTER initialization. This is the parent SQL/approval boundary.
    select(recentCount: number): Promise<unknown>;
    host(operation: GeneralHostOperation, parameters: unknown, phase: "initialize" | "render"): Promise<unknown>;
}

export class GeneralRenderer {
    private closed = false;
    private readonly children = new Set<ChildProcess>();
    constructor(private readonly sandbox: string, private readonly runtime: VerifiedRuntime,
        private readonly limits: RenderLimits) {}
    render(job: string, conversation: GeneralConversation): Promise<Uint8Array> {
        if (this.closed || this.children.size >= 2) return Promise.reject(new PrivateTransportError());
        return new Promise((resolve, reject) => {
            const channel = new PrivateMessageChannel(job);
            const decoder = new PrivateFrameDecoder();
            const child = spawn(this.sandbox, childArguments(this.limits, this.runtime), {
                env: {LANG: "C.UTF-8", TZ: "UTC", S2_PRIVATE_JOB: job}, cwd: this.runtime.root,
                stdio: ["pipe", "pipe", "ignore"], shell: false});
            this.children.add(child);
            let phase: SessionPhase = "initialize";
            let terminal = false, failed = false, body: Uint8Array | undefined;
            let pending = 0, transportBytes = 0;
            let chain: Promise<void> = Promise.resolve();
            const fail = (): void => {
                if (failed) return;
                failed = true;
                child.kill("SIGKILL");
                // Rejection also waits for reap; this slot cannot be reused yet.
            };
            const send = (kind: "start" | "resume" | "reply", value: unknown): void => {
                if (failed || terminal) throw new PrivateTransportError();
                child.stdin.write(encodePrivateFrame(channel.send(phase, kind, value)));
            };
            const accept = async (frame: Uint8Array): Promise<void> => {
                if (failed || terminal) throw new PrivateTransportError();
                const message = channel.receive(frame, phase, phase === "initialize" ?
                    ["host", "initialized", "result"] : ["host", "result"]);
                if (message.kind === "host") {
                    const request = record(message.value, ["operation", "parameters"]);
                    if (!hostNames.has(request.operation as GeneralHostOperation) || phase === "data") {
                        throw new PrivateTransportError();
                    }
                    const reply = await conversation.host(request.operation as GeneralHostOperation,
                        request.parameters, phase);
                    send("reply", reply);
                } else if (message.kind === "initialized") {
                    const initialized = record(message.value, ["recentCount"]);
                    const selected = await conversation.select(initializedRecentCount(initialized.recentCount));
                    phase = "data";
                    send("resume", selected);
                    phase = "render";
                } else {
                    const result = record(message.value, ["base64", "utf8"]);
                    if (typeof result.base64 !== "string" || typeof result.utf8 !== "boolean" ||
                        result.base64.length > Math.ceil(this.limits.maxOutputBytes / 3) * 4) {
                        throw new PrivateTransportError();
                    }
                    const bytes = Buffer.from(result.base64, "base64");
                    if (bytes.toString("base64") !== result.base64 || bytes.length > this.limits.maxOutputBytes) {
                        throw new PrivateTransportError();
                    }
                    body = bytes;
                    terminal = true;
                    child.stdin.end();
                }
            };
            const timer = setTimeout(fail, this.limits.timeoutMs);
            child.once("error", fail);
            child.stdin.once("error", fail);
            child.stdout.on("data", (chunk: Buffer) => {
                try {
                    // Conversation traffic includes bounded helper replies and page
                    // base64. This external byte budget is independent of S2 stops.
                    transportBytes += chunk.length;
                    if (transportBytes > 128 * 1024 * 1024) throw new PrivateTransportError();
                    for (const frame of decoder.push(chunk)) {
                        if (++pending > 1) throw new PrivateTransportError();
                        chain = chain.then(() => accept(frame)).then(() => {pending--;}, fail);
                    }
                } catch {fail();}
            });
            child.once("close", code => {
                clearTimeout(timer);
                this.children.delete(child);
                void chain.then(() => {
                    try {decoder.finish();} catch {failed = true;}
                    if (failed || this.closed || code !== 0 || !terminal || body === undefined) reject(new PrivateTransportError());
                    else resolve(body);
                }, () => reject(new PrivateTransportError()));
            });
            try {send("start", conversation.start);} catch {fail();}
        });
    }
    close(): void {
        this.closed = true;
        for (const child of this.children) child.kill("SIGKILL");
    }
}

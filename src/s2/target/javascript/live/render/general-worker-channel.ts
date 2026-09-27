// general-worker-channel.ts
//
// Synchronous installed-worker state machine on private parent pipes.
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

import {BlockingPrivateTransport, PrivateTransportError} from "./private-transport";
import {PrivateMessageChannel, type SessionPhase} from "./private-protocol";
import type {NativeScalarWire} from "../../runtime/native-scalar";
import type {NativePVFrame} from "../../runtime/native-string";

// These names select installed source-derived handlers, not modules, SQL,
// arbitrary translation keys or code supplied by the program.
export type GeneralHostOperation = "user-lite" | "expand-user" | "template-error" |
    "video-error" | "markup-error" | "valid-stylesheet" | "embed-transform" |
    "expand-site-url" | "rewrite-blocked-href" | "normalize-image-url";

export class GeneralWorkerChannel {
    private state: "new" | "initialize" | "render" | "complete" | "failed" = "new";
    private readonly messages: PrivateMessageChannel;
    constructor(job: string, private readonly transport = new BlockingPrivateTransport(0, 1)) {
        this.messages = new PrivateMessageChannel(job);
    }
    private operation<T>(callback: () => T): T {
        if (this.state === "failed" || this.state === "complete") throw new PrivateTransportError();
        try {return callback();} catch (error) {this.state = "failed"; throw error;}
    }
    start<T>(validate: (value: unknown) => T): T {
        return this.operation(() => {
            if (this.state !== "new") throw new PrivateTransportError();
            const message = this.messages.receive(this.transport.read(), "initialize", ["start"]);
            const value = validate(message.value);
            this.state = "initialize";
            return value;
        });
    }
    /** Validation installs only parent-authorized selected data into the SAME Context. */
    resume<T>(count: NativeScalarWire, validate: (value: unknown) => T): T {
        return this.operation(() => {
            if (this.state !== "initialize") throw new PrivateTransportError();
            this.transport.write(this.messages.send("initialize", "initialized", {recentCount: count}));
            const message = this.messages.receive(this.transport.read(), "data", ["resume"]);
            const value = validate(message.value);
            this.state = "render";
            return value;
        });
    }
    /** Handler-specific request/response validation remains installed authority. */
    host<T>(name: GeneralHostOperation, parameters: unknown, validate: (value: unknown) => T): T {
        return this.operation(() => {
            if (this.state !== "initialize" && this.state !== "render") throw new PrivateTransportError();
            const phase: SessionPhase = this.state;
            this.transport.write(this.messages.send(phase, "host", {operation: name, parameters}));
            return validate(this.messages.receive(this.transport.read(), phase, ["reply"]).value);
        });
    }
    result(value: NativePVFrame): void {
        this.sendResult(value, "render");
    }
    /** Installed encoded init diagnostics need no selected entry/body SQL. */
    preparationResult(value: NativePVFrame): void {
        this.sendResult(value, "initialize");
    }
    private sendResult(value: NativePVFrame, phase: "initialize" | "render"): void {
        this.operation(() => {
            if (this.state !== phase) throw new PrivateTransportError();
            // No decoding/encoding through Unicode: page payload is original octets.
            this.transport.write(this.messages.send(phase, "result", {
                base64: Buffer.from(value.bytes).toString("base64"), utf8: value.utf8}));
            this.state = "complete";
        });
    }
}

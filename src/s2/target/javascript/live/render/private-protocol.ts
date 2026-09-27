// private-protocol.ts
//
// Versioned private initialization, resume and synchronous host message envelope.
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

import {PrivateTransportError} from "./private-transport";

export const PRIVATE_PROTOCOL_VERSION = 1;
export type SessionPhase = "initialize" | "data" | "render";
export type MessageKind = "start" | "initialized" | "resume" | "host" | "reply" | "result" | "failure";
export interface PrivateMessage {
    readonly version: 1;
    readonly job: string;
    readonly sequence: number;
    readonly phase: SessionPhase;
    readonly kind: MessageKind;
    readonly value: unknown;
}
const phases = new Set<SessionPhase>(["initialize", "data", "render"]);
const kinds = new Set<MessageKind>(["start", "initialized", "resume", "host", "reply", "result", "failure"]);
const fields = ["version", "job", "sequence", "phase", "kind", "value"];

export function encodePrivateMessage(message: PrivateMessage): Uint8Array {
    // Validate locally too: undefined values would otherwise silently disappear.
    const bytes = Buffer.from(JSON.stringify(message), "utf8");
    decodePrivateMessage(bytes);
    return bytes;
}
export function decodePrivateMessage(bytes: Uint8Array): PrivateMessage {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
    catch {throw new PrivateTransportError();}
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PrivateTransportError();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key)) ||
        row.version !== PRIVATE_PROTOCOL_VERSION || typeof row.job !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.job) || !Number.isSafeInteger(row.sequence) ||
        (row.sequence as number) < 0 || !phases.has(row.phase as SessionPhase) ||
        !kinds.has(row.kind as MessageKind)) throw new PrivateTransportError();
    if (!Buffer.from(JSON.stringify(row), "utf8").equals(Buffer.from(bytes))) {
        throw new PrivateTransportError();
    }
    return Object.freeze(row) as unknown as PrivateMessage;
}

/** Separate send/receive counters bind each direction to one private job. */
export class PrivateMessageChannel {
    private sent = 0;
    private received = 0;
    constructor(private readonly job: string) {
        if (!/^[a-f0-9]{64}$/.test(job)) throw new PrivateTransportError();
    }
    send(phase: SessionPhase, kind: MessageKind, value: unknown): Uint8Array {
        const bytes = encodePrivateMessage({version: 1, job: this.job,
            sequence: this.sent, phase, kind, value});
        this.sent++;
        return bytes;
    }
    receive(bytes: Uint8Array, phase: SessionPhase, allowed: readonly MessageKind[]): PrivateMessage {
        const message = decodePrivateMessage(bytes);
        if (message.job !== this.job || message.sequence !== this.received ||
            message.phase !== phase || !allowed.includes(message.kind)) throw new PrivateTransportError();
        this.received++;
        return message;
    }
}

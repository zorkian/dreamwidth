// private-transport.ts
//
// Bounded blocking frames on the private parent/worker pipes.
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

import {readSync, writeSync} from "node:fs";

export const PRIVATE_FRAME_LIMIT = 128 * 1024 * 1024;
export class PrivateTransportError extends Error {
    constructor() { super("Private worker transport failed"); }
}

/** Header and payload are bytes; invalid UTF8 output never traverses JSON. */
export function encodePrivateFrame(payload: Uint8Array, limit = PRIVATE_FRAME_LIMIT): Buffer {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRIVATE_FRAME_LIMIT ||
        payload.byteLength > limit) throw new PrivateTransportError();
    const frame = Buffer.allocUnsafe(4 + payload.byteLength);
    frame.writeUInt32BE(payload.byteLength, 0);
    frame.set(payload, 4);
    return frame;
}

/** Partial reads/writes are normal pipe behavior. EOF mid-frame is terminal. */
export class BlockingPrivateTransport {
    constructor(private readonly input: number, private readonly output: number,
        private readonly limit = PRIVATE_FRAME_LIMIT) {
        if (![input, output].every(fd => Number.isSafeInteger(fd) && fd >= 0) ||
            !Number.isSafeInteger(limit) || limit < 1 || limit > PRIVATE_FRAME_LIMIT) {
            throw new PrivateTransportError();
        }
    }
    private readExactly(length: number): Buffer {
        const bytes = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
            let count: number;
            try { count = readSync(this.input, bytes, offset, length - offset, null); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EINTR") continue;
                throw new PrivateTransportError();
            }
            if (count === 0) throw new PrivateTransportError();
            offset += count;
        }
        return bytes;
    }
    read(): Uint8Array {
        const length = this.readExactly(4).readUInt32BE(0);
        if (length > this.limit) throw new PrivateTransportError();
        return this.readExactly(length);
    }
    write(payload: Uint8Array): void {
        const frame = encodePrivateFrame(payload, this.limit);
        let offset = 0;
        while (offset < frame.length) {
            let count: number;
            try { count = writeSync(this.output, frame, offset, frame.length - offset); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EINTR") continue;
                throw new PrivateTransportError();
            }
            if (count === 0) throw new PrivateTransportError();
            offset += count;
        }
    }
}

/** Parent-side incremental decoder; it does not allocate from an unchecked header. */
export class PrivateFrameDecoder {
    private readonly header = Buffer.alloc(4);
    private headerOffset = 0;
    private body: Buffer | null = null;
    private bodyOffset = 0;
    private failed = false;
    constructor(private readonly limit = PRIVATE_FRAME_LIMIT) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRIVATE_FRAME_LIMIT) {
            throw new PrivateTransportError();
        }
    }
    push(chunk: Uint8Array): Uint8Array[] {
        if (this.failed) throw new PrivateTransportError();
        const result: Uint8Array[] = [];
        let offset = 0;
        while (offset < chunk.length) {
            if (this.body === null) {
                const take = Math.min(4 - this.headerOffset, chunk.length - offset);
                this.header.set(chunk.subarray(offset, offset + take), this.headerOffset);
                this.headerOffset += take;
                offset += take;
                if (this.headerOffset < 4) continue;
                const size = this.header.readUInt32BE(0);
                if (size > this.limit) { this.failed = true; throw new PrivateTransportError(); }
                this.body = Buffer.allocUnsafe(size);
                this.bodyOffset = 0;
            }
            const take = Math.min(this.body.length - this.bodyOffset, chunk.length - offset);
            this.body.set(chunk.subarray(offset, offset + take), this.bodyOffset);
            this.bodyOffset += take;
            offset += take;
            if (this.bodyOffset === this.body.length) {
                result.push(this.body);
                this.body = null;
                this.headerOffset = 0;
            }
        }
        return result;
    }
    finish(): void {
        if (this.failed || this.headerOffset !== 0 || this.body !== null) {
            this.failed = true;
            throw new PrivateTransportError();
        }
    }
}

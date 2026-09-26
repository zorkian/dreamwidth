// legacy-text.ts
//
// Decode logtext written through Dreamwidth's legacy latin1 DBI connection.
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

import { gunzipSync } from "node:zlib";
import { SnapshotError } from "./errors";

export interface LegacyText {
    readonly storedBytes: Buffer;
    readonly originalBytes: Buffer;
    readonly text: string;
}

export function decodeLegacyBytes(storedHex: unknown, recoveredHex: unknown,
    roundtripHex: unknown, maxStoredBytes: number, maxOriginalBytes: number):
    {storedBytes: Buffer; originalBytes: Buffer} {
    const storedBytes = hexBytes(storedHex, maxStoredBytes);
    const originalBytes = hexBytes(recoveredHex, maxOriginalBytes);
    if (!storedBytes.equals(hexBytes(roundtripHex, maxStoredBytes))) {
        throw new SnapshotError("unsupported");
    }
    return {storedBytes, originalBytes};
}

function hexBytes(hex: unknown, maxBytes: number): Buffer {
    if (typeof hex !== "string" || hex.length % 2 !== 0 ||
        hex.length > maxBytes * 2 || !/^[0-9A-F]*$/i.test(hex)) {
        throw new SnapshotError("unsupported");
    }
    return Buffer.from(hex, "hex");
}

// MySQL's latin1 is cp1252 with mappings for the otherwise undefined C1 bytes.
// HEX(CONVERT(column USING latin1)) reverses the DBI connection conversion.
// Re-converting that result to utf8mb4 must equal the stored bytes, so an
// unrepresentable code point cannot silently become '?' in the snapshot.
export function decodeLegacyText(
    storedHex: unknown,
    recoveredHex: unknown,
    roundtripHex: unknown,
    maxStoredBytes: number,
    maxDecodedBytes: number,
    mayBeGzip: boolean,
): LegacyText {
    const {storedBytes, originalBytes} = decodeLegacyBytes(
        storedHex, recoveredHex, roundtripHex, maxStoredBytes, maxStoredBytes);
    let decodedBytes = originalBytes;
    if (mayBeGzip && originalBytes.length >= 2 &&
        originalBytes[0] === 0x1f && originalBytes[1] === 0x8b) {
        try {
            decodedBytes = gunzipSync(originalBytes, { maxOutputLength: maxDecodedBytes + 1 });
        } catch {
            throw new SnapshotError("unsupported");
        }
    }
    if (decodedBytes.length > maxDecodedBytes) {
        throw new SnapshotError("unsupported");
    }
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodedBytes);
    } catch {
        throw new SnapshotError("unsupported");
    }
    return { storedBytes, originalBytes, text };
}

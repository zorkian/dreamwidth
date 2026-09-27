// native-string.ts
//
// Private Perl scalar PV storage and byte-preserving S2 string operations.
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

import {NativeProfile, mapNativeCase} from "./native-profile";

export interface NativePVFrame { readonly bytes: Uint8Array; readonly utf8: boolean }

interface Payload { bytes: Buffer; utf8: boolean }
const payloads = new WeakMap<NativeString, Payload>();

/** PV bytes are copied on import and export. Valid UTF8 never implies a flag. */
export class NativeString {
    private constructor(bytes: Uint8Array, utf8: boolean) {
        payloads.set(this, {bytes: Buffer.from(bytes), utf8});
        Object.freeze(this);
    }

    static bytes(bytes: Uint8Array): NativeString { return new NativeString(bytes, false); }
    static flagged(bytes: Uint8Array): NativeString { return new NativeString(bytes, true); }
    static hostUnicode(value: string): NativeString {
        return new NativeString(Buffer.concat(Array.from(value, character => encodeCodepoint(BigInt(character.codePointAt(0)!)))), true);
    }
    static hostUtf8Bytes(value: string): NativeString {
        return new NativeString(Buffer.from(value, 'utf8'), false);
    }
    static is(value: unknown): value is NativeString {
        return typeof value === 'object' && value !== null && payloads.has(value as NativeString);
    }
    static fromFrame(frame: NativePVFrame): NativeString {
        if (!(frame.bytes instanceof Uint8Array) || typeof frame.utf8 !== 'boolean') throw new Error('Invalid native PV frame');
        return new NativeString(frame.bytes, frame.utf8);
    }
    frame(): NativePVFrame { return Object.freeze({bytes: this.bytes(), utf8: this.flagged()}); }
    bytes(): Buffer { return Buffer.from(payload(this).bytes); }
    flagged(): boolean { return payload(this).utf8; }
    clone(): NativeString {
        const value = payload(this);
        return new NativeString(value.bytes, value.utf8);
    }
}

function payload(value: NativeString): Payload {
    const data = payloads.get(value);
    if (!data) throw new Error('Unbranded native PV');
    return data;
}

// Perl upgrades an unflagged octet PV only when a character operand requires it.
// This is not a response encoding conversion; byte-only output stays untouched.
function upgraded(value: Payload): Buffer {
    if (value.utf8) return value.bytes;
    return Buffer.from(Array.from(value.bytes, byte => String.fromCodePoint(byte)).join(''), 'utf8');
}

export function concatStrings(left: NativeString, right: NativeString): NativeString {
    const a = payload(left), b = payload(right);
    return a.utf8 || b.utf8
        ? NativeString.flagged(Buffer.concat([upgraded(a), upgraded(b)]))
        : NativeString.bytes(Buffer.concat([a.bytes, b.bytes]));
}

/** Equivalent to LJ::no_utf8_flag: retain internal bytes, clear flag on copy. */
export function clearUtf8Flag(value: NativeString): NativeString {
    return NativeString.bytes(payload(value).bytes);
}

// Keep encoded character spans intact, including Perl's extended UTF8 widths.
// No decoding bridge is used by reverse/foreach, so invalid octets cannot turn
// into replacement characters merely by traversing the scalar.
function decodeCodepoint(span: Buffer): bigint {
    const first = span[0]!;
    if (span.length === 1) return BigInt(first);
    const headBits = span.length === 13 ? 0 : 7 - span.length;
    let value = BigInt(headBits > 0 ? first & ((1 << headBits) - 1) : 0);
    for (let index = 1; index < span.length; index++) value = (value << 6n) | BigInt(span[index]! & 63);
    return value;
}
function encodeCodepoint(point: bigint): Buffer {
    if (point < 128n) return Buffer.from([Number(point)]);
    const widths = [[2, 11], [3, 16], [4, 21], [5, 26], [6, 31], [7, 36], [13, 72]] as const;
    const width = widths.find(([, bits]) => point < 1n << BigInt(bits))?.[0];
    if (!width) throw new Error('Native codepoint exceeds installed UV width');
    const bytes = Buffer.alloc(width);
    let remaining = point;
    for (let index = width - 1; index > 0; index--) { bytes[index] = 0x80 | Number(remaining & 63n); remaining >>= 6n; }
    bytes[0] = width === 13 ? 0xff : ((0xff << (8 - width)) & 0xff) | Number(remaining);
    return bytes;
}

function utf8Spans(bytes: Buffer): Buffer[] {
    const spans: Buffer[] = [];
    for (let offset = 0; offset < bytes.length;) {
        const first = bytes[offset]!;
        const width = first < 0xc0 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 :
            first < 0xf8 ? 4 : first < 0xfc ? 5 : first < 0xfe ? 6 : first === 0xfe ? 7 : 13;
        let end = Math.min(bytes.length, offset + width);
        for (let index = offset + 1; index < end; index++) {
            if ((bytes[index]! & 0xc0) !== 0x80) { end = index; break; }
        }
        spans.push(bytes.subarray(offset, end));
        offset = end;
    }
    return spans;
}

export function byteCharacters(value: NativeString): NativeString[] {
    const data = payload(value);
    if (data.utf8) return utf8Spans(data.bytes).map(bytes => NativeString.flagged(bytes));
    return Array.from(data.bytes, byte => NativeString.bytes(Uint8Array.of(byte)));
}

export function reverseString(value: NativeString): NativeString {
    const data = payload(value);
    if (!data.utf8) return NativeString.bytes(Buffer.from(data.bytes).reverse());
    return NativeString.flagged(Buffer.concat(byteCharacters(value).reverse().map(part => part.bytes())));
}

export function stringLength(value: NativeString): number {
    const data = payload(value);
    return data.utf8 ? byteCharacters(value).length : data.bytes.length;
}

export function compareStrings(left: NativeString, right: NativeString): number {
    const a = payload(left), b = payload(right);
    return Math.sign(Buffer.compare(a.utf8 || b.utf8 ? upgraded(a) : a.bytes,
        a.utf8 || b.utf8 ? upgraded(b) : b.bytes));
}

/** A native concatenation buffer must keep its flag until the response boundary. */
export class NativeOutput {
    private value = NativeString.bytes(new Uint8Array());
    append(chunk: NativeString): void { this.value = concatStrings(this.value, chunk); }
    scalar(): NativeString { return this.value.clone(); }
    frame(): NativePVFrame { return this.value.frame(); }
    bytes(): Buffer { return clearUtf8Flag(this.value).bytes(); }
}

export function stringIndex(value: NativeString, needle: NativeString, offset = 0): number {
    const a = payload(value), b = payload(needle);
    if (!a.utf8 && !b.utf8) return a.bytes.indexOf(b.bytes, Math.max(0, offset));
    const haystack = utf8Spans(upgraded(a)), target = upgraded(b);
    let byteOffset = 0;
    for (let index = 0; index < haystack.length; index++) {
        if (index >= Math.max(0, offset) && Buffer.concat(haystack.slice(index)).subarray(0, target.length).equals(target)) return index;
        byteOffset += haystack[index]!.length;
    }
    return target.length === 0 && offset <= haystack.length ? Math.max(0, offset) : -1;
}

/** LJ's builtin deliberately lax-decodes before character-offset slicing. */
export function builtinSubstr(value: NativeString, start: number, length: number): NativeString {
    const bytes = byteApiPayload(value), characters: Buffer[] = [];
    for (const span of utf8Spans(bytes)) {
        const first = span[0]!;
        const expected = first < 0x80 ? 1 : first < 0xc0 ? 0 : first < 0xe0 ? 2 : first < 0xf0 ? 3 :
            first < 0xf8 ? 4 : first < 0xfc ? 5 : first < 0xfe ? 6 : first === 0xfe ? 7 : 13;
        const point = decodeCodepoint(span);
        const minimum = expected <= 1 ? 0n : expected === 2 ? 128n : expected === 3 ? 2048n :
            expected === 4 ? 65536n : expected === 5 ? 2097152n : expected === 6 ? 67108864n :
                expected === 7 ? 2147483648n : 68719476736n;
        characters.push(expected === 0 || span.length !== expected || point < minimum
            ? Buffer.from([0xef, 0xbf, 0xbd]) : span);
    }
    const offset = start < 0 ? Math.max(0, characters.length + start) : start;
    const end = length < 0 ? Math.max(offset, characters.length + length) : offset + length;
    return NativeString.bytes(Buffer.concat(characters.slice(offset, end)));
}

export function caseString(value: NativeString, op: 'lower' | 'upper' | 'upperfirst', profile?: NativeProfile): NativeString {
    const data = payload(value);
    if (data.utf8) {
        if (!profile) throw new Error('Missing installed native Unicode profile');
        const spans = utf8Spans(data.bytes);
        const result: Buffer[] = [];
        for (let index = 0; index < spans.length; index++) {
            if (op === 'upperfirst' && index !== 0) { result.push(spans[index]!); continue; }
            const codepoint = decodeCodepoint(spans[index]!);
            if (codepoint > 0x10ffffn) { result.push(spans[index]!); continue; }
            const table = op === 'lower' ? profile.lower : op === 'upper' ? profile.upper : profile.title;
            result.push(Buffer.concat(mapNativeCase(Number(codepoint), table).map(point => encodeCodepoint(BigInt(point)))));
        }
        return NativeString.flagged(Buffer.concat(result));
    }
    const bytes = Buffer.from(data.bytes);
    for (let index = 0; index < bytes.length && (op !== 'upperfirst' || index === 0); index++) {
        const byte = bytes[index]!;
        if (op === 'lower' && byte >= 65 && byte <= 90) bytes[index] = byte + 32;
        if (op !== 'lower' && byte >= 97 && byte <= 122) bytes[index] = byte - 32;
    }
    return NativeString.bytes(bytes);
}

export function startsWith(value: NativeString, needle: NativeString): boolean {
    return stringIndex(value, needle) === 0;
}
export function endsWith(value: NativeString, needle: NativeString): boolean {
    const a = payload(value), b = payload(needle);
    const bytes = a.utf8 || b.utf8 ? upgraded(a) : a.bytes;
    const target = a.utf8 || b.utf8 ? upgraded(b) : b.bytes;
    const matches = (end: number) => end >= target.length && bytes.subarray(end - target.length, end).equals(target);
    return matches(bytes.length) || (bytes[bytes.length - 1] === 10 && matches(bytes.length - 1));
}

export function replaceString(value: NativeString, find: NativeString, replacement: NativeString): NativeString {
    const a = payload(value), b = payload(find), c = payload(replacement), flagged = a.utf8 || b.utf8 || c.utf8;
    const bytes = flagged ? upgraded(a) : a.bytes, needle = flagged ? upgraded(b) : b.bytes;
    const insert = flagged ? upgraded(c) : c.bytes, chunks: Buffer[] = [];
    let offset = 0;
    if (!needle.length) {
        chunks.push(insert);
        const parts = flagged ? utf8Spans(bytes) : Array.from(bytes, byte => Buffer.from([byte]));
        for (const part of parts) chunks.push(part, insert);
    } else {
        for (;;) {
            const index = bytes.indexOf(needle, offset);
            if (index < 0) { chunks.push(bytes.subarray(offset)); break; }
            chunks.push(bytes.subarray(offset, index), insert);
            offset = index + needle.length;
        }
    }
    return flagged ? NativeString.flagged(Buffer.concat(chunks)) : NativeString.bytes(Buffer.concat(chunks));
}

export function splitString(value: NativeString, separator: NativeString): NativeString[] {
    const a = payload(value), b = payload(separator), flagged = a.utf8 || b.utf8;
    const bytes = flagged ? upgraded(a) : a.bytes, needle = flagged ? upgraded(b) : b.bytes;
    if (!bytes.length) return [];
    if (!needle.length) return byteCharacters(flagged ? NativeString.flagged(bytes) : NativeString.bytes(bytes));
    const parts: Buffer[] = [];
    let offset = 0;
    for (;;) {
        const index = bytes.indexOf(needle, offset);
        if (index < 0) { parts.push(bytes.subarray(offset)); break; }
        parts.push(bytes.subarray(offset, index));
        offset = index + needle.length;
    }
    while (parts.length && !parts[parts.length - 1]!.length) parts.pop();
    return parts.map(part => flagged ? NativeString.flagged(part) : NativeString.bytes(part));
}

export function hashKeyBytes(value: NativeString): {bytes: Buffer; utf8: boolean} {
    const data = payload(value);
    if (!data.utf8) return {bytes: Buffer.from(data.bytes), utf8: false};
    const points = utf8Spans(data.bytes).map(decodeCodepoint);
    if (points.every(point => point <= 255n)) return {bytes: Buffer.from(points.map(Number)), utf8: false};
    return {bytes: Buffer.from(data.bytes), utf8: true};
}

/** Native byte-API SvPV conversion differs from clearing the UTF8 flag. */
export function byteApiPayload(value: NativeString): Buffer {
    const data = payload(value);
    if (!data.utf8) return Buffer.from(data.bytes);
    const points = utf8Spans(data.bytes).map(decodeCodepoint);
    if (points.some(point => point > 255n)) throw new Error('Wide character in native byte API');
    return Buffer.from(points.map(Number));
}

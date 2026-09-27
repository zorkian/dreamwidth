// native-scalar.ts
//
// Shared scalar boundaries for source-compiled and recovered S2 programs.
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
// Native string-increment behavior is adapted from Perl 5.34 sv.c:
// Copyright (C) 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
// 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009 by Larry Wall and others.
// You may distribute under the terms of either the GNU General Public License
// or the Artistic License, as specified in Perl's README file.
//

import {NativeNumber, incrementNumber} from './native-number';
import {NativeString, concatStrings} from './native-string';
export type NativeScalar = NativeString | NativeNumber;
export {NativeNumber, NativeString};
export interface NativeSink {
    /** Trusted coordinator declaration; page-local output owns native print cadence. */
    readonly ownsPrintCheckpoints?: true;
    raw(value: NativeString): void;
    safe(value: NativeString): void;
}

/** Host text provenance is explicit; this adapter imports legacy UTF8 byte data. */
export function scalarPV(value: unknown): NativeString {
    if (NativeString.is(value)) return value.clone();
    if (NativeNumber.is(value)) return value.pv();
    if (value === undefined || value === null) return NativeString.bytes(new Uint8Array());
    if (typeof value === 'string') return NativeString.hostUtf8Bytes(value);
    if (typeof value === 'boolean') return NativeString.hostUtf8Bytes(value ? '1' : '');
    if (typeof value === 'number' && Number.isSafeInteger(value)) return NativeNumber.integer(BigInt(value)).pv();
    throw new Error('S2 scalar requires an explicit host adapter');
}
export function scalarNumber(value: unknown): NativeNumber {
    if (NativeNumber.is(value)) return value.clone();
    if (NativeString.is(value)) return cachedNumber(value);
    if (typeof value === 'number' && Number.isSafeInteger(value)) return NativeNumber.integer(BigInt(value));
    if (value === undefined || value === null || value === false) return NativeNumber.integer(0n);
    if (value === true) return NativeNumber.integer(1n);
    if (typeof value === 'string') return NativeNumber.fromPV(NativeString.hostUtf8Bytes(value));
    throw new Error('S2 numeric scalar requires an explicit host adapter');
}
export function scalarConcat(left: unknown, right: unknown): NativeString {
    return concatStrings(scalarPV(left), scalarPV(right));
}
export function legacyText(value: NativeString): string {
    const bytes = value.bytes();
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Legacy S2 text sink cannot carry these bytes');
    return text;
}
export function scalarNotags(value: unknown): NativeString {
    const pv = scalarPV(value), bytes = pv.bytes(), parts: Buffer[] = [];
    for (const byte of bytes) parts.push(byte === 60 ? Buffer.from('&lt;') :
        byte === 62 ? Buffer.from('&gt;') : Buffer.from([byte]));
    return pv.flagged() ? NativeString.flagged(Buffer.concat(parts)) : NativeString.bytes(Buffer.concat(parts));
}

export function scalarTruthy(value: unknown): boolean {
    if (NativeString.is(value)) {
        const bytes = value.bytes();
        return bytes.length !== 0 && !(bytes.length === 1 && bytes[0] === 48);
    }
    if (NativeNumber.is(value)) return value.wire().mode === 'nv'
        ? Buffer.from(value.wire().value, 'hex').readDoubleBE() !== 0 : BigInt(value.wire().value) !== 0n;
    return value !== undefined && value !== null && value !== false && value !== 0 && value !== '' && value !== '0';
}

// Perl numeric coercion caches a value without replacing the original PV. The
// cache is private; scalar assignments copy it, while aliases retain the cell.
const numericCaches = new WeakMap<NativeString, NativeNumber>();
export function scalarCopy(value: unknown): unknown {
    if (NativeNumber.is(value)) return value.clone();
    if (!NativeString.is(value)) return value;
    const copy = value.clone(), cache = numericCaches.get(value);
    if (cache) numericCaches.set(copy, cache.clone());
    return copy;
}
export function cachedNumber(value: NativeString): NativeNumber {
    let number = numericCaches.get(value);
    if (!number) { number = NativeNumber.fromPV(value); numericCaches.set(value, number); }
    return number.clone();
}

export function incrementScalar(value: unknown, plus: boolean): unknown {
    if (plus && NativeString.is(value) && !numericCaches.has(value)) {
        const bytes = value.bytes();
        // The native string increment branch uses ASCII alphanumeric positions,
        // not Unicode casing or a generic number-parser normalization.
        if (bytes.length && /^[A-Za-z]*[0-9]*$/.test(bytes.toString('latin1'))) {
            const result = Buffer.from(bytes);
            let carry = true, prefix = 49;
            for (let index = result.length - 1; index >= 0 && carry; index--) {
                const byte = result[index]!;
                prefix = byte >= 97 ? 97 : byte >= 65 ? 65 : 49;
                if (byte === 57) result[index] = 48;
                else if (byte === 90) result[index] = 65;
                else if (byte === 122) result[index] = 97;
                else { result[index] = byte + 1; carry = false; }
            }
            const output = carry ? Buffer.concat([Buffer.from([prefix]), result]) : result;
            return value.flagged() ? NativeString.flagged(output) : NativeString.bytes(output);
        }
    }
    return incrementNumber(scalarNumber(value),plus);
}


export type NativeScalarWire =
    {kind: 'pv'; base64: string; utf8: boolean; numericCache?: ReturnType<NativeNumber['wire']>} |
    {kind: 'number'; number: ReturnType<NativeNumber['wire']>};
export function encodeScalar(value: NativeScalar): NativeScalarWire {
    if (NativeNumber.is(value)) return {kind: 'number', number: value.wire()};
    if (!NativeString.is(value)) throw new Error('Unbranded scalar wire value');
    const cache=numericCaches.get(value);
    return {kind: 'pv', base64:value.bytes().toString('base64'), utf8:value.flagged(),
        ...(cache ? {numericCache:cache.wire()} : {})};
}
export function decodeScalar(wire: NativeScalarWire): NativeScalar {
    if (wire.kind === 'number') return NativeNumber.fromWire(wire.number);
    if (wire.kind !== 'pv' || typeof wire.base64 !== 'string' || typeof wire.utf8 !== 'boolean') throw new Error('Invalid native scalar wire');
    const bytes=Buffer.from(wire.base64,'base64');
    if(bytes.toString('base64')!==wire.base64)throw new Error('Noncanonical native scalar wire');
    const value=wire.utf8?NativeString.flagged(bytes):NativeString.bytes(bytes);
    if(wire.numericCache) {
        if(wire.numericCache.original && (wire.numericCache.original.base64!==wire.base64 ||
            wire.numericCache.original.utf8!==wire.utf8))throw new Error('Mismatched native PV cache');
        numericCaches.set(value,NativeNumber.fromWire(wire.numericCache));
    }
    return value;
}

const stops = new WeakMap<Error, 'recursion' | 'deadline'>();

/** Runtime-only authority; neither messages nor public properties authenticate a stop. */
export function raiseNativeExecutionStop(kind: 'recursion' | 'deadline'): never {
    const error = new Error(kind === 'recursion' ? 'Excessive S2 recursion' : 'S2 execution timed out');
    stops.set(error, kind);
    throw error;
}
export function isNativeExecutionStop(value: unknown): value is Error {
    return typeof value === 'object' && value !== null && stops.has(value as Error);
}
/** Trusted coordinator lookup; no author-visible property or message inference. */
export function nativeExecutionStopKind(value: unknown): 'recursion' | 'deadline' | undefined {
    return typeof value === 'object' && value !== null ? stops.get(value as Error) : undefined;
}

const programErrors = new WeakSet<Error>();
/** Installed semantic throw sites only; not exposed through the author runtime. */
export function nativeProgramError(message: string): Error {
    const error = new Error(message);
    programErrors.add(error);
    return error;
}
export function isNativeProgramError(value: unknown): value is Error {
    return typeof value === 'object' && value !== null && programErrors.has(value as Error);
}

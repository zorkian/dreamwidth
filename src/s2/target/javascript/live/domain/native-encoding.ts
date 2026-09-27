// native-encoding.ts
//
// Installed native charset mappings and source conversion semantics.
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
// Mapping algorithms derive from Unicode::Map (Martin Schwartz) and
// Unicode::String/Map8 (Gisle Aas), under the same terms as Perl itself.
// JIS framing derives from Encode::JP::JIS7 (Dan Kogai), under Perl terms.
// Portions adapted from LJ::text_out in the LiveJournal-derived LJ/TextUtil.pm.
// That code was forked from Live Journal, Inc. and modified by Dreamwidth
// Studios, LLC. These portions and modifications retain the GNU General Public
// License; see LICENSE. Original license:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// The UTF8 legality rules derive from Unicode::CheckUTF8 1.03. Its inherited
// notice follows:
// Copyright 2001 Unicode, Inc.
// Disclaimer
// This source code is provided as is by Unicode, Inc. No claims are
// made as to fitness for any particular purpose. No warranties of any
// kind are expressed or implied. The recipient agrees to determine
// applicability of information provided. If this file has been
// purchased on magnetic or optical media from Unicode, Inc., the
// sole remedy for any claim will be exchange of defective media
// within 90 days of receipt.
// Limitations on Rights to Redistribute This Code
// Unicode, Inc. hereby grants the right to freely use the information
// supplied in this file in the creation of products supporting the
// Unicode Standard, and to make copies of this file in any form
// for internal or external distribution as long as this notice
// remains attached.
//
import { createHash } from 'node:crypto';
import { NativeString, caseString, byteCharacters, stringLength, startsWith } from '../../runtime/native-string';
import type { NativeProfile } from '../../runtime/native-profile';
type Group = {
    width: number;
    entries: ReadonlyMap<string, Buffer>;
};
type Converter = {
    kind: 'string' | 'jcode' | 'map8' | 'map';
    name?: string;
    entries?: readonly Buffer[];
    groups?: readonly Group[];
    failedHex?: string;
};
interface ProfileData {
    readonly names: ReadonlyMap<string, string>;
    readonly converters: ReadonlyMap<string, Converter>;
    readonly japanese: ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
    readonly h2z: ReadonlyMap<string, Buffer>;
    readonly encodeEuc: ReadonlyMap<string, Buffer>;
    readonly scalar: NativeProfile;
    readonly sources: readonly {
        path: string;
        sha256: string;
    }[];
}
export interface NativeEncodingLimits {
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
}
export type NativeEncodingResult = {
    readonly kind: 'converted';
    readonly value: NativeString;
} | {
    readonly kind: 'conversion-failure';
    readonly reason: 'missing-charset' | 'unsupported-charset';
};
export interface NativeEncodingProfile {
    readonly schema: 1;
}
const issued = new WeakMap<NativeEncodingProfile, ProfileData>();
function freezeData<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value))
            freezeData(child);
        Object.freeze(value);
    }
    return value;
}
function hex(value: unknown): Buffer {
    if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]*$/.test(value))
        throw Error('Invalid encoding profile');
    return Buffer.from(value, 'hex');
}
function entries(value: unknown): Map<string, Buffer> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Invalid encoding profile');
    return new Map(Object.entries(value).map(([key, val]) => { hex(key); return [key, hex(val)]; }));
}
export function loadNativeEncodingProfile(raw: any, scalar: NativeProfile): NativeEncodingProfile {
    if (raw?.schema !== 1 || raw.perl !== '5.034000' || !raw.names || !raw.converters || !raw.japanese || !raw.h2z)
        throw Error('Invalid encoding profile');
    const converters = new Map<string, Converter>();
    for (const [id, c] of Object.entries(raw.converters) as [
        string,
        any
    ][]) {
        if (!['string', 'jcode', 'map8', 'map'].includes(c.kind))
            throw Error('Invalid encoding profile');
        const converted: Converter = { kind: c.kind };
        if (c.kind === 'string' || c.kind === 'jcode') {
            const allowed = c.kind === 'string' ? ['utf8', 'ucs2', 'ucs4', 'utf7', 'utf16'] :
                ['sjis', 's-jis', 's_jis', 'shiftjis', 'shift-jis', 'shift_jis', 'iso-2022-jp', 'iso_2022_jp', 'jis', 'euc-jp'];
            if (!allowed.includes(c.name))
                throw Error('Invalid encoding profile');
            converted.name = c.name;
        }
        if (c.kind === 'map8') {
            if (!Array.isArray(c.entries) || c.entries.length !== 256)
                throw Error('Invalid encoding profile');
            converted.entries = c.entries.map(hex);
        }
        if (c.kind === 'map') {
            if (!Array.isArray(c.groups))
                throw Error('Invalid encoding profile');
            converted.groups = c.groups.map((g: any) => {
                if (!Number.isSafeInteger(g.width) || g.width < 1 || !Array.isArray(g.entries))
                    throw Error('Invalid encoding profile');
                return { width: g.width, entries: new Map(g.entries.map((pair: any) => {
                        if (!Array.isArray(pair) || pair.length !== 2 || hex(pair[0]).length !== g.width)
                            throw Error('Invalid encoding profile');
                        return [pair[0], hex(pair[1])];
                    })) };
            });
            if (c.failedLoad)
                converted.failedHex = hex(c.failedHex).toString('hex');
        }
        converters.set(id, converted);
    }
    const names = new Map<string, string>();
    for (const [name, id] of Object.entries(raw.names)) {
        if (typeof id !== 'string' || !converters.has(id))
            throw Error('Invalid encoding profile');
        names.set(name, id);
    }
    if (!Array.isArray(raw.sources) || !raw.sources.length)
        throw Error('Invalid encoding profile');
    const paths = new Set<string>();
    const sources = raw.sources.map((source: any) => {
        if (typeof source?.path !== 'string' || !source.path.startsWith('/') || paths.has(source.path) ||
            typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256))
            throw Error('Invalid encoding profile');
        paths.add(source.path);
        return Object.freeze({ path: source.path, sha256: source.sha256 });
    });
    const data = { names, converters, japanese: new Map(Object.entries(raw.japanese).map(([name, data]) => [name, entries(data)])), h2z: entries(raw.h2z), encodeEuc: entries(raw.encodeEuc), scalar: freezeData(structuredClone(scalar)), sources: Object.freeze(sources) };
    const profile = Object.freeze({ schema: 1 as const });
    issued.set(profile, data);
    return profile;
}
function data(profile: NativeEncodingProfile): ProfileData { const result = issued.get(profile); if (!result)
    throw Error('Unissued encoding profile'); return result; }
export function verifyNativeEncodingSources(profile: NativeEncodingProfile, read: (path: string) => Uint8Array): void {
    for (const source of data(profile).sources) {
        if (createHash('sha256').update(read(source.path)).digest('hex') !== source.sha256)
            throw Error('Installed encoding dependency changed');
    }
}
function charset(profile: ProfileData, name: NativeString): string {
    return caseString(name, 'lower', profile.scalar).bytes().toString(name.flagged() ? 'utf8' : 'latin1');
}
export function supportedNativeEncoding(profile: NativeEncodingProfile, name: NativeString | undefined): boolean {
    const facts = data(profile);
    return name !== undefined && facts.names.has(charset(facts, name));
}
function encodePoint(point: number): Buffer {
    if (point < 0x80)
        return Buffer.from([point]);
    if (point < 0x800)
        return Buffer.from([0xc0 | (point >> 6), 0x80 | (point & 63)]);
    if (point < 0x10000)
        return Buffer.from([0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63)]);
    return Buffer.from([0xf0 | (point >> 18), 0x80 | ((point >> 12) & 63), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63)]);
}
function utf16(bytes: Buffer, normalize = true): Buffer {
    if (normalize && bytes.length % 2)
        bytes = Buffer.concat([bytes, Buffer.from([0])]);
    if (normalize && bytes[0] === 0xff && bytes[1] === 0xfe) {
        bytes = Buffer.from(bytes);
        bytes.swap16();
    }
    const output: Buffer[] = [];
    for (let at = 0; at + 1 < bytes.length; at += 2) {
        let point = bytes.readUInt16BE(at);
        const low = at + 3 < bytes.length ? bytes.readUInt16BE(at + 2) : 0;
        if (point >= 0xd800 && point <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
            point = 0x10000 + (point - 0xd800) * 1024 + low - 0xdc00;
            at += 2;
        }
        output.push(encodePoint(point));
    }
    return Buffer.concat(output);
}
function stringConvert(name: string, input: NativeString): Buffer {
    let bytes = input.bytes();
    if (name === 'ucs2' || name === 'utf16') {
        if (stringLength(input) % 2)
            bytes = Buffer.concat([bytes, Buffer.from([0])]);
        if (startsWith(input, NativeString.bytes(Buffer.from([0xff, 0xfe])))) {
            const swapped = Buffer.from(bytes);
            for (let at = 0; at + 1 < swapped.length; at += 2) {
                const first = swapped[at]!;
                swapped[at] = swapped[at + 1]!;
                swapped[at + 1] = first;
            }
            bytes = swapped;
        }
        return utf16(bytes, false);
    }
    if (name === 'ucs4') {
        const words: Buffer[] = [];
        for (let at = 0; at + 3 < bytes.length; at += 4) {
            const point = bytes.readUInt32BE(at);
            if (point <= 0xffff) {
                const word = Buffer.alloc(2);
                word.writeUInt16BE(point);
                words.push(word);
            }
            else if (point <= 0x10ffff) {
                const pair = Buffer.alloc(4);
                pair.writeUInt16BE(0xd800 + ((point - 0x10000) >> 10));
                pair.writeUInt16BE(0xdc00 + ((point - 0x10000) & 1023), 2);
                words.push(pair);
            }
        }
        return utf16(Buffer.concat(words));
    }
    if (name === 'utf7') {
        const text = bytes.toString('latin1'), words: Buffer[] = [];
        let at = 0;
        while (at < text.length) {
            if (text[at] !== '+') {
                words.push(Buffer.from([0, bytes[at]!]));
                at++;
                continue;
            }
            if (text[at + 1] === '-') {
                words.push(Buffer.from([0, 43]));
                at += 2;
                continue;
            }
            const match = /^\+([A-Za-z0-9+/]+)-?/.exec(text.slice(at));
            if (match) {
                const part = Buffer.from(match[1]!, 'base64');
                words.push(part.subarray(0, part.length - part.length % 2));
                at += match[0].length;
            }
            else {
                words.push(Buffer.from([0, 43]));
                at++;
            }
        }
        return utf16(Buffer.concat(words));
    }
    throw Error('Unknown installed Unicode string branch');
}
function mapConvert(converter: Converter, bytes: Buffer): Buffer {
    if (converter.failedHex !== undefined)
        return hex(converter.failedHex);
    const groups = converter.groups!, output: Buffer[] = [];
    for (let at = 0; at < bytes.length;) {
        let found = false;
        for (const group of groups) {
            if (at + group.width > bytes.length)
                continue;
            const mapped = group.entries.get(bytes.subarray(at, at + group.width).toString('hex'));
            if (mapped !== undefined) {
                output.push(mapped);
                at += group.width;
                found = true;
                break;
            }
        }
        if (!found)
            at += groups.length === 1 ? groups[0]!.width : 2;
    }
    return utf16(Buffer.concat(output));
}
function japaneseDecode(profile: ProfileData, encoding: string, bytes: Buffer, perlqq = false): Buffer {
    const table = profile.japanese.get(encoding)!, out: Buffer[] = [];
    for (let at = 0; at < bytes.length;) {
        const b = bytes[at]!;
        if (encoding === 'euc-jp' && ((b === 0x8f && at + 2 >= bytes.length) ||
            (b === 0x8e || b >= 0xa1 && b <= 0xfe) && at + 1 >= bytes.length))
            break;
        let width = encoding === 'shiftjis' ? ((b >= 0x81 && b <= 0x9f || b >= 0xe0 && b <= 0xfc) &&
            at + 1 < bytes.length && (bytes[at + 1]! >= 0x40 && bytes[at + 1]! <= 0x7e || bytes[at + 1]! >= 0x80 && bytes[at + 1]! <= 0xfc) ? 2 : 1) :
            b === 0x8f && at + 2 < bytes.length && bytes[at + 1]! >= 0xa1 && bytes[at + 1]! <= 0xfe && bytes[at + 2]! >= 0xa1 && bytes[at + 2]! <= 0xfe ? 3 :
                (b === 0x8e && at + 1 < bytes.length && bytes[at + 1]! >= 0xa1 && bytes[at + 1]! <= 0xdf || b >= 0xa1 && b <= 0xfe && at + 1 < bytes.length && bytes[at + 1]! >= 0xa1 && bytes[at + 1]! <= 0xfe) ? 2 : 1;
        let raw = bytes.subarray(at, at + width);
        let mapped = table.get(raw.toString('hex'));
        if (mapped === undefined && width > 1) {
            width = 1;
            raw = bytes.subarray(at, at + 1);
            mapped = table.get(raw.toString('hex'));
        }
        // A lead with enough remaining bytes but an invalid continuation is
        // a native NOMAP, whereas its short EOF prefix is native PARTIAL.
        if (width === 1 && mapped?.length === 0 && at + 1 < bytes.length)
            mapped = Buffer.from([0xef, 0xbf, 0xbd]);
        if (perlqq && (!mapped || mapped.equals(Buffer.from([0xef, 0xbf, 0xbd]))))
            out.push(Buffer.from(Array.from(raw, byte => '\\x' + byte.toString(16).toUpperCase().padStart(2, '0')).join('')));
        else
            out.push(mapped ?? Buffer.from([0xef, 0xbf, 0xbd]));
        at += width;
    }
    return Buffer.concat(out);
}
function jisEuc(bytes: Buffer): Buffer {
    const text = bytes.toString('latin1');
    const converted = text.replace(/(\x1b\$\(D|\x1b\$[@B]|\x1b&@\x1b\$B|\x1b\([BJI])([^\x1b]*)/g, (_all, esc: string, body: string) => {
        if (esc === '\x1b(B' || esc === '\x1b(J')
            return body;
        let chunk = body.replace(/[\x21-\x7e]/g, c => String.fromCharCode(c.charCodeAt(0) + 128));
        if (esc === '\x1b(I')
            chunk = chunk.replace(/[\xa1-\xdf]/g, c => '\x8e' + c);
        else if (esc === '\x1b$(D')
            chunk = chunk.replace(/[\xa1-\xfe][\xa1-\xfe]/g, pair => '\x8f' + pair);
        return chunk;
    });
    return Buffer.from(converted.replace(/\x1b[^]*/, ''), 'latin1');
}
function japaneseConvert(profile: ProfileData, name: string, input: NativeString): Buffer {
    const jis = name === 'jis' || name.startsWith('iso');
    let decoded = input.flagged() ? input.bytes() : japaneseDecode(profile, jis ? 'euc-jp' : name === 'euc-jp' ? 'euc-jp' : 'shiftjis', jis ? jisEuc(input.bytes()) : input.bytes(), jis);
    if (!name.startsWith('iso'))
        return decoded;
    // Jcode h2z performs an actual Unicode->EUC->normalization->Unicode roundtrip.
    const euc = Buffer.concat(byteCharacters(NativeString.flagged(decoded)).map(char => profile.encodeEuc.get(char.bytes().toString('hex')) ?? Buffer.from('?')));
    const parts: Buffer[] = [];
    for (let at = 0; at < euc.length;) {
        let mapped: Buffer | undefined, width = 1;
        if (euc[at] === 0x8e)
            for (const count of [4, 2]) {
                const candidate = profile.h2z.get(euc.subarray(at, at + count).toString('hex'));
                if (candidate) {
                    mapped = candidate;
                    width = count;
                    break;
                }
            }
        parts.push(mapped ?? euc.subarray(at, at + width));
        at += width;
    }
    decoded = japaneseDecode(profile, 'euc-jp', Buffer.concat(parts));
    return decoded;
}
export function nativeUtf8Valid(input: NativeString | undefined): boolean {
    if (input === undefined)
        return true;
    const bytes = input.bytes();
    for (let at = 0; at < bytes.length;) {
        const first = bytes[at]!;
        if (first < 128) {
            if (first < 32 && first !== 9 && first !== 10 && first !== 13)
                return false;
            at++;
            continue;
        }
        const width = first >= 0xc2 && first < 0xe0 ? 2 : first >= 0xe0 && first < 0xf0 ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
        if (!width || at + width > bytes.length)
            return false;
        for (let i = 1; i < width; i++)
            if (bytes[at + i]! < 128 || bytes[at + i]! > 191)
                return false;
        if (first === 0xe0 && bytes[at + 1]! < 0xa0 || first === 0xf0 && bytes[at + 1]! < 0x90 || first === 0xf4 && bytes[at + 1]! > 0x8f)
            return false;
        at += width;
    }
    return true;
}
export function nativeTextOut(input: NativeString | undefined): NativeString | undefined {
    if (input === undefined || nativeUtf8Valid(input))
        return input?.clone();
    if (!input.flagged())
        return NativeString.bytes(input.bytes().map(byte => byte === 0 || byte >= 128 ? 63 : byte));
    const pieces = byteCharacters(input).map(part => {
        const point = part.bytes().toString('utf8').codePointAt(0)!;
        return point === 0 || point >= 128 && point <= 255 ? NativeString.hostUnicode('?') : part;
    });
    return NativeString.flagged(Buffer.concat(pieces.map(part => part.bytes())));
}
export function convertNativeToUtf8(profile: NativeEncodingProfile, name: NativeString | undefined, input: NativeString | undefined, limits: NativeEncodingLimits): NativeEncodingResult {
    const facts = data(profile);
    for (const limit of [limits.maxInputBytes, limits.maxOutputBytes])
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw Error('Invalid encoding limits');
    if (input !== undefined && input.bytes().length > limits.maxInputBytes)
        throw Error('Encoding input bound');
    if (name === undefined)
        return { kind: 'conversion-failure', reason: 'missing-charset' };
    const id = facts.names.get(charset(facts, name));
    if (id === undefined)
        return { kind: 'conversion-failure', reason: 'unsupported-charset' };
    const converter = facts.converters.get(id)!, value = input ?? NativeString.bytes(Buffer.alloc(0));
    if (converter.kind === 'string' && converter.name === 'utf8') {
        if (value.bytes().length > limits.maxOutputBytes)
            throw Error('Encoding output bound');
        return { kind: 'converted', value: value.clone() };
    }
    let output: Buffer;
    if (converter.kind === 'map8')
        output = utf16(Buffer.concat(Array.from(value.bytes(), byte => converter.entries![byte]!)));
    else if (converter.kind === 'map')
        output = mapConvert(converter, value.bytes());
    else if (converter.kind === 'string')
        output = stringConvert(converter.name!, value);
    else
        output = japaneseConvert(facts, converter.name!, value);
    if (output.length > limits.maxOutputBytes)
        throw Error('Encoding output bound');
    return { kind: 'converted', value: NativeString.bytes(output) };
}

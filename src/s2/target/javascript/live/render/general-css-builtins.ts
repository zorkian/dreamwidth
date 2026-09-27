// general-css-builtins.ts
//
// Scalar-aware native S2 CSS string generators.
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
// Semantic ports from LJ/S2.pm, originally forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and subsequently modified by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. A copy of that license is
// included in the LICENSE file in this distribution.
//
import { runtime, type BuiltinFunction, type Context } from '../../runtime/s2runtime';
import { NativeString, scalarPV, scalarNumber, scalarTruthy, scalarConcat } from '../../runtime/native-scalar';
import { arithmetic, divide, intCast } from '../../runtime/native-number';
import { byteCharacters, characterCodepoint, caseString, concatStrings, replaceString } from '../../runtime/native-string';
import { nativeCharacterClass } from '../../runtime/native-profile';
const bytes = NativeString.hostUtf8Bytes;
const empty = (): NativeString => bytes('');
function member(ctx: Context, kind: 'space' | 'digit' | 'asciiLetterInsensitive', value: NativeString): boolean {
    if (!ctx.scalarProfile)
        throw Error('Missing installed native character profile');
    const point = characterCodepoint(value);
    return point <= 0x10ffffn && nativeCharacterClass(ctx.scalarProfile, kind, Number(point), value.flagged());
}
function literal(value: NativeString, character: string): boolean {
    const raw = value.bytes();
    return raw.length === 1 && raw[0] === character.charCodeAt(0);
}
function slice(value: NativeString, chars: readonly NativeString[], start: number, end: number): NativeString {
    return NativeString.fromFrame({ bytes: Buffer.concat(chars.slice(start, end).map(char => char.bytes())), utf8: value.flagged() });
}
function trim(ctx: Context, value: NativeString): NativeString {
    const chars = byteCharacters(value);
    let start = 0, end = chars.length;
    while (start < end && member(ctx, 'space', chars[start]!))
        start++;
    while (end > start && member(ctx, 'space', chars[end - 1]!))
        end--;
    return slice(value, chars, start, end);
}
function lengthValue(ctx: Context, value: NativeString): NativeString {
    value = trim(ctx, value);
    const view = value.bytes().toString('latin1');
    if (['larger', 'smaller', 'xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'auto', 'inherit'].includes(view))
        return value;
    const chars = byteCharacters(value);
    let at = 0;
    if (chars[at] && (literal(chars[at]!, '-') || literal(chars[at]!, '+')))
        at++;
    const before = at;
    while (chars[at] && member(ctx, 'digit', chars[at]!))
        at++;
    let digits = at - before;
    if (chars[at] && literal(chars[at]!, '.')) {
        at++;
        const after = at;
        while (chars[at] && member(ctx, 'digit', chars[at]!))
            at++;
        digits = at - after;
    }
    const unit = slice(value, chars, at, chars.length).bytes().toString('latin1');
    if (digits && ['em', 'ex', 'px', 'in', 'cm', 'mm', 'pt', 'pc', '%'].includes(unit))
        return value;
    // This source branch is literal ASCII zero, not the preceding /d digit set.
    if (/^(0*\.)?0+$/.test(view))
        return bytes('0');
    return empty();
}
function lengthParts(ctx: Context, value: NativeString): [
    NativeString | undefined,
    NativeString | undefined
] {
    const chars = byteCharacters(value);
    // Preserve the source unanchored /(\d+)(.+)/ and its greedy backtracking:
    // a final digit can become the unit; LF alone is excluded by dot.
    for (let start = 0; start < chars.length; start++) {
        if (!member(ctx, 'digit', chars[start]!))
            continue;
        let end = start + 1;
        while (chars[end] && member(ctx, 'digit', chars[end]!))
            end++;
        if (end === chars.length || literal(chars[end]!, '\n'))
            end--;
        if (end === start)
            continue;
        let tail = end;
        while (chars[tail] && !literal(chars[tail]!, '\n'))
            tail++;
        if (tail > end)
            return [slice(value, chars, start, end), slice(value, chars, end, tail)];
    }
    return [undefined, undefined];
}
function quote(value: NativeString): NativeString {
    value = replaceString(value, bytes('\\'), bytes('\\\\'));
    value = replaceString(value, bytes('"'), bytes('\\"'));
    return concatStrings(concatStrings(bytes('"'), value), bytes('"'));
}
function allowedHash(allowed: unknown): unknown {
    return Array.isArray(allowed) ? runtime.makeHash(Array.from(allowed, key => [scalarPV(key), true] as const)) : allowed;
}
function keyword(ctx: Context, value: NativeString, allowed: unknown): NativeString {
    value = trim(ctx, value);
    for (const char of byteCharacters(value))
        if (!literal(char, '-') && !member(ctx, 'asciiLetterInsensitive', char))
            return empty();
    if (scalarTruthy(allowed)) {
        allowed = allowedHash(allowed);
        if (!scalarTruthy(runtime.memberSlot(allowed, value, 'hash').get()))
            return empty();
    }
    return caseString(value, 'lower', ctx.scalarProfile);
}
function keywordList(ctx: Context, value: NativeString, allowed: unknown): NativeString {
    value = trim(ctx, value);
    allowed = allowedHash(allowed);
    const chars = byteCharacters(value), out: NativeString[] = [];
    let start = 0;
    for (let at = 0; at <= chars.length; at++) {
        if (at !== chars.length && !member(ctx, 'space', chars[at]!))
            continue;
        if (at > start) {
            const cleaned = keyword(ctx, slice(value, chars, start, at), allowed);
            if (scalarTruthy(cleaned))
                out.push(cleaned);
        }
        start = at + 1;
    }
    let result = empty();
    for (const [index, part] of out.entries())
        result = concatStrings(result, index ? concatStrings(bytes(' '), part) : part);
    return result;
}
/** These generators reproduce builtin strings; the final CSS cleaner owns policy. */
export function generalCssCallbacks(): Record<string, BuiltinFunction> {
    return {
        _string__css_length_value: (ctx, value) => lengthValue(ctx, scalarPV(value)),
        _string__css_multiply_length: (ctx, value, multiplier) => {
            const [length, unit] = lengthParts(ctx, scalarPV(value));
            return lengthValue(ctx, scalarConcat(arithmetic('*', scalarNumber(length), scalarNumber(multiplier)), unit));
        },
        _string__css_divide_length: (ctx, value, divisor) => {
            const [length, unit] = lengthParts(ctx, scalarPV(value));
            return lengthValue(ctx, scalarConcat(intCast(divide(scalarNumber(length), scalarNumber(divisor))), unit));
        },
        _string__css_string: (_ctx, value) => quote(scalarPV(value)),
        _string__css_url_value: (_ctx, value) => {
            const pv = scalarPV(value), view = pv.bytes().toString('latin1');
            if (!/^https?:\/\//.test(view) || /[^a-z0-9A-Z.@$\-_+!*'(),&=#;:?/%~]/.test(view))
                return empty();
            return concatStrings(concatStrings(bytes('url('), quote(pv)), bytes(')'));
        },
        _string__css_keyword: (ctx, value, allowed) => keyword(ctx, scalarPV(value), allowed),
        _string__css_keyword_list: (ctx, value, allowed) => keywordList(ctx, scalarPV(value), allowed),
    };
}

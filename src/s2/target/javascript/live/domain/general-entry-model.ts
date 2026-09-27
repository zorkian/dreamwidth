// general-entry-model.ts
//
// Native anonymous Entry model construction from approved named fields.
//
// Portions adapted from LJ::S2::Entry, forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and modified by Dreamwidth Studios,
// LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, adapted portions and modifications are
// provided under the GNU General Public License; see LICENSE.
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
import { runtime } from '../../runtime/s2runtime';
import { NativeString, NativeNumber, scalarPV, scalarNumber, scalarTruthy } from '../../runtime/native-scalar';
import { arithmetic, divide, numericCompare } from '../../runtime/native-number';
import { byteCharacters, characterCodepoint, caseString, compareStrings } from '../../runtime/native-string';
import { nativeCharacterClass, type NativeProfile } from '../../runtime/native-profile';
import type { GeneralModel } from './general-model-primitives';
export interface GeneralEntryInput {
    readonly subject: unknown;
    readonly text: unknown;
    readonly journal: unknown;
    readonly poster: unknown;
    readonly newDay: unknown;
    readonly endDay: unknown;
    readonly comments: unknown;
    readonly userpic: unknown;
    readonly permalinkUrl: unknown;
    readonly itemId: unknown;
    readonly tags: unknown;
    readonly timeformat24: unknown;
    readonly adminPost: unknown;
    readonly domId: unknown;
    readonly userpicStyle: unknown;
    readonly dateparts: unknown;
    readonly systemDateparts: unknown;
    readonly security: unknown;
    readonly allowmask: unknown;
    readonly adultContentLevel: unknown;
    readonly groupNames?: unknown;
}
export type EntryStandardImage = 'security-private' | 'security-protected' | 'security-groups' | 'adult-18' | 'adult-nsfw';
export interface GeneralEntryOperations {
    readonly features: {
        readonly memories: boolean;
        readonly tellafriend: boolean;
        readonly esn: boolean;
    };
    dateTimeParts(value: unknown): GeneralModel;
    standardImage(kind: EntryStandardImage): GeneralModel;
    currents(): {
        readonly values: readonly (readonly [
            NativeString,
            unknown
        ])[];
        readonly moodImage?: GeneralModel;
    };
    groupNames(): unknown;
}
const bytes = NativeString.hostUtf8Bytes;
function equal(value: unknown, expected: string): boolean {
    return compareStrings(scalarPV(value), bytes(expected)) === 0;
}
function model(value: unknown): GeneralModel {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || NativeString.is(value) || NativeNumber.is(value))
        throw Error('Invalid approved Entry object');
    return value as GeneralModel;
}
function classMember(profile: NativeProfile, kind: 'word' | 'asciiLetterInsensitive', char: NativeString): boolean {
    const point = characterCodepoint(char);
    return point <= 0x10ffffn && nativeCharacterClass(profile, kind, Number(point), char.flagged());
}
function asciiInsensitive(profile: NativeProfile, char: NativeString, expected: string): boolean {
    if (!classMember(profile, 'asciiLetterInsensitive', char))
        return false;
    return compareStrings(caseString(char, 'lower', profile), bytes(expected)) === 0 ||
        compareStrings(caseString(char, 'upper', profile), bytes(String.fromCharCode(expected.charCodeAt(0) - 32))) === 0;
}
function trustedMarker(value: NativeString, profile: NativeProfile): boolean {
    const chars = byteCharacters(value);
    // Exact fixed source /<(script|object|applet|embed|iframe)\b/i. This is
    // advisory model metadata, not an HTML parser or an output permission.
    for (let at = 0; at < chars.length; at++) {
        if (!equal(chars[at], '<'))
            continue;
        for (const name of ['script', 'object', 'applet', 'embed', 'iframe']) {
            if (at + name.length >= chars.length)
                continue;
            if (!Array.from(name).every((letter, offset) => asciiInsensitive(profile, chars[at + offset + 1]!, letter)))
                continue;
            const next = chars[at + name.length + 1];
            if (!next || !classMember(profile, 'word', next))
                return true;
        }
    }
    return false;
}
/** Operations are installed closures bound to approved facts, never SQL/IPC selectors. */
export function generalEntry(input: GeneralEntryInput, operations: GeneralEntryOperations, profile: NativeProfile): GeneralModel {
    const result: GeneralModel = { '.type': 'Entry', _link_keyseq: ['edit_entry', 'edit_tags'].map(bytes), _metadata: runtime.makeHash([]) };
    const fields = [
        ['subject', 'subject'], ['text', 'text'], ['journal', 'journal'], ['poster', 'poster'],
        ['new_day', 'newDay'], ['end_day', 'endDay'], ['comments', 'comments'], ['userpic', 'userpic'],
        ['permalink_url', 'permalinkUrl'], ['itemid', 'itemId'], ['tags', 'tags'],
        ['timeformat24', 'timeformat24'], ['admin_post', 'adminPost'], ['dom_id', 'domId'],
    ] as const;
    for (const [native, key] of fields)
        result['_' + native] = runtime.scalarCopy(input[key]);
    // An undef local $pic autovivifies locally only, not e->{userpic} or arg.
    const pic = result._userpic === undefined || result._userpic === null ? runtime.makeHash([]) : model(result._userpic);
    if (scalarTruthy(pic._url)) {
        const style = scalarTruthy(input.userpicStyle) ? input.userpicStyle : bytes('');
        if (equal(style, 'small') || equal(style, 'smaller')) {
            for (const field of ['_width', '_height']) {
                const value = scalarNumber(pic[field]);
                pic[field] = equal(style, 'small') ? divide(arithmetic('*', value, NativeNumber.integer(3n)), NativeNumber.integer(4n)) :
                    divide(value, NativeNumber.integer(2n));
            }
        }
    }
    // Native reads poster->{_u} even without a remote: undef autovivifies this
    // public reference in e, without changing the caller's scalar argument.
    if (result._poster === undefined || result._poster === null)
        result._poster = runtime.makeHash([]);
    if (!scalarTruthy(result._tags))
        result._tags = [];
    result._time = operations.dateTimeParts(input.dateparts);
    result._system_time = operations.dateTimeParts(input.systemDateparts);
    result._depth = NativeNumber.integer(0n);
    const keys = result._link_keyseq as NativeString[];
    if (operations.features.memories)
        keys.push(bytes('mem_add'));
    if (operations.features.tellafriend)
        keys.push(bytes('tell_friend'));
    if (operations.features.esn)
        keys.push(bytes('watch_comments'));
    if (operations.features.esn)
        keys.push(bytes('unwatch_comments'));
    if (equal(input.security, 'private') || equal(input.security, 'usemask') && numericCompare(scalarNumber(input.allowmask), NativeNumber.integer(0n)) === 0) {
        result._security = bytes('private');
        result._security_icon = operations.standardImage('security-private');
    }
    else if (equal(input.security, 'usemask')) {
        // Anonymous remote is absent, so custom masks cannot choose owner-only icons.
        result._security = bytes('protected');
        result._security_icon = operations.standardImage('security-protected');
    }
    result._adult_content_level = bytes('');
    if (equal(input.adultContentLevel, 'explicit')) {
        result._adult_content_level = bytes('18');
        result._adult_content_icon = operations.standardImage('adult-18');
    }
    else if (equal(input.adultContentLevel, 'concepts')) {
        result._adult_content_level = bytes('NSFW');
        result._adult_content_icon = operations.standardImage('adult-nsfw');
    }
    const current = operations.currents(), metadata = result._metadata;
    for (const [key, value] of current.values)
        runtime.memberSlot(metadata, caseString(key, 'lower', profile), 'hash').set(runtime.scalarCopy(value));
    if (current.moodImage !== undefined)
        result._mood_icon = current.moodImage;
    let groups = input.groupNames;
    if (!scalarTruthy(groups)) {
        if (result._journal === undefined || result._journal === null)
            result._journal = runtime.makeHash([]);
        groups = operations.groupNames();
    }
    if (scalarTruthy(groups))
        runtime.memberSlot(metadata, bytes('groups'), 'hash').set(runtime.scalarCopy(groups));
    if (trustedMarker(scalarPV(result._text), profile))
        result._text_must_print_trusted = NativeNumber.integer(1n);
    return result;
}

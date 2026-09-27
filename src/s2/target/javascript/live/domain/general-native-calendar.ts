// general-native-calendar.ts
//
// Issued installed calendar dependencies and native timezone/calendar operations.
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
// Time::Local algorithms derive from Time::Local 1.30, copyright (c) 1997-2020
// Graham Barr & Dave Rolsky, under the same terms as Perl 5.
// LJ::day_of_week derives from LiveJournal-owned LJ/Time.pm, modified by
// Dreamwidth Studios, LLC. These portions retain the GNU General Public License;
// see LICENSE and the original license:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// Native wide-time fallback derives from Perl 5.34 time64.c:
// Copyright (c) 2007-2008 Michael G Schwern; originally derived from Paul Sheer's
// pivotal_gmtime_r.c. Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom
// the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Timezone selection and recurrence semantics derive from GNU libc 2.35
// time/tzfile.c and time/tzset.c, Copyright (C) 1991-2022 Free Software Foundation,
// Inc. The GNU C Library is free software; you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation; either version 2.1 of the License, or (at your
// option) any later version. The GNU C Library is distributed in the hope that
// it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
// of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser
// General Public License for more details. You should have received a copy of
// the GNU Lesser General Public License along with the GNU C Library; if not,
// see <https://www.gnu.org/licenses/>.

import {createHash} from 'node:crypto';
import type {NativeProfile} from '../../runtime/native-profile';
import {NativeNumber, NativeString, scalarNumber, scalarPV} from '../../runtime/native-scalar';
import {NativeOutput} from '../../runtime/native-string';
import {arithmetic, arrayIndex, intCast, modulo, divide, numericCompare} from '../../runtime/native-number';

export interface GeneralCalendarProfile {readonly schema: 1}
export interface GeneralCalendarSession {readonly schema: 1}
export type GeneralCalendarResult = {
    readonly value: NativeNumber | undefined;
    readonly exceptionEffect: {readonly kind: 'cleared'} | {readonly kind: 'set'; readonly message: NativeString};
};
interface ZoneType {offset: number; dst: boolean; standard: boolean; universal: boolean}
interface Rule {kind: 'M' | 'J' | 'N'; day: number; month?: number; week?: number; seconds: number}
interface Posix {standard: number; daylight: number; start: Rule; end: Rule; hasDaylight: boolean; omittedRules: boolean}
interface Zone {
    transitions: bigint[]; indices: number[]; types: ZoneType[];
    leaps: {time: bigint; correction: number}[];
    recurrence?: Posix;
    recurrenceZone?: Zone;
}
interface Facts {
    scalar: NativeProfile; breakpoint: number; century: number; nextCentury: number;
    localMin: number; localMax: number; suffix: Buffer; zone: Zone;
    sources: readonly {path: string; sha256: string}[];
}
const issued = new WeakMap<GeneralCalendarProfile, Facts>();
const sessions = new WeakMap<GeneralCalendarSession, {facts: Facts; cheat: Map<string, NativeNumber>}>();
export function createGeneralCalendarSession(profile: GeneralCalendarProfile): GeneralCalendarSession {
    const session = Object.freeze({schema: 1 as const});
    sessions.set(session, {facts: facts(profile), cheat: new Map()});
    return session;
}
class InvalidCalendarData extends Error {}
function failure(): never {throw new InvalidCalendarData('Invalid installed calendar profile');}
function bytes64(raw: unknown): Buffer {
    if (typeof raw !== 'string') return failure();
    const value = Buffer.from(raw, 'base64');
    if (value.toString('base64') !== raw) return failure();
    return value;
}
function bytesHex(raw: unknown): Buffer {
    if (typeof raw !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(raw)) return failure();
    return Buffer.from(raw, 'hex');
}
function facts(profile: GeneralCalendarProfile): Facts {
    const value = issued.get(profile);
    if (!value) throw Error('Unissued calendar profile');
    return value;
}
function tzif(bytes: Buffer): Zone {
    let cursor = 0;
    const header = (): number[] => {
        if (cursor + 44 > bytes.length || bytes.toString('ascii', cursor, cursor + 4) !== 'TZif') return failure();
        const counts = Array.from({length: 6}, (_, i) => bytes.readUInt32BE(cursor + 20 + i * 4));
        cursor += 44;
        if (!counts[4]) return failure();
        return counts;
    };
    let counts = header(), width = 4;
    if (bytes[4] !== 0) {
        cursor += counts[3]! * 5 + counts[4]! * 6 + counts[5]! + counts[2]! * 8 + counts[0]! + counts[1]!;
        counts = header(); width = 8;
    }
    const [universalCount, standardCount, leapCount, timeCount, typeCount, charCount] = counts as [number, number, number, number, number, number];
    const required = timeCount * (width + 1) + typeCount * 6 + charCount + leapCount * (width + 4) + standardCount + universalCount;
    if (!Number.isSafeInteger(required) || cursor + required > bytes.length ||
        standardCount > typeCount || universalCount > typeCount) return failure();
    const readTime = (): bigint => {const value = width === 8 ? bytes.readBigInt64BE(cursor) : BigInt(bytes.readInt32BE(cursor)); cursor += width; return value;};
    const transitions = Array.from({length: timeCount}, readTime);
    if (transitions.some((value, i) => i > 0 && value <= transitions[i - 1]!)) return failure();
    const indices = Array.from(bytes.subarray(cursor, cursor + timeCount)); cursor += timeCount;
    if (indices.some(index => index >= typeCount)) return failure();
    const types = Array.from({length: typeCount}, (): ZoneType => {
        const offset = bytes.readInt32BE(cursor), dst = bytes[cursor + 4], name = bytes[cursor + 5]; cursor += 6;
        if (dst! > 1 || name! > charCount) return failure();
        return {offset, dst: !!dst, standard: false, universal: false};
    });
    cursor += charCount;
    const leaps = Array.from({length: leapCount}, () => {const time = readTime(), correction = bytes.readInt32BE(cursor); cursor += 4; return {time, correction};});
    if (leaps.some((value, i) => i > 0 && value.time <= leaps[i - 1]!.time)) return failure();
    for (let i = 0; i < standardCount; i++) types[i]!.standard = !!bytes[cursor++];
    for (let i = 0; i < universalCount; i++) types[i]!.universal = !!bytes[cursor++];
    const zone: Zone = {transitions, indices, types, leaps};
    if (width === 8 && cursor < bytes.length) {
        // libc ignores an unreadable footer while retaining the valid table.
        if (bytes[cursor++] === 10) {
            const end = bytes.indexOf(10, cursor);
            if (end > cursor) zone.recurrence = posix(bytes.toString('latin1', cursor, end));
        }
    }
    return zone;
}

// POSIX parsing and the source Time::Local operation are kept in this module;
// there is no ambient libc/ICU/Node-Date call in the serving helper.
function posix(text: string): Posix {
    // libc's parser retains partially parsed rules on malformed input. These
    // are configuration semantics, not a reason to refuse an S2 date/year.
    let cursor = 0;
    const result: Posix = {standard: 0, daylight: 0, start: {kind: 'N', day: 0, seconds: 0},
        end: {kind: 'N', day: 0, seconds: 0}, hasDaylight: false, omittedRules: false};
    const name = (): boolean => {
        const match = /^(?:[a-zA-Z]{3,}|<[a-zA-Z0-9+-]{3,}>)/.exec(text.slice(cursor));
        if (!match) return false;
        cursor += match[0].length; return true;
    };
    const ushort = (): number | undefined => {
        const match = /^[\t\n\r\f\v ]*[+-]?\d+/.exec(text.slice(cursor));
        if (!match) return undefined;
        cursor += match[0].length;
        const signed = BigInt(match[0].trim()), magnitude = signed < 0n ? -signed : signed;
        // scanf's unsigned conversion saturates at ULONG_MAX before narrowing
        // to unsigned short; it is not arbitrary-precision modulo on overflow.
        return magnitude > (1n << 64n) - 1n ? 65535 : Number(BigInt.asUintN(16, signed));
    };
    const clock = (): [number, number, number] | undefined => {
        const hour = ushort(); if (hour === undefined) return undefined;
        let minute = 0, second = 0;
        if (text[cursor] === ':') {const before = cursor; cursor++; const value = ushort();
            if (value === undefined) cursor = before; else {minute = value;
                if (text[cursor] === ':') {const earlier = cursor; cursor++; const sec = ushort();
                    if (sec === undefined) cursor = earlier; else second = sec;}}}
        return [hour, minute, second];
    };
    const offset = (daylight: boolean): boolean => {
        if (!daylight && (cursor === text.length ||
            text[cursor] !== '+' && text[cursor] !== '-' && !/\d/.test(text[cursor]!))) return false;
        const sign = text[cursor] === '-' ? 1 : -1;
        if (text[cursor] === '+' || text[cursor] === '-') cursor++;
        const value = clock();
        const seconds = value ? sign * (Math.min(24, value[0]) * 3600 + Math.min(59, value[1]) * 60 + Math.min(59, value[2])) :
            daylight ? result.standard + 3600 : 0;
        if (daylight) result.daylight = seconds; else result.standard = seconds;
        return !!value || daylight;
    };
    const rule = (target: Rule, second: boolean): boolean => {
        if (text[cursor] === ',') cursor++;
        if (text[cursor] === 'M') {
            target.kind = 'M'; target.month = 0; target.week = 0; target.day = 0; cursor++;
            const month = ushort(); if (month === undefined) return false; target.month = month;
            if (text[cursor++] !== '.') return false;
            const week = ushort(); if (week === undefined) return false; target.week = week;
            if (text[cursor++] !== '.') return false;
            const day = ushort(); if (day === undefined) return false; target.day = day;
            if (month < 1 || month > 12 || week < 1 || week > 5 || day > 6) return false;
        } else if (text[cursor] === 'J' || /\d/.test(text[cursor] ?? '')) {
            const julian = text[cursor] === 'J'; if (julian) cursor++;
            target.kind = julian ? 'J' : 'N';
            const match = /^\d+/.exec(text.slice(cursor)); if (!match) return false;
            const day = BigInt(match[0]); if (day > 365n || julian && day === 0n) return false;
            target.kind = julian ? 'J' : 'N'; target.day = Number(day); cursor += match[0].length;
        } else if (cursor === text.length) {
            target.kind = 'M'; target.month = second ? 11 : 3; target.week = second ? 1 : 2; target.day = 0;
        } else return false;
        if (cursor < text.length && text[cursor] !== '/' && text[cursor] !== ',') return false;
        target.seconds = 7200;
        if (text[cursor] === '/') {
            cursor++; if (cursor === text.length) return false;
            const negative = text[cursor] === '-'; if (negative) cursor++;
            const value = clock() ?? [2, 0, 0];
            target.seconds = (negative ? -1 : 1) * (value[0] * 3600 + value[1] * 60 + value[2]);
        }
        return true;
    };
    if (name() && offset(false)) {
        if (cursor === text.length) result.daylight = result.standard;
        else {
            result.hasDaylight = true;
            if (name()) {
                offset(true);
                result.omittedRules = cursor === text.length || text.slice(cursor) === ',';
            }
            if (rule(result.start, false)) rule(result.end, true);
        }
    }
    return result;
}

const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const positiveMod = (value: number, divisor: number): number => (value % divisor + divisor) % divisor;
function civilDays(year: number, month: number, day: number): number {
    // Proleptic Gregorian civil date to Unix days; bounded arithmetic after a
    // 400-year reduction. This is independent of timezone and JavaScript Date.
    const adjusted = year - (month < 3 ? 1 : 0), era = Math.floor(adjusted / 400), y = adjusted - era * 400;
    const shifted = month + (month > 2 ? -3 : 9);
    return era * 146097 + y * 365 + Math.floor(y / 4) - Math.floor(y / 100) +
        Math.floor((153 * shifted + 2) / 5) + day - 1 - 719468;
}
type Parts = [number, number, number, number, number, number, number, number, number];
function civilParts(days: number, second: number, minute: number, hour: number): Parts {
    const z = days + 719468, era = Math.floor(z / 146097), dayEra = z - era * 146097;
    const y = Math.floor((dayEra - Math.floor(dayEra / 1460) + Math.floor(dayEra / 36524) - Math.floor(dayEra / 146096)) / 365);
    const yearDay = dayEra - (365 * y + Math.floor(y / 4) - Math.floor(y / 100));
    const shifted = Math.floor((5 * yearDay + 2) / 153), day = yearDay - Math.floor((153 * shifted + 2) / 5) + 1;
    const month = shifted + (shifted < 10 ? 3 : -9), year = y + era * 400 + (month <= 2 ? 1 : 0);
    return [second, minute, hour, day, month - 1, year - 1900, positiveMod(days + 4, 7), days - civilDays(year, 1, 1), 0];
}
function integerParts(epoch: bigint, offset = 0): Parts {
    const value = epoch + BigInt(offset);
    let days = value / 86400n, remainder = value % 86400n;
    if (remainder < 0n) {remainder += 86400n; days--;}
    const seconds = Number(remainder);
    return civilParts(Number(days), seconds % 60, Math.floor(seconds / 60) % 60, Math.floor(seconds / 3600));
}
function doubleParts(epoch: number): Parts {
    // Perl time64.c divides the IEEE double successively, rather than splitting
    // exact BigInt seconds. Preserve rounding and negative WRAP in that order.
    let value = epoch, second = Math.trunc(value % 60); value = Math.trunc(value / 60);
    let minute = Math.trunc(value % 60); value = Math.trunc(value / 60);
    let hour = Math.trunc(value % 24), days = Math.trunc(value / 24);
    if (second < 0) {second += 60; minute--;}
    if (minute < 0) {minute += 60; hour--;}
    if (hour < 0) {hour += 24; days--;}
    return civilParts(days, second, minute, hour);
}
function safeYear(year: number): number {
    const diff = year - 2000 - (year > 2000 ? 1 : 0);
    let cycle = year + (Math.trunc(diff / 100) - Math.trunc(diff / 400)) * 16;
    if (year % 100 === 0 && year % 400 !== 0) cycle += 11;
    if ((year - 1) % 100 === 0 && (year - 1) % 400 !== 0) cycle += 17;
    // Native table is a rotated 2010..2037 solar cycle, not a supported-year list.
    return 2010 + positiveMod(positiveMod(cycle, 28) + 6, 28);
}
function change(rule: Rule, year: number, offset: number): bigint {
    let day = rule.day;
    if (rule.kind === 'J') {day--; if (leap(year) && rule.day >= 60) day++;}
    else if (rule.kind === 'M') {
        const m = (rule.month! + 9) % 12 + 1, y = rule.month! <= 2 ? year - 1 : year;
        const century = Math.trunc(y / 100), within = y % 100;
        const first = positiveMod((Math.trunc((26 * m - 2) / 10) + 1 + within + Math.trunc(within / 4) +
            Math.trunc(century / 4) - 2 * century) | 0, 7);
        let inMonth = positiveMod(rule.day - first, 7);
        const length = monthDays[rule.month! - 1]! + (rule.month === 2 && leap(year) ? 1 : 0);
        for (let week = 1; week < rule.week! && inMonth + 7 < length; week++) inMonth += 7;
        day = civilDays(year, rule.month!, inMonth + 1) - civilDays(year, 1, 1);
    }
    // Installed glibc2.35 computes the parenthesized day count in signed C int
    // before multiplying by time64 seconds. Its pre-1970 base is zero. Neither
    // is equivalent to unrestricted mathematical Gregorian epoch arithmetic.
    const days = year > 1970 ? (Math.imul(year - 1970, 365) + Math.trunc((year - 1) / 4) - Math.trunc(1970 / 4) -
        Math.trunc((year - 1) / 100) + Math.trunc(1970 / 100) + Math.trunc((year - 1) / 400) - Math.trunc(1970 / 400)) | 0 : 0;
    return BigInt(days + day) * 86400n + BigInt(rule.seconds - offset);
}
function posixType(rule: Posix, epoch: bigint): {offset: number; dst: boolean} {
    if (!rule.hasDaylight) return {offset: rule.standard, dst: false};
    const year = integerParts(epoch)[5] + 1900;
    const start = change(rule.start, year, rule.standard), end = change(rule.end, year, rule.daylight);
    const dst = start > end ? epoch < end || epoch >= start : epoch >= start && epoch < end;
    return {offset: dst ? rule.daylight : rule.standard, dst};
}
function localParts(facts: Facts, input: number): Parts {
    if (!Number.isFinite(input)) throw Error('Native calendar timestamp is not finite');
    let epoch = BigInt(Math.trunc(input)), original: Parts | undefined;
    if (input < facts.localMin || input > facts.localMax) {
        original = doubleParts(input);
        const year = original[5] + 1900;
        const mapped = year > 2037 || year < 1970 ? safeYear(year) : year;
        epoch = BigInt(civilDays(mapped, original[4] + 1, original[3])) * 86400n +
            BigInt(original[2] * 3600 + original[1] * 60 + original[0]);
    }
    let zone = facts.zone;
    if (zone.recurrenceZone && zone.transitions.length && epoch >= zone.transitions.at(-1)!) zone = zone.recurrenceZone;
    let type: {offset: number; dst: boolean};
    if (zone.transitions.length && epoch >= zone.transitions.at(-1)! && zone.recurrence) type = posixType(zone.recurrence, epoch);
    else if (!zone.transitions.length || epoch < zone.transitions[0]!) type = zone.types.find(item => !item.dst) ?? zone.types[0]!;
    else {
        let lo = 0, hi = zone.transitions.length;
        while (lo < hi) {const mid = (lo + hi) >>> 1; if (zone.transitions[mid]! <= epoch) lo = mid + 1; else hi = mid;}
        type = zone.types[zone.indices[lo - 1]!]!;
    }
    // Pure POSIX configurations have no TZif transitions at all.
    if (!zone.types.length && zone.recurrence) type = posixType(zone.recurrence, epoch);
    let correction = 0, hit = 0;
    for (let i = zone.leaps.length - 1; i >= 0; i--) {
        const value = zone.leaps[i]!;
        if (epoch < value.time) continue;
        correction = value.correction;
        if (epoch === value.time && value.correction > (i ? zone.leaps[i - 1]!.correction : 0)) {
            hit = 1;
            while (i > 0 && zone.leaps[i]!.time === zone.leaps[i - 1]!.time + 1n &&
                zone.leaps[i]!.correction === zone.leaps[i - 1]!.correction + 1) {hit++; i--;}
        }
        break;
    }
    const parts = integerParts(epoch - BigInt(correction), type!.offset);
    parts[0] += hit; parts[8] = type!.dst ? 1 : 0;
    if (original) {
        const difference = parts[4] - original[4];
        parts[5] = original[5] + (difference === 11 ? -1 : difference === -11 ? 1 : 0);
        if (!leap(parts[5] + 1900) && parts[7] === 365) parts[7]--;
    }
    return parts;
}

function defaultRules(zone: Zone, rule: Posix): Zone {
    if (zone.types.length < 2) return {transitions: [], indices: [], types: [], leaps: [], recurrence: rule};
    let standard = zone.types[0]!.offset, daylight = standard;
    let foundStandard = false, foundDaylight = false;
    for (let i = zone.indices.length - 1; i >= 0; i--) {
        const type = zone.types[zone.indices[i]!]!;
        if (type.dst && !foundDaylight) {daylight = type.offset; foundDaylight = true;}
        if (!type.dst && !foundStandard) {standard = type.offset; foundStandard = true;}
        if (foundStandard && foundDaylight) break;
    }
    let dst = false;
    const transitions = zone.transitions.map((time, i) => {
        const type = zone.types[zone.indices[i]!]!;
        const adjusted = type.universal ? time : time + BigInt(dst && !type.standard ? rule.daylight - daylight : rule.standard - standard);
        dst = type.dst; return adjusted;
    });
    return {transitions, indices: zone.indices.map(index => zone.types[index]!.dst ? 1 : 0),
        types: [{offset: rule.standard, dst: false, standard: false, universal: false},
            {offset: rule.daylight, dst: true, standard: false, universal: false}], leaps: zone.leaps,
        // libc retains the default file's future footer; it overrides its names
        // but does not rewrite the footer's offsets during __tzfile_default.
        recurrence: zone.recurrence};
}
export function loadGeneralCalendarProfile(raw: any, scalarProfile: NativeProfile): GeneralCalendarProfile {
    if (raw?.schema !== 1 || raw.perl !== '5.034000' || raw.timeLocal !== '1.30' || raw.libcVersion !== '2.35' ||
        scalarProfile.version !== '5.34.0' || scalarProfile.ivsize !== '8' || scalarProfile.uvsize !== '8' ||
        scalarProfile.nvsize !== '8' || scalarProfile.nvtype !== 'double' || scalarProfile.nv_preserves_uv_bits !== '53' ||
        raw.archname !== scalarProfile.archname || raw.ivsize !== scalarProfile.ivsize || raw.nvsize !== scalarProfile.nvsize ||
        !Number.isSafeInteger(raw.year) || raw.breakpoint !== (raw.year + 50) % 100) return failure();
    let next = raw.year - raw.year % 100; if (raw.breakpoint < 50) next += 100;
    if (raw.nextCentury !== next || raw.century !== next - 100 || raw.epoc !== 719469 || raw.secOff !== 0 ||
        raw.maxDay !== 365 * 2 ** 31 || !Array.isArray(raw.sources) || raw.sources.length === 0) return failure();
    const paths = new Set<string>();
    const sources = raw.sources.map((source: any) => {
        if (typeof source?.path !== 'string' || !source.path.startsWith('/') || paths.has(source.path) ||
            typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256)) return failure();
        paths.add(source.path); return Object.freeze({path: source.path, sha256: source.sha256});
    });
    const boundBytes = (path: unknown, bytes: Buffer): Buffer => {
        const source = sources.find((item: {path: string}) => item.path === path);
        if (!source || source.sha256 !== createHash('sha256').update(bytes).digest('hex')) return failure();
        return bytes;
    };
    let zone: Zone;
    let defaults: Zone | undefined;
    if (raw.timezone?.defaultRules !== undefined) {
        const bytes = boundBytes(raw.timezone.defaultRulesPath, bytes64(raw.timezone.defaultRules));
        try {defaults = tzif(bytes);} catch (error) {if (!(error instanceof InvalidCalendarData)) throw error;}
    }
    if (raw.timezone?.kind === 'tzif') {
        const bytes = boundBytes(raw.timezone.path, bytes64(raw.timezone.base64));
        try {zone = tzif(bytes);} catch (error) {
            if (!(error instanceof InvalidCalendarData)) throw error;
            zone = {transitions: [], indices: [], types: [], leaps: [], recurrence: posix(bytesHex(raw.timezone.fallbackHex).toString('latin1'))};
        }
        if (zone.recurrence?.omittedRules && defaults) zone.recurrenceZone = defaultRules(defaults, zone.recurrence);
    }
    else if (raw.timezone?.kind === 'posix') {
        const rule = posix(bytesHex(raw.timezone.textHex).toString('latin1'));
        zone = {transitions: [], indices: [], types: [], leaps: [], recurrence: rule};
        if (rule.omittedRules && defaults) zone = defaultRules(defaults, rule);
    } else return failure();
    const suffix = bytesHex(raw.errorSuffixHex);
    if (!suffix.length || suffix.at(-1) !== 10) return failure();
    const limits = raw.limits;
    if (limits?.LOCALTIME_MIN !== '-62167219200' || limits?.LOCALTIME_MAX !== '67768036191676799') return failure();
    const value: Facts = {scalar: Object.freeze(structuredClone(scalarProfile)), breakpoint: raw.breakpoint,
        century: raw.century, nextCentury: raw.nextCentury, localMin: Number(limits.LOCALTIME_MIN),
        localMax: Number(limits.LOCALTIME_MAX), suffix, zone, sources: Object.freeze(sources)};
    // Setup checks are independent installed localtime answers. They cover every
    // transition +/-1, pre-first state, recurrence and native time64 boundaries.
    if (!Array.isArray(raw.localChecks) || raw.localChecks.length === 0) return failure();
    for (const check of raw.localChecks) {
        if (typeof check.epoch !== 'string' || !/^-?\d+$/.test(check.epoch) ||
            !Array.isArray(check.parts) || check.parts.length !== 9 || !check.parts.every(Number.isSafeInteger)) return failure();
        const actual = localParts(value, Number(check.epoch));
        if (actual.some((part, i) => part !== check.parts[i])) throw Error(`Installed calendar timezone model differs from native at ${check.epoch}: ${JSON.stringify(actual)} versus ${JSON.stringify(check.parts)}`);
    }
    if (!Array.isArray(raw.latchChecks) || raw.latchChecks.length !== 2) return failure();
    const profile = Object.freeze({schema: 1 as const}); issued.set(profile, value);
    const session = createGeneralCalendarSession(profile);
    for (const [i, check] of raw.latchChecks.entries()) {
        if (check.year !== raw.breakpoint + i || typeof check.epoch !== 'string') return failure();
        const epoch = timegm(session, NativeNumber.integer(BigInt(check.year)), NativeNumber.integer(0n), NativeNumber.integer(1n));
        if (scalarPV(epoch).bytes().toString('latin1') !== check.epoch) throw Error('Installed calendar module latches differ');
    }
    return profile;
}
export function verifyGeneralCalendarSources(profile: GeneralCalendarProfile, read: (path: string) => Uint8Array): void {
    for (const source of facts(profile).sources) {
        if (createHash('sha256').update(read(source.path)).digest('hex') !== source.sha256)
            throw Error('Installed calendar dependency changed');
    }
}
const constant = (value: number): NativeNumber => NativeNumber.integer(BigInt(value));
const add = (a: NativeNumber, b: NativeNumber): NativeNumber => arithmetic('+', a, b);
const sub = (a: NativeNumber, b: NativeNumber): NativeNumber => arithmetic('-', a, b);
const mul = (a: NativeNumber, b: NativeNumber): NativeNumber => arithmetic('*', a, b);
function nv(value: NativeNumber): number {
    const wire = value.wire();
    return wire.mode === 'nv' ? Buffer.from(wire.value, 'hex').readDoubleBE() : Number(wire.value);
}
class CalendarSemanticError extends Error {
    constructor(readonly value: NativeString) {super('Native calendar semantic failure');}
}
function sessionData(session: GeneralCalendarSession): {facts: Facts; cheat: Map<string, NativeNumber>} {
    const data = sessions.get(session); if (!data) throw Error('Unissued calendar session'); return data;
}
function daygm(session: GeneralCalendarSession, day: NativeNumber, month: NativeNumber, year: NativeNumber): NativeNumber {
    const state = sessionData(session);
    const key = `${BigInt.asIntN(16, arrayIndex(month))},${BigInt.asIntN(16, arrayIndex(year))}`;
    let base = state.cheat.get(key);
    if (base === undefined || numericCompare(base, constant(0)) === 0) {
        const shifted = modulo(add(month, constant(10)), constant(12));
        const adjusted = sub(add(year, constant(1900)), intCast(divide(shifted, constant(10))));
        base = sub(add(sub(add(mul(constant(365), adjusted), intCast(divide(adjusted, constant(4)))),
            intCast(divide(adjusted, constant(100)))), add(intCast(divide(adjusted, constant(400))),
            intCast(divide(add(mul(shifted, constant(306)), constant(5)), constant(10))))), constant(719469));
        state.cheat.set(key, base);
    }
    return add(day, base);
}
function timegm(session: GeneralCalendarSession, originalYear: NativeNumber, month: NativeNumber, day: NativeNumber,
    dayInput?: {value: unknown}): NativeNumber {
    const state = sessionData(session), zero = constant(0);
    let year = originalYear;
    if (numericCompare(year, constant(1000)) >= 0) year = sub(year, constant(1900));
    else if (numericCompare(year, constant(100)) < 0 && numericCompare(year, zero) >= 0)
        year = add(year, constant(numericCompare(year, constant(state.facts.breakpoint)) > 0 ? state.facts.century : state.facts.nextCentury));
    const originalDay = dayInput ? dayInput.value : day;
    const die = (...parts: unknown[]): never => {
        // The range comparison does not replace mday's original undef/PV. Use
        // the shared flag-aware concatenation, including mixed raw/wide strings.
        const output = new NativeOutput();
        for (const value of parts) output.append(scalarPV(value));
        output.append(NativeString.bytes(state.facts.suffix));
        throw new CalendarSemanticError(output.scalar());
    };
    if (numericCompare(month, constant(11)) > 0 || numericCompare(month, zero) < 0) die("Month '", month, "' out of range 0..11");
    const index = Number(arrayIndex(month));
    let max = monthDays[index]!;
    const full = add(year, constant(1900));
    const divisible = (by: number): boolean => numericCompare(modulo(full, constant(by)), zero) === 0;
    if (numericCompare(month, constant(1)) === 0 && divisible(4) && (!divisible(100) || divisible(400))) max++;
    if (numericCompare(day, constant(max)) > 0 || numericCompare(day, constant(1)) < 0) die("Day '", originalDay, `' out of range 1..${max}`);
    const days = daygm(session, day, month, year);
    if (!(Math.abs(nv(days)) < 365 * 2 ** 31)) {
        const prefix: unknown[] = nv(days) > 365 * 2 ** 31 ? ['Day too big - ', days, ' > ', constant(365 * 2 ** 31), '\n'] : [];
        die(...prefix, 'Cannot handle date (0, 0, 0, ', originalDay, ', ', month, ', ', full, ')');
    }
    return mul(constant(86400), days);
}
function fromParts(session: GeneralCalendarSession, parts: Parts): NativeNumber {
    const days = daygm(session, constant(parts[3]), constant(parts[4]), constant(parts[5]));
    return add(add(add(constant(parts[0]), mul(constant(60), constant(parts[1]))), mul(constant(3600), constant(parts[2]))), mul(constant(86400), days));
}
export function generalNativeDayOfWeek(session: GeneralCalendarSession, year: unknown, month: unknown, day: unknown): GeneralCalendarResult {
    const state = sessionData(session), local = (time: NativeNumber): Parts => localParts(state.facts, nv(time));
    let result: NativeNumber;
    try {
        const reference = timegm(session, scalarNumber(year), sub(scalarNumber(month), constant(1)), scalarNumber(day), {value: day});
        const located = fromParts(session, local(reference));
        const zoneOffset = sub(located, reference);
        if (numericCompare(zoneOffset, constant(0)) === 0) result = located;
        else {
            let candidate = sub(reference, zoneOffset);
            const daylightOffset = sub(reference, fromParts(session, local(candidate)));
            if (numericCompare(daylightOffset, constant(0)) === 0 &&
                numericCompare(sub(sub(reference, constant(3600)), fromParts(session, local(sub(candidate, constant(3600))))), constant(0)) < 0)
                result = sub(candidate, constant(3600));
            else {
                candidate = add(candidate, daylightOffset);
                if (numericCompare(daylightOffset, constant(0)) <= 0) {
                    const parts = local(candidate);
                    if (parts[0] !== 0 || parts[1] !== 0 || parts[2] !== 0) candidate = sub(candidate, daylightOffset);
                }
                result = candidate;
            }
        }
    } catch (error) {
        if (!(error instanceof CalendarSemanticError)) throw error;
        return {value: undefined, exceptionEffect: {kind: 'set', message: error.value}};
    }
    // Native LJ::day_of_week performs this localtime outside its eval.
    return {value: constant(local(result)[6]), exceptionEffect: {kind: 'cleared'}};
}

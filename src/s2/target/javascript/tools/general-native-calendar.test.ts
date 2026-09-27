// general-native-calendar.test.ts
//
// Independent installed calendar, timezone, cache and exception-effect proofs.
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import type {NativeProfile} from '../runtime/native-profile';
import {NativeNumber, NativeString} from '../runtime/native-scalar';
import {loadGeneralCalendarProfile, verifyGeneralCalendarSources, createGeneralCalendarSession,
    generalNativeDayOfWeek, type GeneralCalendarResult} from '../live/domain/general-native-calendar';

const scalar: NativeProfile = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], {
    input: JSON.stringify({profileOnly: true}), encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
})).profile;
const setup = (timezone: string | undefined): any => JSON.parse(execFileSync('/usr/bin/prlimit',
    ['--as=268435456', '--cpu=10', '--', 'perl', 'tools/native-calendar-profile.pl'], {
        env: {...process.env, TZ: timezone}, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
    }));
type Input = number | string | null | {unicode: string};
const inputs: readonly (readonly [Input, Input, Input])[] = [
    [2026, 9, 27], [76, 1, 1], [77, 1, 1], [100, 1, 1], [2026, 2, 30], [2026, 1, 0],
    [2026, 1.5, 1], ['2026x', 1, 1], [null, 1, 1], [2026, 1, 1], [67562, 1, 1],
    [2026, 1, {unicode: '猫'}], [2026, 14, 1], [-1901, 1, 1], [2011, 12, 30],
    [2100, 3, 14], [2147483000, 1, 1], [2147483647, 12, 31],
    [2026, 1, null], [2200000000, 1, {unicode: '1猫'}],
];
const nativeSource = String.raw`
use strict;use warnings;use JSON::PP;use MIME::Base64 qw(encode_base64);use Encode ();use DBI ();
our $attempted;BEGIN{no warnings 'redefine';*DBI::connect=sub{$attempted=1;die'DB forbidden'};*DBI::connect_cached=sub{$attempted=1;die'DB forbidden'}}
require '/workspaces/dreamwidth/cgi-bin/LJ/Time.pm';local$/;my$rows=decode_json(<STDIN>);my@out;
for my$row(@$rows){my@v=map{ref($_)?$_->{unicode}:$_}@$row;my$value=LJ::day_of_week(@v);my$error=$@;
push@out,{value=>$value,error=>{base64=>encode_base64(utf8::is_utf8($error)?Encode::encode('UTF-8',$error):$error,''),utf8=>utf8::is_utf8($error)?JSON::PP::true:JSON::PP::false}};}
die'DB attempted'if$attempted;print JSON::PP->new->canonical->encode(\@out);
`;
function actual(timezone: string | undefined, rows = inputs): any[] {
    return JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=268435456', '--cpu=10', '--', 'perl', '-e', nativeSource], {
        env: {...process.env, TZ: timezone}, input: JSON.stringify(rows), encoding: 'utf8', timeout: 15000,
    }));
}
function input(value: Input): unknown {
    if (value === null) return undefined;
    if (typeof value === 'number') return NativeNumber.literal(String(value));
    if (typeof value === 'string') return NativeString.bytes(Buffer.from(value, 'latin1'));
    return NativeString.hostUnicode(value.unicode);
}
function check(result: GeneralCalendarResult, expected: any): void {
    assert.equal(result.value?.pv().bytes().toString() ?? null, expected.value === null ? null : String(expected.value));
    if (expected.error.base64 === '') assert.deepEqual(result.exceptionEffect, {kind: 'cleared'});
    else {
        assert.equal(result.exceptionEffect.kind, 'set');
        if (result.exceptionEffect.kind !== 'set') throw Error('missing error effect');
        assert.equal(result.exceptionEffect.message.bytes().toString('base64'), expected.error.base64);
        assert.equal(result.exceptionEffect.message.flagged(), expected.error.utf8);
    }
}
for (const zone of [undefined, 'UTC', 'America/New_York', 'Pacific/Apia', 'AAA2BBB', 'AAA2BBB,J60/0,J300/0', 'AAA2BBB,60/0,300/0', 'right/UTC', 'AAA2@', 'no-such-calendar-zone']) {
    test(`installed calendar matches independent native ${zone}`, () => {
        const profile = loadGeneralCalendarProfile(setup(zone), scalar);
        verifyGeneralCalendarSources(profile, path => readFileSync(path));
        const session = createGeneralCalendarSession(profile), expected = actual(zone);
        inputs.forEach((row, i) => check(generalNativeDayOfWeek(session, ...row.map(input) as [unknown, unknown, unknown]), expected[i]));
        if (zone === 'Pacific/Apia') assert.equal(expected[14].value, 4); // native gap resolves to Dec29
    });
}
test('explicit session cache preserves native signed-short collisions without implicit sharing', () => {
    const profile = loadGeneralCalendarProfile(setup('UTC'), scalar);
    const rows: readonly (readonly [Input, Input, Input])[] = [[2026, 1, 1], [67562, 1, 1]];
    const expected = actual('UTC', rows), warmed = createGeneralCalendarSession(profile);
    rows.forEach((row, i) => check(generalNativeDayOfWeek(warmed, ...row.map(input) as [unknown, unknown, unknown]), expected[i]));
    const alone = actual('UTC', [rows[1]!]);
    check(generalNativeDayOfWeek(createGeneralCalendarSession(profile), ...rows[1]!.map(input) as [unknown, unknown, unknown]), alone[0]);
    assert.notEqual(expected[1].value, alone[0].value);
    const fractional: readonly (readonly [Input, Input, Input])[] = [[2026.5, 1, 1], [2026, 1, 1]];
    const fractionalExpected = actual('UTC', fractional), fractionalSession = createGeneralCalendarSession(profile);
    fractional.forEach((row, i) => check(generalNativeDayOfWeek(fractionalSession, ...row.map(input) as [unknown, unknown, unknown]), fractionalExpected[i]));
});
test('profile/source authority and native model checks fail closed', () => {
    const raw = setup('UTC'), profile = loadGeneralCalendarProfile(raw, scalar);
    assert.throws(() => createGeneralCalendarSession({schema: 1}), /Unissued/);
    assert.throws(() => generalNativeDayOfWeek({schema: 1}, 2026, 1, 1), /Unissued/);
    assert.throws(() => verifyGeneralCalendarSources(profile, () => Buffer.from('changed')), /dependency changed/);
    assert.throws(() => verifyGeneralCalendarSources(profile, () => {throw Error('read failure');}), /read failure/);
    const changed = structuredClone(raw); changed.localChecks[0].parts[6] ^= 1;
    assert.throws(() => loadGeneralCalendarProfile(changed, scalar), /differs from native/);
    const badLatch = structuredClone(raw); badLatch.latchChecks[0].epoch = '1';
    assert.throws(() => loadGeneralCalendarProfile(badLatch, scalar), /latches differ/);
    const badZone = structuredClone(raw); badZone.timezone.base64 = Buffer.from('fake').toString('base64');
    assert.throws(() => loadGeneralCalendarProfile(badZone, scalar), /Invalid/);
    assert.throws(() => generalNativeDayOfWeek(createGeneralCalendarSession(profile), {value: 2026}, 1, 1), /adapter/);
    assert.throws(() => execFileSync('perl', ['-MTime::Local', 'tools/native-calendar-profile.pl'], {
        env: {...process.env, TZ: 'UTC'}, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
    }), /preloaded before issuance/);
    assert.equal(resolve('tools/native-calendar-profile.pl').startsWith('/'), true);
});

test('malformed timezone file follows native libc fallback rather than refusing dates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'calendar-zone-'));
    try {
        const path = join(directory, 'malformed'); writeFileSync(path, Buffer.from('TZif'));
        const zone = ':' + path, profile = loadGeneralCalendarProfile(setup(zone), scalar);
        const session = createGeneralCalendarSession(profile), expected = actual(zone);
        inputs.forEach((row, i) => check(generalNativeDayOfWeek(session, ...row.map(input) as [unknown, unknown, unknown]), expected[i]));
    } finally {rmSync(directory, {recursive: true, force: true});}
});
test('empty TZDIR uses the installed default timezone directory', () => {
    const raw = JSON.parse(execFileSync('perl', ['tools/native-calendar-profile.pl'], {
        env: {...process.env, TZ: 'America/New_York', TZDIR: ''}, encoding: 'utf8', timeout: 15000,
    }));
    assert.match(raw.timezone.path, /\/America\/New_York$/);
    const profile = loadGeneralCalendarProfile(raw, scalar);
    verifyGeneralCalendarSources(profile, path => readFileSync(path));
});

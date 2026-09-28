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
    generalNativeDayOfWeek, generalNativeMysqlDateToTime, type GeneralCalendarResult,
    type GeneralMysqlDateResult} from '../live/domain/general-native-calendar';

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

type MysqlCivil = string | undefined | {unicode: string};
const mysqlCivils: readonly MysqlCivil[] = [
    undefined, 'bad', '0000-00-00', '2026-09-26', '2026-09-26 01:02',
    '2026-09-26 01:02:03', '2026-02-31 01:02:03', '2024-02-30',
    '2026-02-00', '2026-02-29', '2026-13-01', '2026-00-01',
    '2026-01-01 24:00:00', '2026-01-01 00:60:00', '2026-01-01 00:00:60',
    '2026-09-26\n', '2026-09-26\n\n', '2026-09-26\r\n',
    {unicode: '２０２６-０９-２６'}, {unicode: '٢٠٢٦-٠٩-٢٦'},
    '2026-09-26 01:02:03\n', '2026-09-26 1:02:03', '2026-09-26 01:02:03x',
    '2026-01-01 01:02:03', '9999-99-99',
];
const mysqlNativeSource = String.raw`
use strict;use warnings;use JSON::PP;use MIME::Base64 qw(decode_base64 encode_base64);use Encode ();use DBI ();
our $attempted;BEGIN{no warnings 'redefine';*DBI::connect=sub{$attempted=1;die'DB forbidden'};*DBI::connect_cached=sub{$attempted=1;die'DB forbidden'}}
require '/workspaces/dreamwidth/cgi-bin/LJ/Time.pm';local$/;my$rows=decode_json(<STDIN>);my@out;
for my$row(@$rows){my$civil;
if($row->{civil}){$civil=decode_base64($row->{civil}{base64});utf8::decode($civil)or die'invalid oracle UTF8'if$row->{civil}{utf8}}
my($value,$during);my$ok=eval{$@='prior';$value=LJ::mysqldate_to_time($civil,1);$during=$@;1};
my$exception=$ok?$during:$@;push@out,{kind=>$ok?'returned':'program-error',value=>defined($value)?"$value":undef,
exception=>{base64=>encode_base64(utf8::is_utf8($exception)?Encode::encode('UTF-8',$exception):$exception,''),utf8=>utf8::is_utf8($exception)?JSON::PP::true:JSON::PP::false}}}
die'DB attempted'if$attempted;print JSON::PP->new->canonical->encode(\@out);
`;
function mysqlCivil(value: MysqlCivil): NativeString | undefined {
    return value === undefined ? undefined : typeof value === 'string'
        ? NativeString.bytes(Buffer.from(value, 'latin1')) : NativeString.hostUnicode(value.unicode);
}
function actualMysql(timezone: string, rows: readonly MysqlCivil[]): any[] {
    const civil = rows.map(value => value === undefined ? {civil: null} : {
        civil: {base64: mysqlCivil(value)!.bytes().toString('base64'), utf8: typeof value !== 'string'},
    });
    return JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=268435456', '--cpu=10', '--', 'perl', '-e', mysqlNativeSource], {
        env: {...process.env, TZ: timezone}, input: JSON.stringify(civil), encoding: 'utf8', timeout: 15000,
    }));
}
function checkMysql(result: GeneralMysqlDateResult, expected: any): void {
    assert.equal(result.kind, expected.kind);
    assert.equal(result.kind === 'returned' ? result.value?.pv().bytes().toString() ?? null : null, expected.value);
    const error = expected.exception;
    if (error.base64 === 'cHJpb3I=') assert.deepEqual(result.exceptionEffect, {kind: 'none'});
    else if (error.base64 === '') assert.deepEqual(result.exceptionEffect, {kind: 'cleared'});
    else {
        assert.equal(result.exceptionEffect.kind, 'set');
        if (result.exceptionEffect.kind !== 'set') throw Error('missing native error effect');
        assert.equal(result.exceptionEffect.message.bytes().toString('base64'), error.base64);
        assert.equal(result.exceptionEffect.message.flagged(), error.utf8);
        if (result.kind === 'program-error') assert.equal(result.message.bytes().toString('base64'), error.base64);
    }
}
for (const zone of ['UTC', 'America/New_York']) {
    test(`Entry MySQL date uses native parse, eval effect and operation suffix in ${zone}`, () => {
        const profile = loadGeneralCalendarProfile(setup(zone), scalar);
        const session = createGeneralCalendarSession(profile), expected = actualMysql(zone, mysqlCivils);
        mysqlCivils.forEach((civil, index) => checkMysql(generalNativeMysqlDateToTime(session, mysqlCivil(civil)), expected[index]));
    });
}
test('day-of-week and Entry time share one explicit Time::Local cache', () => {
    const profile = loadGeneralCalendarProfile(setup('UTC'), scalar), session = createGeneralCalendarSession(profile);
    const first = generalNativeDayOfWeek(session, 67562, 1, 1);
    const subsequent = generalNativeMysqlDateToTime(session, NativeString.bytes(Buffer.from('2026-01-01')));
    const native = JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=268435456', '--cpu=10', '--', 'perl', '-e',
        String.raw`use strict;use DBI ();BEGIN{no warnings 'redefine';*DBI::connect=sub{die'DB forbidden'}}require '/workspaces/dreamwidth/cgi-bin/LJ/Time.pm';use JSON::PP;my$a=LJ::day_of_week(67562,1,1);my$b=LJ::mysqldate_to_time('2026-01-01',1);print JSON::PP->new->encode([$a,$b])`],
    {env: {...process.env, TZ: 'UTC'}, encoding: 'utf8', timeout: 15000}));
    assert.equal(first.value?.pv().bytes().toString(), String(native[0]));
    assert.equal(subsequent.kind, 'returned');
    if (subsequent.kind === 'returned') assert.equal(subsequent.value?.pv().bytes().toString(), String(native[1]));
});
test('Entry operation-specific Carp site is bound to the installed LJ source', () => {
    const raw = setup('UTC'), changed = structuredClone(raw);
    const source = changed.sources.find((row: {path: string}) => row.path.endsWith('/cgi-bin/LJ/Time.pm'));
    assert.ok(source);
    source.sha256 = '0'.repeat(64);
    const session = createGeneralCalendarSession(loadGeneralCalendarProfile(changed, scalar));
    assert.throws(() => generalNativeMysqlDateToTime(session, NativeString.bytes(Buffer.from('2026-02-31'))),
        /source is unqualified/);
    assert.throws(() => generalNativeMysqlDateToTime(session, {} as NativeString), /source is unqualified/);
    const valid = createGeneralCalendarSession(loadGeneralCalendarProfile(raw, scalar));
    assert.throws(() => generalNativeMysqlDateToTime(valid, {} as NativeString), /original native scalar/);
});

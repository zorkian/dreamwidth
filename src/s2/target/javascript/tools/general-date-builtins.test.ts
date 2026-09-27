// general-date-builtins.test.ts
//
// Native fixed date tokens, scratch caches and ordinal invocation.
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
import { execFileSync } from 'node:child_process';
import { Context, Layer } from '../runtime/s2runtime';
import { NativeString, scalarPV, scalarConcat, nativeProgramError, isNativeProgramError } from '../runtime/native-scalar';
import { generalDateCallbacks } from '../live/render/general-date-builtins';
import { generalDate, type GeneralModel } from '../live/domain/general-model-primitives';
import { generalDateTimeParts } from '../live/domain/general-model-date';
import { hashKeyBytes } from '../runtime/native-string';
import type { NativeProfile } from '../runtime/native-profile';
const bytes = NativeString.hostUtf8Bytes;
const specs = [
    { fmt: 'é', flag: true, override: 'downgraded' }, { fmt: '猫', flag: true, override: 'wide' }, { fmt: 'iso' }, { fmt: 'iso', override: '' }, { fmt: '0' }, { fmt: '' }, { fmt: 'x%%bogus%%y' },
    { fmt: '%%' }, { fmt: 'a%%%%b%%' }, { fmt: '%%yyyy%% %%yy%% %%m%% %%mm%% %%d%% %%dd%%', link: '1' },
    { fmt: '%%mon%% %%month%% %%da%% %%day%% %%dayord%%' },
    { fmt: '<é&"\'>%%dd%%', flag: true },
    { fmt: '%%H%% %%HH%% %%h%% %%hh%% %%min%% %%sec%% %%a%% %%A%%', time: true },
    ...['0', '12', '-1', '25', 'NaN', 'Inf', '-Inf', '18446744073709551615', '1e30', '-1e30'].map(hour => ({ fmt: '%%HH%% %%h%% %%hh%% %%yy%%', hour, time: true })),
    { fmt: '%%da%%', cached: '0' }, { fmt: '%%da%%', cached: '2' },
];
const oracle = JSON.parse(execFileSync('perl', ['-e', String.raw `
use strict;use warnings;no warnings 'once';use JSON::PP;use Encode;
use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
our$db;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{$db=1;die'DB forbidden'};*DBI::connect_cached=sub{$db=1;die'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;
our(@calls,$fail);{no warnings 'redefine';*LJ::day_of_week=sub{push@calls,'day';3};*S2::run_function=sub{push@calls,'ordinal:'.$_[2];die 'trusted ordinal failure' if$fail;return$_[2].'th'};}
sub f{my$v=shift;return undef unless defined$v;my$hex;{use bytes;$hex=unpack('H*',$v)}return{hex=>$hex,utf8=>utf8::is_utf8($v)?1:0};}
sub setup{my$c=[];$c->[S2::PROPS()]={lang_monthname_short=>[map{'m'.$_}0..12],lang_monthname_long=>[map{'month'.$_}0..12],lang_dayname_short=>[map{'d'.$_}0..7],lang_dayname_long=>[map{'day'.$_}0..7]};$c->[S2::SCRATCH()]={};return$c;}
my$specs=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});my@rows;
for my$s(@$specs){@calls=();my$c=setup();my$d={year=>'2026',month=>'9',day=>'27',hour=>$s->{hour}//'13',min=>'2.9',sec=>'07'};
$d->{_dayofweek}=$s->{cached}if exists$s->{cached};my$fmt=$s->{fmt};$fmt=encode_utf8($fmt)unless$s->{flag};
$c->[S2::PROPS()]->{'lang_fmt_date_'.$fmt}=$s->{override}if exists$s->{override};
my$r=$s->{time}?S2::Builtin::LJ::DateTime__time_format($c,$d,$fmt):S2::Builtin::LJ::Date__date_format($c,$d,$fmt,$s->{link});push@rows,{value=>f($r),cached=>f($d->{_dayofweek}),calls=>[@calls]};}
my$c=setup();my$d={year=>2026,month=>9,day=>27};my@cache;
$c->[S2::PROPS()]->{lang_fmt_date_named}='old%%yyyy%%';push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'named',''));
$c->[S2::PROPS()]->{lang_fmt_date_named}='new';$d->{year}=2027;push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'named',''));
# Native concatenated keys collide: 'named'+'x' and 'namedx'+''.
push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'named','x'));push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'namedx',''));
for(1..15){push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'f'.$_,''));}
push@cache,f(S2::Builtin::LJ::Date__date_format($c,$d,'named',''));push@cache,f(S2::Builtin::LJ::DateTime__time_format($c,$d,'t'));
my@constructed;for my$d(LJ::S2::Date(2026,9,27,'02'),LJ::S2::DateTime_parts('2026 9 27 1 2 3 -1')){push@constructed,f(S2::Builtin::LJ::Date__day_of_week($c,$d));}
 my$rctx=setup();$rctx->[S2::PROPS()]->{lang_fmt_date_retry}='%%dayord%%';$fail=1;my$error=eval{S2::Builtin::LJ::Date__date_format($rctx,$d,'retry',0);1};$fail=0;$rctx->[S2::PROPS()]->{lang_fmt_date_retry}='replacement';my$retry={failed=>$error?0:1,value=>f(S2::Builtin::LJ::Date__date_format($rctx,$d,'retry',0)),count=>$rctx->[S2::SCRATCH()]->{_code_datefmt_count}};
 die'DB attempted'if$db;print JSON::PP->new->canonical->encode({rows=>\@rows,cache=>\@cache,constructed=>\@constructed,retry=>$retry});
`], { input: JSON.stringify(specs), timeout: 10000, maxBuffer: 1024 * 1024 }).toString());
function frame(value: unknown) {
    if (value === undefined || value === null)
        return null;
    const pv = scalarPV(value);
    return { hex: pv.bytes().toString('hex'), utf8: pv.flagged() ? 1 : 0 };
}
function setup() {
    const calls: string[] = [], layer = new Layer();
    layer.registerFunction(['lang_ordinal(int)'], () => (_ctx, n) => { calls.push('ordinal:' + scalarPV(n).bytes().toString()); return scalarConcat(n, bytes('th')); });
    const ctx = new Context([layer], () => { });
    for (const [name, prefix, max] of [['monthname_short', 'm', 12], ['monthname_long', 'month', 12], ['dayname_short', 'd', 7], ['dayname_long', 'day', 7]] as const)
        ctx.prop['_lang_' + name] = Array.from({ length: max + 1 }, (_, n) => bytes(prefix + n));
    const callbacks = generalDateCallbacks({ dayOfWeek() { calls.push('day'); return 3; } });
    return { ctx, calls, callbacks };
}
for (const [index, spec] of specs.entries())
    test('actual native date token ' + index, () => {
        const { ctx, calls, callbacks } = setup();
        const model: GeneralModel = { '.type': 'DateTime', _year: bytes('2026'), _month: bytes('9'), _day: bytes('27'), _hour: bytes('hour' in spec ? spec.hour! : '13'), _min: bytes('2.9'), _sec: bytes('07') };
        if ('cached' in spec)
            model._dayofweek = bytes(spec.cached!);
        const fmt = 'flag' in spec && spec.flag ? NativeString.hostUnicode(spec.fmt) : bytes(spec.fmt);
        if ('override' in spec) {
            const key = hashKeyBytes(scalarConcat(bytes('lang_fmt_date_'), fmt));
            ctx.prop['_' + (key.utf8 ? '\0native-wide:' + key.bytes.toString('hex') : key.bytes.toString('latin1'))] = bytes(spec.override!);
        }
        const value = 'time' in spec && spec.time ? callbacks._DateTime__time_format!(ctx, model, fmt) : callbacks._Date__date_format!(ctx, model, fmt, 'link' in spec ? bytes(spec.link!) : undefined);
        assert.deepEqual({ value: frame(value), cached: frame(model._dayofweek), calls }, oracle.rows[index]);
    });
test('actual native captured literal, dynamic field, collision and separate cache15', () => {
    const { ctx, callbacks } = setup(), model: GeneralModel = { _year: bytes('2026'), _month: bytes('9'), _day: bytes('27') }, values: unknown[] = [];
    const date = (fmt: string, link = '') => values.push(frame(callbacks._DateTime__date_format!(ctx, model, bytes(fmt), bytes(link))));
    ctx.prop._lang_fmt_date_named = bytes('old%%yyyy%%');
    date('named');
    ctx.prop._lang_fmt_date_named = bytes('new');
    model._year = bytes('2027');
    date('named');
    date('named', 'x');
    date('namedx');
    for (let n = 1; n <= 15; n++)
        date('f' + n);
    date('named');
    values.push(frame(callbacks._DateTime__time_format!(ctx, model, bytes('t'))));
    assert.deepEqual(values, oracle.cache);
});
test('day helper cached aliases and infrastructure failure identity', () => {
    const ctx = new Context([], () => { }), error = new Error('calendar infrastructure'), cb = generalDateCallbacks({ dayOfWeek() { throw error; } }), model: GeneralModel = {};
    assert.throws(() => cb._Date__day_of_week!(ctx, model), v => v === error);
    model._dayofweek = bytes('0');
    assert.equal(cb._DateTime__day_of_week!(ctx, model), model._dayofweek);
});
test('actual constructor cache PV and zero use existing model field', () => {
    const profile: NativeProfile = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], { input: JSON.stringify({ profileOnly: true }), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 })).profile;
    const ctx = new Context([], () => { }), cb = generalDateCallbacks({ dayOfWeek() { throw Error('unexpected provider for cached constructor'); } });
    const models = [generalDate(bytes('2026'), bytes('9'), bytes('27'), bytes('02')), generalDateTimeParts(bytes('2026 9 27 1 2 3 -1'), profile)];
    assert.deepEqual(models.map(model => frame(cb._Date__day_of_week!(ctx, model))), oracle.constructed);
    const missing: GeneralModel = {}, undef = generalDateCallbacks({ dayOfWeek() { return undefined; } });
    assert.equal(scalarPV(undef._Date__day_of_week!(ctx, missing)).bytes().toString(), '1');
});
test('ordinal failure retains compiled formatter and native retry count', () => {
    let fail = true;
    const layer = new Layer();
    layer.registerFunction(['lang_ordinal(int)'], () => (_ctx, n) => { if (fail)
        throw nativeProgramError('trusted ordinal failure'); return scalarConcat(n, bytes('th')); });
    const ctx = new Context([layer], () => { }), cb = generalDateCallbacks({ dayOfWeek() { return 3; } }), model: GeneralModel = { _day: bytes('27') };
    ctx.prop._lang_fmt_date_retry = bytes('%%dayord%%');
    let failed = 0;
    assert.throws(() => cb._Date__date_format!(ctx, model, bytes('retry'), false), error => { failed = 1; return isNativeProgramError(error); });
    fail = false;
    ctx.prop._lang_fmt_date_retry = bytes('replacement');
    assert.deepEqual({ failed, value: frame(cb._Date__date_format!(ctx, model, bytes('retry'), false)), count: 1 }, oracle.retry);
});

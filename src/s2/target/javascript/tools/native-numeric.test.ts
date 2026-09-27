// native-numeric.test.ts
//
// Independent installed-Perl arithmetic, coercion and formatting differentials.
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
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {NativeNumber, arithmetic, divide, modulo, intCast, incrementNumber,
    numericCompare, arrayIndex} from '../runtime/native-number';
import {NativeString} from '../runtime/native-string';
import {runtime} from '../runtime/s2runtime';

const n = NativeNumber.literal;
const pv = (value: string) => NativeNumber.fromPV(NativeString.hostUtf8Bytes(value));
const add = (a: string, b: string) => arithmetic('+', n(a), n(b));
const sub = (a: string, b: string) => arithmetic('-', n(a), n(b));
const mul = (a: string, b: string) => arithmetic('*', n(a), n(b));
const div = (a: string, b: string) => intCast(divide(n(a), n(b)));
const mod = (a: string, b: string) => modulo(n(a), n(b));
const cast = (value: string) => intCast(pv(value));
const read = (value: string) => {
    let index = arrayIndex(n(value));
    if (index < 0n) index += 2n;
    return index >= 0n && index < 2n ? ['a', 'b'][Number(index)]! : 'undef';
};
const cases: Record<string, () => NativeNumber | string> = {
    literal53: () => n('9007199254740993'),
    product53: () => mul('94906267', '94906267'),
    ivmax_add1: () => add('9223372036854775807', '1'),
    uvmax: () => n('18446744073709551615'),
    uvmax_add1: () => add('18446744073709551615', '1'),
    uvmax_inc: () => incrementNumber(n('18446744073709551615'), true),
    ivmin_sub1: () => sub('-9223372036854775808', '1'),
    uvmax_mul2: () => mul('18446744073709551615', '2'),
    wide_div1: () => div('9007199254740993', '1'),
    wide_div3: () => div('9007199254740993', '3'),
    wide_div2: () => div('9007199254740993', '2'),
    wide_div_negative: () => div('-9007199254740993', '2'),
    ivmax_div3: () => div('9223372036854775807', '3'),
    neg_div: () => div('-7', '3'),
    neg_mod: () => mod('-7', '3'),
    negative_divisor_mod: () => mod('7', '-3'),
    wide_mod: () => mod('9007199254740993', '2'),
    wide_compare: () => numericCompare(n('9007199254740993'), n('9007199254740992')) === 0 ? '1' : '0',
    int_wide_string: () => cast('9007199254740993'),
    int_prefix: () => cast('  -123.9tail'),
    int_exp: () => cast('1e20'),
    hash_wide: () => runtime.hashKeys(runtime.makeHash([
        [n('9007199254740993'), 'a'], [n('9007199254740992'), 'b'],
    ])).map(value => NativeString.is(value) ? value.bytes().toString() : value).sort().join('|'),
    array_negative: () => read('-1'),
    array_wide_read: () => read('9007199254740993') === 'undef' ? 'undef' : 'defined',
    uv_minus_iv: () => sub('18446744073709551615', '9223372036854775807'),
    iv_minus_uv: () => sub('9223372036854775807', '18446744073709551615'),
    uv_cancel_negative: () => add('18446744073709551615', '-9223372036854775808'),
    ivmin_negate: () => sub('0', '-9223372036854775808'),
    uv_negate: () => sub('0', '18446744073709551615'),
    nv_recovered_integer: () => arithmetic('-', add('9223372036854775807', '1.0'), n('1')),
    mod_nv_fraction: () => mod('7.9', '3.2'),
    mod_nv_outside: () => mod('1e20', '3'),
    int_uv_string: () => cast('18446744073709551615'),
    int_over_uv_string: () => cast('18446744073709551616'),
    int_hex_string: () => cast('0x10'),
    int_no_prefix: () => cast('hello'),
    int_small_exp: () => cast('1e3'),
    int_inf: () => cast('Inf'),
    int_nan: () => cast('NaN'),
    nv_small_general: () => divide(n('1'), n('3')),
    nv_fixed_boundary: () => add('1e-4', '0.00000000000000001'),
    nv_exponent_boundary: () => add('1e-5', '0.00000000000000001'),
    nv_negative_zero: () => NativeNumber.nv(-0),
    mixed_uv_compare: () => numericCompare(n('18446744073709551615'), n('-1')) > 0 ? '1' : '0',
    nv_wide_compare: () => numericCompare(n('9007199254740993'), n('9007199254740992.0')) === 0 ? '1' : '0',
    numeric_then_original_string: () => { const value = pv('00123'); arithmetic('+', value, n('0')); return value; },
    uv_array_read: () => read('18446744073709551615') === 'undef' ? 'undef' : 'defined',
    divide_zero: () => div('1', '0'),
    mod_zero: () => mod('1', '0'),
};

test('49 independently evaluated native numeric branches retain text and integer modes', () => {
    const tools = path.resolve(__dirname, '../../tools');
    const oracle = JSON.parse(execFileSync('/usr/bin/prlimit', ['--as=134217728', '--cpu=5', '--',
        '/usr/bin/perl', path.join(tools, 'numeric-native.pl')],
        {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
            env: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC'}}));
    assert.equal(oracle.ivsize, '8');
    assert.equal(oracle.nvtype, 'double');
    assert.equal(oracle.rows.length, 49);
    assert.deepEqual(oracle.rows.map((row: {id: string}) => row.id), Object.keys(cases));
    for (const row of oracle.rows) {
        const call = cases[row.id]; assert.ok(call);
        if (row.error) { assert.throws(call, /division by zero|modulus zero/, row.id); continue; }
        const value = call();
        assert.equal(NativeNumber.is(value) ? value.pv().bytes().toString() : value, row.text, row.id);
        if (NativeNumber.is(value) && row.iok) assert.equal(value.mode(), row.isUV ? 'uv' : 'iv', row.id);
        else if (NativeNumber.is(value) && row.nok) assert.equal(value.mode(), 'nv', row.id);
    }
});

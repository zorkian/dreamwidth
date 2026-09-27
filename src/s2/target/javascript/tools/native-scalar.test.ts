// native-scalar.test.ts
//
// Independent native scalar counterexamples and private boundary assertions.
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
import {execFileSync} from 'node:child_process';
import {nativeCharacterClass, type NativeProfile} from '../runtime/native-profile';
import assert from 'node:assert/strict';
import {NativeString, NativeOutput, byteCharacters, reverseString, concatStrings,
    builtinSubstr, caseString, endsWith, splitString} from '../runtime/native-string';
import {NativeNumber, arithmetic, divide, numericCompare, arrayIndex, intCast,
    incrementNumber} from '../runtime/native-number';
import {Context, runtime} from '../runtime/s2runtime';

const n = NativeNumber.literal;
const text = (value: NativeNumber) => value.pv().bytes().toString('utf8');

test('captured operand cells are branded, once-bound and safe across native-undefined deletion', () => {
    const pv = NativeString.hostUtf8Bytes;
    let container: Record<string, unknown> = {x: pv('a')};
    const original = container;
    const slot = runtime.memberSlot(container, 'x', 'field');
    const operand = runtime.captureOperand(slot);
    container = {x: pv('new')};
    assert.equal(runtime.scalarPV(runtime.scalarBinary('concat', operand, pv('X'))).bytes().toString(), 'aX');
    delete original.x;
    assert.equal(runtime.scalarPV(runtime.scalarBinary('concat', operand, pv('X'))).bytes().toString(), 'X');
    original.x = pv('b');
    assert.equal(runtime.scalarPV(runtime.scalarBinary('concat', operand, pv('X'))).bytes().toString(), 'bX');
    const missing = runtime.captureOperand(runtime.memberSlot(original, 'missing', 'field'));
    original.missing = pv('later');
    assert.equal(runtime.scalarPV(runtime.scalarBinary('concat', missing, pv('X'))).bytes().toString(), 'X');
    assert.equal(runtime.readOperand({get: () => pv('forged')}) instanceof NativeString, false);
});

test('raw native PV keeps byte foreach, reverse, clone and final output exact', () => {
    const source = Buffer.from('猫é');
    const value = NativeString.bytes(source);
    source.fill(0);
    assert.equal(byteCharacters(value).length, 5);
    assert.equal(reverseString(value).bytes().toString('hex'), 'a9c3ab8ce7');
    // Native fixed-source receipt has the same individual octets in its own
    // expression order; no decoded Unicode string is an expected output oracle.
    const output = new NativeOutput();
    output.append(reverseString(value));
    assert.equal(output.bytes().toString('hex'), 'a9c3ab8ce7');
    const copy = value.bytes(); copy.fill(0);
    assert.equal(value.bytes().toString('hex'), 'e78cabc3a9');
    assert.equal(NativeString.is(Object.create(NativeString.prototype)), false);
    assert.equal(concatStrings(NativeString.bytes(Buffer.from([0xe9])),
        NativeString.hostUnicode('x')).bytes().toString('hex'), 'c3a978');
});

test('native builtins deliberately decode substr, but byte casing and dollar match differ', () => {
    assert.equal(builtinSubstr(NativeString.bytes(Buffer.from([0xff, 65])), 0, 1)
        .bytes().toString('hex'), 'efbfbd');
    assert.equal(caseString(NativeString.hostUtf8Bytes('Éa'), 'upper').bytes().toString('utf8'), 'ÉA');
    assert.equal(endsWith(NativeString.hostUtf8Bytes('x\n'), NativeString.hostUtf8Bytes('x')), true);
    assert.deepEqual(splitString(NativeString.hostUtf8Bytes('a::'), NativeString.hostUtf8Bytes(':'))
        .map(part => part.bytes().toString()), ['a']);
});

test('native wide integers, overflow and division retain distinct modes', () => {
    assert.equal(text(arithmetic('+', n('9223372036854775807'), n('1'))), '9223372036854775808');
    assert.equal(text(arithmetic('+', n('18446744073709551615'), n('1'))), '1.84467440737096e+19');
    assert.equal(text(intCast(divide(n('9223372036854775807'), n('3')))), '3074457345618258432');
    assert.equal(text(divide(n('9007199254740993'), n('3'))), '3002399751580331');
    assert.equal(numericCompare(n('9007199254740993'), n('9007199254740992')), 1);
    assert.equal(numericCompare(n('9007199254740993'), NativeNumber.nv(9007199254740992)), 0);
    assert.equal(arrayIndex(n('18446744073709551615')), -1n);
    assert.equal(arrayIndex(NativeNumber.nv(1e20)), -1n);
    assert.equal(arrayIndex(NativeNumber.nv(Infinity)), -1n);
    assert.equal(arrayIndex(NativeNumber.nv(NaN)), 0n);
    assert.equal(text(NativeNumber.fromPV(NativeString.hostUtf8Bytes('00123'))), '00123');
    const prefix = NativeNumber.fromPV(NativeString.hostUtf8Bytes('9007199254740993foo'));
    assert.equal(text(arithmetic('+', prefix, n('0'))), '9.00719925474099e+15');
    const decimal = NativeNumber.fromPV(NativeString.hostUtf8Bytes('1.0'));
    assert.equal(arrayIndex(decimal), 1n);
    assert.equal(incrementNumber(decimal, true).mode(), 'nv');
    assert.equal(incrementNumber(NativeNumber.fromWire(decimal.wire()), true).mode(), 'nv');
    assert.equal(incrementNumber(NativeNumber.fromPV(NativeString.hostUtf8Bytes('1e3')), true).mode(), 'iv');
});

test('Context identity is installed-runtime brand, not prototype or duck typing', () => {
    const context = new Context([], () => {});
    assert.equal(runtime.isContext(context), true);
    assert.equal(runtime.isContext(Object.create(Context.prototype)), false);
    assert.equal(runtime.isContext({getFunction: context.getFunction}), false);
});

test('installed Perl /d character classes preserve byte flags and Unicode version', () => {
    const extracted = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], {
        input: JSON.stringify({profileOnly: true}), encoding: 'utf8', timeout: 10000,
        maxBuffer: 1048576,
    }));
    assert.equal(extracted.kind, 'profile');
    const profile: NativeProfile = extracted.profile;
    const points = [0, 9, 10, 32, 48, 65, 95, 127, 0x85, 0xa0, 0xe9,
        0x301, 0x660, 0x200c, 0x203f, 0x1c89, 0x10400, 0x10ffff];
    // Independent actual regex evaluation, not the inversion-list API under test.
    const oracle = JSON.parse(execFileSync('perl', ['-MJSON::PP', '-e', `
        my $points=JSON::PP->new->decode(do {local $/; <STDIN>}); my @rows;
        for my $cp (@$points) { for my $flag (0,1) {
            next if !$flag && $cp>255;
            my $s=chr($cp); utf8::upgrade($s) if $flag;
            push @rows, [$cp,$flag,($s =~ /\\w/ ? 1:0),($s =~ /\\s/ ? 1:0)];
        }} print JSON::PP->new->encode(\\@rows);
    `], {input: JSON.stringify(points), encoding: 'utf8', timeout: 5000, maxBuffer: 65536}));
    for (const [point, flag, word, space] of oracle) {
        assert.equal(nativeCharacterClass(profile, 'word', point, !!flag), !!word,
            `word U+${point.toString(16)} flag=${flag}`);
        assert.equal(nativeCharacterClass(profile, 'space', point, !!flag), !!space,
            `space U+${point.toString(16)} flag=${flag}`);
    }
    assert.equal(nativeCharacterClass(profile, 'word', 0xe9, false), false);
    assert.equal(nativeCharacterClass(profile, 'word', 0xe9, true), true);
    assert.equal(nativeCharacterClass(profile, 'space', 0xa0, false), false);
    assert.equal(nativeCharacterClass(profile, 'space', 0xa0, true), true);
    assert.equal(profile.unicodeVersion, '13.0.0');
    assert.equal(nativeCharacterClass(profile, 'word', 0x1c89, true), false);
    assert.equal(nativeCharacterClass(profile, 'word', -1, true), false);
    assert.equal(nativeCharacterClass(profile, 'space', 1.5, true), false);
});

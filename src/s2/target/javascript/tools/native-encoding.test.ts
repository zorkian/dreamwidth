// native-encoding.test.ts
//
// Independent installed native conversion families, flags and malformed input.
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
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NativeString } from '../runtime/native-string';
import { loadNativeEncodingProfile, convertNativeToUtf8 as convert, nativeUtf8Valid, nativeTextOut, supportedNativeEncoding, verifyNativeEncodingSources } from '../live/domain/native-encoding';
const limits = { maxInputBytes: 1048576, maxOutputBytes: 4194304 };
const convertNativeToUtf8 = (profile: Parameters<typeof convert>[0], name: NativeString | undefined, input: NativeString | undefined) => convert(profile, name, input, limits);
const run = (script: string, input?: string) => execFileSync('perl', ['-I', '../../../../cgi-bin', '-e', script], { encoding: 'utf8', input, timeout: 10000, maxBuffer: 1048576 });
const raw = JSON.parse(execFileSync('perl', ['tools/native-encoding-profile.pl'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16777216 }));
const scalar = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], { encoding: 'utf8', input: JSON.stringify({ profileOnly: true }), timeout: 10000, maxBuffer: 1048576 })).profile;
const profile = loadNativeEncodingProfile(raw, scalar);
const specs: [
    string,
    string,
    boolean
][] = [
    ['cp1252', '008180ff', false], ['\u212aoi8-r', 'c0ff', false], ['cp1252', 'c3a9', true], ['windows-1251', 'c0ffe9', false], ['GB2312', 'a1a1616280ff', false],
    ['BIG5', 'a440a441ff', false], ['CNS-11643-1986', '6162', false],
    ['utf8', 'f0808080ff', false], ['utf8', 'c3a9', true], ['ucs2', 'feff0041d83dde00d800000a', false],
    ['utf16', 'fffe41003dd800de', false], ['ucs2', '0041ff', false], ['ucs4', '000000410001f60000110000', false],
    ['utf7', '412b496d49446b512e2b2d2b414f592d', false], ['utf7', '2b412d2b212b414f592d', false],
    ['ucs4', '0000fffe00000041', false], ['ucs2', 'dc000041', false], ['ucs2', 'c3a941', true], ['utf16', 'c3bfc3be41', true],
    ['sjis', '8788898a', false], ['euc-jp', '8e8f9091', false], ['euc-jp', 'a18ea1', false],
    ['sjis', '82a0814080ff', false], ['shift-jis', '82', false], ['euc-jp', 'a4a28eb68ebede', false],
    ['euc-jp', '8fa2af8f', false], ['jis', '1b2442242224241b2842411b244222', false],
    ['iso-2022-jp', '1b2849365e1b2842', false], ['ISO_2022_JP', '1b242844222f1b2842', false],
    ['sjis', 'c3a9', true], ['iso-2022-jp', 'efbdb6efbe9e', true],
];
const oracle = JSON.parse(run(`use LJ::ConvUTF8;use JSON::PP;use Encode;my $x=JSON::PP->new->utf8->decode(do{local $/;<STDIN>});my @r;
for my $row(@$x){my($name,$hex,$flag)=@$row;my$s=pack('H*',$hex);$s=Encode::decode('UTF-8',$s) if$flag;
my$v=eval{LJ::ConvUTF8->to_utf8($name,$s)};my$e=$@;my$b;{use bytes;$b=defined($v)?unpack('H*',substr($v,0)):undef}
push@r,{value=>$b,flag=>utf8::is_utf8($v)?1:0,error=>$e?1:0};}print JSON::PP->new->encode(\\@r);`, JSON.stringify(specs)));
for (const [index, spec] of specs.entries())
    test(`native conversion ${spec[0]} ${spec[1]} flag${+spec[2]}`, () => {
        const result = convertNativeToUtf8(profile, NativeString.hostUnicode(spec[0]), spec[2] ? NativeString.flagged(Buffer.from(spec[1], 'hex')) : NativeString.bytes(Buffer.from(spec[1], 'hex')));
        assert.equal(oracle[index].error, 0);
        assert.equal(result.kind, 'converted');
        if (result.kind !== 'converted')
            throw Error('conversion failed');
        assert.equal(result.value.bytes().toString('hex'), oracle[index].value);
        assert.equal(result.value.flagged(), !!oracle[index].flag);
    });
test('installed aliases and undef are native returned states, not WHATWG aliases', () => {
    assert.equal(supportedNativeEncoding(profile, NativeString.hostUtf8Bytes('WINDOWS-1252')), true);
    assert.equal(supportedNativeEncoding(profile, NativeString.hostUtf8Bytes('not-a-charset')), false);
    assert.equal(convertNativeToUtf8(profile, undefined, undefined).kind, 'conversion-failure');
    const empty = convertNativeToUtf8(profile, NativeString.hostUtf8Bytes('cp1252'), undefined);
    assert.equal(empty.kind, 'converted');
    if (empty.kind === 'converted')
        assert.equal(empty.value.bytes().length, 0);
});
const validity = ['', '00', '01', '09', '7f', 'c080', 'c2a0', 'eda080', 'f48fbfbf', 'f4908080', 'ff', '4100c3a9'];
const validNative = JSON.parse(run(`use Unicode::CheckUTF8;use JSON::PP;my$x=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});print JSON::PP->new->encode([map{Unicode::CheckUTF8::is_utf8(pack('H*',$_))?1:0}@$x]);`, JSON.stringify(validity)));
test('native validity includes installed control and surrogate distinctions', () => {
    for (const [i, hex] of validity.entries())
        assert.equal(nativeUtf8Valid(NativeString.bytes(Buffer.from(hex, 'hex'))), !!validNative[i], hex);
    assert.equal(nativeTextOut(undefined), undefined);
    assert.equal(nativeTextOut(NativeString.bytes(Buffer.from('4100c3a9', 'hex')))!.bytes().toString('hex'), '413f3f3f');
});
test('complete installed names resolve and convert independent fixed breadth samples', () => {
    const names = Object.keys(raw.names), samples = ['', '413000ff', Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('hex')];
    const cases = names.flatMap(name => samples.map(hex => [name, hex]));
    const expected = JSON.parse(run(`use LJ::ConvUTF8;use JSON::PP;my$x=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});my@r;
        for my$row(@$x){my($n,$h)=@$row;my$v=eval{LJ::ConvUTF8->to_utf8($n,pack('H*',$h))};my$e=$@;
        my$b;{use bytes;$b=defined($v)?unpack('H*',substr($v,0)):undef}push@r,[$b,utf8::is_utf8($v)?1:0,$e?1:0];}
        print JSON::PP->new->encode(\\@r);`, JSON.stringify(cases)));
    for (const [i, [name, hex]] of cases.entries()) {
        const actual = convertNativeToUtf8(profile, NativeString.hostUtf8Bytes(name!), NativeString.bytes(Buffer.from(hex!, 'hex')));
        assert.equal(expected[i][2], 0, name);
        assert.equal(actual.kind, 'converted', name);
        if (actual.kind === 'converted') {
            assert.equal(actual.value.bytes().toString('hex'), expected[i][0], name + ' ' + hex);
            assert.equal(actual.value.flagged(), !!expected[i][1], name);
        }
    }
    assert.equal(names.length, 567);
});
test('profile data are copied/private and installed dependencies are independently rehashed', () => {
    assert.ok(raw.sources.some((source: {
        path: string;
    }) => source.path.endsWith('/MIME/Base64.pm')));
    assert.ok(raw.sources.some((source: {
        path: string;
    }) => source.path.endsWith('/LJ/TextUtil.pm')));
    verifyNativeEncodingSources(profile, path => readFileSync(path));
    assert.throws(() => verifyNativeEncodingSources(profile, () => Buffer.from('tampered')), /changed/);
    assert.throws(() => supportedNativeEncoding({ schema: 1 }, NativeString.hostUtf8Bytes('utf8')), /Unissued/);
    const copy = structuredClone(raw), projected = loadNativeEncodingProfile(copy, scalar);
    const name = NativeString.hostUtf8Bytes('cp1252');
    const before = convertNativeToUtf8(projected, name, NativeString.bytes(Buffer.from([0x80])));
    copy.names.cp1252 = 'fake';
    copy.converters[raw.names.cp1252].entries[128] = '00';
    const after = convertNativeToUtf8(projected, name, NativeString.bytes(Buffer.from([0x80])));
    assert.equal(before.kind, 'converted');
    assert.equal(after.kind, 'converted');
    if (before.kind === 'converted' && after.kind === 'converted')
        assert.deepEqual(after.value.frame(), before.value.frame());
    const bad = structuredClone(raw);
    bad.sources[0].sha256 = 'not-a-hash';
    assert.throws(() => loadNativeEncodingProfile(bad, scalar), /Invalid/);
});
test('text_out native source is reached only on failed validity and preserves flags', () => {
    const cases: [
        string,
        boolean
    ][] = [['4100c3a9', false], ['01ff', false], ['00c3a9e78cab', true], ['e78cab', true], ['eda080', false]];
    const expected = JSON.parse(run(`use JSON::PP;use Encode;use Unicode::CheckUTF8;
        open my$f,'<:raw','../../../../cgi-bin/LJ/TextUtil.pm' or die;my$source=do{local$/;<$f>};
        my($body)=$source=~/(sub text_out \{.*?\n\})/s;die unless$body;
        {no warnings 'redefine';*LJ::is_utf8=sub{Unicode::CheckUTF8::is_utf8($_[0])};}
        eval "package LJ;$body";die$@ if$@;
        my$x=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});my@r;
        for my$row(@$x){my$s=pack('H*',$row->[0]);$s=Encode::decode('UTF-8',$s) if$row->[1];
        LJ::text_out(\\$s);my$b;{use bytes;$b=unpack('H*',substr($s,0))}push@r,[$b,utf8::is_utf8($s)?1:0];}
        print JSON::PP->new->encode(\\@r);`, JSON.stringify(cases)));
    for (const [i, [hex, flag]] of cases.entries()) {
        const value = nativeTextOut(flag ? NativeString.flagged(Buffer.from(hex, 'hex')) : NativeString.bytes(Buffer.from(hex, 'hex')))!;
        assert.equal(value.bytes().toString('hex'), expected[i][0]);
        assert.equal(value.flagged(), !!expected[i][1]);
    }
});
test('caller resource limits are terminal, never native old-encoding fallback', () => {
    const name = NativeString.hostUtf8Bytes('utf8'), input = NativeString.hostUtf8Bytes('ab');
    assert.throws(() => convert(profile, name, input, { maxInputBytes: 1, maxOutputBytes: 4 }), /input bound/);
    assert.throws(() => convert(profile, name, input, { maxInputBytes: 4, maxOutputBytes: 1 }), /output bound/);
    assert.throws(() => convert(profile, name, input, { maxInputBytes: 0, maxOutputBytes: 4 }), /limits/);
});

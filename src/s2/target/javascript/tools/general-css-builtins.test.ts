// general-css-builtins.test.ts
//
// Independent installed native CSS string builtin comparisons.
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
import { Context, Layer, runtime } from '../runtime/s2runtime';
import { NativeString, isNativeProgramError } from '../runtime/native-scalar';
import type { NativeProfile } from '../runtime/native-profile';
import { generalCssCallbacks } from '../live/render/general-css-builtins';
type Operation = 'length_value' | 'multiply_length' | 'divide_length' | 'string' | 'url_value' | 'keyword' | 'keyword_list';
interface Row {
    operation: Operation;
    hex: string;
    utf8: boolean;
    numeric?: string;
    allowed?: (string | null)[] | Readonly<Record<string, string>>;
}
const row = (operation: Operation, value: string, utf8 = false, extra: Pick<Row, 'numeric' | 'allowed'> = {}): Row => ({ operation, hex: Buffer.from(value).toString('hex'), utf8, ...extra });
const rows: Row[] = [
    row('length_value', '  +.25em\t'), row('length_value', '-1.5px'),
    row('length_value', '-.5%'), row('length_value', '000.00', true), row('length_value', '.00'),
    row('length_value', '+0'), row('length_value', 'larger'), row('length_value', 'LARGER'),
    row('length_value', '1PX'), row('length_value', '1 px'), row('length_value', '1.2.3px'),
    row('length_value', '١px', true), row('length_value', '١px'),
    row('length_value', '\u00a01px\u00a0', true), row('length_value', '\u00a01px\u00a0'),
    row('length_value', '\u00851px\u0085', true), row('length_value', ''),
    row('multiply_length', '-3px', false, { numeric: '2' }),
    row('multiply_length', '1.5px', false, { numeric: '2' }),
    row('multiply_length', 'junk 3px\nignored', false, { numeric: '0.5' }),
    row('multiply_length', '3px\nignored', true, { numeric: '2' }),
    row('multiply_length', '123', false, { numeric: '2' }),
    row('multiply_length', '00', false, { numeric: '2' }),
    row('multiply_length', 'abc', false, { numeric: '2' }),
    row('multiply_length', '1\n22px', false, { numeric: '2' }),
    row('multiply_length', '١px', true, { numeric: '2' }),
    row('multiply_length', '9007199254740993px', false, { numeric: '3' }),
    row('multiply_length', '18446744073709551615px', false, { numeric: '2' }),
    row('divide_length', '3px', false, { numeric: '2' }),
    row('divide_length', '3px', true, { numeric: '-2' }),
    row('divide_length', '9007199254740993px', false, { numeric: '3' }),
    row('divide_length', '3px', false, { numeric: '0' }),
    row('string', 'a\\"\n'), row('string', 'é猫', true), row('string', '', true),
    { operation: 'string', hex: 'ff00225c', utf8: false },
    row('url_value', 'https://example.test/a?x=1&y=%20#tail'),
    row('url_value', "http://a/@$-_+!*'(),&=#;:?/%~", true),
    row('url_value', 'HTTPS://example.test/'), row('url_value', '//example.test/'),
    row('url_value', 'https://example.test/a b'), row('url_value', 'https://example.test/é', true),
    row('keyword', '  RED  ', true), row('keyword', '-foo'), row('keyword', ''),
    row('keyword', '', true), row('keyword', '0'), row('keyword', 'a_b'),
    row('keyword', 'ſ', true), row('keyword', 'K', true), row('keyword', 'İ', true),
    row('keyword', 'ı', true), row('keyword', 'ß', true), row('keyword', 'ſ'),
    row('keyword', 'Red', true, { allowed: ['Red'] }),
    row('keyword', 'Red', false, { allowed: ['red'] }), row('keyword', 'red', false, { allowed: [] }),
    row('keyword', '', true, { allowed: [null] }),
    row('keyword', 'A', false, { allowed: { A: '0' } }), row('keyword', 'A', false, { allowed: { A: '1' } }),
    row('keyword_list', ' Red\tBlue red  ', true),
    row('keyword_list', 'a\u00a0b', true), row('keyword_list', 'a\u00a0b'),
    row('keyword_list', 'A A B', true, { allowed: ['A'] }),
    row('keyword_list', '0  a  a_b --'), row('keyword_list', '', true),
];
const profile: NativeProfile = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], {
    input: JSON.stringify({ profileOnly: true }), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
})).profile;
const callbacks = generalCssCallbacks(), layer = new Layer();
layer.scalarProfile = profile;
const context = new Context([layer], () => { throw Error('Unexpected output'); }, undefined, callbacks);
const oracle = JSON.parse(execFileSync('perl', ['-e', `
    use strict;use warnings;use JSON::PP;use Encode;
    use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
    our $database_attempt;
    BEGIN {require DBI;no warnings 'redefine';
        *DBI::connect=sub{$database_attempt=1;die "DB forbidden in CSS oracle"};
        *DBI::connect_cached=sub{$database_attempt=1;die "DB forbidden in CSS oracle"};}
    require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;
    my %functions=(
        length_value=>\\&S2::Builtin::LJ::string__css_length_value,
        multiply_length=>\\&S2::Builtin::LJ::string__css_multiply_length,
        divide_length=>\\&S2::Builtin::LJ::string__css_divide_length,
        string=>\\&S2::Builtin::LJ::string__css_string,
        url_value=>\\&S2::Builtin::LJ::string__css_url_value,
        keyword=>\\&S2::Builtin::LJ::string__css_keyword,
        keyword_list=>\\&S2::Builtin::LJ::string__css_keyword_list);
    my $rows=JSON::PP->new->utf8->decode(do{local $/;<STDIN>});my @out;
    for my $row (@$rows) {
        my $value=pack('H*',$row->{hex});
        if($row->{utf8}){$value=Encode::decode('UTF-8',$value);utf8::upgrade($value);}
        my $argument=exists($row->{numeric})?$row->{numeric}:$row->{allowed};
        my $result=eval{$functions{$row->{operation}}->([],$value,$argument)};
        my $error=$@;my $hex;
        {use bytes;$hex=defined($result)?unpack('H*',substr($result,0)):undef;}
        push @out,{hex=>$hex,utf8=>utf8::is_utf8($result)?1:0,error=>$error};
    }
    die "DB access attempted" if $database_attempt;
    print JSON::PP->new->canonical->encode(\\@out);
`], { input: JSON.stringify(rows), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 }));
for (const [index, spec] of rows.entries())
    test(`native css ${index}: ${spec.operation}`, () => {
        const input = spec.utf8 ? NativeString.flagged(Buffer.from(spec.hex, 'hex')) : NativeString.bytes(Buffer.from(spec.hex, 'hex'));
        let argument: unknown = spec.numeric === undefined ? spec.allowed : NativeString.hostUtf8Bytes(spec.numeric);
        if (Array.isArray(spec.allowed))
            argument = spec.allowed.map(key => key === null ? undefined : NativeString.hostUnicode(key));
        else if (spec.allowed)
            argument = runtime.makeHash(Object.entries(spec.allowed).map(([key, value]) => [NativeString.hostUnicode(key), NativeString.hostUtf8Bytes(value)] as const));
        const call = () => callbacks['_string__css_' + spec.operation]!(context, input, argument);
        if (oracle[index].error) {
            assert.match(oracle[index].error, /Illegal division by zero/);
            assert.throws(call, isNativeProgramError);
            return;
        }
        const result = call();
        assert.ok(NativeString.is(result));
        assert.equal(result.bytes().toString('hex'), oracle[index].hex);
        assert.equal(result.flagged(), !!oracle[index].utf8);
        assert.equal(input.bytes().toString('hex'), spec.hex, 'source receiver is not mutated');
    });
test('profile/infrastructure misuse remains terminal, never a program diagnostic', () => {
    const missing = new Context([], () => { });
    let error: unknown;
    try {
        callbacks._string__css_keyword!(missing, NativeString.hostUnicode('ſ'));
    }
    catch (value) {
        error = value;
    }
    assert.ok(error instanceof Error);
    assert.equal(isNativeProgramError(error), false);
    assert.throws(() => callbacks._string__css_string!(context, {}), error => !isNativeProgramError(error));
});
test('native sparse allowed arrays include their undef positions', () => {
    const allowed = new Array(2);
    allowed[1] = NativeString.hostUtf8Bytes('A');
    const result = callbacks._string__css_keyword!(context, NativeString.hostUnicode(''), allowed);
    assert.ok(NativeString.is(result));
    assert.equal(result.flagged(), true);
    assert.equal(result.bytes().length, 0);
});

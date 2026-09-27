// general-userpic-image.test.ts
//
// Actual native userpic Image fields, scalar flags and resolved-input boundary.
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
import { NativeString, NativeNumber, scalarPV } from '../runtime/native-scalar';
import { runtime } from '../runtime/s2runtime';
import { generalUserpicImage, type GeneralUserpicImageInput } from '../live/domain/general-userpic-image';
const bytes = NativeString.hostUtf8Bytes;
interface Frame {
    hex: string;
    flag: boolean;
}
const raw = (value: string, flag = false): Frame => ({ hex: Buffer.from(value).toString('hex'), flag });
const base = { userid: raw('9007199254740993'), picid: raw('007'), root: raw('/userpic'), username: raw('ordinary'), width: raw('170'), height: raw('151'), description: raw('Picture & "description"'), keyword: undefined as Frame | undefined };
const cases = [base, { ...base, keyword: raw('') }, { ...base, keyword: raw('0') }, { ...base, keyword: raw('key<&\'') },
    { ...base, description: undefined }, { ...base, description: raw('') }, { ...base, description: raw('0') },
    { ...base, description: raw('猫é', true), keyword: raw('é', true), root: raw('https://é/pic', true) },
    { ...base, description: { hex: 'ff00803c2622', flag: false } },
    { ...base, username: undefined }, { ...base, width: undefined, height: undefined, description: undefined },
    { ...base, width: raw('-1.5'), height: raw('0007') }, { ...base, picid: raw('0') },
    { ...base, picid: undefined }, { ...base, picid: raw('') },
];
const expected = JSON.parse(execFileSync('perl', ['-e', String.raw `
use strict;use warnings;no warnings 'once';use JSON::PP;
use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
our$db;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{$db=1;die'DB forbidden'};*DBI::connect_cached=sub{$db=1;die'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;require LJ::Userpic;
our$owner;{no warnings 'redefine';*LJ::load_userid=sub{$owner};*LJ::Userpic::load_row=sub{undef};*LJ::User::get_picid_from_keyword=sub{0};}
sub pv{my$f=shift;return undef unless$f;my$v=pack('H*',$f->{hex});Encode::_utf8_on($v)if$f->{flag};return$v;}
sub f{my$v=shift;return undef unless defined$v;my$hex;{use bytes;$hex=unpack('H*',$v)}return{hex=>$hex,utf8=>utf8::is_utf8($v)?1:0};}
my$cases=JSON::PP->new->decode(do{local$/;<STDIN>});my@out;
for my$s(@$cases){LJ::Userpic::reset_singletons();$owner=bless{userid=>pv($s->{userid}),user=>pv($s->{username})},'LJ::User';
my$p=LJ::Userpic->new($owner,pv($s->{picid}));$p->absorb_row({userid=>$owner->{userid},picid=>pv($s->{picid}),width=>pv($s->{width}),height=>pv($s->{height}),description=>pv($s->{description})});
$LJ::USERPIC_ROOT=pv($s->{root});my$r=LJ::S2::Image_userpic($owner,pv($s->{picid}),pv($s->{keyword}),pv($s->{width}),pv($s->{height}));
push@out,{type=>$r->{_type},isnull=>$r->{_isnull}?1:0,fields=>{map{$_=>f($r->{$_})}qw(url width height alttext)},title=>f($r->{extra}{title})};}
die'DB attempted'if$db;print JSON::PP->new->canonical->encode([@out]);
`], { input: JSON.stringify(cases), timeout: 10000, maxBuffer: 1048576 }).toString());
function native(frame: Frame | undefined): NativeString | undefined { return frame ? NativeString.fromFrame({ bytes: Buffer.from(frame.hex, 'hex'), utf8: frame.flag }) : undefined; }
function output(value: unknown) { if (value === undefined || value === null)
    return null; const pv = scalarPV(value); return { hex: pv.bytes().toString('hex'), utf8: pv.flagged() ? 1 : 0 }; }
for (const [index, spec] of cases.entries())
    test('actual native selected userpic ' + index, () => {
        const input: GeneralUserpicImageInput = { userid: native(spec.userid), picid: native(spec.picid), root: native(spec.root)!, username: native(spec.username), width: native(spec.width), height: native(spec.height), description: native(spec.description), keyword: native(spec.keyword) };
        const result = generalUserpicImage(input);
        assert.deepEqual({ type: result['.type'], isnull: result['.isnull'] ? 1 : 0, fields: Object.fromEntries(['url', 'width', 'height', 'alttext'].map(key => [key, output(result['_' + key])])), title: output(result._extra ? runtime.memberSlot(result._extra, bytes('title'), 'hash').get() : undefined) }, expected[index]);
        if (!result['.isnull'] && input.width)
            assert.notEqual(result._width, input.width, 'native scalar copy');
    });
test('resolved numeric scalar descriptors preserve wide value and original PV', () => {
    const width = NativeNumber.literal('9007199254740993'), result = generalUserpicImage({ userid: NativeNumber.literal('18446744073709551615'), picid: bytes('007'), root: bytes('/p'), username: bytes('u'), width, height: undefined, description: undefined, keyword: undefined });
    assert.equal(scalarPV(result._width).bytes().toString(), '9007199254740993');
    assert.notEqual(result._width, width);
    assert.equal(scalarPV(result._url).bytes().toString(), '/p/007/18446744073709551615');
});

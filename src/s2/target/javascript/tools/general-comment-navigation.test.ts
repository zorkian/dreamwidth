// general-comment-navigation.test.ts
//
// Native navigation numeric semantics, aliases and private callback authority.
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
import { NativeString, scalarPV } from '../runtime/native-scalar';
import { generalCommentNavigation } from '../live/domain/general-comment-navigation';
import type { GeneralModel } from '../live/domain/general-model-primitives';
const bytes = NativeString.hostUtf8Bytes;
const cases = [['2', '5'], ['1', '1'], ['0', '0'], [null, null], ['0', '3'], ['5', '5'], ['6', '5'], ['2.5', '5.50'], ['2x', '04'], ['9007199254740993', '9007199254740995'], ['-2', '-1']];
const expected = JSON.parse(execFileSync('perl', ['-e', String.raw `
use strict;use warnings;no warnings 'once';use JSON::PP;use Scalar::Util qw(refaddr);
use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
our$db;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{$db=1;die'DB forbidden'};*DBI::connect_cached=sub{$db=1;die'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;
sub f{my$v=shift;return undef unless defined$v;my$hex;{use bytes;$hex=unpack('H*',$v)}return{hex=>$hex,utf8=>utf8::is_utf8($v)?1:0};}
sub snapshot{my$h=shift;return{map{$_=>f($h->{$_})}qw(current total url_next url_prev url_first url_last kept)};}
my$cases=JSON::PP->new->decode(do{local$/;<STDIN>});my@rows;
for my$case(@$cases){my@calls;my$h={current=>$case->[0],total=>$case->[1],map{$_=>'seed'}qw(url_next url_prev url_first url_last kept)};
$h->{_url_of}=sub{push@calls,f($_[0]);return'url:'.$_[0]};my$id=refaddr($h);my$r=LJ::S2::ItemRange($h);my$first=snapshot($r);
my$method=S2::Builtin::LJ::ItemRange__url_of(undef,$h,'2.5tail');my$after=snapshot(LJ::S2::ItemRange($h));
$h->{_url_of}=sub{push@calls,f($_[0]);undef};my$replaced=snapshot(LJ::S2::ItemRange($h));
my$nav=LJ::S2::CommentNav($h);my$unbound=S2::Builtin::LJ::ItemRange__url_of(undef,{_url_of=>'hostile'},'2');
push@rows,{first=>$first,method=>f($method),after=>$after,replaced=>$replaced,calls=>\@calls,identity=>refaddr($nav)==$id?1:0,type=>$nav->{_type},unbound=>f($unbound)};}
die'DB attempted'if$db;print JSON::PP->new->canonical->encode(\@rows);
`], { input: JSON.stringify(cases), timeout: 10000, maxBuffer: 1024 * 1024 }).toString());
function frame(value: unknown) { if (value === undefined || value === null)
    return null; const pv = scalarPV(value); return { hex: pv.bytes().toString('hex'), utf8: pv.flagged() ? 1 : 0 }; }
function snapshot(model: GeneralModel) { return Object.fromEntries(['current', 'total', 'url_next', 'url_prev', 'url_first', 'url_last', 'kept'].map(key => [key, frame(model['_' + key])])); }
for (const [index, values] of cases.entries())
    test('actual native navigation ' + index, () => {
        const factory = generalCommentNavigation(), calls: unknown[] = [];
        const model: GeneralModel = { _current: values[0] === null ? undefined : bytes(values[0]!), _total: values[1] === null ? undefined : bytes(values[1]!) };
        for (const key of ['url_next', 'url_prev', 'url_first', 'url_last', 'kept'])
            model['_' + key] = bytes('seed');
        const callback = (n: unknown) => { calls.push(frame(n)); return bytes('url:' + scalarPV(n).bytes().toString()); };
        const result = factory.itemRange(model, callback), first = snapshot(result);
        assert.equal(result, model);
        assert.equal(model['.type'], 'ItemRange');
        const method = factory.callbacks._ItemRange__url_of!(undefined as never, model, bytes('2.5tail'));
        const after = snapshot(factory.itemRange(model));
        const replaced = snapshot(factory.itemRange(model, n => { calls.push(frame(n)); return undefined; }));
        const nav = factory.commentNav(model), unbound = factory.callbacks._ItemRange__url_of!(undefined as never, { _url_of: callback }, bytes('2'));
        assert.deepEqual({ first, method: frame(method), after, replaced, calls, identity: nav === model ? 1 : 0, type: nav['.type'], unbound: frame(unbound) }, expected[index]);
        assert.equal(factory.callbacks._ItemRange__url_of!(undefined as never, model, bytes('2')), undefined);
        const copy = { ...model, _url_of: callback };
        assert.deepEqual(frame(factory.callbacks._ItemRange__url_of!(undefined as never, copy, bytes('2'))), frame(bytes('')));
    });
test('unbound constructor, flagged return, alias and infrastructure identity', () => {
    const f = generalCommentNavigation(), model: GeneralModel = { _current: bytes('2'), _total: bytes('4') };
    f.itemRange(model);
    assert.deepEqual(frame(model._url_next), frame(bytes('')));
    const flagged = NativeString.hostUnicode('猫');
    f.itemRange(model, () => flagged);
    assert.equal(model._url_next, flagged);
    const alias = model;
    assert.equal(f.callbacks._ItemRange__url_of!(undefined as never, alias, bytes('1')), flagged);
    const other = generalCommentNavigation();
    assert.deepEqual(frame(other.callbacks._ItemRange__url_of!(undefined as never, alias, bytes('1'))), frame(bytes('')));
    const error = new Error('infrastructure');
    assert.throws(() => f.itemRange(model, () => { throw error; }), v => v === error);
});

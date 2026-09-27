// general-image-builtins.test.ts
//
// Actual native standard Image cache, reset, aliases and helper ordering.
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
import { Context } from '../runtime/s2runtime';
import { NativeString, NativeNumber, scalarPV } from '../runtime/native-scalar';
import { generalImageCallbacks, type GeneralImageOperations } from '../live/render/general-image-builtins';
const text = NativeString.hostUtf8Bytes;
const prefixes = ['http://img', 'https://img', 'HTTP://img', '//img', '/img', 'https://é'];
const oracle = JSON.parse(execFileSync('perl', ['-e', String.raw `
use strict;use warnings;no warnings 'once';use JSON::PP;use Encode;use Scalar::Util qw(refaddr);
use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
our$db;BEGIN{require DBI;no warnings 'redefine';*DBI::connect=sub{$db=1;die 'DB forbidden'};*DBI::connect_cached=sub{$db=1;die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;
our@calls;{no warnings 'redefine';*LJ::Lang::ml=sub{push@calls,defined$_[0]?$_[0]:'MISSING';defined$_[0]?"translated:$_[0]":undef};}
sub f{my$v=shift;return undef unless defined$v;my$h;{use bytes;$h=unpack('H*',$v)}return{hex=>$h,utf8=>utf8::is_utf8($v)?1:0}}
sub snap{my$i=shift;return undef unless$i;return{map{$_=>f($i->{$_})}qw(url width height alttext)}}
my$cases=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});my@rows;
for my$p(@$cases){@calls=();%LJ::Img::img=(rss=>{src=>'/rss',width=>'0016',height=>undef,alt=>'rss.alt'},'security-private'=>{src=>'/private',width=>'9007199254740993',height=>'17'});
$LJ::IMGPREFIX=$p;$LJ::S2::RES_MADE=0;$LJ::S2::CURR_CTX=[];$LJ::S2::CURR_CTX->[S2::PROPS()]={text_icon_alt_private=>'first'};
my$unknown=LJ::S2::Image_std('unknown');my$first=S2::Builtin::LJ::get_image(undef,'security-private');my$rss=LJ::S2::Image_std('rss');my$missing=LJ::S2::Image_std('atom');
my$before=snap($first);$LJ::S2::CURR_CTX->[S2::PROPS()]->{text_icon_alt_private}='second';
my$same=LJ::S2::Image_std('security-private');my$ret=S2::Builtin::LJ::Image__set_url(undef,$first,'a b&c');my$mutated=snap($first);
$LJ::S2::RES_MADE=0;my$new=LJ::S2::Image_std('security-private');
push@rows,{unknown=>f($unknown),before=>$before,rss=>snap($rss),missing=>snap($missing),same=>refaddr($first)==refaddr($same)?1:0,ret=>f($ret),mutated=>$mutated,new=>snap($new),different=>refaddr($new)!=refaddr($first)?1:0,old=>snap($first),calls=>[@calls]};}
die 'DB attempted'if$db;print JSON::PP->new->canonical->encode(\@rows);
`], { input: JSON.stringify(prefixes), timeout: 10000, maxBuffer: 1024 * 1024 }).toString());
function frame(value: unknown) { if (value === undefined || value === null)
    return null; const pv = scalarPV(value); return { hex: pv.bytes().toString('hex'), utf8: pv.flagged() ? 1 : 0 }; }
function snap(value: Record<string, unknown> | undefined) { return value ? Object.fromEntries(['url', 'width', 'height', 'alttext'].map(key => [key, frame(value['_' + key])])) : null; }
for (const [index, prefix] of prefixes.entries())
    test('actual native image lifecycle ' + prefix, () => {
        const calls: string[] = [];
        const ctx = new Context([], () => { });
        ctx.prop._text_icon_alt_private = text('first');
        const operations: GeneralImageOperations = { sourceFacts() {
                return { prefix: prefix.includes('é') ? NativeString.hostUnicode(prefix) : text(prefix), images: [
                        { name: text('rss'), src: text('/rss'), width: text('0016'), height: undefined, altKey: text('rss.alt') },
                        { name: text('security-private'), src: text('/private'), width: text('9007199254740993'), height: text('17'), altKey: undefined }
                    ] };
            },
            translate(key) { calls.push(key ? key.bytes().toString() : 'MISSING'); return key ? text('translated:' + key.bytes().toString()) : undefined; },
            escapeUrl(value) { assert.equal(scalarPV(value).bytes().toString(), 'a b&c'); return text('a+b%26c'); } };
        const factory = generalImageCallbacks(operations);
        const unknown = factory.callbacks._get_image!(ctx, text('unknown'));
        const first = factory.image(ctx, text('security-private'))!, rss = factory.image(ctx, text('rss')), missing = factory.image(ctx, text('atom'));
        const before = snap(first);
        ctx.prop._text_icon_alt_private = text('second');
        const same = factory.image(ctx, text('security-private'));
        const ret = factory.callbacks._Image__set_url!(ctx, first, text('a b&c')), mutated = snap(first);
        factory.beginRendering(ctx);
        const next = factory.image(ctx, text('security-private'));
        assert.deepEqual({ unknown: frame(unknown), before, rss: snap(rss), missing: snap(missing), same: first === same ? 1 : 0, ret: frame(ret), mutated, new: snap(next), different: next !== first ? 1 : 0, old: snap(first), calls }, oracle[index]);
        factory.beginRendering(ctx);
        assert.notEqual(factory.image(ctx, text('security-private')), next, 'every run resets');
        const other = new Context([], () => { });
        other.prop._text_icon_alt_private = text('other');
        assert.equal(scalarPV(factory.image(other, text('security-private'))!._alttext).bytes().toString(), 'other');
        assert.equal(scalarPV(first._alttext).bytes().toString(), 'first');
    });
test('flags, numeric descriptor identity and unchanged helper failure', () => {
    const ctx = new Context([], () => { }), width = NativeNumber.literal('9007199254740993');
    const error = new Error('translation infrastructure');
    let failed = true;
    const factory = generalImageCallbacks({ sourceFacts() { return { prefix: NativeString.hostUnicode('https://é'), images: [{ name: text('security-private'), src: text('/x'), width, height: undefined, altKey: undefined }] }; }, translate() { if (failed)
            throw error; return undefined; }, escapeUrl() { throw error; } });
    assert.throws(() => factory.image(ctx, text('unknown')), value => value === error);
    const partial = factory.image(ctx, text('security-private'))!;
    assert.equal(scalarPV(partial._url).flagged(), true);
    assert.equal((partial._width as NativeNumber).wire().value, width.wire().value);
    assert.throws(() => factory.callbacks._Image__set_url!(ctx, partial, text('x')), value => value === error);
    failed = false;
    factory.beginRendering(ctx);
    assert.notEqual(factory.image(ctx, text('security-private')), partial);
});

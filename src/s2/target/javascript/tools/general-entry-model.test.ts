// general-entry-model.test.ts
//
// Actual native Entry constructor branches, aliases and public helper ordering.
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
import { generalEntry, type GeneralEntryInput, type GeneralEntryOperations } from '../live/domain/general-entry-model';
import { generalImage, type GeneralModel } from '../live/domain/general-model-primitives';
import { NativeString, NativeNumber, scalarPV, isNativeProgramError } from '../runtime/native-scalar';
import { runtime } from '../runtime/s2runtime';
import type { NativeProfile } from '../runtime/native-profile';
const bytes = NativeString.hostUtf8Bytes;
interface Case {
    style?: string;
    noPic?: boolean;
    falseUrl?: boolean;
    emptyPic?: boolean;
    missingUsers?: boolean;
    security?: string;
    mask?: string;
    adult?: string;
    features?: boolean;
    esnOnly?: boolean;
    widePic?: boolean;
    emptyDates?: boolean;
    tagsFalse?: boolean;
    groups?: 'empty' | 'zero' | 'explicit' | 'array';
    fallbackEmpty?: boolean;
    mood?: boolean;
    text?: string;
    flag?: boolean;
}
const cases: Case[] = [
    {}, { style: 'small' }, { style: 'smaller' }, { style: 'small', falseUrl: true },
    { noPic: true }, { emptyPic: true }, { missingUsers: true }, { tagsFalse: true },
    { style: 'small', widePic: true }, { emptyDates: true }, { esnOnly: true },
    { features: true, security: 'private', adult: 'explicit', mood: true },
    { security: 'usemask', mask: '0' }, { security: 'usemask', mask: '1' },
    { security: 'usemask', mask: '4', adult: 'concepts' }, { security: 'other' },
    { groups: 'empty' }, { groups: 'zero' }, { groups: 'explicit' },
    { groups: 'array' }, { fallbackEmpty: true },
    ...['<script>', '<ScRiPt', '<scripture>', '<script_>', '<object!', '<applet\n',
        '<embed>', '<iframe>', '<ſcript>', '<ſcripté>', '<scripté>', '<script\u200c>',
        '<script\u1c89>', '<script\uff10>'].map(text => ({ text, flag: true })),
    { text: '<ſcript>', flag: false }, { text: '<scripté>', flag: false },
];
const native = JSON.parse(execFileSync('perl', ['-e', String.raw `
    use strict;use warnings;no warnings 'once';use JSON::PP;use Encode;use Scalar::Util qw(refaddr);
    use lib '/workspaces/dreamwidth/cgi-bin','/workspaces/dreamwidth/src/s2';
    our $db_attempt;BEGIN {require DBI;no warnings 'redefine';
        *DBI::connect=sub{$db_attempt=1;die 'DB forbidden in Entry oracle'};
        *DBI::connect_cached=sub{$db_attempt=1;die 'DB forbidden in Entry oracle'};}
    require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require S2;require LJ::S2;
    our($spec,@calls);my$dates=\&LJ::S2::DateTime_parts;
    {no warnings 'redefine';
        *LJ::get_remote=sub{undef};*LJ::is_enabled=sub{$spec->{features}||$spec->{esnOnly}&&$_[0] eq 'esn'?1:0};
        *LJ::S2::DateTime_parts=sub{push@calls,'date';$dates->(@_)};
        *LJ::S2::Image_std=sub{push@calls,$_[0];LJ::S2::Image($_[0],16,17,$_[0])};
        *LJ::currents=sub{push@calls,'currents';my($p,$m,$opts)=@_;
            my$ref=$opts->{s2imgref};$$ref=['/mood',18,19,'mood'] if$spec->{mood};
            return(Music=>'0',Location=>'',Mood=>undef);};
        *LJ::Entry::new=sub{push@calls,'groups';bless{},'EntryOracleGroups'};}
    sub EntryOracleGroups::group_names {$spec->{fallbackEmpty}?'':'group fallback'}
    sub frame {my$v=shift;return undef unless defined$v;my$hex;
        {use bytes;$hex=unpack('H*',substr($v,0));}return{hex=>$hex,utf8=>utf8::is_utf8($v)?1:0};}
    sub icon {my$v=shift;return undef unless defined$v;return{map{$_=>frame($v->{$_})}qw(url width height alttext)};}
    my$input=JSON::PP->new->utf8->decode(do{local$/;<STDIN>});my@rows;
    for $spec (@$input) {
        @calls=();my$journal={_type=>'UserLite',user=>'ordinary'};
        my$pic=$spec->{noPic}?undef:$spec->{emptyPic}?{}:LJ::S2::Image($spec->{falseUrl}?'0':'/pic',$spec->{widePic}?'9007199254740993':'170',$spec->{widePic}?undef:'151','pic');
        my$text=Encode::encode_utf8($spec->{text}//'plain');
        $text=Encode::decode('UTF-8',$text) if$spec->{flag};
        my$tags=$spec->{tagsFalse}?'0':[];my$comments={_type=>'CommentInfo',count=>'0007'};
        my$arg={subject=>'0',text=>$text,journal=>$spec->{missingUsers}?undef:$journal,
            poster=>$spec->{missingUsers}?undef:$journal,new_day=>'0',end_day=>undef,
            comments=>$comments,userpic=>$pic,permalink_url=>'/entry',itemid=>'9007199254740993',
            tags=>$tags,timeformat24=>'0',admin_post=>'0',dom_id=>'entry-ordinary',
            userpic_style=>$spec->{style},dateparts=>$spec->{emptyDates}?undef:'2026 09 27 01 02 03 0',
            system_dateparts=>$spec->{emptyDates}?undef:'9007199254740993 0 0 -1 2.5 0',security=>$spec->{security}//'public',
            allowmask=>$spec->{mask}//'0',adult_content_level=>$spec->{adult}//''};
        $arg->{group_names}=$spec->{groups} eq 'array'?[]:$spec->{groups} eq 'zero'?'0':
            $spec->{groups} eq 'explicit'?'explicit groups':'' if defined$spec->{groups};
        my$e=LJ::S2::Entry(undef,$arg);
        push@rows,{fields=>{map{$_=>frame($e->{$_})}qw(subject text new_day end_day permalink_url itemid timeformat24 admin_post dom_id depth adult_content_level security text_must_print_trusted)},
            keys=>[map{frame($_)}@{$e->{link_keyseq}}],pic=>icon($e->{userpic}),
            securityIcon=>icon($e->{security_icon}),adultIcon=>icon($e->{adult_content_icon}),moodIcon=>icon($e->{mood_icon}),
            time=>{map{$_=>frame($e->{time}{$_})}qw(year month day hour min sec _dayofweek)},
            systemTime=>{map{$_=>frame($e->{system_time}{$_})}qw(year month day hour min sec _dayofweek)},
            metadata=>{map{$_=>ref($e->{metadata}{$_})?'array':frame($e->{metadata}{$_})}keys%{$e->{metadata}}},
            aliases=>{picture=>defined($pic)&&refaddr($pic)==refaddr($e->{userpic})?1:0,
                comments=>refaddr($comments)==refaddr($e->{comments})?1:0,
                users=>ref($arg->{journal})&&refaddr($e->{journal})==refaddr($e->{poster})?1:0,
                tags=>ref($tags)&&refaddr($tags)==refaddr($e->{tags})?1:0},
            noPic=>!defined($e->{userpic})?1:0,emptyPic=>ref($e->{userpic})&&keys(%{$e->{userpic}})==0?1:0,
            missingPoster=>keys(%{$e->{poster}})==0?1:0,missingJournal=>keys(%{$e->{journal}})==0?1:0,
            calls=>[@calls]};
    }
    die 'DB attempted' if$db_attempt;print JSON::PP->new->canonical->encode(\@rows);
`], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576, env: { ...process.env, PERL_HASH_SEED: '0', PERL_PERTURB_KEYS: '0' } }));
const profile: NativeProfile = JSON.parse(execFileSync('perl', ['tools/compile-active.pl'], {
    input: JSON.stringify({ profileOnly: true }), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
})).profile;
const frame = (value: unknown) => value === undefined || value === null ? null : { hex: scalarPV(value).bytes().toString('hex'), utf8: scalarPV(value).flagged() ? 1 : 0 };
const image = (value: unknown) => value === undefined ? null : Object.fromEntries(['url', 'width', 'height', 'alttext'].map(field => [field, frame((value as GeneralModel)['_' + field])]));
const dateFromNative = (fields: Record<string, {
    hex: string;
    utf8: number;
} | null>): GeneralModel => Object.fromEntries([
    ['.type', 'DateTime'], ...Object.entries(fields).filter(([, v]) => v !== null).map(([key, v]) => [key.startsWith('_') ? key : '_' + key,
        NativeString.fromFrame({ bytes: Buffer.from(v!.hex, 'hex'), utf8: !!v!.utf8 })]),
]);
for (const [index, spec] of cases.entries())
    test(`actual native Entry constructor ${index}`, () => {
        const expected = native[index], calls: string[] = [];
        const journal = { '.type': 'UserLite', _user: bytes('ordinary') };
        const pic = spec.noPic ? undefined : spec.emptyPic ? {} : generalImage(bytes(spec.falseUrl ? '0' : '/pic'), bytes(spec.widePic ? '9007199254740993' : '170'), spec.widePic ? undefined : bytes('151'), bytes('pic'));
        const comments = { '.type': 'CommentInfo', _count: bytes('0007') }, tags = spec.tagsFalse ? bytes('0') : [];
        const text = spec.flag ? NativeString.hostUnicode(spec.text ?? 'plain') : bytes(spec.text ?? 'plain');
        const input: GeneralEntryInput = { subject: bytes('0'), text, journal: spec.missingUsers ? undefined : journal,
            poster: spec.missingUsers ? undefined : journal, newDay: bytes('0'), endDay: undefined, comments, userpic: pic,
            permalinkUrl: bytes('/entry'), itemId: bytes('9007199254740993'), tags, timeformat24: bytes('0'),
            adminPost: bytes('0'), domId: bytes('entry-ordinary'), userpicStyle: spec.style === undefined ? undefined : bytes(spec.style),
            dateparts: spec.emptyDates ? undefined : bytes('2026 09 27 01 02 03 0'), systemDateparts: spec.emptyDates ? undefined : bytes('9007199254740993 0 0 -1 2.5 0'),
            security: bytes(spec.security ?? 'public'), allowmask: bytes(spec.mask ?? '0'), adultContentLevel: bytes(spec.adult ?? ''),
            groupNames: spec.groups === 'array' ? [] : spec.groups === 'zero' ? bytes('0') : spec.groups === 'explicit' ? bytes('explicit groups') : spec.groups === 'empty' ? bytes('') : undefined };
        let dates = 0;
        const operations: GeneralEntryOperations = { features: { memories: !!spec.features, tellafriend: !!spec.features, esn: !!spec.features || !!spec.esnOnly },
            // Dependency isolation: actual native DateTime projections, no copied
            // DateTime algorithm or unreviewed Page implementation in this test.
            dateTimeParts(value) { assert.equal(value, dates ? input.systemDateparts : input.dateparts); calls.push('date'); return dateFromNative(dates++ ? expected.systemTime : expected.time); },
            standardImage(kind) { calls.push(kind); return generalImage(bytes(kind), NativeNumber.integer(16n), NativeNumber.integer(17n), bytes(kind)); },
            currents() {
                calls.push('currents');
                return { values: [[bytes('Music'), bytes('0')], [bytes('Location'), bytes('')], [bytes('Mood'), undefined]],
                    ...(spec.mood ? { moodImage: generalImage(bytes('/mood'), NativeNumber.integer(18n), NativeNumber.integer(19n), bytes('mood')) } : {}) };
            },
            groupNames() { calls.push('groups'); return bytes(spec.fallbackEmpty ? '' : 'group fallback'); } };
        const result = generalEntry(input, operations, profile);
        const fields = ['subject', 'text', 'new_day', 'end_day', 'permalink_url', 'itemid', 'timeformat24', 'admin_post', 'dom_id', 'depth', 'adult_content_level', 'security', 'text_must_print_trusted'];
        const metadata = Object.fromEntries(runtime.hashKeys(result._metadata).map(key => [scalarPV(key).bytes().toString(),
            Array.isArray(runtime.memberSlot(result._metadata, key, 'hash').get()) ? 'array' : frame(runtime.memberSlot(result._metadata, key, 'hash').get())]));
        const snapshot = { fields: Object.fromEntries(fields.map(key => [key, frame(result['_' + key])])),
            keys: (result._link_keyseq as unknown[]).map(frame), pic: image(result._userpic),
            securityIcon: image(result._security_icon), adultIcon: image(result._adult_content_icon), moodIcon: image(result._mood_icon),
            time: Object.fromEntries(Object.keys(expected.time).map(key => [key, frame((result._time as GeneralModel)[key.startsWith('_') ? key : '_' + key])])),
            systemTime: Object.fromEntries(Object.keys(expected.systemTime).map(key => [key, frame((result._system_time as GeneralModel)[key.startsWith('_') ? key : '_' + key])])), metadata,
            aliases: { picture: pic !== undefined && pic === result._userpic ? 1 : 0, comments: comments === result._comments ? 1 : 0,
                users: input.journal !== undefined && result._journal === result._poster ? 1 : 0, tags: Array.isArray(tags) && tags === result._tags ? 1 : 0 },
            noPic: result._userpic === undefined ? 1 : 0, emptyPic: result._userpic !== undefined && Object.keys(result._userpic as object).length === 0 ? 1 : 0,
            missingPoster: Object.keys(result._poster as object).length === 0 ? 1 : 0, missingJournal: Object.keys(result._journal as object).length === 0 ? 1 : 0, calls };
        assert.deepEqual(snapshot, expected);
        assert.equal((result._time as GeneralModel)['.type'], 'DateTime');
        assert.notEqual(result._time, result._system_time);
        assert.equal(input.poster, spec.missingUsers ? undefined : journal, 'autovivification does not overwrite caller arg');
        assert.equal(input.userpic, pic);
        assert.notEqual(result._subject, input.subject, 'native scalar copy is independent');
    });
test('installed helper infrastructure failure is propagated unchanged', () => {
    const error = new Error('fixture infrastructure');
    const input = Object.fromEntries(['subject', 'text', 'journal', 'poster', 'newDay', 'endDay', 'comments', 'userpic', 'permalinkUrl', 'itemId', 'tags', 'timeformat24', 'adminPost', 'domId', 'userpicStyle', 'dateparts', 'systemDateparts', 'security', 'allowmask', 'adultContentLevel'].map(key => [key, undefined])) as unknown as GeneralEntryInput;
    const operations: GeneralEntryOperations = { features: { memories: false, tellafriend: false, esn: false },
        dateTimeParts() { throw error; }, standardImage() { throw Error('unexpected'); }, currents() { throw Error('unexpected'); }, groupNames() { throw Error('unexpected'); } };
    assert.throws(() => generalEntry(input, operations, profile), value => value === error && !isNativeProgramError(value));
});

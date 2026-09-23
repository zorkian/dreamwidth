#!/usr/bin/perl
# Characterize a pure retained-shaped raw decode-hook argument for native altlogin.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Hash::MultiValue;
use Storable qw(dclone);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Entry::Legacy;

sub build {
    my ( $post, $canonical ) = @_;
    return DW::Entry::Legacy::build_altlogin_legacy_raw_post(
        native_post => $post,
        canonical   => $canonical,
    );
}

sub canonical_for {
    my ($post) = @_;
    return DW::Entry::Legacy::prepare_altlogin_native_form(
        $post,
        canonical_seed => { tz => 'guess', props => { native_keep => 'native value' } },
        legacy_seed    => { tz => 'guess' },
    )->{canonical};
}

subtest 'builder maps a real-shaped native form without executing processing' => sub {
    my $post = Hash::MultiValue->new(
        'action:update'        => 'Update',
        user                   => 'credential-actor',
        password               => 'fixture-only-password',
        lj_form_auth           => 'token',
        nojs                   => 1,
        subject                => 'Raw subject',
        event                  => 'Raw <strong>body</strong>',
        editor                 => 'rte0',
        security               => 'custom',
        custom_bit             => 1,
        custom_bit             => 60,
        custom_bit             => 1,
        custom_bit             => '001',
        taglist                => ' raw tag ',
        prop_picture_keyword   => 'icon',
        current_mood           => 42,
        current_mood_other     => 'typed mood',
        current_music          => 'music',
        current_location       => 'location',
        comment_settings       => 'nocomments',
        opt_screening          => 1,
        age_restriction        => 'restricted',
        age_restriction_reason => 'reason',
        entrytime_date         => '2026-09-23',
        entrytime_time         => '10:11',
        trust_datetime         => 1,
        entrytime_outoforder   => 1,
        flags_adminpost        => 1,
        crosspost_entry        => 1,
        crosspost              => 77,
        crosspost_password_77  => 'injected',
        extension_control      => 'first',
        extension_control      => '',
    );
    my $canonical        = canonical_for($post);
    my $post_before      = dclone( DW::Entry::Legacy::legacy_post_hash($post) );
    my $canonical_before = dclone($canonical);
    my $legacy_request   = { extension => { value => 'second argument' } };
    my $legacy_before    = dclone($legacy_request);

    my ( $decode, $hooks, $auth, $protocol, $requests ) = ( 0, 0, 0, 0, 0 );
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub { ++$decode;   die 'decoder must not run'; };
    local *LJ::Hooks::run_hooks                 = sub { ++$hooks;    die 'hook must not run'; };
    local *LJ::auth_okay                        = sub { ++$auth;     die 'auth must not run'; };
    local *LJ::Protocol::do_request             = sub { ++$protocol; die 'protocol must not run'; };
    local *DW::Request::get = sub { ++$requests; die 'request lookup must not run'; };

    my $raw = build( $post, $canonical );
    is_deeply(
        {
            map { $_ => $raw->{$_} }
                qw(lj_form_auth nojs user password subject event security prop_taglist
                prop_picture_keyword prop_current_moodid prop_current_mood prop_current_music
                prop_current_location comment_settings prop_opt_screening prop_adult_content
                prop_adult_content_reason prop_opt_backdated prop_admin_post date_ymd_yyyy
                date_ymd_mm date_ymd_dd hour min date_diff date_diff_nojs extension_control)
        },
        {
            lj_form_auth              => 'token',
            nojs                      => 1,
            user                      => 'credential-actor',
            password                  => 'fixture-only-password',
            subject                   => 'Raw subject',
            event                     => 'Raw <strong>body</strong>',
            security                  => 'custom',
            prop_taglist              => ' raw tag ',
            prop_picture_keyword      => 'icon',
            prop_current_moodid       => 42,
            prop_current_mood         => 'typed mood',
            prop_current_music        => 'music',
            prop_current_location     => 'location',
            comment_settings          => 'nocomments',
            prop_opt_screening        => 1,
            prop_adult_content        => 'explicit',
            prop_adult_content_reason => 'reason',
            prop_opt_backdated        => 1,
            prop_admin_post           => 1,
            date_ymd_yyyy             => '2026',
            date_ymd_mm               => '09',
            date_ymd_dd               => '23',
            hour                      => '10',
            min                       => '11',
            date_diff                 => 1,
            date_diff_nojs            => 1,
            extension_control         => "first\0",
        },
        'known fields receive retained raw names while extension repeats use BML NUL convention'
    );
    ok(
        $raw->{custom_bit_1} && $raw->{custom_bit_60},
        'canonical custom mask supplies bits one and sixty'
    );
    ok( !exists $raw->{custom_bit_0},
        'zero-padded and malformed input does not invent raw bit zero' );
    my @native_controls =
        qw(editor taglist current_mood current_mood_other current_music current_location
        age_restriction age_restriction_reason entrytime_date entrytime_time trust_datetime
        entrytime_outoforder crosspost_entry crosspost);
    ok( !( grep { exists $raw->{$_} } @native_controls ),
        'native-only and crosspost controls are absent from purpose-shaped raw input' );
    ok(
        !exists $raw->{event_format}
            && !exists $raw->{switched_rte_on}
            && !exists $raw->{prop_used_rte}
            && !exists $raw->{prop_opt_preformatted},
        'builder does not synthesize retained editor or formatting controls'
    );
    ok(
        !exists $raw->{date_ymd_old_yyyy} && !exists $raw->{hour_old},
        'builder does not invent retained previous-date comparison controls'
    );
    is_deeply( DW::Entry::Legacy::legacy_post_hash($post),
        $post_before, 'native HMV remains unchanged' );
    is_deeply( $canonical, $canonical_before, 'canonical result remains unchanged' );
    is_deeply( $legacy_request, $legacy_before, 'separate second hook argument remains unchanged' );
    is( $decode,   0, 'builder does not decode' );
    is( $hooks,    0, 'builder does not invoke hooks' );
    is( $auth,     0, 'builder does not authenticate' );
    is( $protocol, 0, 'builder does not call protocol' );
    is( $requests, 0, 'builder does not access request context' );
};

subtest 'canonical security determines retained raw security without a second bit parser' => sub {
    for my $case (
        [ public  => { security => 'public',  allowmask => 0 }, 'public',  [] ],
        [ private => { security => 'private', allowmask => 0 }, 'private', [] ],
        [ access  => { security => 'usemask', allowmask => 1 }, 'friends', [] ],
        [
            custom => { security => 'usemask', allowmask => ( 1 << 1 ) | ( 1 << 60 ) },
            'custom', [ 1, 60 ]
        ],
        )
    {
        my ( $label, $canonical, $security, $bits ) = @$case;
        my $post = Hash::MultiValue->new(
            'action:update' => 'Update',
            security        => 'custom',
            custom_bit      => 0,
            custom_bit      => 1
        );
        my $raw = build( $post, { %$canonical, props => {} } );
        is( $raw->{security}, $security, "$label canonical security chooses retained selector" );
        is_deeply( [ map { $_ } grep { $raw->{"custom_bit_$_"} } 1 .. 60 ],
            $bits, "$label numbered bits derive only from canonical mask" );
    }

    # Native custom bit zero and access both canonicalize to usemask=1. Build
    # from the actual native parser result and use friends, which reproduces
    # that mask without inventing a retained bit zero.
    my $malformed = Hash::MultiValue->new(
        'action:update' => 'Update',
        security        => 'custom',
        custom_bit      => 0
    );
    my $canonical = canonical_for($malformed);
    is_deeply(
        { map { $_ => $canonical->{$_} } qw(security allowmask) },
        { security => 'usemask', allowmask => 1 },
        'native parser canonicalizes malformed bit zero to the ambiguous usemask one state'
    );
    my $raw = build( $malformed, $canonical );
    is( $raw->{security}, 'friends',
        'ambiguous canonical mask one uses documented friends classification' );
    ok( !( grep { $raw->{"custom_bit_$_"} } 1 .. 60 ),
        'ambiguous classification synthesizes no unsupported retained bit zero' );
};

subtest 'unsupported masks and date syntax return undef without shaping input' => sub {
    my $mixed_bit_zero = Hash::MultiValue->new(
        'action:update' => 'Update',
        security        => 'custom',
        custom_bit      => 0,
        custom_bit      => 1
    );
    my $mixed_canonical = canonical_for($mixed_bit_zero);
    is( $mixed_canonical->{allowmask}, 3, 'native parser creates mixed bit-zero canonical mask' );
    my $mixed_before = dclone( DW::Entry::Legacy::legacy_post_hash($mixed_bit_zero) );
    is( build( $mixed_bit_zero, $mixed_canonical ),
        undef, 'mixed bit-zero mask has no retained raw representation' );
    is_deeply( DW::Entry::Legacy::legacy_post_hash($mixed_bit_zero),
        $mixed_before, 'unsupported mask leaves native input unchanged' );

    my $outside = Hash::MultiValue->new( 'action:update' => 'Update', security => 'custom' );
    is( build( $outside, { security => 'usemask', allowmask => 1 << 61, props => {} } ),
        undef, 'out-of-range canonical bit has no retained raw representation' );

    for my $case (
        [ 'invalid date text',   Hash::MultiValue->new( entrytime_date => 'not-a-year-02-03' ) ],
        [ 'invalid time text',   Hash::MultiValue->new( entrytime_time => 'not-hour:not-minute' ) ],
        [ 'explicit empty date', Hash::MultiValue->new( entrytime_date => '' ) ],
        [ 'explicit empty time', Hash::MultiValue->new( entrytime_time => '' ) ],
        )
    {
        my ( $label, $post ) = @$case;
        my $before           = dclone( DW::Entry::Legacy::legacy_post_hash($post) );
        my $canonical        = { security => 'public', props => { native_keep => 'value' } };
        my $canonical_before = dclone($canonical);
        is( build( $post, $canonical ),
            undef, "$label is explicitly unsupported rather than silently split" );
        is_deeply( DW::Entry::Legacy::legacy_post_hash($post),
            $before, "$label leaves native input unchanged" );
        is_deeply( $canonical, $canonical_before, "$label leaves canonical input unchanged" );
    }
};

subtest 'reserved namespaces are cleared and adult raw values remain observational' => sub {
    my $post = Hash::MultiValue->new(
        security          => 'custom',
        custom_bit        => 0,
        custom_bit        => '01',
        custom_bit        => 61,
        custom_bit_0      => 1,
        custom_bit_01     => 1,
        custom_bit_61     => 1,
        crosspost_entry   => 1,
        crosspost         => 9,
        prop_xpost_check  => 1,
        prop_xpost_9      => 9,
        extension_control => 'kept',
    );
    my $raw = build( $post, { security => 'usemask', allowmask => 1 << 1, props => {} } );
    is( $raw->{security},     'custom', 'representable canonical custom mask selects custom' );
    is( $raw->{custom_bit_1}, 1,        'canonical bit one is synthesized' );
    my @injected_reserved = qw(custom_bit custom_bit_0 custom_bit_01 custom_bit_61
        crosspost_entry crosspost prop_xpost_check prop_xpost_9);
    ok( !( grep { exists $raw->{$_} } @injected_reserved ),
        'injected reserved custom and crosspost names are cleared before canonical bit synthesis' );
    is( $raw->{extension_control},
        'kept', 'unrelated extension control survives namespace cleanup' );

    for my $case (
        [ 'recognized alias',       'discretion',      'concepts' ],
        [ 'empty raw value',        '',                '' ],
        [ 'unrecognized raw value', 'extension-value', 'extension-value' ],
        )
    {
        my ( $label, $value, $expected ) = @$case;
        my $adult = build(
            Hash::MultiValue->new( age_restriction => $value, age_restriction_reason => '' ),
            { security => 'public', props => { adult_content => 'canonical normalized' } },
        );
        is( $adult->{prop_adult_content},
            $expected, "$label adult value remains a retained raw observation" );
        is( $adult->{prop_adult_content_reason}, '', "$label empty adult reason remains present" );
    }
};

subtest 'date observation and raw empties do not alter canonical date ownership' => sub {
    my $trusted = Hash::MultiValue->new(
        'action:update'        => 'Update',
        entrytime_date         => '2026-10-11',
        entrytime_time         => '12:13',
        trust_datetime         => 1,
        taglist                => '',
        current_location       => '',
        age_restriction_reason => '',
    );
    my $trusted_canonical = canonical_for($trusted);
    my $trusted_before    = dclone($trusted_canonical);
    my $trusted_raw       = build( $trusted, $trusted_canonical );
    is_deeply(
        {
            map { $_ => $trusted_raw->{$_} }
                qw(date_ymd_yyyy date_ymd_mm date_ymd_dd hour min date_diff)
        },
        {
            date_ymd_yyyy => '2026',
            date_ymd_mm   => '10',
            date_ymd_dd   => '11',
            hour          => '12',
            min           => '13',
            date_diff     => 1
        },
        'trusted date is observationally split into retained current date controls'
    );
    ok( !exists $trusted_raw->{date_diff_nojs}, 'trusted JS date does not invent no-JS signal' );
    is_deeply( $trusted_canonical, $trusted_before,
        'trusted canonical tz/date state is not reconciled here' );
    is( $trusted_raw->{prop_taglist},          '', 'explicit empty tag remains raw empty' );
    is( $trusted_raw->{prop_current_location}, '', 'explicit empty metadata remains raw empty' );
    is( $trusted_raw->{prop_adult_content_reason},
        '', 'explicit empty adult reason remains raw empty' );

    my $untrusted = Hash::MultiValue->new(
        'action:update' => 'Update',
        entrytime_date  => '2026-10-11',
        entrytime_time  => '12:13'
    );
    my $untrusted_canonical = canonical_for($untrusted);
    my $untrusted_raw       = build( $untrusted, $untrusted_canonical );
    ok( !exists $untrusted_raw->{date_diff} && !exists $untrusted_raw->{date_diff_nojs},
        'untrusted date exposes no invented trust signal' );

    my $nojs = Hash::MultiValue->new(
        'action:update' => 'Update',
        nojs            => 1,
        entrytime_date  => '2026-10-11',
        entrytime_time  => '12:13'
    );
    my $nojs_raw = build( $nojs, canonical_for($nojs) );
    is( $nojs_raw->{date_diff_nojs}, 1, 'no-JS date exposes retained no-JS trust signal' );
};

subtest 'result and extension references are independently copied' => sub {
    my $extension = { nested => 'input' };
    my $post      = Hash::MultiValue->new(
        'action:update'  => 'Update',
        extension_object => $extension,
        extension_scalar => 'value'
    );
    my $canonical = { security => 'public', allowmask => 0, props => { editor => 'markdown0' } };
    my $canonical_copy = dclone($canonical);
    my $raw            = build( $post, $canonical );
    $raw->{extension_object}{nested} = 'result mutation';
    $raw->{security} = 'private';
    is( $extension->{nested}, 'input', 'returned extension reference cannot alter HMV value' );
    is_deeply( $canonical, $canonical_copy, 'returned raw mutation cannot alter canonical data' );
    is( $post->{extension_scalar}, 'value', 'original scalar extension value remains intact' );
};

done_testing;

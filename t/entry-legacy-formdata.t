#!/usr/bin/perl
# Characterize native-schema retry data from retained legacy entry submissions.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use lib "$ENV{LJHOME}/cgi-bin";
use Hash::MultiValue;
use DW::Entry;
use DW::Entry::Legacy;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

sub field_values {
    my ( $formdata, $name ) = @_;
    return [ $formdata->get_all($name) ];
}

sub value {
    my ( $formdata, $name ) = @_;
    my $values = field_values( $formdata, $name );
    return $values->[0];
}

sub canonical {
    return {
        subject   => 'Legacy RTE subject',
        security  => 'usemask',
        allowmask => ( 1 << 3 ) | ( 1 << 60 ),
        year      => '2020',
        mon       => '02',
        day       => '03',
        hour      => '04',
        min       => '05',
        props     => {
            used_rte             => 1,
            opt_preformatted     => 0,
            opt_backdated        => 1,
            taglist              => 'first, second',
            picture_keyword      => 'fixture-pic',
            current_moodid       => 77,
            current_mood         => 'fixture other mood',
            current_music        => 'fixture music',
            current_location     => 'fixture location',
            current_coords       => '1.2,3.4',
            opt_screening        => 'F',
            opt_nocomments       => 0,
            opt_noemail          => 1,
            adult_content        => 'concepts',
            adult_content_reason => 'fixture reason',
        },
        crosspost_entry => 1,
        crosspost       => {
            41 => {
                id       => 41,
                password => 'password 41',
                chal     => 'challenge 41',
                resp     => 'response 41',
            },
            42 => {
                id       => undef,
                password => 'password 42',
                chal     => 'challenge 42',
                resp     => 'response 42',
            },
        },
        @_,
    };
}

sub legacy_post {
    return {
        security            => 'public',
        subject             => 'Legacy RTE subject',
        event               => '<p>Legacy RTE body</p>',
        usejournal          => 'fixture_comm',
        custom_bit_3        => 1,
        custom_bit_60       => 1,
        date_diff           => 1,
        comment_settings    => 'nocomments',
        flags_adminpost     => 1,
        prop_current_coords => '1.2,3.4',
        switched_rte_on     => 1,
        event_format        => 'preformatted',
        @_,
    };
}

subtest 'RTE source, canonical controls, and native field names survive a retry mapping' => sub {
    my $formdata = DW::Entry::Legacy::formdata_from_legacy( canonical(), legacy_post() );
    is( value( $formdata, 'subject' ), 'Legacy RTE subject', 'raw legacy subject is retained' );
    is(
        value( $formdata, 'event' ),
        '<p>Legacy RTE body</p>',
        'raw RTE body is retained byte-for-byte'
    );
    is( value( $formdata, 'editor' ), 'rte0', 'canonical used_rte selects native RTE editor' );
    is( value( $formdata, 'security' ),
        'custom', 'canonical custom mask selects native custom security' );
    is_deeply(
        field_values( $formdata, 'custom_bit' ),
        [ 3, 60 ],
        'selected legacy custom bits become repeated native values'
    );
    is( value( $formdata, 'entrytime_date' ),
        '2020-02-03', 'canonical date becomes native date field' );
    is( value( $formdata, 'entrytime_time' ), '04:05', 'canonical time becomes native time field' );
    is( value( $formdata, 'trust_datetime' ),
        1, 'changed legacy date remains trusted on native retry' );
    is( value( $formdata, 'entrytime_outoforder' ), 1, 'backdating is retained' );
    is( value( $formdata, 'taglist' ), 'first, second', 'tags map to native field' );
    is( value( $formdata, 'prop_picture_keyword' ), 'fixture-pic', 'userpic maps to native field' );
    is( value( $formdata, 'current_mood' ), 77, 'mood id maps to native select' );
    is(
        value( $formdata, 'current_mood_other' ),
        'fixture other mood',
        'other mood maps to native text field'
    );
    is( value( $formdata, 'current_music' ), 'fixture music', 'music maps to native field' );
    is(
        value( $formdata, 'current_location' ),
        'fixture location',
        'location maps to native field'
    );
    is( value( $formdata, 'opt_screening' ), 'F', 'comment screening maps to native field' );
    is( value( $formdata, 'comment_settings' ),
        'noemail', 'canonical comment precedence is retained' );
    is( value( $formdata, 'age_restriction' ),
        'discretion', 'legacy adult concepts maps to native discretion' );
    is(
        value( $formdata, 'age_restriction_reason' ),
        'fixture reason',
        'adult reason maps to native field'
    );
    is( value( $formdata, 'flags_adminpost' ), 1, 'community admin flag is retained' );
    is( value( $formdata, 'crosspost_entry' ), 1, 'crosspost master maps to native field' );
    is_deeply( field_values( $formdata, 'crosspost' ),
        [41], 'only selected account becomes repeated native selection' );
    is( value( $formdata, 'crosspost_password_41' ),
        'password 41', 'selected account password is retained' );
    is( value( $formdata, 'crosspost_chal_41' ),
        'challenge 41', 'selected account challenge is retained' );
    is( value( $formdata, 'crosspost_resp_41' ),
        'response 41', 'selected account response is retained' );
    is( value( $formdata, 'crosspost_password_42' ),
        'password 42', 'unselected account password is retained' );
    is( value( $formdata, 'crosspost_chal_42' ),
        'challenge 42', 'unselected account challenge is retained' );
    is( value( $formdata, 'crosspost_resp_42' ),
        'response 42', 'unselected account response is retained' );

    for my $legacy_name (qw(prop_current_coords switched_rte_on event_format date_ymd_mm)) {
        is_deeply( field_values( $formdata, $legacy_name ),
            [], "$legacy_name is not emitted into the native retry schema" );
    }
};

subtest 'legacy custom-bit bounds survive a native retry' => sub {
    my $legacy = {
        security       => 'custom',
        subject        => 'custom-bit subject',
        event          => 'custom-bit body',
        date_ymd_mm    => '02',
        date_ymd_dd    => '03',
        date_ymd_yyyy  => '2020',
        hour           => '04',
        min            => '05',
        date_diff      => 1,
        custom_bit_0   => 1,
        custom_bit_01  => 1,
        custom_bit_001 => 1,
        custom_bit_1   => 1,
        custom_bit_60  => 1,
        custom_bit_060 => 1,
        custom_bit_61  => 1,
    };
    my $canonical = DW::Entry::Legacy::normalize_entry_form( {}, $legacy );
    is(
        $canonical->{allowmask},
        ( 1 << 1 ) | ( 1 << 60 ),
        'legacy decoder ignores nonliteral and out-of-range custom-bit keys'
    );

    my $formdata = DW::Entry::Legacy::formdata_from_legacy( $canonical, $legacy );
    is_deeply(
        field_values( $formdata, 'custom_bit' ),
        [ 1, 60 ],
        'native retry emits each literal legacy custom-bit key in the decoder range once'
    );

    my %backend;
    ok(
        DW::Entry::_form_to_backend( 0, \%backend, $formdata ),
        'native decoder accepts bounded retry bits'
    );
    is(
        $backend{allowmask},
        ( 1 << 1 ) | ( 1 << 60 ),
        'native retry ignores nonliteral and out-of-range legacy custom bits'
    );
};

subtest 'canonical placeholder-subject normalization survives a native retry' => sub {
    no warnings 'redefine';
    local *LJ::Lang::ml = sub {
        return 'LEGACY-SUBJECT-PLACEHOLDER' if $_[0] eq 'entryform.subject.hint2';
        return "unexpected:$_[0]";
    };
    my $legacy    = legacy_post( subject => 'LEGACY-SUBJECT-PLACEHOLDER' );
    my $canonical = DW::Entry::Legacy::normalize_entry_form( {}, $legacy );
    is( $canonical->{subject}, '', 'legacy decoder clears the translated subject placeholder' );

    my $formdata = DW::Entry::Legacy::formdata_from_legacy( $canonical, $legacy );
    is( value( $formdata, 'subject' ), '', 'native retry receives canonical empty subject' );
    is(
        value( $formdata, 'event' ),
        '<p>Legacy RTE body</p>',
        'ordinary raw body is still retained'
    );

    my %backend;
    ok(
        DW::Entry::_form_to_backend( 0, \%backend, $formdata ),
        'native retry accepts placeholder-normalized form data'
    );
    is( $backend{subject}, '', 'native retry cannot save the old placeholder literal' );
};

subtest 'the generated data is accepted by the native form decoder on retry' => sub {
    my $formdata = DW::Entry::Legacy::formdata_from_legacy( canonical(), legacy_post() );
    my %backend;
    ok( DW::Entry::_form_to_backend( 0, \%backend, $formdata ),
        'native decoder accepts mapped form data' );
    is( $backend{subject},  'Legacy RTE subject',     'native retry retains mapped subject' );
    is( $backend{event},    '<p>Legacy RTE body</p>', 'native retry retains raw RTE body' );
    is( $backend{security}, 'usemask',                'native retry reconstructs custom security' );
    is( $backend{allowmask}, ( 1 << 3 ) | ( 1 << 60 ),
        'native retry reconstructs all custom bits' );
    is( $backend{props}{editor},        'rte0', 'native retry retains selected RTE editor' );
    is( $backend{props}{opt_backdated}, 1,      'native retry retains backdating' );
    is( $backend{props}{adult_content},
        'concepts', 'native retry reverses adult form value correctly' );
    is( $backend{crosspost_entry},   1,     'native retry retains crosspost master' );
    is( $backend{crosspost}{41}{id}, 41,    'native retry retains selected crosspost account' );
    is( $backend{crosspost}{42},     undef, 'unselected account has no repeated native selection' );
};

subtest 'raw/preformatted and trusted/no-JavaScript variants keep their distinct retry state' =>
    sub {
    my $raw = DW::Entry::Legacy::formdata_from_legacy(
        canonical( props => { %{ canonical()->{props} }, used_rte => 0, opt_preformatted => 1 } ),
        legacy_post( event => "<strong>raw</strong>\nsecond" ) );
    is(
        value( $raw, 'event' ),
        "<strong>raw</strong>\nsecond",
        'raw body is not normalized by retry mapping'
    );
    is( value( $raw, 'editor' ),
        'html_raw0', 'preformatted canonical state selects native raw editor' );

    my $trusted = DW::Entry::Legacy::formdata_from_legacy(
        canonical(
            tz    => 'UTC',
            props => { %{ canonical()->{props} }, used_rte => 0, opt_preformatted => 0 }
        ),
        legacy_post( date_diff_nojs => 1 )
    );
    is( value( $trusted, 'editor' ),
        'html_casual1', 'ordinary legacy formatting selects native casual editor' );
    is_deeply( field_values( $trusted, 'trust_datetime' ),
        [], 'seed-timezone date remains untrusted without a changed-date signal' );
    is( value( $trusted, 'nojs' ), 1, 'legacy no-JavaScript date remains explicit on retry' );
    };

subtest 'mapping does not decode again or mutate a multivalue legacy submission' => sub {
    my $post = Hash::MultiValue->new(
        subject       => '',
        subject       => 'second subject',
        event         => 'body',
        date_ymd_mm   => '02',
        date_ymd_dd   => '03',
        date_ymd_yyyy => '2020',
        hour          => '04',
        min           => '05',
    );
    my $calls = 0;
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub { $calls++ };
    my $formdata =
        DW::Entry::Legacy::formdata_from_legacy( canonical( subject => "\0second subject" ),
        $post );
    is( $calls, 0, 'formdata mapping does not invoke the decoder or hook boundary again' );
    is(
        value( $formdata, 'subject' ),
        "\0second subject",
        'canonical subject is retained without a second decode'
    );
    is( value( $formdata, 'event' ),
        'body', 'legacy multivalue conversion retains ordinary event input' );
    is_deeply(
        [ $post->get_all('subject') ],
        [ '', 'second subject' ],
        'mapping does not mutate original multivalue input'
    );
};

done_testing;

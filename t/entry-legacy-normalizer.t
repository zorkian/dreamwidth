#!/usr/bin/perl
# Characterize canonical normalization of retained legacy entry-form submissions.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use Scalar::Util qw(refaddr);
use lib "$ENV{LJHOME}/cgi-bin";
use Hash::MultiValue;
use DW::Entry::Legacy;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

sub post {
    return {
        security      => 'public',
        subject       => 'Legacy subject',
        event         => 'Legacy body',
        date_ymd_mm   => '02',
        date_ymd_dd   => '03',
        date_ymd_yyyy => '2020',
        hour          => '04',
        min           => '05',
        @_,
    };
}

subtest 'normalization calls the decoder once and preserves hook identity and fields' => sub {
    my $original = \&DW::Entry::Legacy::decode_entry_form;
    my $calls    = 0;
    my @hook;
    local $LJ::HOOKS{decode_entry_form} = [
        sub {
            my ( $input, $req ) = @_;
            @hook = ( $input, $req );
            $req->{prop_hooked} = 'hooked property';
            $req->{hook_field}  = 'ordinary hook value';
        }
    ];
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub {
        $calls++;
        return $original->(@_);
    };

    my $input = post(
        prop_taglist          => 'first, second',
        prop_current_location => 'fixture location',
    );
    my $seed       = { tz => 'UTC', existing => 'seed field', props => { preserved => 'yes' } };
    my $normalized = DW::Entry::Legacy::normalize_entry_form( $seed, $input );

    is( $calls, 1, 'normalizer invokes the preserved decoder exactly once' );
    is( refaddr($normalized),    refaddr($seed),  'normalizer returns the original seed request' );
    is( refaddr( $hook[0] ),     refaddr($input), 'hook receives original post object' );
    is( refaddr( $hook[1] ),     refaddr($seed),  'hook receives original seed request' );
    is( $normalized->{existing}, 'seed field',    'ordinary seed field is retained' );
    is( $normalized->{hook_field}, 'ordinary hook value', 'ordinary hook field stays top-level' );
    is_deeply(
        $normalized->{props},
        {
            preserved            => 'yes',
            taglist              => 'first, second',
            current_location     => 'fixture location',
            hooked               => 'hooked property',
            current_moodid       => undef,
            current_mood         => undef,
            current_music        => undef,
            opt_screening        => undef,
            opt_noemail          => 0,
            opt_preformatted     => 0,
            opt_nocomments       => 0,
            picture_keyword      => undef,
            current_coords       => undef,
            adult_content        => '',
            adult_content_reason => '',
            opt_backdated        => 0,
            used_rte             => 0,
        },
        'every decoded property is canonicalized while hook-added properties survive'
    );
    ok( !grep( { /^prop_/ } keys %$normalized ), 'no decoded property remains top-level' );
};

subtest 'Hash::MultiValue conversion preserves BML NUL-joined repeated values' => sub {
    my $input = Hash::MultiValue->new(
        security      => 'public',
        subject       => '',
        subject       => 'second subject',
        event         => 'Legacy body',
        date_ymd_mm   => '02',
        date_ymd_dd   => '03',
        date_ymd_yyyy => '2020',
        hour          => '04',
        min           => '05',
        hook_value    => '',
        hook_value    => 'second value',
    );
    my $legacy = DW::Entry::Legacy::legacy_post_hash($input);
    isnt( refaddr($legacy), refaddr($input), 'conversion creates a separate legacy-shaped hash' );
    is(
        $legacy->{subject},
        "\0second subject",
        'empty first repeated subject retains its NUL separator'
    );
    is(
        $legacy->{hook_value},
        "\0second value",
        'repeated ordinary value uses BML scalar encoding'
    );
    is_deeply(
        [ $input->get_all('subject') ],
        [ '', 'second subject' ],
        'conversion does not mutate the multivalue input'
    );

    my @hook;
    local $LJ::HOOKS{decode_entry_form} = [
        sub {
            my ( $post, $req ) = @_;
            @hook = ( $post, $req );
            $req->{hook_seen_value} = $post->{hook_value};
        }
    ];
    my $normalized = DW::Entry::Legacy::normalize_entry_form( {}, $input );
    isnt( refaddr( $hook[0] ), refaddr($input), 'decoder hook receives the converted plain hash' );
    is( $hook[0]{hook_value}, "\0second value", 'hook observes the legacy repeated-value scalar' );
    is( $normalized->{hook_seen_value}, "\0second value", 'hook mutation preserves that scalar' );
};

subtest
    'seed date timezone survives trusted legacy dates and changes only when decoder trusts input'
    => sub {
    my $trusted = DW::Entry::Legacy::normalize_entry_form( { tz => 'UTC', year => 'old' }, post() );
    is( $trusted->{tz},   'UTC', 'trusted old date retains seed timezone' );
    is( $trusted->{year}, 'old', 'trusted old date retains seed protocol date' );

    my $changed =
        DW::Entry::Legacy::normalize_entry_form( { tz => 'UTC' }, post( date_diff => 1 ) );
    ok( !exists $changed->{tz}, 'changed legacy date removes seed timezone' );
    is_deeply( [ @{$changed}{qw(year mon day hour min)} ],
        [qw(2020 02 03 04 05)], 'changed legacy date keeps decoder protocol components' );

    my $nojs =
        DW::Entry::Legacy::normalize_entry_form( { tz => 'UTC' }, post( date_diff_nojs => 1 ) );
    ok( !exists $nojs->{tz}, 'no-JavaScript legacy date removes seed timezone' );
    };

subtest 'crosspost records retain selected and unselected legacy account credentials' => sub {
    my $normalized = DW::Entry::Legacy::normalize_entry_form(
        {},
        post(
            prop_xpost_check       => 1,
            prop_xpost_41          => 1,
            prop_xpost_password_41 => 'password 41',
            prop_xpost_chal_41     => 'challenge 41',
            prop_xpost_resp_41     => 'response 41',
            prop_xpost_password_42 => 'password 42',
            prop_xpost_chal_42     => 'challenge 42',
            prop_xpost_resp_42     => 'response 42',
        )
    );
    is( $normalized->{crosspost_entry}, 1, 'legacy crosspost master becomes canonical master' );
    is_deeply(
        $normalized->{crosspost},
        {
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
        'selected and unselected account callback data is retained'
    );

    my $disabled = DW::Entry::Legacy::normalize_entry_form( {},
        post( prop_xpost_check => 0, prop_xpost_41 => 1 ) );
    is( $disabled->{crosspost_entry}, 0, 'disabled legacy crosspost master remains disabled' );
    is( $disabled->{crosspost}{41}{id},
        41, 'disabled master does not discard submitted account state' );
};

done_testing;

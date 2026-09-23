#!/usr/bin/perl
# Characterize retaining the legacy decoder request beside canonical retry data.
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

sub form_values {
    my ( $form, $name ) = @_;
    return [ $form->get_all($name) ];
}

subtest 'preparation decodes once and keeps the success-hook request flat' => sub {
    my $original_decode = \&DW::Entry::Legacy::decode_entry_form;
    my $decode_calls    = 0;
    my @sequence;
    my @decode_hook;
    my @success_hook;

    local $LJ::HOOKS{decode_entry_form} = [
        sub {
            my ( $input, $request ) = @_;
            push @sequence, 'decode';
            @decode_hook = ( $input, $request );
            $request->{prop_hooked} = 'hook property';
            $request->{opaque_hook} = { unchanged => 'opaque value' };
        }
    ];
    local $LJ::HOOKS{after_entry_post_extra_html} = [
        sub {
            my %args = @_;
            push @sequence, 'success';
            @success_hook = ( $args{request}, $args{itemlink} );
            return 'extra html';
        }
    ];
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub {
        $decode_calls++;
        return $original_decode->(@_);
    };

    my $input = post(
        prop_current_location => 'flat location',
        prop_taglist          => 'first, second',
        prop_xpost_check      => 1,
        prop_xpost_41         => 1,
    );
    my $seed = {
        tz        => 'UTC',
        preserved => 'seed value',
        props     => { seeded => 'seed property' },
    };
    my $prepared = DW::Entry::Legacy::prepare_entry_form( $seed, $input );

    is( $decode_calls, 1, 'preparation invokes the decoder exactly once' );
    is( refaddr( $prepared->{request} ),
        refaddr($seed), 'prepared request is the decoder seed reference' );
    is( refaddr( $prepared->{post} ),
        refaddr($input), 'plain legacy input remains the hook input reference' );
    is( refaddr( $decode_hook[0] ), refaddr($input), 'decode hook receives original plain input' );
    is( refaddr( $decode_hook[1] ), refaddr($seed),  'decode hook receives original seed request' );

    is(
        $prepared->{request}{prop_current_location},
        'flat location',
        'success request retains flat decoder location property'
    );
    is(
        $prepared->{request}{prop_hooked},
        'hook property',
        'success request retains flat hook property'
    );
    is_deeply(
        $prepared->{request}{props},
        { seeded => 'seed property' },
        'canonicalization does not mutate seeded request properties'
    );
    is( $prepared->{request}{opaque_hook}{unchanged},
        'opaque value', 'success request preserves opaque hook data' );

    isnt( refaddr( $prepared->{canonical} ), refaddr($seed), 'canonical data is a separate hash' );
    isnt(
        refaddr( $prepared->{canonical}{props} ),
        refaddr( $seed->{props} ),
        'canonical properties are isolated from seeded request properties'
    );
    is_deeply(
        $prepared->{canonical}{props},
        {
            seeded               => 'seed property',
            current_location     => 'flat location',
            taglist              => 'first, second',
            hooked               => 'hook property',
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
        'canonical copy moves decoder and hook properties without losing seed properties'
    );
    ok(
        !exists $prepared->{canonical}{prop_current_location},
        'canonical copy removes flat decoder properties'
    );
    ok( !exists $prepared->{canonical}{prop_hooked},
        'canonical copy removes flat hook properties' );
    is( $prepared->{canonical}{opaque_hook}{unchanged},
        'opaque value', 'canonical copy preserves opaque hook fields' );

    my $formdata =
        DW::Entry::Legacy::formdata_from_legacy( $prepared->{canonical}, $prepared->{post} );
    is( $decode_calls, 1, 'retry mapper does not decode or invoke hooks again' );
    is_deeply( form_values( $formdata, 'current_location' ),
        ['flat location'], 'canonical copy maps to native retry fields' );

    is(
        LJ::Hooks::run_hook(
            'after_entry_post_extra_html',
            user     => 'fixture user',
            itemlink => '/entry/fixture/1.html',
            request  => $prepared->{request},
        ),
        'extra html',
        'success hook can consume the original decoder request'
    );
    is( refaddr( $success_hook[0] ),
        refaddr($seed), 'success hook receives the exact decoder request reference' );
    is(
        $success_hook[0]{prop_current_location},
        'flat location',
        'success hook sees the retained flat property'
    );
    is_deeply(
        \@sequence,
        [ 'decode', 'success' ],
        'decoder hook precedes success hook exactly once'
    );
};

subtest 'preparation keeps multivalue inputs unchanged while sharing one decoded post' => sub {
    my $input = Hash::MultiValue->new(
        security              => 'public',
        subject               => '',
        subject               => 'second subject',
        event                 => 'Legacy body',
        date_ymd_mm           => '02',
        date_ymd_dd           => '03',
        date_ymd_yyyy         => '2020',
        hour                  => '04',
        min                   => '05',
        prop_current_location => '',
        prop_current_location => 'second location',
        opaque_value          => '',
        opaque_value          => 'second opaque value',
    );
    my @hook;
    local $LJ::HOOKS{decode_entry_form} = [
        sub {
            my ( $legacy_post, $request ) = @_;
            @hook = ( $legacy_post, $request );
            $request->{hook_opaque} = $legacy_post->{opaque_value};
        }
    ];

    my $seed     = { props => { seeded => 'yes' } };
    my $prepared = DW::Entry::Legacy::prepare_entry_form( $seed, $input );

    isnt( refaddr( $prepared->{post} ),
        refaddr($input), 'multivalue boundary returns a separate legacy plain hash' );
    is(
        refaddr( $hook[0] ),
        refaddr( $prepared->{post} ),
        'decoder hook and preparation share the converted legacy plain hash'
    );
    is(
        $prepared->{post}{subject},
        "\0second subject",
        'empty first repeated subject retains BML NUL joining'
    );
    is(
        $prepared->{post}{opaque_value},
        "\0second opaque value",
        'opaque repeated field retains BML NUL joining'
    );
    is_deeply(
        [ $input->get_all('subject') ],
        [ '', 'second subject' ],
        'preparation does not mutate repeated subject input'
    );
    is_deeply(
        [ $input->get_all('prop_current_location') ],
        [ '', 'second location' ],
        'preparation does not mutate repeated property input'
    );
    is(
        $prepared->{request}{prop_current_location},
        "\0second location",
        'flat success request retains converted repeated property scalar'
    );
    is(
        $prepared->{canonical}{props}{current_location},
        "\0second location",
        'canonical copy retains converted repeated property scalar'
    );
    is(
        $prepared->{request}{hook_opaque},
        "\0second opaque value",
        'opaque hook value remains on the success request'
    );
};

subtest 'decode hook mutations have distinct raw and decoded-request propagation' => sub {
    for my $case (
        [
            plain => sub {
                return post(
                    prop_current_location => 'decoded before hook',
                    prop_taglist          => 'decoded tags',
                    date_diff             => 1,
                );
            },
        ],
        [
            multivalue => sub {
                return Hash::MultiValue->new(
                    security              => 'public',
                    subject               => 'Legacy subject',
                    event                 => 'Legacy body',
                    date_ymd_mm           => '02',
                    date_ymd_dd           => '03',
                    date_ymd_yyyy         => '2020',
                    hour                  => '04',
                    min                   => '05',
                    date_diff             => 1,
                    prop_current_location => 'decoded before hook',
                    prop_taglist          => 'decoded tags',
                );
            },
        ],
        )
    {
        my ( $label, $make_input ) = @$case;
        my $input = $make_input->();
        my $seed  = {
            tz          => 'UTC',
            top_changed => 'seed value',
            top_deleted => 'remove me',
            props       => { seeded => 'yes' },
        };
        my @seen;
        local $LJ::HOOKS{decode_entry_form} = [
            sub {
                my ( $raw, $request ) = @_;
                @seen = ( $raw, $request );

                # The decoder has already copied this property before the hook.
                # Raw changes are visible to later raw consumers only unless the
                # hook also changes the decoded request itself.
                $raw->{prop_current_location} = 'raw mutation after decode';
                $raw->{prop_raw_added}        = 'raw-only property';
                delete $raw->{prop_taglist};

                $request->{prop_current_location} = 'decoded request mutation';
                $request->{prop_hook_added}       = 'hook-added property';
                delete $request->{prop_taglist};
                $request->{top_changed} = 'hook top-level replacement';
                $request->{top_added}   = 'hook top-level addition';
                delete $request->{top_deleted};
            }
        ];

        my $prepared = DW::Entry::Legacy::prepare_entry_form( $seed, $input );
        my ( $raw, $request ) = @seen;

        is( refaddr($request), refaddr($seed), "$label hook receives the original flat request" );
        is( refaddr( $prepared->{request} ),
            refaddr($seed), "$label prepared success request remains the original flat reference" );
        is(
            $raw->{prop_current_location},
            'raw mutation after decode',
            "$label raw first argument retains its late mutation"
        );
        is(
            $raw->{prop_raw_added},
            'raw-only property',
            "$label raw first argument retains arbitrary added properties"
        );
        ok( !exists $raw->{prop_taglist}, "$label raw first argument retains its deletion" );

        is(
            $request->{prop_current_location},
            'decoded request mutation',
            "$label decoded request has its independent property mutation"
        );
        is(
            $request->{prop_hook_added},
            'hook-added property',
            "$label decoded request retains arbitrary added property"
        );
        ok( !exists $request->{prop_taglist},
            "$label decoded request retains its property deletion" );
        is(
            $request->{top_changed},
            'hook top-level replacement',
            "$label decoded request retains top-level replacement"
        );
        is(
            $request->{top_added},
            'hook top-level addition',
            "$label decoded request retains top-level addition"
        );
        ok( !exists $request->{top_deleted}, "$label decoded request retains top-level deletion" );
        ok( !exists $request->{tz}, "$label hook sees observed changed-date timezone deletion" );

        my $canonical = $prepared->{canonical};
        isnt( refaddr($canonical), refaddr($request), "$label canonical data is independent" );
        is(
            $canonical->{props}{current_location},
            'decoded request mutation',
            "$label canonicalization uses the decoded request, not raw mutation"
        );
        is(
            $canonical->{props}{hook_added},
            'hook-added property',
            "$label arbitrary decoded prop addition becomes canonical"
        );
        ok( !exists $canonical->{props}{taglist},
            "$label decoded prop deletion remains deleted canonically" );
        ok( !exists $canonical->{props}{raw_added},
            "$label raw-only property is not synchronized" );
        is(
            $canonical->{top_changed},
            'hook top-level replacement',
            "$label top-level replacement survives canonicalization"
        );
        is(
            $canonical->{top_added},
            'hook top-level addition',
            "$label top-level addition survives canonicalization"
        );
        ok( !exists $canonical->{top_deleted},
            "$label top-level deletion survives canonicalization" );
        ok( !exists $canonical->{tz},
            "$label canonical data preserves observed date timezone deletion" );

        if ( $label eq 'multivalue' ) {
            isnt( refaddr($raw), refaddr($input),
                'multivalue hook raw argument is legacy plain conversion' );
            is_deeply( [ $input->get_all('prop_current_location') ],
                ['decoded before hook'],
                'multivalue input remains unchanged by raw hook mutation' );
        }
        else {
            is( refaddr($raw), refaddr($input), 'plain input remains the raw hook argument' );
        }
    }
};

done_testing;

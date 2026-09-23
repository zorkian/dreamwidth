#!/usr/bin/perl
# Characterize pure propagation of retained decode-hook request deltas.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Scalar::Util qw(refaddr);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Entry::Legacy;

sub canonical {
    return {
        subject => 'native subject',
        event   => 'native body',
        tz      => 'guess',
        year    => undef,
        props   => {
            editor           => 'markdown0',
            opt_preformatted => 0,
            native_keep      => 'native value',
            current_location => 'before location',
            delete_me        => 'delete property',
        },
        top_keep     => 'native top-level',
        top_delete   => 'delete top-level',
        prop_xpost_9 => 'before xpost',
    };
}

subtest 'flat request additions changes and deletions update an independent canonical copy' => sub {
    my $source = canonical();
    my $before = {
        prop_current_location => 'before location',
        prop_delete_me        => 'delete property',
        prop_xpost_9          => 'before xpost',
        top_keep              => 'native top-level',
        top_delete            => 'delete top-level',
        unchanged             => 'unchanged value',
    };
    my $after = {
        prop_current_location => 'after location',
        prop_added            => 'hook property',
        prop_undef            => undef,
        prop_xpost_9          => 'after xpost',
        prop_xpost_10         => 'new xpost',
        top_keep              => 'hook replacement',
        top_added             => 'hook top-level',
        top_undef             => undef,
        unchanged             => 'unchanged value',
    };

    my $updated = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );

    isnt( refaddr($updated),            refaddr($source),            'canonical hash is copied' );
    isnt( refaddr( $updated->{props} ), refaddr( $source->{props} ), 'canonical props are copied' );
    is_deeply(
        $updated->{props},
        {
            editor           => 'markdown0',
            opt_preformatted => 0,
            native_keep      => 'native value',
            current_location => 'after location',
            added            => 'hook property',
            undef            => undef,
        },
        'changed added deleted and undef prop fields match decoded_to_canonical behavior'
    );
    is( $updated->{top_keep},  'hook replacement', 'top-level replacement propagates' );
    is( $updated->{top_added}, 'hook top-level',   'top-level addition propagates' );
    ok(
        exists $updated->{top_undef} && !defined $updated->{top_undef},
        'explicit undef is distinct from top-level deletion'
    );
    ok( !exists $updated->{top_delete}, 'top-level deletion propagates' );
    is( $updated->{prop_xpost_9},  'after xpost', 'prop_xpost change stays top-level' );
    is( $updated->{prop_xpost_10}, 'new xpost',   'prop_xpost addition stays top-level' );
    ok(
        !exists $updated->{props}{xpost_9} && !exists $updated->{props}{xpost_10},
        'prop_xpost namespace does not move into canonical props'
    );
    is( $updated->{tz}, 'guess', 'unchanged trusted-date timezone state remains intact' );
    is( $updated->{props}{editor}, 'markdown0', 'unchanged native editor remains intact' );
    is( $updated->{props}{opt_preformatted}, 0, 'unchanged native formatting remains intact' );

    is_deeply( $source, canonical(), 'source canonical data remains unchanged' );
    is_deeply(
        $before,
        {
            prop_current_location => 'before location',
            prop_delete_me        => 'delete property',
            prop_xpost_9          => 'before xpost',
            top_keep              => 'native top-level',
            top_delete            => 'delete top-level',
            unchanged             => 'unchanged value',
        },
        'before snapshot remains unchanged'
    );
    is_deeply( $after->{prop_added}, 'hook property', 'after snapshot remains unchanged' );
};

subtest 'reference replacements and repeated calls remain isolated' => sub {
    my $source = canonical();
    my $before =
        { extension => { value => 'before' }, prop_extension => { value => 'before prop' } };
    my $after = { extension => { value => 'after' }, prop_extension => { value => 'after prop' } };

    my $first = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is_deeply(
        $first->{extension},
        { value => 'after' },
        'arbitrary extension reference replacement propagates'
    );
    is_deeply(
        $first->{props}{extension},
        { value => 'after prop' },
        'arbitrary prop extension replacement canonicalizes'
    );
    $first->{props}{editor} = 'html_raw0';
    my $second = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is( $second->{props}{editor}, 'markdown0', 'repeated call does not share copied props state' );
    is( $source->{props}{editor},
        'markdown0', 'result mutation cannot affect source canonical state' );
};

done_testing;

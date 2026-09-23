#!/usr/bin/perl
# Characterize pure propagation of retained decode-hook request deltas.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Scalar::Util qw(refaddr);
use Storable qw(dclone);
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

subtest 'normalized property deltas preserve native props and prop namespace precedence' => sub {
    my $source = canonical();
    $source->{props}{x}               = 'old';
    $source->{props}{observed_delete} = 'old';
    my $before = { props => { x => 'old', observed_delete => 'old' } };
    my $after  = { props => { x => 'new' } };

    my $updated = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is( $updated->{props}{x}, 'new', 'changed observed property propagates' );
    ok( !exists $updated->{props}{observed_delete}, 'deleted observed property is removed' );
    is( $updated->{props}{editor}, 'markdown0', 'unobserved native editor survives props delta' );
    is( $updated->{props}{native_keep},
        'native value', 'unobserved native property survives props delta' );
    isnt(
        refaddr( $updated->{props} ),
        refaddr( $after->{props} ),
        'normalized property output is copied rather than aliased to after snapshot'
    );

    my $collision_source = canonical();
    $collision_source->{props}{x} = 'old';
    my $collision = DW::Entry::Legacy::apply_legacy_request_delta(
        $collision_source,
        { props => { x => 'old' }, prop_x => 'old' },
        { props => { x => 'new' }, prop_x => 'old' },
    );
    is( $collision->{props}{x}, 'old',
        'flat prop_x precedence is normalized before comparison even when its scalar is unchanged'
    );
    is( $collision->{props}{native_keep}, 'native value', 'collision keeps native-only property' );

    my $undef_props = DW::Entry::Legacy::apply_legacy_request_delta(
        canonical(),
        { props => { discarded => 'before' }, prop_only => 'before value' },
        { props => undef,                     prop_only => 'after value' },
    );
    is( $undef_props->{props}{only}, 'after value',
        'non-hash props still permits flat prop delta' );
    ok( !exists $undef_props->{props}{discarded}, 'non-hash props deletes observed property' );
    is( $undef_props->{props}{native_keep},
        'native value', 'non-hash props preserves native-only value' );
};

subtest 'deeply independent nested snapshots produce an isolated result' => sub {
    my $source = dclone(
        {
            extension => { value  => 'source' },
            props     => { editor => 'markdown0', extension => { value => 'source prop' } },
        }
    );
    my $before = dclone(
        {
            extension      => { value => 'before' },
            prop_extension => { value => 'before prop' },
        }
    );
    my $after = dclone(
        {
            extension      => { value => 'after' },
            prop_extension => { value => 'after prop' },
        }
    );
    my $source_before = dclone($source);
    my $before_before = dclone($before);
    my $after_before  = dclone($after);

    my $updated = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is_deeply( $updated->{extension}, { value => 'after' }, 'nested extension delta propagates' );
    is_deeply(
        $updated->{props}{extension},
        { value => 'after prop' },
        'nested prop delta canonicalizes'
    );
    $updated->{extension}{value} = 'changed result';
    $updated->{props}{extension}{value} = 'changed result prop';
    is_deeply( $source, $source_before, 'result nested mutation cannot alter canonical source' );
    is_deeply( $before, $before_before, 'result nested mutation cannot alter before snapshot' );
    is_deeply( $after,  $after_before,  'result nested mutation cannot alter after snapshot' );
};

subtest 'deep independent snapshots detect an in-place nested hook mutation' => sub {
    my $request = { extension => { value => 'before' } };
    my $before  = dclone($request);
    $request->{extension}{value} = 'after';
    my $after = dclone($request);

    my $updated = DW::Entry::Legacy::apply_legacy_request_delta(
        { extension => { value => 'source' }, props => {} },
        $before, $after );
    is_deeply(
        $updated->{extension},
        { value => 'after' },
        'a deep pre-hook snapshot makes an in-place nested mutation observable'
    );
};

subtest 'scalar arbitrary extension names and repeated calls remain isolated' => sub {
    my $source = canonical();
    my $before = { extension => 'before', prop_extension => 'before prop' };
    my $after  = { extension => 'after', prop_extension => 'after prop' };

    my $first = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is( $first->{extension},        'after',      'arbitrary scalar extension change propagates' );
    is( $first->{props}{extension}, 'after prop', 'arbitrary scalar prop extension canonicalizes' );

    my $same_content = DW::Entry::Legacy::apply_legacy_request_delta(
        { extension => 'native unchanged', props => {} },
        { extension => { alpha => 1, beta  => 2 } },
        { extension => { beta  => 2, alpha => 1 } },
    );
    is(
        $same_content->{extension},
        'native unchanged',
        'canonical snapshot serialization does not report reordered equal hashes as a delta'
    );

    $first->{props}{editor} = 'html_raw0';
    my $second = DW::Entry::Legacy::apply_legacy_request_delta( $source, $before, $after );
    is( $second->{props}{editor}, 'markdown0', 'repeated call does not share copied props state' );
    is( $source->{props}{editor},
        'markdown0', 'result mutation cannot affect source canonical state' );
};

done_testing;

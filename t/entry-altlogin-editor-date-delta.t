#!/usr/bin/perl
# Characterize pure generic hook-delta composition for native altlogin.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Hash::MultiValue;
use Storable qw(dclone);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Entry::Legacy;

sub canonical {
    return {
        event => 'native event',
        tz    => 'guess',
        year  => '2001',
        mon   => '02',
        day   => '03',
        hour  => '04',
        min   => '05',
        props => {
            editor           => 'markdown0',
            opt_preformatted => 0,
            used_rte         => 0,
            native_keep      => 'native value',
            extension        => { value => 'native' },
        },
    };
}

sub compose {
    my ( $base, $before, $after ) = @_;
    return DW::Entry::Legacy::compose_altlogin_hook_delta(
        canonical => $base,
        before    => $before,
        after     => $after,
    );
}

subtest 'direct event and date deltas affect attempt but never retry' => sub {
    for my $name (qw(event tz year mon day hour min)) {
        for my $mode (qw(add change delete undef)) {
            my $base = canonical();
            delete $base->{$name} if $mode eq 'add';
            my $before = $mode eq 'add' ? {} : { $name => "before-$name" };
            my $after =
                $mode eq 'delete'
                ? {}
                : { $name => $mode eq 'undef' ? undef : "after-$name" };
            my $result = compose( $base, $before, $after );
            if ( $mode eq 'delete' ) {
                ok( !exists $result->{canonical_for_attempt}{$name},
                    "$name deletion reaches attempt" );
            }
            elsif ( $mode eq 'undef' ) {
                ok(
                    exists $result->{canonical_for_attempt}{$name}
                        && !defined $result->{canonical_for_attempt}{$name},
                    "$name explicit undef reaches attempt"
                );
            }
            else {
                is( $result->{canonical_for_attempt}{$name},
                    "after-$name", "$name $mode reaches attempt" );
            }
            is_deeply( $result->{canonical_for_retry},
                $base, "$name $mode leaves retry canonical unchanged" );
        }
    }

    my $shape = compose(
        canonical(),
        { tz   => 'guess',        year => '2001' },
        { year => 'invalid-year', mon  => undef, day => 'partial-day', tz => 'invalid-tz' },
    );
    is_deeply(
        { map { $_ => $shape->{canonical_for_attempt}{$_} } qw(tz year mon day) },
        { tz => 'invalid-tz', year => 'invalid-year', mon => undef, day => 'partial-day' },
        'partial and invalid date values remain exact data with no composition repair'
    );
};

subtest 'date field combinations compose exact canonical hash shape' => sub {
    my $base = canonical();

    my $unobserved = compose( $base, { tz => 'guess' }, { tz => 'guess' } );
    is_deeply(
        { map { $_ => $unobserved->{canonical_for_attempt}{$_} } qw(tz year mon day hour min) },
        { tz => 'guess', year => '2001', mon => '02', day => '03', hour => '04', min => '05' },
        'tz guess with no observed date change leaves native canonical date fields untouched'
    );

    my $deleted_tz = compose(
        $base,
        { tz   => 'guess' },
        { year => '2099', mon => '12', day => '31', hour => '23', min => '59' },
    );
    ok( !exists $deleted_tz->{canonical_for_attempt}{tz}, 'deleted tz reaches attempt' );
    is_deeply(
        { map { $_ => $deleted_tz->{canonical_for_attempt}{$_} } qw(year mon day hour min) },
        { year => '2099', mon => '12', day => '31', hour => '23', min => '59' },
        'tz deletion plus all five explicit date fields reach attempt'
    );

    my $partial = compose( $base, {}, { day => 'only-day-observed' } );
    is( $partial->{canonical_for_attempt}{day},
        'only-day-observed', 'partial observed field reaches attempt' );
    is_deeply(
        { map { $_ => $partial->{canonical_for_attempt}{$_} } qw(tz year mon hour min) },
        { tz => 'guess', year => '2001', mon => '02', hour => '04', min => '05' },
'date fields absent from both snapshots are never observed and stay at native canonical values'
    );

    my $mixed = compose(
        $base,
        { tz => 'guess', year => '2001', mon => '02', day => '03' },
        { tz => undef,   mon  => undef,  day => 'mixed-day' },
    );
    ok(
        exists $mixed->{canonical_for_attempt}{tz} && !defined $mixed->{canonical_for_attempt}{tz},
        'mixed combo: tz explicit undef reaches attempt'
    );
    ok(
        !exists $mixed->{canonical_for_attempt}{year},
        'mixed combo: year deletion reaches attempt'
    );
    ok(
        exists $mixed->{canonical_for_attempt}{mon}
            && !defined $mixed->{canonical_for_attempt}{mon},
        'mixed combo: mon explicit undef reaches attempt'
    );
    is( $mixed->{canonical_for_attempt}{day},
        'mixed-day', 'mixed combo: day change reaches attempt' );
    is_deeply(
        { map { $_ => $mixed->{canonical_for_attempt}{$_} } qw(hour min) },
        { hour => '04', min => '05' },
        'mixed combo: unobserved date fields stay at native canonical values'
    );

    for my $result ( $unobserved, $deleted_tz, $partial, $mixed ) {
        is_deeply( $result->{canonical_for_retry},
            $base, 'date combination leaves retry canonical unchanged' );
    }
};

subtest 'editor delta conflict reports legacy-only effective property changes' => sub {
    my $base = canonical();
    my $none = compose( $base, { prop_opt_preformatted => 0 }, { prop_opt_preformatted => 0 } );
    ok( !defined $none->{editor_conflict}, 'unchanged legacy formatting has no conflict' );

    for my $case (
        [
            'change', { prop_opt_preformatted => 0 },
            { prop_opt_preformatted => 1 }, ['prop_opt_preformatted']
        ],
        [ 'delete', { prop_used_rte => 1 }, {}, ['prop_used_rte'] ],
        [ 'empty', { prop_used_rte => 1 }, { prop_used_rte => '' }, ['prop_used_rte'] ],
        [
            'zero', { prop_opt_preformatted => 1 },
            { prop_opt_preformatted => 0 }, ['prop_opt_preformatted']
        ],
        [ 'undef', { prop_used_rte => 1 }, { prop_used_rte => undef }, ['prop_used_rte'] ],
        )
    {
        my ( $label, $before, $after, $keys ) = @$case;
        my $result = compose( $base, $before, $after );
        is_deeply( $result->{editor_conflict}{keys},
            $keys, "$label legacy formatting change is surfaced" );
        is( $result->{canonical_for_attempt}{props}{editor},
            'markdown0', "$label does not invent an editor policy" );
    }

    my $explicit_editor = compose(
        $base,
        { prop_opt_preformatted => 0, prop_editor => 'markdown0' },
        { prop_opt_preformatted => 1, prop_editor => 'html_raw0' },
    );
    ok( !defined $explicit_editor->{editor_conflict},
        'explicit effective editor delta resolves conflict classification' );
    is( $explicit_editor->{canonical_for_attempt}{props}{editor},
        'html_raw0', 'generic delta retains explicit editor change' );

    my $nested = compose(
        $base,
        { props => { opt_preformatted => 0 }, prop_opt_preformatted => 0 },
        { props => { opt_preformatted => 1 }, prop_opt_preformatted => 0 },
    );
    ok(
        !defined $nested->{editor_conflict},
'flat prop precedence prevents a nested props-only formatting change from creating a false conflict'
    );

    my $combined = compose(
        $base,
        { prop_opt_preformatted => 0, prop_used_rte => 0 },
        { prop_opt_preformatted => 1, prop_used_rte => 1 },
    );
    is_deeply(
        $combined->{editor_conflict}{keys},
        [ 'prop_opt_preformatted', 'prop_used_rte' ],
        'combined legacy-format-only changes surface every changed key together'
    );
};

subtest 'editor and legacy format properties compose exact canonical property shape' => sub {
    my $base = canonical();
    for my $prop (qw(editor opt_preformatted used_rte)) {
        my $flat = "prop_$prop";
        for my $mode (qw(add change delete empty zero undef)) {
            my $before = $mode eq 'add' ? {} : { $flat => "before-$prop" };
            my $after =
                  $mode eq 'delete' ? {}
                : $mode eq 'empty' ? { $flat => '' }
                : $mode eq 'zero'  ? { $flat => 0 }
                : $mode eq 'undef' ? { $flat => undef }
                :                    { $flat => "after-$prop" };
            my $result = compose( $base, $before, $after );
            if ( $mode eq 'delete' ) {
                ok( !exists $result->{canonical_for_attempt}{props}{$prop},
                    "$prop $mode reaches attempt properties" );
            }
            elsif ( $mode eq 'undef' ) {
                ok(
                    exists $result->{canonical_for_attempt}{props}{$prop}
                        && !defined $result->{canonical_for_attempt}{props}{$prop},
                    "$prop $mode reaches attempt properties"
                );
            }
            elsif ( $mode eq 'empty' ) {
                is( $result->{canonical_for_attempt}{props}{$prop},
                    '', "$prop $mode reaches attempt properties" );
            }
            elsif ( $mode eq 'zero' ) {
                is( $result->{canonical_for_attempt}{props}{$prop},
                    0, "$prop $mode reaches attempt properties" );
            }
            else {
                is( $result->{canonical_for_attempt}{props}{$prop},
                    "after-$prop", "$prop $mode reaches attempt properties" );
            }
            is_deeply( $result->{canonical_for_retry},
                $base, "$prop $mode leaves retry canonical unchanged" );
        }
    }
};

subtest 'arbitrary extension deltas and all returned values are independent' => sub {
    my $base   = canonical();
    my $before = dclone(
        {
            extension      => { value => 'before' },
            prop_extension => { value => 'before prop' },
            prop_delete    => 'delete',
        }
    );
    my $after = dclone(
        {
            extension      => { value => 'after' },
            prop_extension => { value => 'after prop' },
            prop_added     => undef,
        }
    );
    my $base_before   = dclone($base);
    my $before_before = dclone($before);
    my $after_before  = dclone($after);
    my ( $decode, $hooks, $auth, $protocol, $render ) = ( 0, 0, 0, 0, 0 );
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub { ++$decode;   die 'decoder must not run'; };
    local *LJ::Hooks::run_hooks                 = sub { ++$hooks;    die 'hook must not run'; };
    local *LJ::auth_okay                        = sub { ++$auth;     die 'auth must not run'; };
    local *LJ::Protocol::do_request             = sub { ++$protocol; die 'protocol must not run'; };
    local *DW::Entry::Legacy::legacy_new_rerender = sub { ++$render; die 'renderer must not run'; };
    my $result = compose( $base, $before, $after );

    is_deeply(
        $result->{canonical_for_attempt}{extension},
        { value => 'after' },
        'arbitrary nested top-level extension delta is retained'
    );
    is_deeply(
        $result->{canonical_for_attempt}{props}{extension},
        { value => 'after prop' },
        'arbitrary nested property delta is retained'
    );
    ok(
        exists $result->{canonical_for_attempt}{props}{added}
            && !defined $result->{canonical_for_attempt}{props}{added},
        'arbitrary explicit undef property delta is retained'
    );
    ok( !exists $result->{canonical_for_attempt}{props}{delete},
        'arbitrary property deletion is retained' );
    is( $result->{canonical_for_attempt}{props}{native_keep},
        'native value', 'native-only property survives unrelated extension delta' );

    $result->{canonical_for_attempt}{extension}{value}      = 'attempt mutation';
    $result->{canonical_for_retry}{props}{extension}{value} = 'retry mutation';
    $result->{before_snapshot}{extension}{value}            = 'before snapshot mutation';
    $result->{after_snapshot}{extension}{value}             = 'after snapshot mutation';
    is_deeply( $base,   $base_before,   'canonical input remains independent' );
    is_deeply( $before, $before_before, 'before input remains independent' );
    is_deeply( $after,  $after_before,  'after input remains independent' );

    my $native_hmv = Hash::MultiValue->new( extension => 'native input' );
    is( $native_hmv->{extension}, 'native input', 'composition invokes no native post processing' );
    is( $decode,                  0,              'composition does not decode' );
    is( $hooks,                   0,              'composition does not invoke hooks' );
    is( $auth,                    0,              'composition does not authenticate' );
    is( $protocol,                0,              'composition does not call protocol' );
    is( $render,                  0,              'composition does not render' );

    # Cross-structure independence: the returned structures must not alias
    # each other even though attempt/retry both derive from the same canonical
    # input and before/after both derive from the same hook snapshots.
    my $second = compose( $base, $before, $after );
    $second->{canonical_for_attempt}{event}      = 'attempt-only mutation';
    $second->{canonical_for_retry}{event}        = 'retry-only mutation';
    $second->{before_snapshot}{extension}{value} = 'before-only mutation';
    $second->{after_snapshot}{extension}{value}  = 'after-only mutation';
    isnt(
        $second->{canonical_for_retry}{event},
        'attempt-only mutation',
        'attempt mutation cannot alter retry'
    );
    isnt(
        $second->{canonical_for_attempt}{event},
        'retry-only mutation',
        'retry mutation cannot alter attempt'
    );
    isnt(
        $second->{after_snapshot}{extension}{value},
        'before-only mutation',
        'before-snapshot mutation cannot alter after-snapshot'
    );
    isnt(
        $second->{before_snapshot}{extension}{value},
        'after-only mutation',
        'after-snapshot mutation cannot alter before-snapshot'
    );
};

subtest 'combined editor date event and extension deltas compose in one call' => sub {
    my $base   = canonical();
    my $before = {
        event                 => 'before event',
        tz                    => 'guess',
        year                  => '2001',
        prop_opt_preformatted => 0,
        extension             => { value => 'before' },
        prop_extension        => { value => 'before prop' },
    };
    my $after = {
        event                 => 'after event',
        tz                    => undef,
        year                  => '2099',
        mon                   => '12',
        prop_opt_preformatted => 1,
        prop_editor           => 'html_raw0',
        extension             => { value => 'after' },
        prop_extension        => { value => 'after prop' },
    };
    my $result = compose( $base, $before, $after );

    is( $result->{canonical_for_attempt}{event}, 'after event', 'combined event delta retained' );
    ok(
        exists $result->{canonical_for_attempt}{tz}
            && !defined $result->{canonical_for_attempt}{tz},
        'combined tz explicit undef retained'
    );
    is( $result->{canonical_for_attempt}{year}, '2099', 'combined year delta retained' );
    is( $result->{canonical_for_attempt}{mon},  '12',   'combined mon addition retained' );
    is( $result->{canonical_for_attempt}{day},
        '03', 'unobserved date field survives combined delta' );
    is( $result->{canonical_for_attempt}{props}{editor},
        'html_raw0', 'combined explicit editor delta retained' );
    ok( !defined $result->{editor_conflict},
        'explicit editor delta resolves conflict even amid other simultaneous deltas' );
    is_deeply(
        $result->{canonical_for_attempt}{extension},
        { value => 'after' },
        'combined arbitrary top-level extension delta retained'
    );
    is_deeply(
        $result->{canonical_for_attempt}{props}{extension},
        { value => 'after prop' },
        'combined arbitrary property extension delta retained'
    );
    is( $result->{canonical_for_attempt}{props}{native_keep},
        'native value', 'native-only property survives combined delta' );
    is_deeply( $result->{canonical_for_retry},
        $base, 'combined delta leaves retry canonical unchanged' );
};

done_testing;

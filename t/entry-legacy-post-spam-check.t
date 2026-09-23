#!/usr/bin/perl
# Characterize opt-in legacy post-attempt spam hook timing.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use Scalar::Util qw(refaddr);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Test qw(temp_user);

sub form_request {
    return {
        security        => 'public',
        props           => { editor => 'html_raw0' },
        crosspost_entry => 0,
        crosspost       => {},
    };
}

{
    my $poster = temp_user();
    my $flat_request =
        { subject => 'Failed legacy attempt', prop_current_location => 'Failed location' };
    my ( @events, @spam_args );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        push @events, 'save';
        return { errors => 'save failed' };
    };
    local *LJ::Hooks::run_hooks = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'spam_check' ) {
            push @events,    'spam';
            push @spam_args, \@args;
        }
        return ();
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $poster, journal => $poster },
        legacy_success => { poster => $poster, remote => $poster, request => $flat_request },
    );
    is( $result{errors}, 'save failed', 'failed legacy attempt returns its save error' );
    is_deeply( \@events, [qw(save spam)],
        'failed legacy attempt runs spam immediately after save attempt' );
    is( $spam_args[0][0]->id, $poster->id, 'failed legacy spam hook receives the poster' );
    is( refaddr( $spam_args[0][1] ),
        refaddr($flat_request),
        'failed legacy spam hook receives the explicit original flat request reference' );
    is( $spam_args[0][2], 'entry', 'failed legacy spam hook preserves entry type' );
}

{
    my $poster = temp_user();
    my $flat_request =
        { subject => 'Ordinary legacy attempt', prop_current_location => 'Ordinary location' };
    my ( @events, @spam_args );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        push @events, 'save';
        return { itemid => 1, anum => 1, url => '/entry/legacy/257.html' };
    };
    local *DW::Controller::Entry::_legacy_success_housekeeping =
        sub { push @events, 'housekeeping' };
    local *DW::Controller::Entry::_queue_crosspost = sub {
        push @events, 'crosspost';
        return ();
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *LJ::Hooks::run_hooks                  = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'spam_check' ) {
            push @events,    'spam';
            push @spam_args, \@args;
        }
        elsif ( $name eq 'after_entry_post_extra_options' ) {
            push @events, 'options';
        }
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        push @events, 'html' if $_[0] eq 'after_entry_post_extra_html';
        return;
    };
    local *DW::Template::render_template = sub {
        push @events, 'render';
        return 'rendered';
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $poster, journal => $poster },
        legacy_success => { poster => $poster, remote => $poster, request => $flat_request },
    );
    is( $result{status}, 'ok', 'ordinary legacy attempt succeeds' );
    is_deeply( \@events, [qw(save spam housekeeping crosspost options html render)],
        'ordinary legacy spam hook runs once after save and before housekeeping and success hooks'
    );
    is( scalar @spam_args, 1, 'ordinary legacy attempt runs exactly one post-attempt spam hook' );
    is( $spam_args[0][0]->id, $poster->id, 'ordinary legacy spam hook receives the poster' );
    is( refaddr( $spam_args[0][1] ),
        refaddr($flat_request),
        'ordinary legacy spam hook receives the explicit original flat request reference' );
}

{
    my $poster = temp_user();
    my $flat_request =
        { subject => 'Moderated legacy attempt', prop_current_location => 'Moderated location' };
    my ( @events, @spam_args );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        push @events, 'save';
        return { message => 'Queued for moderation' };
    };
    local *DW::Controller::Entry::_legacy_success_housekeeping =
        sub { push @events, 'housekeeping' };
    local *LJ::Hooks::run_hooks = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'spam_check' ) {
            push @events,    'spam';
            push @spam_args, \@args;
        }
        elsif ( $name eq 'after_entry_post_extra_options' ) {
            push @events, 'options';
        }
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        push @events, 'html' if $_[0] eq 'after_entry_post_extra_html';
        return;
    };
    local *DW::Template::render_template = sub {
        push @events, 'render';
        return 'rendered';
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $poster, journal => $poster },
        legacy_success => { poster => $poster, remote => $poster, request => $flat_request },
    );
    is( $result{status}, 'ok', 'moderated legacy attempt succeeds' );
    is_deeply(
        \@events,
        [qw(save spam housekeeping html render)],
        'moderated legacy spam hook runs once before housekeeping and moderated success hooks'
    );
    is( scalar @spam_args, 1, 'moderated legacy attempt runs exactly one post-attempt spam hook' );
    is( refaddr( $spam_args[0][1] ),
        refaddr($flat_request),
        'moderated legacy spam hook receives the explicit original flat request reference' );
}

{
    my $poster = temp_user();
    my @spam_calls;

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub { return { errors => 'native save failed' } };
    local *LJ::Hooks::run_hooks       = sub {
        push @spam_calls, [@_] if $_[0] eq 'spam_check';
        return ();
    };

    my %result = DW::Controller::Entry::_do_post( form_request(), {},
        { poster => $poster, journal => $poster } );
    is( $result{errors}, 'native save failed', 'native failed attempt returns its save error' );
    is_deeply( \@spam_calls, [],
        'native _do_post context invokes no legacy post-attempt spam hook' );
}

done_testing;

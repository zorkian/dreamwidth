#!/usr/bin/perl
# Characterize retained editjournal success seams without registering legacy routes.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request;
use lib "$ENV{LJHOME}/cgi-bin";
use DW::Request::Standard;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Test qw(temp_user);

{

    package LegacyEditFixture::Account;
    sub new { my $class = shift; return bless {@_}, $class }
    sub acctid      { return $_[0]->{acctid} }
    sub displayname { return $_[0]->{name} }
}

sub request_for {
    DW::Request->reset;
    my $request =
        DW::Request::Standard->new( HTTP::Request->new( GET => 'http://localhost/editjournal' ) );
    $request->header_in( Host => 'localhost' );
    return $request;
}

sub form_request {
    my (%opts) = @_;
    return {
        event           => exists $opts{event} ? $opts{event} : 'Saved event',
        security        => 'private',
        props           => { editor => 'html_raw0' },
        crosspost_entry => 0,
        crosspost       => {},
    };
}

sub invoke_edit {
    my ( $form, $auth, %opts ) = @_;
    my @scheduled;
    my $account = LegacyEditFixture::Account->new( acctid => 23, name => 'Legacy account' );
    no warnings 'redefine';
    local *DW::Entry::_save_editted_entry = sub {
        return $opts{save_result} || { url => '/entry/test/257' };
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *LJ::Protocol::schedule_xposts         = sub {
        my ( $user, $ditemid, $deleted, $callback ) = @_;
        my @callback = $callback->($account);
        push @scheduled, [ $user->id, $ditemid, $deleted, \@callback ];
        return ( [$account], [] );
    };
    my $request = request_for();
    my %result  = DW::Controller::Entry::_do_edit( 257, $form, $auth, %opts );
    return ( \%result, \@scheduled, $request->response_content );
}

{
    my $poster   = temp_user();
    my $remote   = temp_user();
    my $journal  = $remote;
    my $callback = DW::Controller::Entry::_legacy_crosspost_callback(
        {},
        {
            prop_xpost_23          => 'selected-from-get',
            prop_xpost_password_23 => 'password-from-get',
            prop_xpost_chal_23     => 'challenge-from-get',
            prop_xpost_resp_23     => 'response-from-get',
        }
    );
    my ( $result, $scheduled, $content ) = invoke_edit(
        form_request(),
        { poster => $poster, journal => $journal },
        legacy_edit => {
            remote              => $remote,
            crosspost_master    => 1,
            crosspost_callback  => $callback,
            editurl             => '/editjournal?itemid=257',
            entry_was_suspended => 1,
        },
    );
    is( $result->{status}, 'ok', 'legacy save succeeds through real success template' );
    is_deeply(
        $scheduled,
        [
            [
                $remote->id,
                257, 0,
                [
                    'selected-from-get',
                    {
                        password       => 'password-from-get',
                        auth_challenge => 'challenge-from-get',
                        auth_response  => 'response-from-get',
                    }
                ]
            ]
        ],
        'legacy edit uses its session remote, raw GET callback, and resolved non-delete item'
    );
    like(
        $content,
        qr/Please note that your entry is still suspended\./,
        'legacy suspended save renders the retained localized notice'
    );
    like( $content, qr/Legacy account/, 'legacy crosspost result is visibly rendered' );
    DW::Request->reset;
}

{
    my $user = temp_user();
    my @hooks;
    no warnings 'redefine';
    local *LJ::Hooks::run_hook = sub {
        my ($name) = @_;
        push @hooks, $name;
        return '<span id="legacy-delete-extra">legacy delete extra</span>'
            if $name eq 'entry_deleted_page_extras';
        return undef;
    };
    my ( $result, $scheduled, $content ) = invoke_edit(
        form_request( event => '' ),
        { poster => $user, journal => $user },
        legacy_edit => {
            remote             => $user,
            crosspost_master   => 1,
            crosspost_callback => sub { return ( 1, {} ) },
            editurl            => '/editjournal?itemid=257',
        },
    );
    is( $result->{status}, 'ok', 'legacy delete succeeds through real success template' );
    is_deeply(
        [ grep { $_ eq 'entry_deleted_page_extras' } @hooks ],
        ['entry_deleted_page_extras'],
        'legacy delete runs its extra-output hook exactly once'
    );
    like( $content, qr/legacy-delete-extra/, 'legacy delete extra is visibly rendered' );
    my $crosspost_at = index( $content, 'Legacy account' );
    my $extras_at    = index( $content, 'legacy-delete-extra' );
    my $links_at     = index( $content, 'successlinks' );
    ok(
        $crosspost_at >= 0 && $crosspost_at < $extras_at && $extras_at < $links_at,
        'legacy delete extra follows crosspost rows and precedes success links'
    );
    is_deeply(
        [ @{ $scheduled->[0] }[ 1, 2 ] ],
        [ 257, 1 ],
        'legacy delete schedules the resolved composite item as a deletion'
    );
    DW::Request->reset;
}

{
    my $user = temp_user();
    my @hooks;
    no warnings 'redefine';
    local *LJ::Hooks::run_hook = sub { push @hooks, $_[0]; return 'unexpected' };
    my ( $result, $scheduled ) = invoke_edit(
        form_request(),
        { poster => $user, journal => $user },
        save_result => { errors => 'save failed' },
        legacy_edit => {
            remote             => $user,
            crosspost_master   => 1,
            crosspost_callback => sub { return ( 1, {} ) },
        },
    );
    is( $result->{errors}, 'save failed', 'failed legacy edit returns the save error' );
    is_deeply( $scheduled, [], 'failed legacy edit does not schedule crossposts' );
    is_deeply( \@hooks,    [], 'failed legacy edit does not run success extras' );
}

{
    my $user = temp_user();
    my @hooks;
    no warnings 'redefine';
    local *LJ::Hooks::run_hook = sub { push @hooks, $_[0]; return 'unexpected' };
    my ( $result, $scheduled, $content ) =
        invoke_edit( form_request(), { poster => $user, journal => $user }, );
    is( $result->{status}, 'ok', 'native edit remains successful without legacy context' );
    is_deeply( $scheduled, [], 'native edit does not use legacy raw master scheduling' );
    is_deeply( \@hooks,    [], 'native edit invokes no legacy delete extra hook' );
    unlike( $content, qr/editedstillsuspended/,
        'native response has no retained legacy suspended notice key' );
    DW::Request->reset;
}

done_testing;

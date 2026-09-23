#!/usr/bin/perl
# Characterize legacy post-success housekeeping without external delivery.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Test qw(temp_user);

{

    package HousekeepingFixture::Account;

    sub new { my $class = shift; return bless {@_}, $class }
    sub acctid      { return $_[0]->{acctid} }
    sub displayname { return $_[0]->{name} }
}

sub fresh {
    return LJ::load_userid( $_[0]->id, 1 );
}

sub seed_sentinels {
    my ( $poster, $remote ) = @_;
    $poster->set_prop( 'disable_auto_formatting', 'sentinel' );
    $remote->set_prop( 'entry_draft',             'draft body' );
    $remote->set_prop( 'draft_properties',        'frozen properties' );
    $remote->set_prop( 'entry_editor',            'plain' );
    $remote->set_prop( 'last_fm_user',            'last fm sentinel' );
    $remote->displaydate_check(1);
}

sub form_request {
    return {
        security        => 'public',
        props           => { editor => 'html_raw0' },
        crosspost_entry => 0,
        crosspost       => {},
    };
}

sub invoke_post {
    my ( $form, $auth, $save_result, %opts ) = @_;
    my @queue_observations;
    my @render_observations;

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry              = sub { return $save_result };
    local *DW::Controller::Entry::_queue_crosspost = sub {
        push @queue_observations,
            {
            remote_draft => fresh( $auth->{poster} )->prop('entry_draft'),
            remote_props => fresh( $auth->{poster} )->prop('draft_properties'),
            };
        return ();
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *DW::Template::render_template         = sub {
        push @render_observations,
            {
            remote_draft => fresh( $auth->{poster} )->prop('entry_draft'),
            remote_props => fresh( $auth->{poster} )->prop('draft_properties'),
            };
        return 'rendered';
    };

    my %result = DW::Controller::Entry::_do_post( $form, {}, $auth, %opts );
    return ( \%result, \@queue_observations, \@render_observations );
}

{
    my $poster = temp_user();
    my $remote = temp_user();
    seed_sentinels( $poster, $remote );

    DW::Controller::Entry::_legacy_success_housekeeping(
        { poster => $poster, remote => $remote, event_format => 1, switched_rte_on => 1 }, {} );

    my $fresh_poster = fresh($poster);
    my $fresh_remote = fresh($remote);
    is( $fresh_poster->prop('disable_auto_formatting'),
        1, 'legacy helper updates the distinct poster formatting preference' );
    is( $fresh_remote->prop('entry_draft'), undef, 'legacy helper clears only remote draft body' );
    is(
        $fresh_remote->prop('draft_properties'),
        'frozen properties',
        'legacy helper preserves remote draft metadata'
    );
    is( $fresh_remote->prop('entry_editor'), 'rich', 'legacy helper sets remote rich editor' );
    is( $fresh_remote->prop('last_fm_user'), 'last fm sentinel', 'last fm is unchanged' );
    is( $fresh_remote->displaydate_check, 1, 'displaydate is unchanged' );

    $fresh_remote->set_prop( 'entry_editor', 'always_rich' );
    DW::Controller::Entry::_legacy_success_housekeeping(
        {
            poster          => $fresh_poster,
            remote          => $fresh_remote,
            event_format    => 0,
            switched_rte_on => 0
        },
        {}
    );
    is( 0 + ( fresh($poster)->prop('disable_auto_formatting') || 0 ),
        0, 'legacy helper records false formatting preference' );
    is( fresh($remote)->prop('entry_editor'),
        'always_rich', 'always editor preference is preserved' );
}

{
    my $poster = temp_user();
    my $remote = temp_user();
    seed_sentinels( $poster, $remote );
    my $form   = form_request();
    my $legacy = { poster => $poster, remote => $remote, event_format => 1, switched_rte_on => 1 };

    my ( $result, $queues, $renders ) = invoke_post(
        $form,
        { poster => $remote, journal => $remote },
        { errors => 'save failed' },
        legacy_success => $legacy,
    );
    is( $result->{errors}, 'save failed', 'failed canonical post returns save error' );
    is( fresh($poster)->prop('disable_auto_formatting'),
        'sentinel', 'failed canonical post does not change poster preference' );
    is( fresh($remote)->prop('entry_draft'),
        'draft body', 'failed canonical post does not clear remote draft body' );
    is(
        fresh($remote)->prop('draft_properties'),
        'frozen properties',
        'failed canonical post does not change remote draft metadata'
    );
    is( scalar @$queues,  0, 'failed canonical post does not queue crossposts' );
    is( scalar @$renders, 0, 'failed canonical post does not render success' );
}

{
    my $poster = temp_user();
    my $remote = temp_user();
    seed_sentinels( $poster, $remote );
    my $legacy = { poster => $poster, remote => $remote, event_format => 1, switched_rte_on => 1 };
    my ( $result, $queues, $renders ) = invoke_post(
        form_request(),
        { poster => $remote, journal => $remote },
        { itemid => 1, anum => 1, url => '/entry/test/257' },
        legacy_success => $legacy,
    );
    is( $result->{status}, 'ok', 'ordinary canonical post succeeds' );
    is( scalar @$queues,   1,    'ordinary result reaches crosspost queue seam' );
    is( $queues->[0]{remote_draft},
        undef, 'ordinary queue observes legacy draft cleanup before the result split' );
    is(
        $queues->[0]{remote_props},
        'frozen properties',
        'ordinary queue observes preserved legacy draft metadata'
    );
    is( fresh($poster)->prop('disable_auto_formatting'),
        1, 'ordinary canonical post invokes legacy preference housekeeping' );
    is( fresh($remote)->prop('entry_editor'),
        'rich', 'ordinary canonical post invokes legacy editor housekeeping' );
    is( scalar @$renders, 1, 'ordinary canonical post renders one success result' );
}

{
    my $poster = temp_user();
    my $remote = temp_user();
    seed_sentinels( $poster, $remote );
    my $legacy = { poster => $poster, remote => $remote, event_format => 0, switched_rte_on => 0 };
    my ( $result, $queues, $renders ) = invoke_post(
        form_request(),
        { poster  => $remote, journal => $remote },
        { message => 'queued for moderation' },
        legacy_success => $legacy,
    );
    is( $result->{status}, 'ok', 'moderated canonical post succeeds' );
    is( scalar @$queues,   0,    'moderated result does not schedule crossposts' );
    is( scalar @$renders,  1,    'moderated result renders one success result' );
    is( $renders->[0]{remote_draft},
        undef, 'moderated render observes legacy draft cleanup before the result split' );
    is(
        $renders->[0]{remote_props},
        'frozen properties',
        'moderated render observes preserved legacy draft metadata'
    );
    is( 0 + ( fresh($poster)->prop('disable_auto_formatting') || 0 ),
        0, 'moderated canonical post invokes legacy preference housekeeping' );
    is( fresh($remote)->prop('entry_editor'),
        'plain', 'moderated canonical post invokes legacy plain editor housekeeping' );
}

{
    my $user = temp_user();
    seed_sentinels( $user, $user );
    my ( $result, $queues, $renders ) = invoke_post(
        form_request(),
        { poster => $user, journal => $user },
        { itemid => 1, anum => 1, url => '/entry/test/257' },
    );
    is( $result->{status}, 'ok', 'native canonical post succeeds without legacy option' );
    is( fresh($user)->prop('entry_draft'),      undef, 'native default clears draft body' );
    is( fresh($user)->prop('draft_properties'), undef, 'native default clears draft metadata' );
}

{
    my $poster  = temp_user();
    my $remote  = temp_user();
    my $other   = temp_user();
    my $account = HousekeepingFixture::Account->new( acctid => 23, name => 'Test account' );
    my @scheduled;
    my $legacy_callback =
        DW::Controller::Entry::_legacy_crosspost_callback( { prop_xpost_23 => 'legacy-selection' },
        {} );
    my $form = form_request();
    my $legacy_master =
        DW::Controller::Entry::_legacy_crosspost_master( {}, { prop_xpost_check => 1 } );
    is( $legacy_master, 1, 'legacy master falls back to the raw GET checkbox value' );
    is( DW::Controller::Entry::_legacy_crosspost_master( {}, {} ),
        undef, 'legacy master leaves an absent checkbox undefined' );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        return { itemid => 1, anum => 1, url => '/entry/test/257' };
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *DW::Template::render_template         = sub { return 'rendered'; };
    local *LJ::Protocol::schedule_xposts = sub {
        my ( $scheduler_user, $ditemid, $deleted, $callback ) = @_;
        my @value = $callback->($account);
        push @scheduled, [ $scheduler_user->id, $ditemid, $deleted, \@value ];
        return ( [], [] );
    };

    my %result = DW::Controller::Entry::_do_post(
        $form,
        {},
        { poster => $poster, journal => $remote },
        legacy_success => {
            poster           => $poster,
            remote           => $remote,
            crosspost_master => $legacy_master,
        },
        legacy_crosspost_callback => $legacy_callback,
    );
    is( $result{status}, 'ok', 'legacy GET-only master post with the session journal succeeds' );
    is_deeply(
        \@scheduled,
        [
            [
                $remote->id,
                257, 0,
                [
                    'legacy-selection',
                    { password => undef, auth_challenge => undef, auth_response => undef }
                ]
            ]
        ],
        'legacy GET-only master schedules as the matching session remote, not the distinct poster'
    );

    @scheduled = ();
    %result    = DW::Controller::Entry::_do_post(
        $form,
        {},
        { poster => $poster, journal => $other },
        legacy_success => {
            poster           => $poster,
            remote           => $remote,
            crosspost_master => $legacy_master,
        },
        legacy_crosspost_callback => $legacy_callback,
    );
    is( $result{status}, 'ok', 'legacy GET-only master post to a distinct journal succeeds' );
    is_deeply( \@scheduled, [],
        'legacy distinct session remote and journal do not schedule crossposts' );

    %result = DW::Controller::Entry::_do_post(
        $form,
        {},
        { poster => $poster, journal => $poster },
        legacy_success            => { poster => $poster, crosspost_master => $legacy_master },
        legacy_crosspost_callback => $legacy_callback,
    );
    is( $result{status}, 'ok', 'legacy GET-only master post without a session remote succeeds' );
    is_deeply( \@scheduled, [], 'legacy absent session remote does not schedule crossposts' );

    %result = DW::Controller::Entry::_do_post(
        $form,
        {},
        { poster => $poster, journal => $remote },
        legacy_success => { poster => $poster, remote => $remote, crosspost_master => undef },
        legacy_crosspost_callback => $legacy_callback,
    );
    is( $result{status}, 'ok', 'legacy post without a raw master succeeds' );
    is_deeply( \@scheduled, [], 'legacy absent raw master does not schedule crossposts' );
}

{
    my $user     = temp_user();
    my $account  = HousekeepingFixture::Account->new( acctid => 23, name => 'Test account' );
    my $callback = DW::Controller::Entry::_legacy_crosspost_callback(
        {
            prop_xpost_23          => 'post-selected',
            prop_xpost_password_23 => 'post-password',
            prop_xpost_chal_23     => '',
            prop_xpost_resp_23     => 'post-response',
        },
        {
            prop_xpost_23          => 'get-selected',
            prop_xpost_password_23 => 'get-password',
            prop_xpost_chal_23     => 'get-challenge',
            prop_xpost_resp_23     => 'get-response',
        }
    );
    my ( $selected, $credentials ) = $callback->($account);
    is( $selected, 'post-selected', 'legacy callback keeps raw selected POST value' );
    my $post_credentials = $credentials;
    is_deeply(
        $post_credentials,
        {
            password       => 'post-password',
            auth_challenge => 'get-challenge',
            auth_response  => 'post-response'
        },
        'legacy callback uses POST values first and GET fallback per credential'
    );

    my $fallback = DW::Controller::Entry::_legacy_crosspost_callback(
        {},
        {
            prop_xpost_23          => 'get-selected',
            prop_xpost_password_23 => 'get-password',
            prop_xpost_chal_23     => 'get-challenge',
            prop_xpost_resp_23     => 'get-response',
        }
    );
    ( $selected, $credentials ) = $fallback->($account);
    is( $selected, 'get-selected', 'legacy callback falls back to raw GET selected value' );
    is_deeply(
        $credentials,
        {
            password       => 'get-password',
            auth_challenge => 'get-challenge',
            auth_response  => 'get-response'
        },
        'legacy callback falls back to GET credentials'
    );

    my $absent = DW::Controller::Entry::_legacy_crosspost_callback( {}, {} );
    ( $selected, $credentials ) = $absent->($account);
    is( $selected, undef, 'legacy callback leaves an absent account selection undefined' );
    is_deeply(
        $credentials,
        { password => undef, auth_challenge => undef, auth_response => undef },
        'legacy callback leaves absent credentials undefined'
    );

    my @scheduled;
    no warnings 'redefine';
    local *LJ::Protocol::schedule_xposts = sub {
        my ( $user, $ditemid, $deleted, $scheduler_callback ) = @_;
        my @value = $scheduler_callback->($account);
        push @scheduled, [ $user->id, $ditemid, $deleted, \@value ];
        return ( [], [] );
    };
    DW::Controller::Entry::_queue_crosspost(
        { crosspost_entry => 1, crosspost => {} },
        remote             => $user,
        journal            => $user,
        deleted            => 0,
        editurl            => '/entry/test/257/edit',
        ditemid            => 257,
        crosspost_callback => $callback,
    );
    is_deeply(
        \@scheduled,
        [ [ $user->id, 257, 0, [ 'post-selected', $post_credentials ] ] ],
        'queue seam invokes the explicit legacy raw callback unchanged'
    );
}

done_testing;

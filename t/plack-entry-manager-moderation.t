#!/usr/bin/perl
# Characterize native community-manager entry moderation (delete and
# delete-as-spam of another poster's entry) and the RTE poll-permission fix.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user temp_comm);

plan skip_all => 'Manager moderation integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub fresh_entry {
    my ( $journal, $ditemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $journal, ditemid => $ditemid );
}

sub cookie_for {
    my ($u) = @_;
    my $session = LJ::Session->create( $u, nolog => 1 );
    return
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
}

sub capture_warnings {
    my ($code) = @_;
    my @warnings;
    local $SIG{__WARN__} = sub { push @warnings, $_[0] };
    my $result = $code->();
    return ( \@warnings, $result );
}

sub maintainer_form {
    my ($content) = @_;
    return ( grep { $_->find_input('action:savemaintainer') }
            HTML::Form->parse( $content, 'http://localhost' ) )[0];
}

my $manager = temp_user();
$manager->update_self( { status => 'A' } );
my $poster = temp_user();
$poster->update_self( { status => 'A' } );
my $outsider = temp_user();
$outsider->update_self( { status => 'A' } );
my $member = temp_user();
$member->update_self( { status => 'A' } );
my $comm = temp_comm();
LJ::set_rel( $comm, $manager, 'A' );
LJ::set_rel( $comm, $member,  'P' );

my $manager_cookie  = cookie_for($manager);
my $outsider_cookie = cookie_for($outsider);
my $member_cookie   = cookie_for($member);
my $poster_cookie   = cookie_for($poster);
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'managerModeration';

test_psgi $app, sub {
    my $send = shift;

    my $as_manager = sub {
        my ($req) = @_;
        $req->header( Cookie => $manager_cookie );
        return $send->($req);
    };
    my $as_outsider = sub {
        my ($req) = @_;
        $req->header( Cookie => $outsider_cookie );
        return $send->($req);
    };
    my $as_member = sub {
        my ($req) = @_;
        $req->header( Cookie => $member_cookie );
        return $send->($req);
    };
    my $as_poster = sub {
        my ($req) = @_;
        $req->header( Cookie => $poster_cookie );
        return $send->($req);
    };

    # A valid CSRF token isn't tied to the page that issued it, only the
    # session, so a token lifted from an unrelated page still isolates the
    # authorization guards under test from the CSRF guard.
    my $valid_token_for = sub {
        my ($cb)   = @_;
        my $res    = $cb->( GET '/entry/new' );
        my ($form) = grep { $_->find_input('lj_form_auth') }
            HTML::Form->parse( $res->content, 'http://localhost' );
        return $form ? $form->value('lj_form_auth') : undef;
    };

    subtest 'manager deletes another poster entry through the maintainer form' => sub {
        my $entry = $poster->t_post_fake_comm_entry(
            $comm,
            subject => 'Manager delete target subject',
            body    => 'Manager delete target body',
        );
        my $url = '/entry/' . $comm->user . '/' . $entry->ditemid . '/edit';
        my $get = $as_manager->( GET $url );
        is( $get->code, 200, 'manager GET renders the maintainer form' );
        my $form = maintainer_form( $get->content );
        ok( $form, 'maintainer form parses' ) or BAIL_OUT('maintainer form missing');
        ok( $form->find_input('action:delete'), 'maintainer form carries a delete control' );
        ok( $form->find_input('action:deletespam'),
            'maintainer form carries a delete-as-spam control' );
        like(
            $get->content,
            qr/Are you sure you want to delete this entry\?/,
            'maintainer form renders the delete confirmation string'
        );

        # Fill in a maintainer-only property change without clicking
        # savemaintainer: if this leaked into the property-save path instead
        # of delete, the entry would survive with the field changed rather
        # than being removed outright.
        $form->value( 'prop_opt_nocomments_maintainer', 1 );
        $form->action( 'http://localhost' . $url );
        my ( $warnings, $res ) =
            capture_warnings( sub { $as_manager->( $form->click('action:delete') ) } );
        is( $res->code, 200,
            'manager delete POST returns the delete handler response, not a redirect' );
        ok( !$res->header('Location'),
            'manager delete response is not the savemaintainer redirect' );
        is_deeply( $warnings, [], 'manager delete produces no warnings' );
        my $deleted = fresh_entry( $comm, $entry->ditemid );
        ok( !$deleted->valid, 'forced-fresh read proves the entry is actually deleted' );
    };

    subtest 'manager deletes another poster entry as spam' => sub {
        my $entry = $poster->t_post_fake_comm_entry(
            $comm,
            subject => 'Manager spam target subject',
            body    => 'Manager spam target body',
        );
        my $url  = '/entry/' . $comm->user . '/' . $entry->ditemid . '/edit';
        my $get  = $as_manager->( GET $url );
        my $form = maintainer_form( $get->content );
        ok( $form, 'maintainer form parses for spam-delete case' )
            or BAIL_OUT('maintainer form missing');
        $form->action( 'http://localhost' . $url );
        my ( $warnings, $res ) =
            capture_warnings( sub { $as_manager->( $form->click('action:deletespam') ) } );
        is( $res->code, 200, 'manager delete-as-spam POST returns the delete handler response' );
        is_deeply( $warnings, [], 'manager delete-as-spam produces no warnings' );
        my $deleted = fresh_entry( $comm, $entry->ditemid );
        ok( !$deleted->valid,
            'forced-fresh read proves the entry is deleted after delete-as-spam' );

        my $dbh = LJ::get_db_writer();
        my ($count) = $dbh->selectrow_array(
            'SELECT COUNT(*) FROM spamreports WHERE journalid = ? AND posterid = ?',
            undef, $comm->userid, $poster->userid );
        ok( $count >= 1, 'delete-as-spam recorded a spamreports row for the deleted poster entry' );
    };

    subtest 'a non-manager cannot delete another poster entry' => sub {
        my $entry = $poster->t_post_fake_comm_entry(
            $comm,
            subject => 'Non-manager target subject',
            body    => 'Non-manager target body',
        );
        my $url = '/entry/' . $comm->user . '/' . $entry->ditemid . '/edit';
        my $get = $as_outsider->( GET $url );
        unlike(
            $get->content,
            qr/name=["']action:delete["']/,
            'non-manager GET does not receive any delete control'
        );
        ok(
            fresh_entry( $comm, $entry->ditemid )->valid,
            'non-manager GET leaves the entry intact'
        );

        my $res = $as_outsider->(
            POST $url, Content => [ 'action:delete' => 1, lj_form_auth => 'invalid' ]
        );
        my $still_there = fresh_entry( $comm, $entry->ditemid );
        ok( $still_there->valid,
            'a forged non-manager delete POST cannot remove another poster entry' );
        is(
            $still_there->event_raw,
            'Non-manager target body',
            'unauthorized attempt leaves the entry body unchanged'
        );

        # A valid CSRF token alone must not be enough: these cases isolate the
        # can_manage/editable_by/poster authorization guards themselves from
        # the CSRF guard exercised above.
        my $dbh        = LJ::get_db_writer();
        my $spam_count = sub {
            my ($count) = $dbh->selectrow_array(
                'SELECT COUNT(*) FROM spamreports WHERE journalid = ? AND posterid = ?',
                undef, $comm->userid, $poster->userid );
            return $count;
        };
        my $before_spam_count = $spam_count->();

        for my $case (
            [ 'outsider',           $as_outsider, $outsider_cookie ],
            [ 'non-manager member', $as_member,   $member_cookie ],
            )
        {
            my ( $label, $as, $cookie ) = @$case;
            my $token = $valid_token_for->($as);
            ok( $token, "$label has a real CSRF token to attempt with" );

            for my $action (qw(action:delete action:deletespam)) {
                my $post_res =
                    $as->( POST $url, Content => [ $action => 1, lj_form_auth => $token ] );
                my $after = fresh_entry( $comm, $entry->ditemid );
                ok( $after->valid,
                    "$label with a VALID token and $action still cannot delete another poster entry"
                );
                is(
                    $after->event_raw,
                    'Non-manager target body',
                    "$label with a VALID token and $action leaves the entry body unchanged"
                );
            }
        }
        is( $spam_count->(), $before_spam_count,
            'no non-manager attempt, with any token, recorded a spamreports row' );
    };

    subtest
        'a non-manager poster sending delete-as-spam on their own entry records no spam report' =>
        sub {
        my $own_entry = $poster->t_post_fake_comm_entry(
            $comm,
            subject => 'Poster own deletespam subject',
            body    => 'Poster own deletespam body',
        );
        my $url   = '/entry/' . $comm->user . '/' . $own_entry->ditemid . '/edit';
        my $token = $valid_token_for->($as_poster);
        ok( $token, 'poster has a real CSRF token' );

        my $dbh = LJ::get_db_writer();
        my ($before) = $dbh->selectrow_array(
            'SELECT COUNT(*) FROM spamreports WHERE journalid = ? AND posterid = ?',
            undef, $comm->userid, $poster->userid );
        $as_poster->( POST $url, Content => [ 'action:deletespam' => 1, lj_form_auth => $token ] );
        my ($after) = $dbh->selectrow_array(
            'SELECT COUNT(*) FROM spamreports WHERE journalid = ? AND posterid = ?',
            undef, $comm->userid, $poster->userid );
        is( $after, $before,
            'a poster sending deletespam on their own entry records no spamreports row' );
        };

    subtest 'a poster deleting their own community entry is unaffected' => sub {
        my $own_entry = $manager->t_post_fake_comm_entry(
            $comm,
            subject => 'Manager own entry subject',
            body    => 'Manager own entry body',
        );
        my $url = '/entry/' . $comm->user . '/' . $own_entry->ditemid . '/edit';
        my $get = $as_manager->( GET $url );
        is( $get->code, 200, 'poster GET on their own community entry renders the real editor' );
        unlike( $get->content, qr/entry-maintainer-form/,
            'own-entry edit is the ordinary editor, not the maintainer form' );
        my ($form) = grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $get->content, 'http://localhost' );
        ok( $form, 'ordinary edit form parses for the entry owner' )
            or BAIL_OUT('owned edit form missing');
        $form->action( 'http://localhost' . $url );
        my $res = $as_manager->( $form->click('action:delete') );
        is( $res->code, 200, 'own-entry delete via the ordinary editor still succeeds' );
        ok( !fresh_entry( $comm, $own_entry->ditemid )->valid,
            'own-entry delete via the ordinary editor still actually deletes' );
    };

    subtest 'CSRF denial for manager delete' => sub {
        my $entry = $poster->t_post_fake_comm_entry(
            $comm,
            subject => 'CSRF target subject',
            body    => 'CSRF target body',
        );
        my $url  = '/entry/' . $comm->user . '/' . $entry->ditemid . '/edit';
        my $get  = $as_manager->( GET $url );
        my $form = maintainer_form( $get->content );
        ok( $form, 'maintainer form parses for CSRF case' ) or BAIL_OUT('maintainer form missing');
        $form->value( 'lj_form_auth', 'deliberately-invalid-token' );
        $form->action( 'http://localhost' . $url );
        my $res = $as_manager->( $form->click('action:delete') );
        unlike( $res->content, qr/deleted|entry.*removed/i,
            'an invalid form-auth token does not perform a delete' );
        ok(
            fresh_entry( $comm, $entry->ditemid )->valid,
            'an invalid form-auth token leaves the entry intact'
        );

        $form = maintainer_form( $as_manager->( GET $url )->content );
        $form->value( 'lj_form_auth', '' );
        $form->action( 'http://localhost' . $url );
        $res = $as_manager->( $form->click('action:deletespam') );
        unlike( $res->content, qr/deleted|entry.*removed/i,
            'a missing form-auth token does not perform a delete-as-spam' );
        ok(
            fresh_entry( $comm, $entry->ditemid )->valid,
            'a missing form-auth token leaves the entry intact'
        );
    };
};

subtest 'rte_js_vars follows the remote capability, not a fixed default' => sub {
    like(
        LJ::rte_js_vars(),
        qr/var canmakepoll = true;/,
        'no remote at all keeps the existing permissive default'
    );
    is( $manager->can_create_polls ? 1 : 0,
        0, 'fixture confirms the ordinary test account genuinely lacks poll capability' );
    like(
        LJ::rte_js_vars($manager),
        qr/var canmakepoll = false;/,
        'a real remote lacking the poll capability now gets canmakepoll = false'
    );

    test_psgi $app, sub {
        my $send = shift;
        my $req  = GET '/entry/new';
        $req->header( Cookie => $manager_cookie );
        my $res = $send->($req);
        is( $res->code, 200, 'manager can load the native new-entry form' );
        like(
            $res->content,
            qr/var canmakepoll = false;/,
            q{the actual new-entry route now reflects the logged-in remote's poll capability}
        );
    };
};

done_testing;

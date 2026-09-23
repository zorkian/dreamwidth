#!/usr/bin/perl
# Security and CSRF regressions for the native inbox action RPCs:
# /__rpc_inbox_actions (DW::Controller::Inbox::action_handler) and
# /__rpc_esn_inbox (DW::Controller::RPC::MiscLegacy::esn_inbox_handler).
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use HTTP::Request::Common;
use Plack::Test;
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Event::AddedToCircle;
use LJ::JSON qw(from_json to_json);
use LJ::Session;
use LJ::Test qw(temp_user);

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub form_token {
    my ($content) = @_;
    return $1 if $content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
    return;
}

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'inboxActions';

my $u  = temp_user();
my $u2 = temp_user();
$_->update_self( { status => 'A' } ) for $u, $u2;
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

# Seed one real inbox item so action/view handling has something to act on.
# enqueue() returns an LJ::NotificationItem object, not a bare qid.
my $evt       = LJ::Event::AddedToCircle->new( $u2, $u, 2 );
my $inbox     = $u->notification_inbox;
my $seed_item = $inbox->enqueue( event => $evt );
my $qid       = $seed_item->qid;
ok( $qid, 'seeded a real inbox item for these tests' );

test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };

    my $index = $cb->( GET '/inbox/new' );
    is( $index->code, 200, 'inbox index renders' );
    my $token = form_token( $index->content );
    ok( $token, 'inbox index supplies a CSRF token' );

    # --- Item 1: action_handler validates view before any method dispatch,
    # and items_by_view no longer stringifies it into eval. ---

    # This is a syntactically valid injection under the removed
    # `eval "\$inbox->${view}_items"`: it would call a real method, then
    # execute arbitrary code, then comment out the appended "_items" text.
    # Under the fix it must never even reach that method-name lookup.
    $main::INBOX_VIEW_INJECTION_CANARY = 0;
    my $malicious_view = 'items; $main::INBOX_VIEW_INJECTION_CANARY = 1; #';

    my $res = $cb->(
        POST '/__rpc_inbox_actions',
        'Content-Type' => 'application/json',
        Content        => to_json(
            {
                action       => 'delete_all',
                view         => $malicious_view,
                page         => 1,
                itemid       => 0,
                lj_form_auth => $token,
            }
        ),
    );
    is( $res->code, 200, 'malicious view payload still returns HTTP 200' );
    is( $main::INBOX_VIEW_INJECTION_CANARY,
        0, 'malicious view payload never reaches string eval or executes injected code' );
    my $data = from_json( $res->content );
    ok( $data->{success}, 'malicious view payload safely falls back rather than erroring' );

    # A bogus view built only of word characters exercises the separate
    # LJ::NotificationInbox->can(...) gate, not the \W gate.
    $res = $cb->(
        POST '/__rpc_inbox_actions',
        'Content-Type' => 'application/json',
        Content        => to_json(
            {
                action       => 'delete_all',
                view         => 'nonexistentview',
                page         => 1,
                itemid       => 0,
                lj_form_auth => $token,
            }
        ),
    );
    is( $res->code, 200, 'bogus word-only view still returns HTTP 200' );
    $data = from_json( $res->content );
    ok( $data->{success}, 'bogus word-only view safely falls back rather than erroring' );

    # A real view still works after the fix.
    $res = $cb->(
        POST '/__rpc_inbox_actions',
        'Content-Type' => 'application/json',
        Content        => to_json(
            { action => 'expand', ids => $qid, view => 'circle', lj_form_auth => $token }
        ),
    );
    is( $res->code, 200, 'a real view continues to work after the fix' );
    $data = from_json( $res->content );
    ok( $data->{success}, 'a real view request still succeeds' );

    # --- Item 6: /__rpc_esn_inbox requires lj_form_auth for every mutating
    # mode, but not for the unauthenticated nav-count poll. ---

    my $esn_res = $cb->( POST '/__rpc_esn_inbox', Content => [ action => 'get_unread_items' ], );
    is( $esn_res->code, 200, 'get_unread_items returns HTTP 200 with no token' );
    my $esn_data = from_json( $esn_res->content );
    ok( !$esn_data->{error},              'get_unread_items succeeds unauthenticated' );
    ok( exists $esn_data->{unread_count}, 'get_unread_items reports an unread count' );

    for my $bad_token ( undef, 'invalid-token' ) {
        my @payload = ( action => 'mark_all_read', cur_folder => 'all' );
        push @payload, lj_form_auth => $bad_token if defined $bad_token;
        my $bad_res = $cb->( POST '/__rpc_esn_inbox', Content => \@payload );
        is( $bad_res->code, 200, 'mutating call without a valid token still returns HTTP 200' );
        my $bad_data = from_json( $bad_res->content );
        ok( $bad_data->{error}, 'mutating call without a valid token is rejected' );
    }

    # The item 1 tests above used delete_all and cleared the inbox; seed a
    # fresh item to verify the item 6 CSRF-gated mutation actually happens.
    $inbox->enqueue( event => LJ::Event::AddedToCircle->new( $u2, $u, 2 ) );
    is( $u->notification_inbox->unread_count,
        1, 'seeded item is unread before the authenticated mutating call' );

    my $good_res = $cb->(
        POST '/__rpc_esn_inbox',
        Content => [ action => 'mark_all_read', cur_folder => 'all', lj_form_auth => $token ],
    );
    is( $good_res->code, 200, 'mutating call with a valid token returns HTTP 200' );
    my $good_data = from_json( $good_res->content );
    ok( !$good_data->{error}, 'mutating call with a valid token is accepted' );
    is( $u->notification_inbox->unread_count,
        0, 'mutating call with a valid token actually performed the mutation' );
};

done_testing;

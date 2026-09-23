#!/usr/bin/perl
# Native inbox cutover: canonical routes resolve directly, retained old
# links redirect with their query args preserved, and the inbox beta gate
# is gone everywhere except the retained (still-unreachable) .bml page.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use File::Find;
use HTTP::Request::Common;
use Plack::Test;
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Event::AddedToCircle;
use LJ::Message;
use LJ::Session;
use LJ::Test qw(temp_user);

plan skip_all => 'Inbox cutover characterization requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub form_token {
    my ($content) = @_;
    return $1 if $content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
    return;
}

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'inboxCutover';

my $u  = temp_user();
my $u2 = temp_user();
$_->update_self( { status => 'A' } ) for $u, $u2;
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

my $evt       = LJ::Event::AddedToCircle->new( $u2, $u, 2 );
my $seed_item = $u->notification_inbox->enqueue( event => $evt );
my $qid       = $seed_item->qid;

test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };

    # --- Canonical native routes resolve directly for a logged-in user ---
    for my $path (qw(/inbox /inbox/ /inbox/index.bml)) {
        my $res = $cb->( GET $path );
        is( $res->code, 200, "$path resolves natively (not a redirect, not 404)" );
        ok( !$res->header('Location'), "$path is not a redirect" );
        like( $res->content, qr/id=["']inbox["']/, "$path renders the native inbox page" );
    }

    # singleentry filtering via query args continues to work at the
    # canonical URL, matching how JournalNewComment.pm links to it.
    my $single = $cb->( GET "/inbox/?view=singleentry&itemid=$qid" );
    is( $single->code, 200, '/inbox/?view=singleentry&itemid= resolves natively' );
    like( $single->content, qr/id=["']inbox["']/,
        'singleentry view renders the native inbox page' );

    for my $path (qw(/inbox/compose /inbox/compose.bml)) {
        my $res = $cb->( GET $path );
        is( $res->code, 200, "$path resolves natively" );
        ok( !$res->header('Location'), "$path is not a redirect" );
        my $token = form_token( $res->content );
        ok( $token, "$path renders a real compose form with a CSRF token" );
    }

    my $msg = LJ::Message->new(
        {
            journalid => $u2->id,
            otherid   => $u->id,
            msgid     => LJ::alloc_global_counter('M'),
            timesent  => time(),
            subject   => 'cutover fixture',
            body      => 'body',
        }
    );
    $msg->save_to_db or die 'unable to save cutover markspam fixture message';
    for my $path ( '/inbox/markspam', '/inbox/markspam.bml' ) {
        my $res = $cb->( GET "$path?msgid=" . $msg->msgid );
        is( $res->code, 200, "$path resolves natively" );
        ok( !$res->header('Location'), "$path is not a redirect" );
        like( $res->content, qr/msgid/, "$path renders the native markspam confirmation form" );
    }

    # --- POST with form auth works end to end at the canonical routes ---
    my $index_get   = $cb->( GET '/inbox' );
    my $index_token = form_token( $index_get->content );
    ok( $index_token, 'canonical /inbox supplies a CSRF token' );
    my $post_res = $cb->(
        POST '/inbox',
        Content => [ mark_read => 1, "check_$qid" => $qid, lj_form_auth => $index_token ],
    );
    is( $post_res->code, 200, 'POST to canonical /inbox with form auth succeeds' );
    ok( !$post_res->header('Location'), 'POST to canonical /inbox is not a redirect' );

    # --- Retained /inbox/new* links redirect to canonical URLs, keeping args ---
    for my $case (
        [ '/inbox/new?view=circle',                   qr{/inbox(?:\?|$)} ],
        [ '/inbox/new/compose?user=' . $u2->user,     qr{/inbox/compose(?:\?|$)} ],
        [ '/inbox/new/markspam?msgid=' . $msg->msgid, qr{/inbox/markspam(?:\?|$)} ],
        )
    {
        my ( $old_path, $expected ) = @$case;
        my $res = $cb->( GET $old_path );
        ok( $res->is_redirect, "$old_path redirects" );
        my $location = $res->header('Location') || '';
        like( $location, $expected, "$old_path redirects to its canonical URL" );
    }

    # Confirm the redirected-to query args are the actual submitted ones,
    # not merely present.
    my $view_redirect = $cb->( GET '/inbox/new?view=circle' );
    like( $view_redirect->header('Location') || '',
        qr/[?&]view=circle\b/,
        '/inbox/new?view=circle preserves the view argument across the redirect' );
    my $compose_redirect = $cb->( GET '/inbox/new/compose?user=' . $u2->user );
    like(
        $compose_redirect->header('Location') || '',
        qr/[?&]user=\Q@{[ $u2->user ]}\E\b/,
        '/inbox/new/compose?user= preserves the user argument across the redirect'
    );

    # --- Anonymous gets the login response, not the native page ---
    my $anon = $send->( GET '/inbox' );
    ok( $anon->is_redirect, 'anonymous /inbox is redirected rather than rendered' );
    like( $anon->header('Location') || '', qr{/login\b},
        'anonymous /inbox is redirected to login' );

    # --- The no-JS bookmark toggle link mutates via GET and is now the
    # primary route at cutover, so it must require its own CSRF token. ---
    # notification_inbox caches its bookmark set on the user object, so a
    # fresh reload is required to observe a mutation made by a separate
    # (server-side) user object in the same process.
    my $fresh_is_bookmark =
        sub { LJ::load_userid( $u->id, 1 )->notification_inbox->is_bookmark($qid) };

    my $before     = $fresh_is_bookmark->();
    my $bad_toggle = $cb->( GET "/inbox/?bookmark_off=$qid" );
    is( $bad_toggle->code, 200, 'bookmark toggle without a token still renders' );
    is( $fresh_is_bookmark->(), $before,
        'bookmark toggle without a token does not change bookmark state' );

    my $good_toggle =
        $cb->( GET "/inbox/?bookmark_off=$qid&lj_form_auth=" . LJ::eurl($index_token) );
    is( $good_toggle->code, 200, 'bookmark toggle with a valid token renders' );
    is( $fresh_is_bookmark->(), 1,
        'bookmark toggle with a valid token actually changes bookmark state' );
};

# --- No user_in_beta('inbox') check remains outside the retained .bml page ---
{
    my @offenders;
    my $inbox_bml = "$ENV{LJHOME}/htdocs/inbox/index.bml";
    find(
        {
            wanted => sub {
                return unless -f $_ && /\.(?:pm|pl|tt)$/;
                return if $_ eq $inbox_bml;
                open my $fh, '<', $_ or return;
                local $/;
                my $content = <$fh>;
                push @offenders, $File::Find::name
                    if $content =~ /user_in_beta\s*\(\s*\S+\s*(?:=>|,)\s*["']inbox["']/;
            },
            no_chdir => 1,
        },
        "$ENV{LJHOME}/cgi-bin",
        "$ENV{LJHOME}/views",
    );
    is_deeply( \@offenders, [],
        'no user_in_beta("inbox") check remains outside the retained .bml page' );
}

done_testing;

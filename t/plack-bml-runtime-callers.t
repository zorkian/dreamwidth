#!/usr/bin/perl
# Characterizes ordinary BML runtime callers converted to their DW::Request
# or native equivalents (BML graduation package W5). Confirms output is
# unchanged for callers the BML::* shim already served correctly under
# Plack, and confirms correct output for callers the shim never served
# correctly outside an actively-rendering .bml page.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use HTTP::Request::Common;
use Plack::Test;
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::RenameToken;
use DW::Request::Standard;
use LJ::Event::SecurityAttributeChanged;
use LJ::Hooks;
use LJ::Test qw(temp_user);

plan skip_all => 'BML runtime caller characterization requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

subtest 'LJ::User::redirect_rename uses DW::Request, not the no-op BML::redirect' => sub {
    my $u            = temp_user();
    my $fromusername = $u->user;
    my $tousername   = $fromusername . "_renameto";
    ok(
        $u->rename(
            $tousername,
            token    => DW::RenameToken->create_token( ownerid => $u->id ),
            redirect => 1
        ),
        'rename with redirect succeeds'
    );
    my $orig_u = LJ::load_user($fromusername);
    ok( $orig_u->is_redirect, 'original account is now a redirect stub' );

    DW::Request->reset;
    my $r = DW::Request::Standard->new( GET 'http://localhost/foo' );
    $r->header_in( Host => 'localhost' );

    my $status = $orig_u->redirect_rename('/bar');
    is( $status, $r->REDIRECT, 'redirect_rename returns a real redirect status' );
    is(
        $r->header_out('Location'),
        $orig_u->get_renamed_user->journal_base . '/bar',
        'redirect_rename sets Location to the renamed-to journal, plus the given URI'
    );
    DW::Request->reset;
};

subtest 'LJ::User::_logout_common no longer depends on BML::set_scheme' => sub {
    my $u = temp_user();
    $u->update_self( { status => 'A' } );
    my $session = LJ::Session->create( $u, nolog => 1 );
    my $sessid  = $session->id;
    ok( $session, 'session created' );

    DW::Request->reset;
    my $r = DW::Request::Standard->new( GET 'http://localhost/logout' );
    $r->header_in( Host => 'localhost' );

    ok( eval { $u->logout; 1 }, 'logout does not die without an active BML render' )
        or diag("logout died: $@");
    ok( !LJ::Session->instance( $u, $sessid ), 'session no longer resolves after logout' );
    DW::Request->reset;
};

subtest 'DW::User::Rename logs the real request IP via LJ::get_remote_ip' => sub {
    my $u = temp_user();

    DW::Request->reset;
    my $r = DW::Request::Standard->new( GET 'http://localhost/rename' );
    $r->header_in( Host => 'localhost' );

    my @captured;
    no warnings qw(redefine once);
    local *LJ::Event::SecurityAttributeChanged::new = sub {
        my ( $class, $u, $opts ) = @_;
        push @captured, $opts;
        return bless {}, $class;
    };
    local *LJ::Event::SecurityAttributeChanged::fire = sub { return 1; };

    ok(
        $u->rename(
            $u->user . "_renameto",
            token => DW::RenameToken->create_token( ownerid => $u->id ),
        ),
        'rename succeeds'
    );
    is( scalar @captured, 1, 'account_renamed notification fired exactly once' );
    is( $captured[0]->{ip},
        '127.0.0.100', 'notification carries the real request IP, not [unknown]' );
    DW::Request->reset;
};

subtest 'DW::Hooks::Changelog uses LJ::get_remote_ip, not the crash-prone BML::get_remote_ip' =>
    sub {
    local %LJ::CHANGELOG = (
        enabled         => 1,
        community       => 'changelog_test_comm',
        allowed_posters => ['changelog_test_poster'],
        allowed_ips     => ['127.0.0.100'],
    );

    DW::Request->reset;
    my $r = DW::Request::Standard->new( GET 'http://localhost/interface/xmlrpc' );
    $r->header_in( Host => 'localhost' );

    ok(
        eval {
            LJ::Hooks::run_hook(
                'post_noauth',
                {
                    usejournal => 'changelog_test_comm',
                    username   => 'changelog_test_poster',
                }
            );
            1;
        },
        'post_noauth hook does not die when called from a native request context'
    ) or diag("post_noauth died: $@");
    ok(
        LJ::Hooks::run_hook(
            'post_noauth',
            {
                usejournal => 'changelog_test_comm',
                username   => 'changelog_test_poster',
            }
        ),
        'post_noauth allows a post from an allowed IP, matched via the real request IP'
    );
    DW::Request->reset;
    };

subtest 'LJ::Sysban::block logs the ban and leaves the response to its caller' => sub {
    my @logged;
    no warnings 'redefine';
    local *LJ::statushistory_add = sub { push @logged, [@_]; return 1; };

    # no active request at all (e.g. mailgated.pl -> supportlib -> ...)
    DW::Request->reset;
    ok( eval { LJ::Sysban::block( 0, 'test block, no request', {} ); 1 },
        'block does not die with no active request' )
        or diag("block died: $@");
    is( scalar @logged, 1, 'block logs to statushistory with no active request' );

    # a native Plack-style request, as DW::Controller::Community/Create call it
    my $r = DW::Request::Standard->new( GET 'http://localhost/create' );
    $r->header_in( Host => 'localhost' );
    ok( eval { LJ::Sysban::block( 0, 'test block, with request', {} ); 1 },
        'block does not die with an active native request' )
        or diag("block died: $@");
    is( scalar @logged, 2, 'block logs to statushistory with an active native request' );
    DW::Request->reset;
};

subtest 'LJ::start_request resets BML cookie cache without a blanket eval' => sub {
    %BML::COOKIE_M       = ( leftover => ['stale'] );
    $BML::COOKIES_PARSED = 1;

    ok( eval { LJ::start_request(); 1 }, 'start_request does not die' )
        or diag("start_request died: $@");
    is_deeply( \%BML::COOKIE_M, {}, 'start_request clears the BML cookie cache' );
    is( $BML::COOKIES_PARSED, 0, 'start_request resets the BML cookies-parsed flag' );
};
done_testing;

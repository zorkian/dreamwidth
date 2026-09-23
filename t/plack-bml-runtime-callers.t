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
done_testing;

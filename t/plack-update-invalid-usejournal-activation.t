#!/usr/bin/perl
# Verify public native invalid-usejournal GET terminals retain update.bml behavior.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use Plack::Test;
use HTML::Form;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::External::Account;
use DW::Request;
use LJ::Hooks;
use LJ::Session;
use LJ::Test qw(temp_user);

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

my $original_remote   = \&LJ::get_remote;
my $original_hook     = \&LJ::Hooks::run_hook;
my $original_accounts = \&DW::External::Account::get_external_accounts;
my $original_init     = \&DW::Controller::Entry::_init;
my ( $remote_calls, $update_fields, $account_calls, $init_calls ) = (0) x 4;

{
    no warnings 'redefine';
    local *LJ::get_remote = sub {
        my ( undef, $file ) = caller;
        ++$remote_calls if $file =~ m!cgi-bin/DW/Controller/Entry\.pm$!;
        return $original_remote->(@_);
    };
    local *LJ::Hooks::run_hook = sub {
        ++$update_fields if $_[0] eq 'update_fields';
        return $original_hook->(@_);
    };
    local *DW::External::Account::get_external_accounts = sub {
        ++$account_calls;
        return $original_accounts->(@_);
    };
    local *DW::Controller::Entry::_init = sub {
        ++$init_calls;
        return $original_init->(@_);
    };

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ( $req, $authenticated ) = @_;
            $req->header( Cookie => $cookie ) if $authenticated;
            return $send->($req);
        };

        for my $case (
            [
'/update?usejournal=missing-invalid-user&encoded=one%2Ftwo&repeat=first&repeat=second',
                0
            ],
            [
'/update.bml?usejournal=missing-invalid-user&encoded=one%2Ftwo&repeat=first&repeat=second',
                1
            ],
            )
        {
            my ( $path, $authenticated ) = @$case;
            my $res = $request->( GET $path, $authenticated );
            is( $res->code,               200,   "$path preserves legacy HTTP 200" );
            is( $res->header('Location'), undef, "$path does not redirect" );
            like(
                $res->content,
                qr/<title>Post an Entry<\/title>/i,
                "$path preserves the update title"
            );
            like(
                $res->content,
                qr/Invalid usejournal argument\./,
                "$path preserves the exact invalid-usejournal message"
            );
            unlike( $res->content, qr/missing string/i, "$path has no missing translation" );
            unlike(
                $res->content,
                qr/id=['\"](?:updateForm|js-post-entry)['\"]/,
                "$path has no legacy or native form"
            );
        }

        is( $remote_calls,  0, 'invalid target does not look up a remote user' );
        is( $update_fields, 0, 'invalid target does not call update_fields' );
        is( $account_calls, 0, 'invalid target does not enumerate external accounts' );
        is( $init_calls,    0, 'invalid target does not initialize entry form state' );

        my $valid = $request->(
            GET '/update?usejournal='
                . $owner->user
                . '&encoded=one%2Ftwo&repeat=first&repeat=second',
            1
        );
        is( $valid->code, 200, 'valid journal target keeps the retained public form' );
        my ($form) =
            grep { ( $_->attr('id') || '' ) eq 'updateForm' && $_->find_input('usejournal') }
            HTML::Form->parse( $valid->content, 'http://localhost/update' );
        ok( $form, 'valid target keeps the retained parsed form' )
            or BAIL_OUT('retained valid-target form missing');
        is( $form->value('usejournal'), $owner->user, 'valid target remains selected' );
        is( $form->action, 'http://localhost/update',
            'valid target keeps the retained update action' );
    };
}

done_testing;

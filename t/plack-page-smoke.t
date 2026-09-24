#!/usr/bin/perl
#
# t/plack-page-smoke.t
#
# A table of real pages that historically leaked a broken BML macro
# (a literal "<?...?>" tag) or an unresolved translation key into their
# rendered output once the BML engine was removed: help_icon (a widget,
# a controller, and the shared subscribe_interface path) and the manage
# hub's relocated ml keys. LJ::error_list/warning_list render as part of
# every page's sitewide error bar, so any row here also covers their
# "<?errorbar?>"/"<?warningbar?>" regression class incidentally. A broken
# tag or missing-string banner on any row is the regression this file
# guards against, not a re-derivation of each fix's original assertions.
#
# Excluded from the missing-string check: tropo.footer.opensource (a
# pre-existing unresolved key in the site footer shared by every page)
# and profile.service.icq (a pre-existing unresolved IM-service label on
# the profile page) -- both predate and are unrelated to this migration.
#
# Authors:
#     Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use Plack::Test;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Session;
use LJ::Subscription::Pending;
use LJ::Test qw(temp_user);

plan skip_all => 'Page smoke requires a development server' unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

local $LJ::HELPURL{upic_keywords}     = 'http://example.com/help/upic_keywords';
local $LJ::HELPURL{notify_email_help} = 'http://example.com/help/notify_email';
no warnings 'redefine';
local *LJ::NotificationMethod::Email::help_url = sub { return 'notify_email_help'; };

my $u = temp_user();
$u->update_self( { status => 'A' } );
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

my $journal = temp_user();
$journal->update_self( { status => 'A' } );
LJ::Subscription::Pending->new(
    $u,
    journal => $journal,
    event   => 'JournalNewEntry',
    method  => 'Email',
    flags   => LJ::Subscription::TRACKING
)->commit;

my @pages = (
    { name => 'manage hub',     path => '/manage/' },
    { name => 'manage profile', path => '/manage/profile' },
    {
        name => 'tracking (subscribe_interface/help_icon)',
        path => '/manage/tracking/user?journal=' . $journal->user,
    },
    { name => 'console reference', path => '/admin/console/reference' },
);

test_psgi $app, sub {
    my $send = shift;

    for my $page (@pages) {
        my $req = GET $page->{path};
        $req->header( Cookie => $cookie );
        my $res = $send->($req);
        is( $res->code, 200, "$page->{name} ($page->{path}) renders" );
        unlike( $res->content, qr/<\?\w/, "$page->{name} has no broken BML macro tag" );
        ( my $content_scrubbed = $res->content ) =~
            s/\Q[missing string tropo.footer.opensource]\E//g;
        $content_scrubbed =~ s/\Q[missing string profile.service.icq]\E//g;
        unlike(
            $content_scrubbed,
            qr/\[missing string/,
            "$page->{name} has no unresolved translation key"
        );
    }
};

done_testing;

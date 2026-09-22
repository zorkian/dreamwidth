#!/usr/bin/perl
# Disposable credentials for the settings browser acceptance test.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin";
use JSON qw(encode_json);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_comm temp_user);

my $password = 'settings-browser-fixture';
my $user     = temp_user();
my $comm     = temp_comm();
$user->set_password($password);
$comm->set_password($password);
LJ::set_rel( $comm, $user, 'A' );
print encode_json({ user => $user->user, community => $comm->user, password => $password, community_type => $comm->journaltype, maintainer => LJ::check_rel( $comm, $user, 'A' ) ? 1 : 0 }) . "\n";
$| = 1;
<>;    # Keep LJ::Test fixtures alive until the browser closes stdin.

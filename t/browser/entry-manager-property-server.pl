#!/usr/bin/perl
# Test-only browser server for the callable manager-property POST adapter.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";
use DW::Controller::Entry;
use LJ::Test::LegacyOwnedEditRoute;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# GET retains BML solely as the source of the old manager form.  The only
# intercepted POST is the callable savemaintainer adapter; its undef result
# intentionally reaches retained BML.
my $original = $DW::Routing::string_choices{'app/editjournal'};
my $adapter  = {
    %$original,
    sub => sub { return DW::Controller::Entry::legacy_manager_property_post_handler(); },
};
$DW::Routing::string_choices{'app/editjournal'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($adapter);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

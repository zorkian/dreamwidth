#!/usr/bin/perl
# Test-only legacy update route for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Routing;
use LJ::Test::LegacyOwnedEditRoute;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# This short-lived browser server retains BML only to generate the old form.
# Its captured production handler still receives every POST and non-GET request.
my $production_update_route = $DW::Routing::string_choices{'app/update'};
$DW::Routing::string_choices{'app/update'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($production_update_route);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

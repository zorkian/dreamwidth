#!/usr/bin/perl
# Test-only retained GET plus callable anonymous update POST server.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Request;
use DW::Routing;
use LJ::Test::LegacyOwnedEditRoute;
use Plack::Middleware::DW::RequestWrapper;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $production = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $production eq 'CODE';
my $production_update = $DW::Routing::string_choices{'app/update'};

# Harvest the retained anonymous form only for GET. Every POST continues to the
# public production route, including the composed authenticated/anonymous handlers.
$DW::Routing::string_choices{'app/update'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($production_update);

Starman::Server->new->run( $production,
    { port => $port, host => '127.0.0.1', workers => 1, daemonize => 0 } );

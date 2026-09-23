#!/usr/bin/perl
# Isolated public application server for retained owned-edit browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

# app.psgi loads the registered EntryPicker composition.  This server does not
# test-only overlay renders retained BML for GET; POST uses the production dispatch.
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $production_editjournal_route = $DW::Routing::string_choices{'app/editjournal'};
$DW::Routing::string_choices{'app/editjournal'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($production_editjournal_route);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

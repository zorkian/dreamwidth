#!/usr/bin/perl
# Isolated browser server for public same-poster community edit dispatch.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $original = $DW::Routing::string_choices{'app/editjournal'};
# GET is retained solely to harvest its legacy form. POST remains the original
# registered public EntryPicker route and therefore exercises its real dispatch.
$DW::Routing::string_choices{'app/editjournal'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($original);
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

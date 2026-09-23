#!/usr/bin/perl
# Test-only server for the public anonymous update dispatcher.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $production = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $production eq 'CODE';
Starman::Server->new->run( $production,
    { port => $port, host => '127.0.0.1', workers => 1, daemonize => 0 } );

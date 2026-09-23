#!/usr/bin/perl
# Isolated server for public retained owned-edit GET browser coverage.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# app.psgi owns the public route composition under test; do not overlay it here.

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

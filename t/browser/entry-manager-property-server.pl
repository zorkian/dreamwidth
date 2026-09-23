#!/usr/bin/perl
# Isolated plain application server for public manager-property browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# Public EntryPicker activation owns the savemaintainer POST composition.
# Retained BML continues to own every manager GET and unsupported action.
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

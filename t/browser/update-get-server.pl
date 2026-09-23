#!/usr/bin/perl
# Test-only callable retained update GET endpoint for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Routing;
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
DW::Routing->register_string(
    '/__test_update_get', sub { return DW::Controller::Entry::legacy_update_get_handler() },
    app          => 1,
    no_redirects => 1
);
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

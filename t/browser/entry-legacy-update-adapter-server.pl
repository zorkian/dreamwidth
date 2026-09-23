#!/usr/bin/perl
# Test-only legacy update route for browser acceptance.
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

# This exists only in the dedicated browser server.  It intentionally accepts
# every method so retained GET and unsupported POSTs can return undef and fall
# through to the BML resolver exactly as they do before route registration.
DW::Routing->register_string(
    '/update',
    sub { return DW::Controller::Entry::legacy_update_handler(); },
    app          => 1,
    no_redirects => 1,
);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

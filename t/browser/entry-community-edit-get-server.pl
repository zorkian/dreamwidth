#!/usr/bin/perl
# Isolated server composing the callable retained community edit GET seam for browser tests.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Request;
use DW::Routing;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# Test-only composition: production keeps EntryPicker's BML GET fallthrough.
DW::Routing->register_string(
    '/editjournal',
    sub {
        my $r = DW::Request->get;
        return undef unless $r && $r->method eq 'GET';
        return DW::Controller::Entry::legacy_community_edit_get_handler();
    },
    app          => 1,
    no_redirects => 1,
);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

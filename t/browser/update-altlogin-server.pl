#!/usr/bin/perl
# Test-only callable alternate-login update GET endpoint.
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
DW::Routing->register_string(
    '/__test_update_altlogin',
    sub {
        my $r = DW::Request->get;
        my $x = DW::Controller::Entry::legacy_update_altlogin_get_handler();
        return $x if ref $x;
        if ( defined $x ) { $r->status(200) unless defined $r->status; return $r->res; }
        $r->status(299);
        $r->print('retained altlogin fallback');
        return $r->res;
    },
    app => 1
);
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

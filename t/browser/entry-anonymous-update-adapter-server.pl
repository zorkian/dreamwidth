#!/usr/bin/perl
# Test-only retained GET plus callable anonymous update POST server.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Controller::Entry;
use DW::Request;
use DW::Routing;
use LJ::Test::LegacyOwnedEditRoute;
use Plack::Middleware::DW::RequestWrapper;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $production = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $production eq 'CODE';
my $production_update = $DW::Routing::string_choices{'app/update'};
my $adapter_update    = {
    %$production_update,
    sub => sub {
        my $r        = DW::Request->get;
        my $rendered = DW::Controller::Entry::legacy_anonymous_update_handler();
        return $r->OK if defined $rendered;
        return $production_update->{sub}->(@_);
    },
};
$DW::Routing::string_choices{'app/update'} =
    LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($adapter_update);

Starman::Server->new->run( $production,
    { port => $port, host => '127.0.0.1', workers => 1, daemonize => 0 } );

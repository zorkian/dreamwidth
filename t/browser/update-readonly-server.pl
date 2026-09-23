#!/usr/bin/perl
# Test-only callable readonly update GET endpoint for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $readonly   = \&LJ::User::readonly;
my $legacy_get = \&DW::Controller::Entry::legacy_update_get_handler;
no warnings 'redefine';
*LJ::User::readonly = sub {
    return 1 if DW::Request->get && DW::Request->get->get_args->{readonly};
    return $readonly->(@_);
};
*DW::Controller::Entry::legacy_update_get_handler = sub {
    my $r = DW::Request->get;
    return DW::Controller::Entry::legacy_update_readonly_get_handler()
        if $r && $r->method eq 'GET' && $r->get_args->{readonly};
    return $legacy_get->(@_);
};
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

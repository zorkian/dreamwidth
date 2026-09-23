#!/usr/bin/perl
# Test-only callable authenticated share GET endpoint for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::External::Page;
use DW::Request;
use DW::Routing;
{

    package UpdateShareBrowser::Page;
    sub new { my ( $class, %args ) = @_; return bless \%args, $class; }
    sub title       { 'Browser shared title' }
    sub url         { 'https://example.invalid/browser-share' }
    sub description { 'Browser shared description' }
}
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
no warnings 'redefine';
*DW::External::Page::new = sub { return UpdateShareBrowser::Page->new; };
DW::Routing->register_string(
    '/__test_update_share',
    sub {
        my $r      = DW::Request->get;
        my $result = DW::Controller::Entry::legacy_update_share_get_handler();
        return $result if ref $result;
        if ( defined $result ) { $r->status(200) unless defined $r->status; return $r->res; }
        $r->status(299);
        $r->print('retained share fallback');
        return $r->res;
    },
    app => 1,
);
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

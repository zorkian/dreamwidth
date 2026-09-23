#!/usr/bin/perl
# Plain-app server for public authenticated update share GET browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::External::Page;
{

    package UpdateSharePublicBrowser::Page;
    sub new { my ( $class, %args ) = @_; return bless \%args, $class; }
    sub title       { 'Browser shared title' }
    sub url         { 'https://example.invalid/browser-share' }
    sub description { 'Browser shared description' }
}
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
no warnings 'redefine';
*DW::External::Page::new = sub { return UpdateSharePublicBrowser::Page->new; };
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

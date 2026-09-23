#!/usr/bin/perl
# Test-only public /update terminal-response server.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
my $identity = \&LJ::User::identity;
my $can_post = \&LJ::User::can_post;
no warnings 'redefine';
*LJ::User::identity = sub {
    return 1 if DW::Request->get && DW::Request->get->get_args->{identity};
    return $identity->(@_);
};
*LJ::User::can_post = sub {
    return 0 if DW::Request->get && DW::Request->get->get_args->{cantpost};
    return $can_post->(@_);
};
$LJ::MSG_NO_POST = q{Configured <a href="/no-post">cannot post</a>};
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

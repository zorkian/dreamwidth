#!/usr/bin/perl
# Test-only callable anonymous retained update GET endpoint for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use LJ::Lang;
use Plack::Middleware::DW::RequestWrapper;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $production = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $production eq 'CODE';

my $anonymous = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        LJ::Lang::set_request_context(
            getter => sub {
                my ( $lang, $key, undef, $args ) = @_;
                return 'Anonymous browser legacy title' if $key eq '/update.bml.title2';
                return LJ::Lang::get_text( $lang, $key, undef, $args );
            }
        );

        my $rendered = DW::Controller::Entry::legacy_update_anonymous_get_handler(
            action_url => '/__test/anonymous-update-submit',
            datetime   => '2026-09-23 04:05',
        );
        return $production->( $r->env ) unless defined $rendered;

        $r->status(200);
        return $r->res;
    }
);

my $app = sub {
    my ($env) = @_;
    return $anonymous->($env) if $env->{PATH_INFO} eq '/__test/anonymous-update';
    return $production->($env);
};

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

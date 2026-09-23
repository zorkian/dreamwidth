#!/usr/bin/perl
# Test-only callable alternate-login rerender endpoint.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Starman::Server;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Entry::Legacy;
use DW::FormErrors;
use DW::Request;
use DW::Routing;
my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;
DW::Routing->register_string(
    '/__test_altlogin_rerender',
    sub {
        my $r      = DW::Request->get;
        my $remote = LJ::get_remote() or die 'missing session remote';
        my $poster = $r->get_args->{user} || die 'missing display user';
        my $post   = {
            user                  => $poster,
            password              => 'server-only-secret',
            subject               => 'Browser alternate subject',
            event                 => 'Browser alternate body',
            security              => 'friends',
            prop_taglist          => 'browser-one, browser-two',
            prop_current_location => 'Browser location',
            prop_current_music    => 'Browser music',
            event_format          => 'preformatted',
            date_ymd_yyyy         => 'not-a-year',
            date_ymd_mm           => '02',
            date_ymd_dd           => '03',
            hour                  => '04',
            min                   => '05',
            prop_xpost_check      => 1,
        };
        my $prepared = DW::Entry::Legacy::prepare_entry_form( { tz => 'guess' }, $post );
        my $errors   = DW::FormErrors->new;
        $errors->add_string( undef, 'browser alternate-login retry marker' );
        DW::Controller::Entry::legacy_new_rerender(
            $prepared,
            remote             => $remote,
            errors             => $errors,
            legacy_altlogin    => { username => $poster },
            submit_action_name => 'action:update',
            action_url         => '/update?altlogin=1',
            suppress_crosspost => 1
        );
        $r->status(200);
        return $r->res;
    },
    app => 1
);
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

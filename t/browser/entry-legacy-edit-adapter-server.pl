#!/usr/bin/perl
# Test-only retained owned-edit adapter route for browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Starman::Server;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use DW::Routing;
use LJ::Entry;

my ($port) = @ARGV;
die "usage: $0 PORT\n" unless $port;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

# This route exists only in the dedicated browser server.  GETs and POSTs
# outside the ordinary owned save/delete subset deliberately fall through to
# the retained BML resolver.
DW::Routing->register_string(
    '/editjournal',
    sub {
        my $r = DW::Request->get;
        return undef unless $r->did_post;

        my $post = $r->post_args;
        return undef unless DW::Entry::Legacy::legacy_edit_action($post);

        my $remote  = LJ::get_remote;
        my $ditemid = $r->get_args->{itemid} || $post->{itemid} || 0;
        my $entry   = $remote && $ditemid ? LJ::Entry->new( $remote, ditemid => $ditemid ) : undef;
        return undef unless $entry && $entry->valid && $entry->poster->equals($remote);

        my $token   = LJ::check_form_auth( $post->{lj_form_auth} );
        my $referer = LJ::check_referer( undef, $r->header_in('Referer') );
        unless ( $token && $referer ) {
            $r->status(403);
            $r->print('adapter request rejected');
            return $r->OK;
        }

        my %result = DW::Controller::Entry::legacy_owned_edit_post(
            entry          => $entry,
            remote         => $remote,
            journal        => $remote,
            session_remote => $remote,
            post           => $post,
            get            => $r->get_args( preserve_case => 1 ),
            legacy_seed    => {
                mode       => 'editevent',
                ver        => $LJ::PROTOCOL_VER,
                user       => $remote->user,
                usejournal => undef,
                itemid     => $entry->jitemid,
                xpost      => '0',
            },
        );
        return $result{render} if exists $result{render};

        $r->status(400);
        return $r->print('adapter action fell through');
    },
    app          => 1,
    no_redirects => 1,
);

Starman::Server->new->run( $app, { port => $port, host => '127.0.0.1', workers => 1 } );

#!/usr/bin/perl
#
# Authors:
#      Mark Smith <mark@dreamwidth.org>
#      Afuna <coder.dw@afunamatata.com>
#
# Copyright (c) 2014 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

package DW::Controller::Admin::StatusCheck;

use strict;
use DW::Controller;
use DW::Routing;
use DW::Template;
use DW::Controller::Admin;
use IO::Socket::INET ();

=head1 NAME

DW::Controller::Admin::StatusCheck - Checks the status of various services

=cut

DW::Routing->register_string( "/admin/healthy", \&healthy_handler, format => 'plain' );
DW::Controller::Admin->register_admin_page(
    '/',
    path     => 'healthy',
    ml_scope => '/admin/healthy.tt',
);

# Returns some healthy-or-not statistics on the site.  Intended to be used by
# remote monitoring services and the like.  This is supposed to be very
# lightweight, not designed to replace Nagios monitoring in any way.
# Printing as plain text to avoid having to parse HTML cruft
sub healthy_handler {
    my ($opts) = @_;

    my ( $ok, $rv ) = controller( anonymous => 1 );
    return $rv unless $ok;

    my $r = $rv->{r};

    my ( @pass, @fail );

    # check 1) verify databases reachable
    my $dbh = LJ::get_db_writer();
    if ($dbh) {
        my $time = $dbh->selectrow_array('SELECT UNIX_TIMESTAMP()');
        if ( !$time || $dbh->err ) {
            push @fail, "global writer test query failed";
        }
        else {
            push @pass, "global writer";
        }
    }
    else {
        push @fail, "global writer unreachable";
    }

    # step 2) check all clusters
    foreach my $cid (@LJ::CLUSTERS) {
        my $dbcm = LJ::get_cluster_master($cid);
        if ($dbcm) {
            my $time = $dbcm->selectrow_array('SELECT UNIX_TIMESTAMP()');
            if ( !$time || $dbcm->err ) {
                push @fail, "cluster $cid writer test query failed";
            }
            else {
                push @pass, "cluster $cid writer";
            }
        }
        else {
            push @fail, "cluster $cid writer unreachable";
        }
    }

    # verify connectivity to all memcache machines
    foreach my $memc (@LJ::MEMCACHE_SERVERS) {
        my $sock = IO::Socket::INET->new( PeerAddr => $memc, Timeout => 1 );

        if ($sock) {
            push @pass, "memcache $memc";
        }
        else {
            push @fail, "memcache $memc";
        }
    }

    # check each mogilefs server
    foreach my $mog ( @{ $LJ::MOGILEFS_CONFIG{hosts} || [] } ) {
        my $sock = IO::Socket::INET->new( PeerAddr => $mog, Timeout => 1 );

        if ($sock) {
            push @pass, "mogilefsd $mog";
        }
        else {
            push @fail, "mogilefsd $mog";
        }
    }

    # check each gearman server
    foreach my $gm (@LJ::GEARMAN_SERVERS) {
        my $sock = IO::Socket::INET->new( PeerAddr => $gm, Timeout => 1 );

        if ($sock) {
            push @pass, "gearman $gm";
        }
        else {
            push @fail, "gearman $gm";
        }
    }

    # and each Perlbal
    foreach my $pb ( values %LJ::PERLBAL_SERVERS ) {
        my $sock = IO::Socket::INET->new( PeerAddr => $pb, Timeout => 1 );

        if ($sock) {
            push @pass, "perlbal $pb";
        }
        else {
            push @fail, "perlbal $pb";
        }
    }

    my $out = '';
    if (@fail) {
        $out = "status=fail\n\nfailures:\n";
        $out .= join( "\n", map { "  $_" } @fail ) . "\n";
    }
    else {
        $out = "status=ok\n";
    }

    if (@pass) {
        $out .= "\nokay:\n";
        $out .= join( "\n", map { "  $_" } @pass ) . "\n";
    }

    $r->print($out);
    return $r->OK;
}

1;

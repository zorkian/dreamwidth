#!/usr/bin/perl
#
# live-mutate.pl
#
# Toggle one marked journal field for offline fingerprint revocation checks.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use warnings;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

my $action = shift @ARGV // '';
die "Expected --mutate or --restore\n"
    unless !@ARGV && ($action eq '--mutate' || $action eq '--restore');
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3') or die "Missing marked journal\n";
die "Unmarked journal\n"
    unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && $u->{clusterid} == 1 && ($u->{journaltype} // '') eq 'P';
my $baseline = 'S2 slice 3 fixture';
my $variant = 'S2 slice 3 mutation probe';
my $current = $u->{name} // '';
die "Unexpected marked name; refusing mutation\n"
    unless $current eq $baseline || $current eq $variant;
my $expected = $action eq '--mutate' ? $variant : $baseline;
$u->update_self( { name => $expected } ) unless $current eq $expected;
die "Normal helper did not update marked name\n" unless ($u->{name} // '') eq $expected;
print "Marked journal name is " . ($action eq '--mutate' ? 'variant' : 'baseline') . "\n";

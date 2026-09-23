#!/usr/bin/perl
# Confirms that requiring ljlib.pl alone -- the ljlib-only / non-web process
# path (background jobs, workers): no app.psgi, no test-harness DW::BML
# import -- still installs the BML::* shims that LJ::Protocol::sendmessage's
# BML::set_language('en') call needs (the only remaining direct BML::* caller
# among LJ::Protocol/LJ::PageStats/LJ::Web; the latter two no longer call any
# BML::* symbol as of E2). LJ::Protocol's own 'use DW::BML;' is reached
# through an entirely separate chain (LJ::User -> ... -> LJ::Talk ->
# DW::EmailPost::Comment -> LJ::Protocol) than LJ::S2's former one, so this
# stays a meaningful regression guard rather than a symbol E2 made moot. Runs
# the require in an isolated perl subprocess so no transitive load from this
# test file's own imports can mask a regression in what ljlib.pl itself pulls
# in.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use File::Temp qw(tempfile);

my ( $probe_fh, $probe_file ) = tempfile( SUFFIX => '.pl', UNLINK => 1 );
print $probe_fh <<'PROBE';
BEGIN { $LJ::_T_CONFIG = 1; }
require "$ENV{LJHOME}/cgi-bin/ljlib.pl";
print "GET_REQUEST=",  ( defined &BML::get_request  ? 1 : 0 ), "\n";
print "SET_LANGUAGE=", ( defined &BML::set_language ? 1 : 0 ), "\n";
print "ML=",            ( defined &BML::ml           ? 1 : 0 ), "\n";
PROBE
close $probe_fh;

open( my $out_fh, '-|', $^X, $probe_file ) or die "can't run probe subprocess: $!";
my @lines = <$out_fh>;
close $out_fh;

is( $? >> 8, 0, 'probe subprocess exited cleanly after requiring ljlib.pl alone' )
    or diag( "probe output:\n", @lines );

my %got;
for (@lines) {
    $got{$1} = $2 if /^(\w+)=(\d)$/;
}

ok( $got{GET_REQUEST},  'BML::get_request is defined after require ljlib.pl alone' );
ok( $got{SET_LANGUAGE}, 'BML::set_language is defined after require ljlib.pl alone' );
ok( $got{ML},           'BML::ml is defined after require ljlib.pl alone' );

done_testing;

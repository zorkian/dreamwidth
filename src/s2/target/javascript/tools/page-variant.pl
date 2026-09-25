#!/usr/bin/perl
#
# page-variant.pl
#
# Temporarily edit the dedicated local sample to verify real Perl page variants.
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
use utf8;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use Encode ();
use LJ::Entry;
use LJ::Protocol;

my $mode = @ARGV && $ARGV[0] =~ /^--(?:restore-only|assert-variant|fail-after-edit|sleep-after-edit)$/
    ? shift @ARGV : '';
my $outdir = $mode eq '--restore-only' || $mode eq '--assert-variant'
    ? undef : shift @ARGV;
die "Expected output directory\n"
    if $mode ne '--restore-only' && $mode ne '--assert-variant' && !defined $outdir;
die "Expected one output directory\n" if @ARGV || (defined $outdir && !-d $outdir);
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $db = LJ::get_db_writer() or die "No local database writer\n";
die "Unexpected database scope\n" unless $db->selectrow_array('SELECT DATABASE()') eq 'dw_global';
my $u = LJ::load_user('s2js_slice2');
if (!$u && $mode eq '--restore-only') {
    print "No owned sample to restore before initial seed\n";
    exit 0;
}
die "Missing dedicated fixture account\n" unless $u;
die "Refusing unmarked account\n" unless ($u->bio(1) // '') eq 's2-js-slice2 fixture v1';
my @rows = LJ::get_log2_recent_user({
    userid => $u->userid, clusterid => $u->{clusterid}, itemshow => 20,
});
die "Expected exactly two owned entries\n" if $mode ne '--restore-only' && @rows != 2;
my $sample;
for my $row (@rows) {
    my $entry = LJ::Entry->new($u, jitemid => $row->{jitemid});
    $sample = $entry if Encode::decode_utf8($entry->subject_raw // '') eq 'Sample 1 & text';
}
if (!$sample && $mode eq '--restore-only') {
    print "No owned first sample to restore before seed repair\n";
    exit 0;
}
my $baseline = '<p>Fixture 1: café &amp; tea 😀</p>';
my $variant = '<p>Fixture 1 variant: café &amp; tea 😀</p>';
my $current = $sample && $sample->valid ? Encode::decode_utf8($sample->event_raw // '') : '';
die "Missing owned first sample\n" unless $sample && $sample->valid
    && ($current eq $baseline ||
        (($mode eq '--restore-only' || $mode eq '--assert-variant') && $current eq $variant))
    && $sample->security eq 'public'
    && $sample->eventtime_mysql eq '2026-09-24 11:00:00';

sub edit_body {
    my ($body) = @_;
    my %request = (
        mode => 'editevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice2',
        itemid => $sample->jitemid, event => $body, subject => 'Sample 1 & text',
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot edit owned sample: " . ($response{errmsg} // '') . "\n"
        unless ($response{success} // '') eq 'OK';
}

if ($mode eq '--restore-only') {
    edit_body($baseline) if $current eq $variant;
    print "Owned first sample verified at baseline\n";
    exit 0;
}
if ($mode eq '--assert-variant') {
    die "Expected owned variant after edit handshake\n" unless $current eq $variant;
    print "Owned first sample is the edited variant\n";
    exit 0;
}
my $error;
eval {
    edit_body($variant);
    die "Injected failure after owned edit\n" if $mode eq '--fail-after-edit';
    if ($mode eq '--sleep-after-edit') {
        open my $marker, '>:raw', "$outdir/variant-edited.marker"
            or die "Cannot write edit handshake marker: $!\n";
        print {$marker} "owned edit committed\n";
        close $marker or die "Cannot close edit handshake marker: $!\n";
        sleep 30;
    }
    my $exit = system($^X,
        "$ENV{LJHOME}/src/s2/target/javascript/tools/page-fixture.pl",
        $outdir, '--variant-read');
    die "Real Perl variant export failed: $exit\n" if $exit != 0;
    1;
} or $error = $@ || 'Unknown variant failure';
# Restore through the normal app edit helper even when the export fails.
eval { edit_body($baseline); 1 } or $error .= "Restore failed: " . ($@ || 'unknown');
die $error if $error;
print "Owned first sample restored after real Perl variant export\n";

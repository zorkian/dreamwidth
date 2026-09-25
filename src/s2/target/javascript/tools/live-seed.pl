#!/usr/bin/perl
#
# live-seed.pl
#
# Create and verify the marked local account for one live stock S2 page.
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
use Digest::SHA qw(sha256_hex);
use Encode ();
use LJ::Entry;
use LJ::Protocol;
use LJ::S2;

binmode STDOUT, ':encoding(UTF-8)';
binmode STDERR, ':encoding(UTF-8)';

die "Usage: perl tools/live-seed.pl [--other]\n"
    if @ARGV > 1 || (@ARGV && $ARGV[0] ne '--other');
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $db = LJ::get_db_writer() or die "No local database writer\n";
die "Unexpected database scope\n" unless $db->selectrow_array('SELECT DATABASE()') eq 'dw_global';

my $other = @ARGV ? 1 : 0;
my $username = $other ? 's2js_slice3_other' : 's2js_slice3';
my $display = $other ? 'S2 slice 3 other' : 'S2 slice 3 fixture';
my $marker = 's2-js-slice3 live dev v1';
my $u = LJ::load_user($username);
if ($u) {
    die "Refusing unmarked account collision\n" unless ($u->bio(1) // '') eq $marker;
    $u->update_self( { name => $display } ) unless ($u->{name} // '') eq $display;
}
else {
    $u = LJ::User->create_personal(
        user => $username, email => "$username\@example.invalid",
        password => 'S2-local-fixture-only', name => $display,
    ) or die "Cannot create dedicated account\n";
    $u->update_self( { status => 'A', statusvis => 'V', name => $display } );
    $u->set_bio($marker);
}
die "Marked account identity differs\n"
    unless ($u->bio(1) // '') eq $marker && ($u->{name} // '') eq $display
    && ($u->{status} // '') eq 'A' && ($u->{statusvis} // '') eq 'V'
    && ($u->{journaltype} // '') eq 'P' && $u->{clusterid} == 1
    && $u->{caps} == $LJ::NEWUSER_CAPS && $u->{dversion} == $LJ::MAX_DVERSION;

if (!$other) {
    my @names = ('core2', 'core2base/layout');
    my @files = ('styles/core2.s2', 'styles/core2base/layout.s2');
    my @hashes = (
        '8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6',
        'c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411',
    );
    my $public = LJ::S2::get_public_layers();
    my @layer_ids;
    for my $i (0 .. $#names) {
        my $id = $public->{ $names[$i] }{s2lid} or die "Missing stock layer $names[$i]\n";
        my $source = LJ::S2::load_layer_source($id);
        die "Installed stock source differs: $names[$i]\n"
            unless defined $source && sha256_hex($source) eq $hashes[$i];
        open my $fh, '<:raw', "$ENV{LJHOME}/$files[$i]" or die "Cannot read stock source\n";
        local $/;
        my $checkout_source = <$fh>;
        die "Checkout stock source differs: $files[$i]\n"
            unless sha256_hex($checkout_source) eq $hashes[$i];
        push @layer_ids, $id;
    }
    my $styleid = $u->prop('s2_style');
    my $style = $styleid ? LJ::S2::load_style($styleid) : undef;
    if ($style && ($style->{name} // '') eq $marker) {
        my $parts = LJ::S2::get_style_layers($u, $styleid, 1);
        die "Owned style has unexpected layer stack\n"
            unless $parts->{core} == $layer_ids[0] && $parts->{layout} == $layer_ids[1]
            && !grep { $_ ne 'core' && $_ ne 'layout' && $parts->{$_} } keys %$parts;
    }
    else {
        # create_personal assigns this stock wizard style before this script can
        # attach its own marked style. A retry may repair that same partial setup.
        my $cluster = LJ::get_cluster_def_reader($u) or die "No cluster reader\n";
        my $entry_count = $cluster->selectrow_array(
            'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $u->userid );
        die "Refusing unowned style or populated account\n"
            unless $style && ($style->{name} // '') eq 'wizard-ciel/indil'
            && defined $entry_count && $entry_count == 0;
        $styleid = LJ::S2::create_style($u, $marker) or die "Cannot create style\n";
        LJ::S2::set_style_layers($u, $styleid,
            core => $layer_ids[0], layout => $layer_ids[1]) or die "Cannot set stock layers\n";
        $u->set_prop( stylesys => 2 );
        $u->set_prop( s2_style => $styleid );
    }

    my @sample = (
        [ 'Live sample 1 café', '<p>Fixture 1: café &amp; tea 😀</p>', 11 ],
        [ 'Live sample 2 😀', '<p>Fixture 2: café &amp; tea 😀</p>', 12 ],
    );
    my @rows = LJ::get_log2_recent_user({
        userid => $u->userid, clusterid => $u->{clusterid}, itemshow => 200,
    });
    my %found;
    for my $row (@rows) {
        my $entry = LJ::Entry->new($u, jitemid => $row->{jitemid});
        die "Unexpected entry in marked cohort\n" unless $entry && $entry->valid;
        my $subject = Encode::decode_utf8($entry->subject_raw // '');
        my ($n) = $subject =~ /^Live sample ([12]) /;
        die "Unexpected entry in marked cohort\n" unless $n;
        die "Duplicate owned sample\n" if $found{$n}++;
        my $expected = $sample[$n - 1];
        my $body = Encode::decode_utf8($entry->event_raw // '');
        die "Owned sample content or policy differs\n"
            unless $subject eq $expected->[0] && $body eq $expected->[1]
            && $entry->security eq 'public'
            && $entry->eventtime_mysql eq sprintf('2026-09-24 %02d:00:00', $expected->[2])
            && ($entry->prop('editor') // '') eq 'html_raw0';
    }
    for my $n (1 .. 2) {
        next if $found{$n};
        my $expected = $sample[$n - 1];
        my %request = (
            mode => 'postevent', ver => $LJ::PROTOCOL_VER, user => $username,
            subject => $expected->[0], event => $expected->[1],
            security => 'public', prop_editor => 'html_raw0',
            year => 2026, mon => 9, day => 24, hour => $expected->[2], min => 0,
        );
        my %response;
        LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
        die "Cannot create owned sample $n: " . ($response{errmsg} // '') . "\n"
            unless ($response{success} // '') eq 'OK';
    }
    print "Marked stock journal ready: $username; style $styleid; two public html_raw0 posts\n";
}
else {
    print "Marked isolation account ready: $username\n";
}

my ($secret_hour) = LJ::get_secret();
die "Cannot prepare local hourly secret\n" unless $secret_hour;
print "Local existing secret hour available\n";

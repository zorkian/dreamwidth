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
use utf8;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use Encode ();

my $action = shift @ARGV // '';
die "Expected --mutate, --restore, --mutate-text or --restore-text\n"
    unless !@ARGV
    && $action =~ /^--(?:mutate|restore)(?:-text)?$/;
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3') or die "Missing marked journal\n";
die "Unmarked journal\n"
    unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && $u->{clusterid} == 1 && ($u->{journaltype} // '') eq 'P';
my $baseline = 'S2 slice 3 fixture';
my $variant = 'S2 slice 3 mutation probe';
if ($action =~ /-text$/) {
    my $name_variant = Encode::encode_utf8('S2 slice 3 café 😀');
    my $title_variant = Encode::encode_utf8('Journal café 😀');
    my $blob_variant = Encode::encode_utf8('<p>Custom café 😀</p>');
    my %fields = (
        name => [ $baseline, $name_variant ],
        journaltitle => [ '', $title_variant ],
        customtext_content => [ '', $blob_variant ],
    );
    for my $field (qw(name journaltitle customtext_content)) {
        my $current = $field eq 'name' ? ($u->{name} // '') : ($u->raw_prop($field) // '');
        die "Unexpected marked $field; refusing mutation\n"
            unless $current eq $fields{$field}[0] || $current eq $fields{$field}[1];
    }
    my $index = $action eq '--mutate-text' ? 1 : 0;
    my $name = $fields{name}[$index];
    $u->update_self( { name => $name } ) unless ($u->{name} // '') eq $name;
    for my $field (qw(journaltitle customtext_content)) {
        my $expected = $fields{$field}[$index];
        $u->set_prop($field => $expected)
            unless ($u->raw_prop($field) // '') eq $expected;
        die "Normal helper did not update marked $field\n"
            unless ($u->raw_prop($field) // '') eq $expected;
    }
    die "Normal helper did not update marked name\n" unless ($u->{name} // '') eq $name;
    print "Marked journal text is " . ($index ? 'variant' : 'baseline') . "\n";
    exit 0;
}
my $current = $u->{name} // '';
die "Unexpected marked name; refusing mutation\n"
    unless $current eq $baseline || $current eq $variant;
my $expected = $action eq '--mutate' ? $variant : $baseline;
$u->update_self( { name => $expected } ) unless $current eq $expected;
die "Normal helper did not update marked name\n" unless ($u->{name} // '') eq $expected;
print "Marked journal name is " . ($action eq '--mutate' ? 'variant' : 'baseline') . "\n";

#!/usr/bin/perl
# privacy-mutate.pl
#
# Offline, recoverable mutations of one marked local journal for privacy tests.
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
use File::Temp qw(tempfile);
use JSON::PP;

my ($action, $case) = @ARGV;
die "Expected --begin, --case NAME, --restore or --finish\n"
    unless defined $action && (($action eq '--case' && @ARGV == 2)
    || ($action =~ /^--(?:begin|restore|finish)$/ && @ARGV == 1));
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3') or die "Missing marked owner\n";
die "Unmarked owner\n" unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && $u->{clusterid} == 1 && $u->{journaltype} eq 'P';
my %cases = (
    suspended => [statusvis => 'S'], deleted => [statusvis => 'D'],
    locked => [statusvis => 'L'], unvalidated => [status => 'N'],
    reply_setting => [opt_whocanreply => 'friends'],
    adult_setting => [adult_content => 'explicit'],
    custom_blob => [customtext_content => '<p>PRIVACY_PROBE_PRIVATE_SETTING</p>'],
    analytics => [ga4_analytics => 'PRIVACY_PROBE_ANALYTICS'],
    legacy_style => [stylesys => '1'], missing_style => [s2_style => undef],
);
my %columns = map { $_ => 1 } qw(status statusvis opt_whocanreply);
my @fields = sort keys %{ {map { $_->[0] => 1 } values %cases} };
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
my $path = "$dir/privacy-state.json";
my $json = JSON::PP->new->canonical;
my $current = sub {
    my ($field) = @_;
    my $value = $columns{$field} ? $u->{$field} : $u->raw_prop($field);
    # preload_props represents absent properties as an empty string. The TS
    # primary snapshot separately requires actual NULL/absence before starting.
    return !$columns{$field} && defined $value && $value eq '' ? undef : $value;
};
my $equal = sub {
    my ($a, $b) = @_;
    return !defined $a && !defined $b || defined $a && defined $b && "$a" eq "$b";
};
my $save = sub {
    my ($state) = @_;
    my ($fh, $temp) = tempfile('.privacy-state-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temp or die "Cannot restrict recovery state\n";
    print {$fh} $json->encode($state) or die "Cannot save recovery state\n";
    close $fh or die "Cannot close recovery state\n";
    rename $temp, $path or die "Cannot publish recovery state\n";
};
if ($action eq '--begin') {
    die "Recovery state exists; restore and finish it before starting\n" if -e $path || -l $path;
    die "Expected visible active baseline\n" unless $u->{statusvis} eq 'V' && $u->{status} eq 'A'
        && $u->{opt_whocanreply} eq 'all';
    my %baseline = map { $_ => $current->($_) } @fields;
    my $input = do { local $/; <STDIN> };
    die "Missing bounded primary baseline\n" unless defined $input && length($input) <= 4096;
    my $primary = $json->decode($input);
    die "Primary baseline differs\n" unless ref $primary eq 'HASH'
        && ($primary->{userid} // 0) == $u->userid
        && ($primary->{fingerprint} // '') =~ /^[0-9a-f]{64}$/
        && $json->encode($primary->{fields}) eq $json->encode(\%baseline);
    die "Unexpected baseline properties\n" unless ($baseline{stylesys} // '') eq '2'
        && ($baseline{s2_style} // '') =~ /^[1-9][0-9]*$/
        && !defined $baseline{customtext_content} && !defined $baseline{ga4_analytics}
        && (!defined $baseline{adult_content} || $baseline{adult_content} eq 'none');
    $save->({userid => 0 + $u->userid, baseline => \%baseline,
        fingerprint => $primary->{fingerprint}, active => undef});
    print "Marked privacy baseline recorded\n";
    exit 0;
}
die "Missing or unsafe recovery state\n" if !-f $path || -l $path
    || (stat($path))[7] > 8192 || ((stat($path))[2] & 0077);
open my $fh, '<:raw', $path or die "Cannot read recovery state\n";
my $state = do { local $/; $json->decode(<$fh>) };
close $fh;
die "Recovery identity differs\n" unless ref $state eq 'HASH' && $state->{userid} == $u->userid
    && ($state->{fingerprint} // '') =~ /^[0-9a-f]{64}$/
    && ref $state->{baseline} eq 'HASH'
    && join(',', sort keys %{$state->{baseline}}) eq join(',', @fields);
my $active = $state->{active};
die "Unknown saved case\n" if defined $active && !exists $cases{$active};
for my $field (@fields) {
    my $value = $current->($field);
    my $baseline = $state->{baseline}{$field};
    next if $equal->($value, $baseline);
    next if defined $active && $cases{$active}[0] eq $field
        && $equal->($value, $cases{$active}[1]);
    die "Unexpected external field change; refusing overwrite\n";
}
my $set = sub {
    my ($field, $value) = @_;
    # update_self is the normal field/cache helper. Exercise raw visibility
    # states without account cancellation/deletion hooks or audit-date changes.
    my $ok = $columns{$field} ? $u->update_self({$field => $value}) : $u->set_prop($field => $value);
    die "Normal helper update failed\n" unless $ok;
    die "Normal helper value differs\n" unless $equal->($current->($field), $value);
};
if ($action eq '--case') {
    die "Unknown case or outstanding mutation\n" unless exists $cases{$case} && !defined $active;
    $state->{active} = $case;
    $save->($state); # write intent before mutation, so a killed run can recover
    $set->(@{$cases{$case}});
    print "Marked privacy case applied: $case\n";
}
elsif ($action eq '--restore') {
    if (defined $active) {
        my $field = $cases{$active}[0];
        $set->($field, $state->{baseline}{$field});
        $state->{active} = undef;
        $save->($state);
    }
    print "Marked privacy baseline restored\n";
}
else {
    die "Restore active mutation before finishing\n" if defined $active;
    unlink $path or die "Cannot remove completed recovery state\n";
    print "Marked privacy test state closed\n";
}

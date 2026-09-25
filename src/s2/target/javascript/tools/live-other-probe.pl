#!/usr/bin/perl
#
# live-other-probe.pl
#
# Isolate two recorded same-ID posts across the marked local journals.
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
use File::Path qw(make_path);
use File::Temp qw(tempfile);
use JSON::PP;
use LJ::Entry;
use LJ::Protocol;

my $mode = shift @ARGV // '';
die "Expected --create-primary, --create-other or --restore\n"
    unless !@ARGV && $mode =~ /^--(?:create-primary|create-other|restore)$/;
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my %users;
for my $name (qw(s2js_slice3 s2js_slice3_other)) {
    my $u = LJ::load_user($name);
    if (!$u && $mode eq '--restore' && !-e "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live/other-probe-state.json") {
        print "No marked isolation state to restore\n";
        exit 0;
    }
    die "Missing or unmarked isolation account\n" unless $u
        && ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
        && ($u->{journaltype} // '') eq 'P' && $u->{clusterid} == 1;
    $users{$name} = $u;
}
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
make_path($dir) unless -d $dir;
my $path = "$dir/other-probe-state.json";

sub save {
    my ($value) = @_;
    my ($fh, $temporary) = tempfile('.other-probe-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temporary or die "Cannot restrict isolation state\n";
    binmode $fh, ':raw';
    print {$fh} JSON::PP->new->canonical->encode($value)
        or die "Cannot stage isolation state\n";
    close $fh or die "Cannot close isolation state\n";
    rename $temporary, $path or die "Cannot publish isolation state\n";
}

my $state;
if (-e $path) {
    die "Unsafe isolation state\n" if -l $path || !-f $path || (stat($path))[7] > 4096;
    open my $input, '<:raw', $path or die "Cannot read isolation state\n";
    local $/;
    $state = JSON::PP->new->decode(<$input>);
    close $input;
    die "Isolation state identity differs\n"
        unless ref $state eq 'HASH' && ($state->{version} // 0) == 2
        && ($state->{primary_ownerid} // 0) == $users{s2js_slice3}->userid
        && ($state->{other_ownerid} // 0) == $users{s2js_slice3_other}->userid
        && ($state->{run} // '') =~ /^[A-Za-z0-9]{16}$/
        && ($state->{marker} // '') eq 'S2JS3 other probe v1'
        && ref $state->{ids} eq 'HASH'
        && ref $state->{seed_ids} eq 'ARRAY' && @{ $state->{seed_ids} } == 2;
    for my $name (keys %{ $state->{ids} }) {
        die "Unknown recorded isolation owner\n"
            unless $name eq 's2js_slice3' || $name eq 's2js_slice3_other';
        die "Invalid recorded isolation ID\n"
            unless ($state->{ids}{$name}{jitemid} // '') =~ /^\d+$/
            && ($state->{ids}{$name}{anum} // '') =~ /^\d+$/;
    }
}

sub entries {
    my ($name) = @_;
    my $u = $users{$name};
    my @rows = LJ::get_log2_recent_user({
        userid => $u->userid, clusterid => $u->{clusterid},
        itemshow => 200, remote => $u,
    });
    die "Isolation journal exceeds 200 entries\n" if @rows >= 200;
    return map {
        LJ::Entry->new($u, jitemid => $_->{jitemid})
            or die "Cannot inspect isolation entry\n"
    } @rows;
}

sub exact_probe {
    my ($name) = @_;
    my @matched;
    for my $entry (entries($name)) {
        my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
        next unless index($subject, "$state->{marker} $state->{run} ") == 0;
        my $expected_subject = "$state->{marker} $state->{run} $name";
        my $body = Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK);
        die "Isolation probe identity/content differs\n"
            unless $subject eq $expected_subject
            && $body eq '<p>Other journal probe café 😀</p>'
            && $entry->security eq 'public'
            && $entry->eventtime_mysql eq '2026-09-24 15:00:00'
            && ($entry->prop('editor') // '') eq 'html_raw0'
            && (!defined $state->{ids}{$name}
                || $entry->jitemid == $state->{ids}{$name}{jitemid});
        push @matched, $entry;
    }
    die "Multiple marked isolation probes\n" if @matched > 1;
    return $matched[0];
}

sub post {
    my ($name) = @_;
    die "Isolation probe already exists\n" if exact_probe($name);
    $state->{inflight} = $name;
    save($state); # Intent precedes the normal helper write for interrupted recovery.
    my %request = (
        mode => 'postevent', ver => $LJ::PROTOCOL_VER, user => $name,
        subject => Encode::encode_utf8("$state->{marker} $state->{run} $name"),
        event => Encode::encode_utf8('<p>Other journal probe café 😀</p>'),
        security => 'public', prop_editor => 'html_raw0',
        year => 2026, mon => 9, day => 24, hour => 15, min => 0,
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot post isolation probe\n"
        unless ($response{success} // '') eq 'OK'
        && ($response{itemid} // '') =~ /^\d+$/
        && ($response{anum} // '') =~ /^\d+$/;
    $state->{ids}{$name} = {
        jitemid => 0 + $response{itemid}, anum => 0 + $response{anum},
    };
    delete $state->{inflight};
    save($state);
    my $entry = exact_probe($name) or die "Recorded isolation probe is absent\n";
    die "Concurrent counter allocation defeated same-ID probe\n"
        unless $entry->jitemid == $state->{target} + 1;
}

if ($mode eq '--create-primary') {
    die "Restore existing isolation probes first\n" if $state;
    my @primary = entries('s2js_slice3');
    my @other = entries('s2js_slice3_other');
    die "Expected two original seed entries and empty second journal\n"
        unless @primary == 2 && !@other;
    my @seed_ids = sort { $a <=> $b } map { $_->jitemid } @primary;
    my @subjects = sort map {
        Encode::decode_utf8($_->subject_raw // '', Encode::FB_CROAK)
    } @primary;
    die "Original seed subjects differ\n"
        unless $subjects[0] eq 'Live sample 1 café'
        && $subjects[1] eq 'Live sample 2 😀';
    my $run = LJ::rand_chars(16);
    die "Cannot make isolation marker\n" unless $run =~ /^[A-Za-z0-9]{16}$/;
    $state = {
        version => 2, marker => 'S2JS3 other probe v1', run => $run,
        primary_ownerid => $users{s2js_slice3}->userid,
        other_ownerid => $users{s2js_slice3_other}->userid,
        seed_ids => \@seed_ids, ids => {},
    };
    save($state);
    my $primary = LJ::alloc_user_counter($users{s2js_slice3}, 'L');
    my $other = LJ::alloc_user_counter($users{s2js_slice3_other}, 'L');
    die "Cannot allocate bounded isolation counters\n" unless $primary && $other;
    my $allocations = 2;
    while ($primary != $other) {
        die "Isolation counter alignment exceeds 512 allocations\n"
            if $allocations >= 512;
        if ($primary < $other) {
            $primary = LJ::alloc_user_counter($users{s2js_slice3}, 'L');
        }
        else {
            $other = LJ::alloc_user_counter($users{s2js_slice3_other}, 'L');
        }
        die "Cannot align isolation counters\n" unless $primary && $other;
        $allocations++;
    }
    $state->{target} = $primary;
    $state->{allocations} = $allocations;
    save($state);
    post('s2js_slice3');
    print "Recorded primary isolation probe $state->{ids}{s2js_slice3}{jitemid}; " .
        "$allocations monotonic counter allocations\n";
    exit 0;
}
if ($mode eq '--create-other') {
    die "Create primary isolation probe first\n"
        unless $state && defined $state->{target}
        && exact_probe('s2js_slice3') && !exact_probe('s2js_slice3_other');
    post('s2js_slice3_other');
    die "Same-ID collision did not occur\n"
        unless $state->{ids}{s2js_slice3}{jitemid}
        == $state->{ids}{s2js_slice3_other}{jitemid};
    print "Recorded equal jitemid $state->{ids}{s2js_slice3_other}{jitemid} " .
        "in two marked journals\n";
    exit 0;
}
if (!$state) {
    print "No owned isolation probes to restore\n";
    exit 0;
}
my %primary_by_id = map { $_->jitemid => $_ } entries('s2js_slice3');
for my $id (@{ $state->{seed_ids} }) {
    die "Original seed entry changed or disappeared\n"
        unless $id =~ /^\d+$/ && $primary_by_id{$id}
        && $primary_by_id{$id}->security eq 'public';
}
for my $name (qw(s2js_slice3_other s2js_slice3)) {
    my $entry = exact_probe($name) or next;
    die "Cannot fully delete exact isolation probe\n"
        unless LJ::delete_entry($users{$name}, $entry->jitemid, 0, $entry->anum);
    die "Isolation probe survived normal-helper removal\n" if exact_probe($name);
}
unlink $path or die "Cannot close isolation state\n";
print "Restored only recorded isolation probes; monotonic counter gaps remain\n";

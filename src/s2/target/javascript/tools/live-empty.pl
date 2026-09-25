#!/usr/bin/perl
#
# live-empty.pl
#
# Temporarily hide only the two exact marked seed posts for real empty-page checks.
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
die "Expected --hide or --restore\n"
    unless !@ARGV && ($mode eq '--hide' || $mode eq '--restore');
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3');
if (!$u && $mode eq '--restore') {
    print "No marked journal to restore\n";
    exit 0;
}
die "Unmarked journal\n" unless $u
    && ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && ($u->{journaltype} // '') eq 'P' && $u->{clusterid} == 1;
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
make_path($dir) unless -d $dir;
my $path = "$dir/empty-state.json";
my @expected = (
    [ 'Live sample 1 café', '<p>Fixture 1: café &amp; tea 😀</p>',
        '2026-09-24 11:00:00' ],
    [ 'Live sample 2 😀', '<p>Fixture 2: café &amp; tea 😀</p>',
        '2026-09-24 12:00:00' ],
);
my $state;
if (-e $path) {
    die "Unsafe empty-page state\n" if -l $path || !-f $path || (stat($path))[7] > 4096;
    open my $input, '<:raw', $path or die "Cannot read empty-page state\n";
    local $/;
    $state = JSON::PP->new->decode(<$input>);
    close $input;
    die "Empty-page state identity differs\n"
        unless ref $state eq 'HASH' && ($state->{version} // 0) == 1
        && ($state->{ownerid} // 0) == $u->userid
        && ref $state->{ids} eq 'ARRAY' && @{ $state->{ids} } == 2
        && $state->{ids}[0] =~ /^\d+$/ && $state->{ids}[1] =~ /^\d+$/;
}
sub checked {
    my ($entry, $index) = @_;
    die "Seed entry disappeared or changed\n"
        unless $entry && $entry->valid && $entry->journalid == $u->userid
        && $entry->eventtime_mysql eq $expected[$index][2]
        && ($entry->prop('editor') // '') eq 'html_raw0'
        && $entry->security =~ /^(?:public|private)$/;
    my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
    my $body = Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK);
    die "Seed content changed\n"
        unless $subject eq $expected[$index][0] && $body eq $expected[$index][1];
}
sub edit_security {
    my ($entry, $index, $security) = @_;
    return if $entry->security eq $security;
    my %request = (
        mode => 'editevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
        itemid => $entry->jitemid,
        subject => Encode::encode_utf8($expected[$index][0]),
        event => Encode::encode_utf8($expected[$index][1]),
        security => $security, allowmask => 0, prop_editor => 'html_raw0',
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot edit exact seed security\n" unless ($response{success} // '') eq 'OK';
}
if ($mode eq '--hide') {
    die "Restore interrupted empty-page probe first\n" if $state;
    my @rows = LJ::get_log2_recent_user({
        userid => $u->userid, clusterid => $u->{clusterid},
        itemshow => 200, remote => $u,
    });
    die "Expected only two seed posts\n" unless @rows == 2;
    my %ids;
    for my $row (@rows) {
        my $entry = LJ::Entry->new($u, jitemid => $row->{jitemid});
        my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
        for my $index (0, 1) {
            $ids{$index} = $entry->jitemid if $subject eq $expected[$index][0];
        }
    }
    die "Missing exact seed post\n" unless keys(%ids) == 2;
    for my $index (0, 1) {
        my $entry = LJ::Entry->new($u, jitemid => $ids{$index});
        checked($entry, $index);
        die "Seed post was not public\n" unless $entry->security eq 'public';
    }
    $state = { version => 1, ownerid => $u->userid,
        ids => [ $ids{0}, $ids{1} ] };
    my ($fh, $temporary) = tempfile('.empty-state-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temporary or die "Cannot restrict empty-page state\n";
    binmode $fh, ':raw';
    print {$fh} JSON::PP->new->canonical->encode($state)
        or die "Cannot stage empty-page state\n";
    close $fh or die "Cannot close empty-page state\n";
    rename $temporary, $path or die "Cannot publish empty-page state\n";
    for my $index (0, 1) {
        edit_security(LJ::Entry->new($u, jitemid => $state->{ids}[$index]),
            $index, 'private');
    }
    print "Both exact seed posts are temporarily private\n";
    exit 0;
}
if (!$state) {
    print "No empty-page probe to restore\n";
    exit 0;
}
for my $index (0, 1) {
    my $entry = LJ::Entry->new($u, jitemid => $state->{ids}[$index]);
    checked($entry, $index);
    edit_security($entry, $index, 'public');
    checked(LJ::Entry->new($u, jitemid => $state->{ids}[$index]), $index);
}
unlink $path or die "Cannot close empty-page state\n";
print "Both exact seed posts restored public\n";

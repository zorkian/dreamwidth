#!/usr/bin/perl
#
# live-probes.pl
#
# Create, edit and fully remove only recorded marked local live-page test posts.
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
use Fcntl qw(:flock);
use File::Path qw(make_path);
use File::Temp qw(tempfile);
use JSON::PP;
use LJ::Entry;
use LJ::Protocol;

my $mode = shift @ARGV // '';
die "Expected bounded create/edit/security/delete/restore probe mode\n"
    unless !@ARGV
    && $mode =~ /^--(?:create-(?:(?:single|mixed)(?:-pause-after-post)?|bad-malformed|bad-url|bad-script)|edit-single|private-single|usemask-single|public-single|suspend-single(?:-pause-after-set)?|unsuspend-single|delete-single|restore)$/;
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3') or die "Missing dedicated marked journal\n";
die "Unmarked journal\n"
    unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && ($u->{journaltype} // '') eq 'P' && $u->{clusterid} == 1;
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
make_path($dir) unless -d $dir;
my $state_path = "$dir/probe-state.json";
my $lock_path = "$dir/probe-state.lock";
my $marker_path = "$dir/probe-posted.marker";
my $suspended_marker_path = "$dir/probe-suspended.marker";
die "Unsafe probe lock path\n" if -l $lock_path;
open my $lock, '>>', $lock_path or die "Cannot open probe lock\n";
chmod 0600, $lock_path or die "Cannot restrict probe lock\n";
flock($lock, LOCK_EX | LOCK_NB) or die "Another probe operation is active\n";

sub save_state {
    my ($state) = @_;
    my ($fh, $temporary) = tempfile('.probe-state-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temporary or die "Cannot restrict probe state\n";
    binmode $fh, ':raw';
    print {$fh} JSON::PP->new->canonical->encode($state)
        or die "Cannot stage probe state\n";
    close $fh or die "Cannot close probe state\n";
    rename $temporary, $state_path or die "Cannot publish probe state\n";
}

sub load_state {
    return undef unless -e $state_path;
    die "Unsafe probe state path\n"
        if -l $state_path || !-f $state_path || (stat($state_path))[7] > 8192;
    open my $fh, '<:raw', $state_path or die "Cannot read probe state\n";
    local $/;
    my $state = JSON::PP->new->decode(<$fh>);
    close $fh;
    die "Probe state identity differs\n"
        unless ref $state eq 'HASH' && ($state->{version} // 0) == 1
        && ($state->{username} // '') eq 's2js_slice3'
        && ($state->{ownerid} // 0) == $u->userid
        && ($state->{marker} // '') eq 'S2JS3 live probe v1'
        && ($state->{run} // '') =~ /^[A-Za-z0-9]{16}$/
        && ($state->{kind} // '') =~ /^(?:single|mixed|bad-malformed|bad-url|bad-script)$/
        && ref $state->{ids} eq 'HASH'
        && ref $state->{seed_ids} eq 'ARRAY' && @{ $state->{seed_ids} } == 2
        && ($state->{kind} ne 'single'
            || (($state->{visibility} // '') =~ /^(?:public|private|usemask)$/
                && ($state->{statusvis} // '') =~ /^[VS]$/
                && (!defined $state->{original_statusvis}
                    || $state->{original_statusvis} eq ''
                    || $state->{original_statusvis} eq 'V')
                && (!defined $state->{inflight_statusvis}
                    || $state->{inflight_statusvis} =~ /^[VS]$/)));
    return $state;
}

sub plan {
    my ($state) = @_;
    my @types = $state->{kind} eq 'mixed'
        ? ((('public') x 22), 'private', 'usemask') : ('public');
    my @items;
    for my $index (1 .. @types) {
        my $type = $types[$index - 1];
        my $time = $state->{kind} eq 'single' ? '2026-09-23 14:00:00'
            : $state->{kind} eq 'mixed'
            ? sprintf('2026-09-24 13:%02d:00', $index - 1)
            : '2026-09-22 16:00:00';
        my %bad_body = (
            'bad-malformed' => '<p>unterminated',
            'bad-url' => '<p><a href="javascript:alert(1)">bad link</a></p>',
            'bad-script' => '<script>alert(1)</script>',
        );
        my $bad = $state->{kind} =~ /^bad-/;
        push @items, {
            index => $index, type => $type, time => $time,
            subject => $bad
                ? "$state->{marker} $state->{run} $state->{kind} $index"
                : "$state->{marker} $state->{run} $type $index",
            body => $bad ? $bad_body{ $state->{kind} }
                : "<p>Probe $type $index café 😀</p>",
        };
    }
    return @items;
}

sub entries {
    my @rows = LJ::get_log2_recent_user({
        userid => $u->userid, clusterid => $u->{clusterid}, itemshow => 200,
        remote => $u,
    });
    die "Probe journal exceeds 200 entries\n" if @rows >= 200;
    return map {
        LJ::Entry->new($u, jitemid => $_->{jitemid})
            or die "Cannot inspect marked journal entry\n"
    } @rows;
}

sub validate_probe {
    my ($entry, $expected, $state) = @_;
    my %security = ($expected->{type} => 1);
    if ($state->{kind} eq 'single') {
        $security{ $state->{visibility} } = 1;
        $security{ $state->{inflight_security} } = 1
            if $state->{inflight_security};
    }
    die "Probe entry identity differs\n" unless $entry->valid
        && $entry->journalid == $u->userid
        && $security{ $entry->security }
        && $entry->eventtime_mysql eq $expected->{time}
        && ($entry->prop('editor') // '') eq 'html_raw0';
    my %statusvis = (($state->{statusvis} // 'V') => 1);
    $statusvis{ $state->{inflight_statusvis} } = 1
        if $state->{inflight_statusvis};
    die "Probe entry status differs\n" unless $statusvis{ $entry->statusvis };
    my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
    my $body = Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK);
    my $edit_subject = "$state->{marker} $state->{run} edited 1";
    my $edit_body = '<p>Probe edited 1 café 😀</p>';
    die "Probe content differs\n"
        unless ($subject eq $expected->{subject} && $body eq $expected->{body})
        || ($state->{kind} eq 'single'
            && $subject eq $edit_subject && $body eq $edit_body);
}

sub post {
    my ($state, $item, $pause) = @_;
    $state->{inflight} = $item->{index};
    save_state($state);
    my ($year, $mon, $day, $hour, $min) = $item->{time}
        =~ /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):\d\d$/;
    my %request = (
        mode => 'postevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
        subject => Encode::encode_utf8($item->{subject}),
        event => Encode::encode_utf8($item->{body}),
        security => $item->{type}, allowmask => $item->{type} eq 'usemask' ? 1 : 0,
        prop_editor => 'html_raw0', year => $year, mon => $mon, day => $day,
        hour => $hour, min => $min,
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot post owned probe\n" unless ($response{success} // '') eq 'OK'
        && ($response{itemid} // '') =~ /^\d+$/ && ($response{anum} // '') =~ /^\d+$/;
    if ($pause) {
        die "Unsafe probe handshake path\n" if -l $marker_path;
        open my $marker, '>:raw', $marker_path or die "Cannot write probe handshake\n";
        print {$marker} "owned post committed\n" or die "Cannot write probe handshake\n";
        close $marker or die "Cannot close probe handshake\n";
        sleep 30;
    }
    my $id = $response{itemid} + 0;
    my $entry = LJ::Entry->new($u, jitemid => $id);
    validate_probe($entry, $item, $state);
    if ($state->{kind} eq 'single') {
        my $original = $entry->prop('statusvis');
        die "Unexpected initial single-probe status property\n"
            if defined $original && $original ne '' && $original ne 'V';
        $state->{original_statusvis} = $original;
    }
    $state->{ids}{ $item->{index} } = { jitemid => $id, anum => $response{anum} + 0 };
    delete $state->{inflight};
    save_state($state);
}

my $state = load_state();
if ($mode =~ /^--create-(single|mixed|bad-malformed|bad-url|bad-script)(?:-pause-after-post)?$/) {
    my $kind = $1;
    my $pause = $mode =~ /-pause-after-post$/;
    die "Restore existing owned probe run first\n" if $state;
    my @existing = entries();
    die "Expected only two original seed entries before probe\n" unless @existing == 2;
    my @seed_ids = sort { $a <=> $b } map { $_->jitemid } @existing;
    my @seed_subjects = sort map {
        Encode::decode_utf8($_->subject_raw // '', Encode::FB_CROAK)
    } @existing;
    die "Original seed subjects differ\n"
        unless $seed_subjects[0] eq 'Live sample 1 café'
        && $seed_subjects[1] eq 'Live sample 2 😀';
    my $run = LJ::rand_chars(16);
    die "Cannot create bounded probe marker\n" unless $run =~ /^[A-Za-z0-9]{16}$/;
    $state = {
        version => 1, username => 's2js_slice3', ownerid => $u->userid,
        marker => 'S2JS3 live probe v1', run => $run,
        kind => $kind, seed_ids => \@seed_ids, ids => {},
        ($kind eq 'single'
            ? (visibility => 'public', statusvis => 'V', original_statusvis => undef)
            : ()),
    };
    save_state($state);
    post($state, $_, $pause && $_->{index} == 1) for plan($state);
    print "Created $state->{kind} marked probe run with " . scalar(keys %{ $state->{ids} }) . " IDs\n";
    exit 0;
}
if ($mode eq '--restore' && !$state) {
    unlink $marker_path if -f $marker_path && !-l $marker_path;
    unlink $suspended_marker_path if -f $suspended_marker_path && !-l $suspended_marker_path;
    print "No owned probe state to restore\n";
    exit 0;
}
die "No matching single probe run\n"
    if $mode =~ /^--(?:edit|private|usemask|public|suspend|unsuspend|delete)-single(?:-pause-after-set)?$/
    && (!$state || $state->{kind} ne 'single');
my @expected = plan($state);
my %by_subject = map { $_->{subject} => $_ } @expected;
my %found;
my @current = entries();
my %all_by_id = map { $_->jitemid => $_ } @current;
for my $id (@{ $state->{seed_ids} }) {
    die "Original seed entry changed or disappeared\n"
        unless $id =~ /^\d+$/ && $all_by_id{$id}
        && $all_by_id{$id}->security eq 'public';
}
for my $entry (@current) {
    my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
    next unless index($subject, "$state->{marker} $state->{run} ") == 0;
    my $item = $by_subject{$subject};
    $item = $expected[0] if $state->{kind} eq 'single'
        && $subject eq "$state->{marker} $state->{run} edited 1";
    die "Unexpected marked probe entry\n" unless $item;
    my $index = $item->{index};
    die "Duplicate marked probe\n" if $found{$index};
    my $record = $state->{ids}{$index};
    die "Unrecorded probe identity differs\n"
        unless ($record && $record->{jitemid} == $entry->jitemid)
        || (!$record && ($state->{inflight} // 0) == $index);
    validate_probe($entry, $item, $state);
    $found{$index} = $entry;
}
if ($state->{kind} eq 'single' && !$found{1} && $state->{ids}{1}) {
    # A suspended entry may disappear from the recent enumeration. Inspect
    # only the recorded exact ID, then apply the same marker/content checks.
    my $direct = LJ::Entry->new($u, jitemid => $state->{ids}{1}{jitemid});
    if ($direct && $direct->valid) {
        validate_probe($direct, $expected[0], $state);
        my $subject = Encode::decode_utf8($direct->subject_raw // '', Encode::FB_CROAK);
        die "Direct probe marker differs\n"
            unless $subject eq $expected[0]{subject}
            || $subject eq "$state->{marker} $state->{run} edited 1";
        $found{1} = $direct;
    }
}
for my $index (keys %{ $state->{ids} }) {
    my $record = $state->{ids}{$index};
    die "Recorded probe changed identity or marker\n"
        unless $index =~ /^\d+$/ && ref $record eq 'HASH'
        && ($record->{jitemid} // '') =~ /^\d+$/
        && (!$all_by_id{ $record->{jitemid} } || $found{$index});
}
if ($mode eq '--edit-single') {
    die "Edit requires public single probe\n" unless $state->{visibility} eq 'public';
    my $entry = $found{1} or die "Missing recorded single probe\n";
    my $body = Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK);
    if ($body eq $expected[0]{body}) {
        my %request = (
            mode => 'editevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
            itemid => $entry->jitemid,
            subject => Encode::encode_utf8("$state->{marker} $state->{run} edited 1"),
            event => Encode::encode_utf8('<p>Probe edited 1 café 😀</p>'),
            security => 'public', allowmask => 0, prop_editor => 'html_raw0',
        );
        my %response;
        LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
        die "Cannot edit owned probe\n" unless ($response{success} // '') eq 'OK';
    }
    print "Edited recorded single probe through normal helper\n";
    exit 0;
}
if ($mode =~ /^--(private|usemask|public)-single$/) {
    my $target = $1;
    my $entry = $found{1} or die "Missing recorded single probe\n";
    my $subject = $entry->subject_raw // '';
    my $body = $entry->event_raw // '';
    if ($entry->security ne $target) {
        $state->{inflight_security} = $target;
        save_state($state);
        my %request = (
            mode => 'editevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
            itemid => $entry->jitemid, subject => $subject, event => $body,
            security => $target, allowmask => $target eq 'usemask' ? 1 : 0,
            prop_editor => 'html_raw0',
        );
        my %response;
        LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
        die "Cannot change exact probe security\n"
            unless ($response{success} // '') eq 'OK';
    }
    $state->{visibility} = $target;
    delete $state->{inflight_security};
    save_state($state);
    print "Recorded single probe security is $target\n";
    exit 0;
}
if ($mode =~ /^--(suspend|unsuspend)-single(?:-pause-after-set)?$/) {
    my $target = $1 eq 'suspend' ? 'S' : 'V';
    my $entry = $found{1} or die "Missing recorded single probe\n";
    die "Suspension requires public probe\n" unless $entry->security eq 'public';
    if ($entry->statusvis ne $target) {
        $state->{inflight_statusvis} = $target;
        save_state($state);
        my $raw = $target eq 'S' ? 'S' : $state->{original_statusvis};
        $entry->set_prop(statusvis => $raw);
        my $checked = LJ::Entry->new($u, jitemid => $entry->jitemid);
        die "Normal status helper failed\n"
            unless $checked && $checked->valid && $checked->statusvis eq $target;
        if ($mode eq '--suspend-single-pause-after-set') {
            die "Unsafe suspended-probe handshake path\n" if -l $suspended_marker_path;
            open my $marker, '>:raw', $suspended_marker_path
                or die "Cannot write suspended-probe handshake\n";
            print {$marker} "owned suspension committed\n"
                or die "Cannot write suspended-probe handshake\n";
            close $marker or die "Cannot close suspended-probe handshake\n";
            sleep 30;
        }
    }
    $state->{statusvis} = $target;
    delete $state->{inflight_statusvis};
    save_state($state);
    print "Recorded single probe statusvis is $target\n";
    exit 0;
}
if ($mode eq '--delete-single') {
    my $entry = $found{1} or die "Missing recorded single probe\n";
    die "Cannot fully delete recorded single probe\n"
        unless LJ::delete_entry($u, $entry->jitemid, 0, $entry->anum);
    print "Recorded single probe deleted; recovery state retained\n";
    exit 0;
}
for my $index (sort { $b <=> $a } keys %found) {
    my $entry = $found{$index};
    if ($state->{kind} eq 'single' && $entry->statusvis eq 'S') {
        $entry->set_prop(statusvis => $state->{original_statusvis});
        my $checked = LJ::Entry->new($u, jitemid => $entry->jitemid);
        die "Cannot restore original probe status\n"
            unless $checked && $checked->valid && $checked->statusvis eq 'V';
    }
    die "Cannot fully delete exact owned probe\n"
        unless LJ::delete_entry($u, $entry->jitemid, 0, $entry->anum);
}
my %remaining = map { $_->jitemid => 1 } entries();
die "Recorded probe survived normal-helper removal\n"
    if grep { $remaining{ $state->{ids}{$_}{jitemid} } } keys %{ $state->{ids} };
die "Original seed entry disappeared during probe removal\n"
    if grep { !$remaining{$_} } @{ $state->{seed_ids} };
unlink $state_path or die "Cannot remove completed owned probe state\n";
unlink $marker_path if -f $marker_path && !-l $marker_path;
unlink $suspended_marker_path if -f $suspended_marker_path && !-l $suspended_marker_path;
print "Restored only recorded marked probe entries\n";

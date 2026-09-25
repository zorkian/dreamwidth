#!/usr/bin/perl
#
# live-content-post.pl
#
# Create, edit, and fully remove one marked rich-content test entry.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

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

my ($mode, $variant) = @ARGV;
die "Usage: perl tools/live-content-post.pl --create|--set VARIANT|--restore\n"
    unless defined $mode && ($mode eq '--create' && !defined $variant
    || $mode eq '--restore' && !defined $variant
    || $mode eq '--set' && defined $variant && $variant =~
        /^(?:rich|edited|forged-cut|escaped-css|schemes|unsafe-anchor)$/);
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $u = LJ::load_user('s2js_slice3') or die "Missing dedicated marked journal\n";
die "Unmarked or unsupported journal\n"
    unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1'
    && ($u->{journaltype} // '') eq 'P' && $u->{clusterid} == 1;
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
make_path($dir) unless -d $dir;
my $state_path = "$dir/content-post-state.json";
my $lock_path = "$dir/content-post-state.lock";
die "Unsafe content lock\n" if -l $lock_path;
open my $lock, '>>', $lock_path or die "Cannot open content lock\n";
chmod 0600, $lock_path or die "Cannot restrict content lock\n";
flock($lock, LOCK_EX | LOCK_NB) or die "Another content operation is active\n";

my %bodies = (
    rich => q{<div class="s2-rich" id="source-id-discarded"><h2>Rich café 😀</h2><p><b>Bold</b> and <em>emphasis</em> with <a href="https://app.slice4.invalid/page">a link</a>.</p><ol><li>one</li><li>two</li></ol><table class="s2-table"><caption>Caption</caption><tr><td style="--tone:#336699;color:var(--tone);position:relative;left:4px;transform:translateX(2px);display:grid;gap:2px;background-image:url(https://asset.slice4.invalid/bg.png)">Cell</td></tr></table><img src="https://asset.slice4.invalid/pixel.png" width="16" height="16" alt="Pixel"><map name="s2map"><area shape="rect" coords="0,0,16,16" href="https://app.slice4.invalid/map" alt="Map"></map><img src="https://asset.slice4.invalid/map.png" usemap="#s2map" alt="Mapped"><form action="https://app.slice4.invalid/form"><input type="text" name="q" value="café"><button type="submit">Go</button></form></div><lj-cut text="Read hidden café"><p>HIDDEN-S2-CONTENT-ONLY</p></lj-cut><p>After cut visible</p>},
    edited => q{<div class="s2-rich edited"><h2>Edited rich café 😀</h2><p>The visible content changed through the normal entry helper.</p><lj-cut text="More edited"><p>HIDDEN-EDITED-ONLY</p></lj-cut></div>},
    'forged-cut' => q{<div class="s2-rich"><span class="cuttag" id="span-cuttag_other_123_1">Forged cut control</span><lj-cut text="Legitimate cut"><p>HIDDEN-FORGED-CASE</p></lj-cut><p>Visible after cut</p></div>},
    'escaped-css' => q{<div class="css-case" style="position:\66 ixed;top:0;left:0">Escaped fixed</div><div class="css-case" style="position:\61 bsolute;top:0;left:0">Escaped absolute</div><div class="css-case" style="--p:\66 ixed;position:var(--p);top:0;left:0">Escaped custom property</div>},
    schemes => q{<p><a href="gopher://links.slice4.invalid/item">Gopher</a> <a href="magnet:?xt=urn:btih:123">Magnet</a> <a href="spotify:track:123">Spotify</a></p>},
    'unsafe-anchor' => q{<p><a href="javascript:alert(1)">Inert link text</a></p>},
);
my $marker = 'S2JS4 rich content probe v1';
my $time = '2026-09-24 16:00:00';

sub save_state {
    my ($state) = @_;
    my ($fh, $temporary) = tempfile('.content-post-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temporary or die "Cannot restrict content state\n";
    binmode $fh, ':raw';
    print {$fh} JSON::PP->new->canonical->encode($state)
        or die "Cannot stage content state\n";
    close $fh or die "Cannot close content state\n";
    rename $temporary, $state_path or die "Cannot publish content state\n";
}

sub load_state {
    return undef unless -e $state_path;
    die "Unsafe content state\n"
        if -l $state_path || !-f $state_path || (stat($state_path))[7] > 8192;
    open my $fh, '<:raw', $state_path or die "Cannot read content state\n";
    local $/;
    my $state = JSON::PP->new->decode(<$fh>);
    close $fh;
    die "Content state identity differs\n"
        unless ref $state eq 'HASH' && ($state->{version} // 0) == 1
        && ($state->{username} // '') eq 's2js_slice3'
        && ($state->{ownerid} // 0) == $u->userid
        && ($state->{marker} // '') eq $marker
        && ($state->{run} // '') =~ /^[A-Za-z0-9]{16}$/
        && ($state->{variant} // '') =~ /^(?:rich|edited|forged-cut|escaped-css|schemes|unsafe-anchor)$/
        && (!defined $state->{inflight_variant} || exists $bodies{ $state->{inflight_variant} })
        && ref $state->{seed_ids} eq 'ARRAY' && @{ $state->{seed_ids} } == 2
        && (!defined $state->{jitemid} || $state->{jitemid} =~ /^[1-9][0-9]*$/)
        && (!defined $state->{anum} || $state->{anum} =~ /^[0-9]+$/);
    return $state;
}

sub journal_entries {
    my @rows = LJ::get_log2_recent_user({
        userid => $u->userid, clusterid => $u->{clusterid}, itemshow => 200,
        remote => $u,
    });
    die "Marked journal exceeds 200 entries\n" if @rows >= 200;
    return map {
        LJ::Entry->new($u, jitemid => $_->{jitemid})
            or die "Cannot inspect marked entry\n"
    } @rows;
}

sub expected_subject {
    my ($state) = @_;
    return "$state->{marker} $state->{run}";
}

sub validate_entry {
    my ($entry, $state) = @_;
    die "Content entry identity differs\n" unless $entry && $entry->valid
        && $entry->journalid == $u->userid && $entry->security eq 'public'
        && $entry->statusvis eq 'V' && $entry->eventtime_mysql eq $time
        && ($entry->prop('editor') // '') eq 'html_raw0';
    my $subject = Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK);
    my $body = Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK);
    die "Content entry marker differs\n" unless $subject eq expected_subject($state);
    my %allowed = ($state->{variant} => 1);
    $allowed{ $state->{inflight_variant} } = 1 if $state->{inflight_variant};
    die "Content entry body differs\n" unless grep { $body eq $bodies{$_} } keys %allowed;
    return $body;
}

sub verify_seeds {
    my ($state, @entries) = @_;
    my %by_id = map { $_->jitemid => $_ } @entries;
    my @expected = (
        [ 'Live sample 1 café', '<p>Fixture 1: café &amp; tea 😀</p>', '2026-09-24 11:00:00' ],
        [ 'Live sample 2 😀', '<p>Fixture 2: café &amp; tea 😀</p>', '2026-09-24 12:00:00' ],
    );
    for my $index (0 .. 1) {
        my $entry = $by_id{ $state->{seed_ids}[$index] }
            or die "Original seed entry disappeared\n";
        die "Original seed entry changed\n" unless $entry->valid
            && $entry->security eq 'public'
            && $entry->eventtime_mysql eq $expected[$index][2]
            && ($entry->prop('editor') // '') eq 'html_raw0'
            && Encode::decode_utf8($entry->subject_raw // '', Encode::FB_CROAK)
                eq $expected[$index][0]
            && Encode::decode_utf8($entry->event_raw // '', Encode::FB_CROAK)
                eq $expected[$index][1];
    }
}

my $state = load_state();
if ($mode eq '--create') {
    die "Restore existing content run first\n" if $state;
    my @entries = journal_entries();
    die "Expected two original seed entries\n" unless @entries == 2;
    my %by_subject = map {
        Encode::decode_utf8($_->subject_raw // '', Encode::FB_CROAK) => $_
    } @entries;
    my @seed_ids = map {
        my $entry = $by_subject{$_} or die "Original seed subject missing\n";
        $entry->jitemid;
    } ('Live sample 1 café', 'Live sample 2 😀');
    $state = {
        version => 1, username => 's2js_slice3', ownerid => $u->userid,
        marker => $marker, run => LJ::rand_chars(16), seed_ids => \@seed_ids,
        variant => 'rich', inflight_variant => 'rich',
    };
    die "Cannot create bounded content marker\n"
        unless $state->{run} =~ /^[A-Za-z0-9]{16}$/;
    verify_seeds($state, @entries);
    save_state($state); # Intent precedes the normal helper write.
    my %request = (
        mode => 'postevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
        subject => Encode::encode_utf8(expected_subject($state)),
        event => Encode::encode_utf8($bodies{rich}),
        security => 'public', prop_editor => 'html_raw0',
        year => 2026, mon => 9, day => 24, hour => 16, min => 0,
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot post exact marked content\n"
        unless ($response{success} // '') eq 'OK'
        && ($response{itemid} // '') =~ /^[1-9][0-9]*$/
        && ($response{anum} // '') =~ /^[0-9]+$/;
    die "Injected post failure after normal helper\n"
        if ($ENV{S2_CONTENT_INJECT_FAILURE} // '') eq 'after-post';
    $state->{jitemid} = 0 + $response{itemid};
    $state->{anum} = 0 + $response{anum};
    validate_entry(LJ::Entry->new($u, jitemid => $state->{jitemid}), $state);
    delete $state->{inflight_variant};
    save_state($state);
    print "Created exact rich content entry $state->{jitemid}\n";
    exit 0;
}
if ($mode eq '--restore' && !$state) {
    print "No marked content entry to restore\n";
    exit 0;
}
die "No marked content state\n" unless $state;
my @entries = journal_entries();
verify_seeds($state, @entries);
my @marked = grep {
    my $subject = Encode::decode_utf8($_->subject_raw // '', Encode::FB_CROAK);
    index($subject, "$marker $state->{run}") == 0;
} @entries;
die "Multiple marked content entries\n" if @marked > 1;
my $entry = @marked ? $marked[0] : undef;
if ($state->{jitemid}) {
    my $direct = LJ::Entry->new($u, jitemid => $state->{jitemid});
    die "Recorded content entry missing or differs\n"
        unless $direct && $direct->valid && $entry
        && $entry->jitemid == $direct->jitemid
        && $direct->anum == $state->{anum};
    $entry = $direct;
}
if ($entry) {
    die "Unrecorded content identity differs\n"
        if $state->{jitemid} && $entry->jitemid != $state->{jitemid};
    my $body = validate_entry($entry, $state);
    if ($mode eq '--set') {
        die "Incomplete post intent needs restore\n" unless $state->{jitemid};
        if ($body ne $bodies{$variant}) {
            $state->{inflight_variant} = $variant;
            save_state($state);
            my %request = (
                mode => 'editevent', ver => $LJ::PROTOCOL_VER, user => 's2js_slice3',
                itemid => $entry->jitemid,
                subject => Encode::encode_utf8(expected_subject($state)),
                event => Encode::encode_utf8($bodies{$variant}),
                security => 'public', allowmask => 0, prop_editor => 'html_raw0',
            );
            my %response;
            LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
            die "Cannot edit exact marked content\n"
                unless ($response{success} // '') eq 'OK';
            die "Injected edit failure after normal helper\n"
                if ($ENV{S2_CONTENT_INJECT_FAILURE} // '') eq 'after-edit';
            validate_entry(LJ::Entry->new($u, jitemid => $entry->jitemid), $state);
        }
        $state->{variant} = $variant;
        delete $state->{inflight_variant};
        save_state($state);
        print "Set exact marked content variant $variant\n";
        exit 0;
    }
    die "Unexpected content operation\n" unless $mode eq '--restore';
    die "Cannot fully delete exact marked content\n"
        unless LJ::delete_entry($u, $entry->jitemid, 0, $entry->anum);
}
die "Unexpected content operation\n" unless $mode eq '--restore';
my @remaining = journal_entries();
verify_seeds($state, @remaining);
die "Marked content entry survived restoration\n"
    if grep {
        my $subject = Encode::decode_utf8($_->subject_raw // '', Encode::FB_CROAK);
        index($subject, "$marker $state->{run}") == 0;
    } @remaining;
unlink $state_path or die "Cannot remove completed content state\n";
print "Restored exact marked content entry only\n";

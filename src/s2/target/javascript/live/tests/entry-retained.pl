#!/usr/bin/perl
# entry-retained.pl
#
# Bounded offline full-entry and inert metadata differential oracle.
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
use LJ::CleanHTML;
use JSON::PP;
use Encode qw(encode decode FB_CROAK);

die "Local proxy-absent probe required\n"
    unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER
    && !$LJ::PROXY_URL && !$LJ::PROXY_SALT_FILE;
my $json = do { local $/; <STDIN> };
die "Oversized probe input\n" if length($json) > 2097152;
my $cases = decode_json($json);
die "Invalid probe cases\n" unless ref($cases) eq 'ARRAY' && @$cases <= 128;
my @results;
for my $case (@$cases) {
    die "Invalid probe case\n" unless ref($case) eq 'HASH'
        && defined $case->{body} && !ref($case->{body})
        && defined $case->{subject} && !ref($case->{subject});
    # LJ::Entry event_raw/subject_raw carry unflagged UTF8 bytes. Preserve that
    # actual boundary, including text_trim's byte-pattern character counting.
    my $body = encode('UTF-8', $case->{body}, FB_CROAK);
    my $subject = encode('UTF-8', $case->{subject}, FB_CROAK);
    die "Oversized probe entry\n" if length($body) > 65536 || length($subject) > 1024;
    my $full = $body;
    my $event_text = $body;
    LJ::CleanHTML::clean_event(\$full, { editor => 'html_raw0' });
    LJ::CleanHTML::clean_event(\$event_text, { textonly => 1 });
    LJ::CleanHTML::clean_subject_all(\$subject);
    my $og = $event_text;
    $og =~ s/\s+/ /g;
    $og = LJ::ehtml( LJ::text_trim($og, 0, 300) );
    push @results, { map { $_->[0] => decode('UTF-8', $_->[1], FB_CROAK) }
        ['full', $full], ['subjectText', $subject], ['eventText', $event_text], ['og', $og] };
}
print encode_json(\@results), "\n";

#!/usr/bin/perl
# cleaner-retained.pl
#
# Bounded offline native entry-cleaner probe for focused compatibility tests.
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

die "This probe requires the local proxy-absent configuration\n"
    if $LJ::PROXY_URL || $LJ::PROXY_SALT_FILE;
my $json = do { local $/; <STDIN> };
die "Oversized probe input\n" if length($json) > 65536;
my $cases = decode_json($json);
die "Invalid probe cases\n" unless ref($cases) eq 'ARRAY' && @$cases <= 128;
my @results;
for my $raw (@$cases) {
    die "Invalid probe body\n" if !defined($raw) || ref($raw);
    my $clean = $raw;
    LJ::CleanHTML::clean_event( \$clean, { editor => 'html_raw0' } );
    push @results, $clean;
}
print encode_json(\@results), "\n";

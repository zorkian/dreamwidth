#!/usr/bin/perl
# cleaner-second-pass.pl
#
# Measure retained entry-cleaner transforms when generated HTML re-enters as raw.
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
my @cases = (
    {
        id      => 'cut-raw-reentry',
        raw     => 'a<lj-cut>HIDDEN</lj-cut>b',
        options => {
            cuturl  => 'http://localhost:8080/~s2js_slice3/436.html',
            journal => 's2js_slice3',
            ditemid => 436,
        },
    },
    {
        id      => 'placeholder-raw-reentry',
        raw     => '<img src="https://image.test/a">',
        options => { extractimages => 1 },
    },
);
my @results;
for my $case (@cases) {
    my $first = $case->{raw};
    LJ::CleanHTML::clean_event( \$first, { editor => 'html_raw0', %{ $case->{options} } } );
    my $second = $first;
    LJ::CleanHTML::clean_event( \$second, { editor => 'html_raw0', %{ $case->{options} } } );
    push @results, { id => $case->{id}, raw => $case->{raw}, first => $first, second => $second };
}
print JSON::PP->new->canonical->encode(\@results), "\n";

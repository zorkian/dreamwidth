#!/usr/bin/perl
#
# page-cleaner-probe.pl
#
# Probe the retained HTMLCleaner rules reached by trusted stock S2 safe output.
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
use HTMLCleaner;
use JSON::PP;

binmode STDOUT, ':raw';
my @input = (
    '<a class="current recent" >Recent Entries</a>',
    q{<a title='0 comments'>entry</a>},
    q{<a title='a"b&c&amp;d'>entry</a>},
    '<span>x</span><!-- end footer -->',
);
my @results;
for my $input (@input) {
    my $output = '';
    my $cleaner = HTMLCleaner->new(output => sub { $output .= $_[0] });
    $cleaner->parse($input);
    $cleaner->eof;
    push @results, { input => $input, output => $output };
}
print JSON::PP->new->canonical->utf8->encode(\@results);

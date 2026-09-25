#!/usr/bin/perl
# content-oracle.pl
#
# Offline retained cleaner differential; never a serving dependency.
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
use JSON::PP;
use LJ::CleanHTML;

local $/;
my $input = JSON::PP->new->utf8->decode(<STDIN>);
die "Expected bounded probe array\n" unless ref $input eq 'ARRAY' && @$input <= 200;
my @results;
for my $value (@$input) {
    die "Expected bounded string\n" if ref $value || !defined $value || length($value) > 65536;
    LJ::CleanHTML::clean_event(\$value, {editor => 'html_raw0'});
    push @results, $value;
}
print JSON::PP->new->utf8->encode(\@results);

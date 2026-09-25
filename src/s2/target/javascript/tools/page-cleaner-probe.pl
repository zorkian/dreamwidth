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
    'a > b',
    '1 < 2',
    '<B>x</B>',
    '<input checked>',
    '<a onclick="x()" href="/y">x</a>',
    '<link rel="stylesheet" href="/res/1/stylesheet?1">',
    '<script>x()</script>ok',
    '<a href="javascript:x()">x</a>',
    '<link rel="stylesheet" href="http://localhost/~s2js_slice2/res/6/stylesheet?1">',
    '<span style="font-size: smaller;">x</span>',
);
my %unsupported = map { $_ => 1 } (7, 8, 9, 10, 11);
my $absolute_stylesheet = $input[12] =~ /href="([^"]+)"/ ? $1 : '';
my $allow = LJ::valid_stylesheet_url($absolute_stylesheet);
die "Expected retained absolute stylesheet allow decision\n" unless $allow eq '1';
my @results;
for my $input (@input) {
    my $index = scalar @results;
    my $output = '';
    my $cleaner = HTMLCleaner->new(
        output => sub { $output .= $_[0] },
        valid_stylesheet => \&LJ::valid_stylesheet_url,
    );
    $cleaner->parse($input);
    $cleaner->eof;
    push @results, {
        input => $input, output => $output,
        supported => $unsupported{$index} ? JSON::PP::false : JSON::PP::true,
        $input eq $input[12] ? (stylesheet => {
            href => $absolute_stylesheet, decision => 0 + $allow,
        }) : (),
    };
}
print JSON::PP->new->canonical->utf8->encode(\@results);

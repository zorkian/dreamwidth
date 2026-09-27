#!/usr/bin/perl
# page-css-native.pl
#
# Independent native CSS screening branch controls.
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
use FindBin;
use lib "$FindBin::Bin/../../../cgi-bin";
use CSS::Cleaner;
use LJ::CSS::Cleaner;
use JSON::PP;
my @values=(q{p{color:red}},q{@import url(x)},q{p{color:\61}},
    q{p{color:\61;expression(x)}},q{p{color:java/**/script}},
    "p{color:java// hi\nscript}",q{p{color:&#999999999999999999999999;}},
    q{p{color:&#2097152;}},q{p{position:fixed}},q{p{content:"comment-bake-cookie"}},
    q{p{background:url(https://x/y)}},q{@font-face{font-family:custom;src:url(font.woff)}},
    "p{color:\0}",q{p{color:&#0;}},q{p{color:\xpression(x)}});
my @rows;
for my $value(@values) {
    my ($plain,$sheet,$error);
    eval {$plain=CSS::Cleaner->new->clean($value);$sheet=LJ::CSS::Cleaner->new->clean($value);1}or$error=$@;
    push @rows,{input=>$value,plain=>$plain,sheet=>$sheet,error=>$error};
}
print JSON::PP->new->canonical->encode(\@rows);

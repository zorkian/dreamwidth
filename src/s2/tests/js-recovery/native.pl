#!/usr/bin/perl
# native.pl
#
# Compile fixed trusted recovery fixtures and independently execute native output.
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
use lib "$FindBin::Bin/../..";
use Encode qw(decode encode FB_CROAK);
use JSON::PP;
use S2;
use S2::Compiler;
use S2::Checker;
my $compiler = S2::Compiler->new({checker => S2::Checker->new});
my @codes;
my $id = 100;
for my $spec (["program.s2", "core"], ["override.s2", "layout"]) {
    open my $file, '<:raw', "$FindBin::Bin/$spec->[0]" or die "Fixture read failed";
    local $/;
    my $bytes = <$file>;
    my $source = decode('UTF-8', $bytes, FB_CROAK);
    my $output = '';
    $compiler->compile_source({type=>$spec->[1],source=>\$source,output=>\$output,
        layerid=>++$id,untrusted=>($id == 102),builtinPackage=>'S2::Builtin'});
    push @codes, $output;
}
# Only code compiled above from the fixed maintained fixtures is executed here.
# No persisted compdata or caller-supplied source reaches this native oracle.
S2::load_layer(101, $codes[0]);
S2::load_layer(102, $codes[1]);
my @outputs;
for my $layers ([101], [101,102]) {
    my $text = '';
    S2::set_output(sub { $text .= $_[0] });
    S2::set_output_safe(sub { $text .= "SAFE(" . $_[0] . ")" });
    my $context = S2::make_context(@$layers);
    S2::run_code($context, 'main()');
    push @outputs, $text;
}
my $wide = 94906267;
no warnings 'numeric';
my $numeric = {literal => "" . 9007199254740993, product => "" . ($wide * $wide), concat => ("x" . 1 + 2)};
print JSON::PP->new->canonical->utf8->encode({codes=>\@codes, outputs=>\@outputs, numeric=>$numeric});

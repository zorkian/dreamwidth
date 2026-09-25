#!/usr/bin/perl
#
# cleaner-native-run.pl
#
# Run one original cleaner suite with a temporary call-recording injection.
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
use File::Temp qw(tempfile);

my ($suite, $outdir) = @ARGV;
die "Usage: perl tools/cleaner-native-run.pl cleaner-NAME.t <existing-output-dir>\n"
    unless defined $suite && $suite =~ /^cleaner-[a-z-]+\.t$/
    && defined $outdir && -d $outdir;
my $source_path = "$ENV{LJHOME}/t/$suite";
open my $source, '<:raw', $source_path or die "Cannot read original suite: $!\n";
my $program = do { local $/; <$source> };
close $source;
my $injection = 'BEGIN { require "$ENV{LJHOME}/src/content/tools/cleaner-native-capture.pl"; '
    . 'DW::Content::NativeCapture::install(); }';
my @lines = split /\n/, $program, -1;
my $injection_line;
for my $index (0 .. $#lines) {
    if ($lines[$index] =~ /^use LJ::CleanHTML;\s*$/) {
        $injection_line = $index + 1;
        splice @lines, $index + 1, 0, $injection,
            '#line ' . ($injection_line + 1) . ' "t/' . $suite . '"';
        last;
    }
}
die "Suite does not import LJ::CleanHTML\n" unless $injection_line;
my ($temporary, $temporary_path) = tempfile('dw-native-cleaner-XXXXXX',
    DIR => '/tmp', SUFFIX => '.t', UNLINK => 1);
print {$temporary} join("\n", @lines) or die "Cannot write injected suite: $!\n";
close $temporary or die "Cannot close injected suite: $!\n";
my $calls = "$outdir/$suite.calls.jsonl";
my $tap = "$outdir/$suite.tap";
die "Native capture outputs already exist\n" if -e $calls || -e $tap;
local $ENV{S2_NATIVE_SUITE} = $suite;
local $ENV{S2_NATIVE_SOURCE} = "t/$suite";
local $ENV{S2_NATIVE_CAPTURE_PATH} = $calls;
open my $tap_output, '>:raw', $tap or die "Cannot open TAP output: $!\n";
open my $child, '-|', $^X, $temporary_path or die "Cannot start injected suite: $!\n";
while (my $line = <$child>) {
    print {$tap_output} $line or die "Cannot write TAP output: $!\n";
}
close $child;
my $status = $?;
close $tap_output or die "Cannot close TAP output: $!\n";
die "Instrumented original suite failed: exit $status\n" if $status;
print "Captured original $suite into $calls and $tap\n";

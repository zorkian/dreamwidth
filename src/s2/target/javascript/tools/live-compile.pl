#!/usr/bin/perl
#
# live-compile.pl
#
# Compile only pinned stock sources for the local S2 journal renderer.
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
use lib "$FindBin::Bin/../../..";
use Digest::SHA qw(sha256_hex);
use Encode qw(decode FB_CROAK);
use JSON::PP;
use S2;
use S2::Checker;
use S2::Compiler;

my $themes = @ARGV && $ARGV[0] eq "--themes" ? shift @ARGV : undef;
my $output = shift @ARGV // die "Expected artifact output path\n";
die "Expected one artifact output path\n" if @ARGV;
my $root = "$FindBin::Bin/../../../../..";
my @sources = ('styles/core2.s2', 'styles/core2base/layout.s2');
my @hashes = (
    '8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6',
    'c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411',
);
my $compiler = S2::Compiler->new({ checker => S2::Checker->new });
my @layers;
for my $index (0 .. 1) {
    open my $fh, '<:raw', "$root/$sources[$index]" or die "Cannot read stock source: $!\n";
    local $/;
    my $bytes = <$fh>;
    close $fh;
    die "Stock source hash mismatch\n" unless sha256_hex($bytes) eq $hashes[$index];
    my $source = decode('UTF-8', $bytes, FB_CROAK);
    my $code = '';
    $compiler->compile_source({
        type => $index ? 'layout' : 'core', source => \$source, output => \$code,
        layerid => "layer_$index", untrusted => 0, builtinPackage => 'S2::Builtin',
        format => 'javascript', sourcename => $sources[$index],
    });
    push @layers, {source => $sources[$index], sourceHash => $hashes[$index],
        variable => "layer_$index", code => $code};
}
my @themes;
if ($themes) {
    open my $source_fh, '<:raw', "$root/styles/core2base/themes.s2" or die "Cannot read themes\n";
    local $/;
    my $all = <$source_fh>;
    close $source_fh;
    for my $name (qw(dazzle kelis)) {
        my ($bytes) = $all =~ m{#NEWLAYER: core2base/\Q$name\E\n(.*?)(?=\n#NEWLAYER:|\z)}s;
        die "Missing theme\n" unless defined $bytes;
        my $source = decode('UTF-8', $bytes, FB_CROAK);
        my $code = '';
        $compiler->compile_source({type=>'theme',source=>\$source,output=>\$code,
            layerid=>"theme_$name",untrusted=>0,builtinPackage=>'S2::Builtin',format=>'javascript'});
        push @themes, {name=>$name,sourceHash=>sha256_hex($source),code=>$code};
    }
}
open my $fh, '>:raw', $output or die "Cannot write artifact: $!\n";
print {$fh} JSON::PP->new->canonical->utf8->encode({schema => 1, abi => 1, layers => \@layers, ($themes ? (themes=>\@themes) : ())});
close $fh or die "Cannot close artifact: $!\n";
system('cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
    "$FindBin::Bin/../live/render/sandbox.c", '-o', "$output.sandbox") == 0
    or die "Cannot build renderer isolation launcher\n";
print "Compiled two pinned stock layers with declared property metadata\n";

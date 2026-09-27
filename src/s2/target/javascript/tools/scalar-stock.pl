#!/usr/bin/perl
# scalar-stock.pl
#
# General scalar compiler coverage and independent stock/source execution oracle.
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
use lib "$FindBin::Bin/../../..", "$FindBin::Bin/../../../../../cgi-bin";
use File::Find;
use Storable qw(dclone);
use MIME::Base64 qw(encode_base64);
use JSON::PP;
use S2;
use S2::Compiler;
use S2::Checker;
require 'ljlib.pl';
require LJ::S2;
{
    no warnings qw(redefine once);
    *LJ::get_db_reader = *LJ::get_db_writer = *LJ::get_dbh = sub { die "DB forbidden\n" };
    *LJ::get_cluster_master = sub { die "DB forbidden\n" };
}
my $root = "$FindBin::Bin/../../../../..";
sub read_raw {
    open my $file, '<:raw', $_[0] or die $!;
    local $/;
    my $source = <$file>;
    close $file;
    return $source;
}
sub compile {
    my ($source, $type, $id, $format, $checker) = @_;
    my $compiler = S2::Compiler->new({checker => $checker});
    my $code = '';
    $compiler->compile_source({source => \$source, type => $type, layerid => $id,
        output => \$code, format => $format,
        builtinPackage => $format eq 'perl' ? 'S2::Builtin::LJ' : 'S2::Builtin',
        generalHashes => 1, generalScalars => 1});
    return ($code, $compiler->{checker});
}
my $source = read_raw("$root/styles/core2.s2");
my ($native, $parent) = compile($source, 'core', 901, 'perl', S2::Checker->new);
my ($js) = compile($source, 'core', 'layer_0', 'javascript', S2::Checker->new);
my @layers = ({name => 'core2', variable => 'layer_0', code => $js});
my @files;
find(sub {push @files, $File::Find::name if $_ eq 'layout.s2'}, "$root/styles");
my $layout_source = read_raw("$root/styles/venture/layout.s2");
my ($layout_native) = compile($layout_source, 'layout', 902, 'perl', dclone($parent));
for my $file (sort @files) {
    # The retained checker contains reference cycles. Each trusted stock compile
    # gets a fresh test process so the sweep does not retain 58 checker graphs.
    pipe(my $reader, my $writer) or die $!;
    my $pid = fork();
    die "Cannot fork stock oracle\n" unless defined $pid;
    if (!$pid) {
        close $reader;
        my ($code) = compile(read_raw($file), 'layout', 'layer_1', 'javascript', dclone($parent));
        (my $name = $file) =~ s{^\Q$root/styles/\E}{};
        print {$writer} JSON::PP->new->canonical->encode(
            {name => $name, variable => 'layer_1', code => $code});
        close $writer or die $!;
        exit 0;
    }
    close $writer;
    my $capture = do {local $/; <$reader>};
    close $reader;
    waitpid($pid, 0);
    die "Stock oracle compile failed\n" if $?;
    push @layers, JSON::PP->new->decode($capture);
}
S2::load_layer(901, $native, 1);
S2::load_layer(902, $layout_native, 1);
my $ctx = S2::make_context(901, 902);
my $comment = {_type => 'Comment', replies => [
    {_type => 'Comment', replies => [{_type => 'Comment', replies => []}]},
    {_type => 'Comment', replies => []}]};
my $count = S2::run_function($ctx, 'print_module_pagesummary_comment_count(Comment)', $comment);
my $font = S2::run_function($ctx, 'generate_font_css(string,string,string,string,string)',
    'Georgia', 'Arial', 'serif', '12', 'px');
my $byte_pv = pack('H*', 'e78cabc3a9');
my @builtin_cases = (
    {id => 'length', value => S2::Builtin::LJ::string__length($ctx, $byte_pv)},
    {id => 'index', value => S2::Builtin::LJ::string__index($ctx, $byte_pv, pack('H*', 'c3a9'), 0)},
    {id => 'substr', hex => unpack('H*', S2::Builtin::LJ::string__substr($ctx, $byte_pv, 0, 1))},
    {id => 'substr_invalid', hex => unpack('H*', S2::Builtin::LJ::string__substr($ctx, pack('H*', 'ff41'), 0, 1))},
    {id => 'lower', hex => unpack('H*', S2::Builtin::LJ::string__lower($ctx, 'AZ' . $byte_pv))},
    {id => 'upper', hex => unpack('H*', S2::Builtin::LJ::string__upper($ctx, 'az' . $byte_pv))},
    {id => 'upperfirst', hex => unpack('H*', S2::Builtin::LJ::string__upperfirst($ctx, 'az' . $byte_pv))},
    {id => 'ends_lf', value => 0 + S2::Builtin::LJ::string__ends_with($ctx, "x\n", 'x')},
    {id => 'replace', hex => unpack('H*', S2::Builtin::LJ::string__replace($ctx, 'a.a', '.', '!'))},
    {id => 'split', parts => S2::Builtin::LJ::string__split($ctx, 'a::', ':')},
    {id => 'compare', value => S2::Builtin::LJ::string__compare($ctx, 'a', 'b')},
    {id => 'repeat', hex => unpack('H*', S2::Builtin::LJ::string__repeat($ctx, 'ab', 2))},
);
my $color = S2::Builtin::LJ::Color__Color('#0ef');
my $long_source = 'layerinfo type = "core"; function main() {print ' .
    join('+', ('"a"') x 2000) . ';}';
my ($long_native) = compile($long_source, 'core', 903, 'perl', S2::Checker->new);
S2::load_layer(903, $long_native, 1);
my $output = '';
S2::set_output(sub {$output .= $_[0]});
S2::run_code(S2::make_context(903), 'main()');
sub layer {
    my ($id, $parent_id, $type, $text, $code) = @_;
    return {id => $id, ownerId => 11, parentId => $parent_id, type => $type, compiledTime => 1,
        sourceBase64 => encode_base64($text, ''), activeBase64 => encode_base64($code, '')};
}
print JSON::PP->new->canonical->encode({layers => \@layers, count => 0 + $count, font => $font,
    builtinRows => \@builtin_cases, color => $color,
    invalidColor => scalar S2::Builtin::LJ::Color__Color("#123456\n"),
    snapshot => {styleId => 902, systemUserId => 11, layers => [
        layer(901, 0, 'core', $source, $native),
        layer(902, 901, 'layout', $layout_source, $layout_native)]},
    longSnapshot => {styleId => 903, systemUserId => 11, layers => [
        layer(903, 0, 'core', $long_source, $long_native)]},
    longOutputBase64 => encode_base64($output, '')});

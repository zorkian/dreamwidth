#!/usr/bin/perl
# scalar-native.pl
#
# Raw independent native oracle for the maintained synthetic scalar source.
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
use S2;
use S2::Compiler;
use S2::Checker;
use MIME::Base64 qw(encode_base64);
use JSON::PP;
use Config;
use Encode qw(decode_utf8 encode_utf8);
open my $file, '<:raw', "$FindBin::Bin/../../../tests/js-replacement/scalars.s2" or die $!;
local $/;
my $source = <$file>;
close $file;
my $code = '';
S2::Compiler->new({checker => S2::Checker->new})->compile_source({type => 'core',
    source => \$source, output => \$code, layerid => 201, format => 'perl',
    builtinPackage => 'S2::Builtin::LJ'});
S2::load_layer(201, $code, 1);
my $output = '';
S2::set_output(sub { $output .= $_[0] });
S2::set_output_safe(sub { die 'Unexpected safe output' });
S2::run_code(S2::make_context(201), 'main()');
my @cases;
for my $hex ('c39f', 'c4b0', 'ce9fcea3', 'c7b3') {
    my $pv = decode_utf8(pack('H*', $hex));
    push @cases, {input => $hex, lower => unpack('H*', encode_utf8(lc($pv))),
        upper => unpack('H*', encode_utf8(uc($pv))), title => unpack('H*', encode_utf8(ucfirst($pv)))};
}
my $byte_pv = pack('H*', 'e78cabc3a9');
my $invalid_pv = pack('H*', 'ff41');
my @builtin_cases = (
    {id => 'length', value => length($byte_pv)},
    {id => 'index', value => index($byte_pv, pack('H*', 'c3a9'))},
    {id => 'substr', hex => unpack('H*', encode_utf8(substr(decode_utf8($byte_pv), 0, 1)))},
    {id => 'substr_invalid', hex => unpack('H*', encode_utf8(substr(decode_utf8($invalid_pv), 0, 1)))},
    {id => 'lower', hex => unpack('H*', lc('AZ' . $byte_pv))},
    {id => 'upper', hex => unpack('H*', uc('az' . $byte_pv))},
    {id => 'upperfirst', hex => unpack('H*', ucfirst('az' . $byte_pv))},
    {id => 'ends_lf', value => ("x\n" =~ /\Qx\E$/) ? 1 : 0},
    {id => 'replace', hex => do {my $v = 'a.a'; $v =~ s/\Q.\E/!/g; unpack('H*', $v)}},
    {id => 'split', parts => [split(/\Q:\E/, 'a::')]},
    {id => 'compare', value => 'b' cmp 'a'},
    {id => 'repeat', hex => unpack('H*', 'ab' x 2)},
);
print JSON::PP->new->canonical->encode({caseRows => \@cases, builtinRows => \@builtin_cases,
    outputBase64 => encode_base64($output, ''),
    outputUtf8 => utf8::is_utf8($output) ? JSON::PP::true : JSON::PP::false,
    profile => {version => "$^V", ivsize => $Config{ivsize}, uvsize => $Config{uvsize},
        nvsize => $Config{nvsize}, nvtype => $Config{nvtype}},
    snapshot => {styleId => 201, systemUserId => 11, layers => [{id => 201, ownerId => 11,
        parentId => 0, type => 'core', compiledTime => 1,
        sourceBase64 => encode_base64($source, ''), activeBase64 => encode_base64($code, '')}]}});

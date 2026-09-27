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
print JSON::PP->new->canonical->encode({caseRows => \@cases,
    outputBase64 => encode_base64($output, ''),
    outputUtf8 => utf8::is_utf8($output) ? JSON::PP::true : JSON::PP::false,
    profile => {version => "$^V", ivsize => $Config{ivsize}, uvsize => $Config{uvsize},
        nvsize => $Config{nvsize}, nvtype => $Config{nvtype}},
    snapshot => {styleId => 201, systemUserId => 11, layers => [{id => 201, ownerId => 11,
        parentId => 0, type => 'core', compiledTime => 1,
        sourceBase64 => encode_base64($source, ''), activeBase64 => encode_base64($code, '')}]}});

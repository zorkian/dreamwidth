#!/usr/bin/perl
# compile-active.pl
#
# Compile source candidates only when they reproduce the authoritative active program.
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
use JSON::PP;
use MIME::Base64 qw(decode_base64 encode_base64);
use Digest::SHA qw(sha256_hex);
use Storable qw(dclone);
use S2::Compiler;
use S2::Checker;
use Config;
use Unicode::UCD;

binmode STDIN, ':raw';
binmode STDOUT, ':raw';
my $json = JSON::PP->new->canonical->utf8;
my $result;
eval {
    local $/;
    my $bytes = <STDIN>;
    die "input" if !defined($bytes) || length($bytes) > 134217728;
    my $request = $json->decode($bytes);
    die "input" unless ref($request) eq 'HASH';
    if ($request->{profileOnly}) {
        my %profile = map { $_ => $Config{$_} } qw(version archname ivsize uvsize nvsize nvtype nv_preserves_uv_bits);
        $profile{unicodeVersion} = Unicode::UCD::UnicodeVersion();
        for my $spec (['lower','Lowercase_Mapping'], ['upper','Uppercase_Mapping'], ['title','Titlecase_Mapping']) {
            my ($ranges, $values, $format, $default) = Unicode::UCD::prop_invmap($spec->[1]);
            die "profile" unless $format eq 'al' && $default == 0;
            $profile{$spec->[0]} = {ranges => $ranges, values => [map { ref($_) eq 'ARRAY' ? [map {0 + $_} @$_] : 0 + $_ } @$values]};
        }
        my @sources;
        for my $name (sort keys %INC) {
            next unless $name =~ m{^(?:Unicode/|unicore/|Config)};
            my $file = $INC{$name};
            open my $source, '<:raw', $file or die "profile";
            local $/;
            my $data = <$source>;
            close $source;
            push @sources, {file => $file, digest => sha256_hex($data)};
        }
        $result = {kind => 'profile', profile => \%profile, sources => \@sources};
    } else {
    die "input" unless ref($request->{layers}) eq 'ARRAY';
    die "input" unless $request->{systemUserId} =~ /^\d+$/ && $request->{systemUserId} > 0;
    my %checkers;
    my @compiled;
    for my $layer (@{ $request->{layers} }) {
        die "input" unless ref($layer) eq 'HASH';
        my ($id, $type) = @$layer{qw(id type)};
        die "input" unless $id =~ /^\d+$/ && $id > 0 && $id <= 4294967295;
        die "input" unless $type =~ /^(core|layout|theme|user|i18n|i18nc)$/;
        die "input" unless $layer->{ownerId} =~ /^\d+$/ && $layer->{ownerId} > 0;
        my $untrusted = $layer->{ownerId} != $request->{systemUserId};
        my $source = decode_base64($layer->{sourceBase64});
        my $active = decode_base64($layer->{activeBase64});
        die "input" unless encode_base64($source, '') eq $layer->{sourceBase64}
            && encode_base64($active, '') eq $layer->{activeBase64};
        die "input" if length($source) > 16777215 || length($active) > 16777215;
        my $parent = $type eq 'core' ? S2::Checker->new : $checkers{$layer->{parentId}};
        die "dependency" unless $parent;
        my $native = '';
        my $native_compiler = S2::Compiler->new({checker => dclone($parent)});
        eval {
            $native_compiler->compile_source({type => $type, source => \$source,
                output => \$native, layerid => $id, untrusted => $untrusted,
                builtinPackage => 'S2::Builtin::LJ', format => 'perl'});
        };
        # A saved source candidate may itself be invalid while older code remains
        # active. That is another recovery dependency, never an active-code ban.
        if ($@ || $native ne $active) {
            $result = {kind => 'recovery', layerId => 0 + $id,
                reason => 'active-source-correspondence',
                candidateSha256 => sha256_hex($native), activeSha256 => sha256_hex($active)};
            last;
        }
        # Both checkers see the same raw bytes. General scalar literals serialize
        # octets as hex, never a Unicode decode/reencode of stored source.
        my $text = $source;
        my $js = '';
        my $compiler = S2::Compiler->new({checker => dclone($parent)});
        my $variable = 'layer_' . scalar(@compiled);
        $compiler->compile_source({type => $type, source => \$text, output => \$js,
            layerid => $variable, untrusted => $untrusted,
            builtinPackage => 'S2::Builtin', format => 'javascript', generalHashes => 1, generalScalars => 1});
        $checkers{$id} = $native_compiler->{checker};
        push @compiled, {id => 0 + $id, variable => $variable, code => $js};
    }
    $result ||= {kind => 'compiled', layers => \@compiled};
    }
};
# Compiler diagnostics contain paths and original input. Keep them out of the
# parent-facing response/log; separate offline native tooling supplies diagnostics.
$result = {kind => 'failed', reason => 'compile'} if $@;
print $json->encode($result);

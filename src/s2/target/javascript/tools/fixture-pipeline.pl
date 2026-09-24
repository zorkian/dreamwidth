#!/usr/bin/perl
#
# fixture-pipeline.pl
#
# Compile the bounded S2 fixtures through the retained frontend and run the Perl oracle.
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
use Encode ();
use JSON::PP;
use S2;
use S2::Checker;
use S2::Compiler;

binmode STDOUT, ':raw';
binmode STDERR, ':encoding(UTF-8)';

my $mode = shift @ARGV // die "Expected compile or oracle mode\n";
die "Expected compile or oracle mode\n" unless $mode eq 'compile' || $mode eq 'oracle';
die "Expected at least one layer\n" unless @ARGV;

my $checker  = S2::Checker->new;
my $compiler = S2::Compiler->new( { checker => $checker } );
my @layers;

for my $index ( 0 .. $#ARGV ) {
    my ( $type, $path ) = split /:/, $ARGV[$index], 2;
    die "Expected core or layout layer and source path\n"
        unless defined $path && ( $type eq 'core' || $type eq 'layout' );
    # Production Perl compiles the original source bytes. Decode only for JS
    # output so JSON contains valid Unicode text for Node to evaluate.
    my $source_mode = $mode eq 'compile' ? '<:encoding(UTF-8)' : '<:raw';
    open my $source_file, $source_mode, $path or die "Cannot read $path: $!\n";
    local $/;
    my $source = <$source_file>;
    close $source_file;

    my $compiled = '';
    eval {
        $compiler->compile_source(
            {
                type           => $type,
                source         => \$source,
                output         => \$compiled,
                layerid        => $mode eq 'compile' ? "layer_$index" : $index + 1,
                untrusted      => 0,
                builtinPackage => 'S2::Builtin',
                format         => $mode eq 'compile' ? 'javascript' : 'perl',
                sourcename     => $path,
            }
        );
    };
    die "$path: $@" if $@;

    if ( $mode eq 'compile' ) {
        push @layers, { source => $path, code => $compiled, variable => "layer_$index" };
    }
    else {
        my $result = eval $compiled;
        die "Perl oracle eval failed for $path: $@\n" if $@ || !$result;
    }
}

if ( $mode eq 'compile' ) {
    print JSON::PP->new->canonical->utf8->encode( { abi => 1, layers => \@layers } );
}
else {
    my $output = '';
    S2::set_output( sub { $output .= $_[0] } );
    S2::set_run_timeout(0);
    my $layer_ids = [ 1 .. scalar @ARGV ];
    my $context   = S2::make_context($layer_ids);
    S2::run_code( $context, 'main()' );
    # Oracle output is already UTF-8 bytes, including string__substr below.
    print $output;
}

package S2::Builtin;

# Color matches the small fixture implementation in src/s2/runtests.pl.
sub Color__Color {
    my ($value) = @_;
    $value =~ s/^\#//;
    return if $value =~ /[^a-fA-F0-9]/ || length($value) != 6;
    my $color = { _type => 'Color' };
    $color->{r} = hex substr( $value, 0, 2 );
    $color->{g} = hex substr( $value, 2, 2 );
    $color->{b} = hex substr( $value, 4, 2 );
    $color->{as_string} = sprintf '#%02x%02x%02x', $color->{r}, $color->{g}, $color->{b};
    return $color;
}

sub string__length {
    my ( $context, $value ) = @_;
    # cgi-bin/LJ/S2.pm string__length counts source UTF-8 bytes.
    return length($value);
}

sub string__substr {
    my ( $context, $value, $start, $length ) = @_;
    # cgi-bin/LJ/S2.pm string__substr decodes, slices characters, then
    # encodes the result back to UTF-8 bytes.
    my $unicode = Encode::decode_utf8($value);
    return Encode::encode_utf8( substr( $unicode, $start, $length ) );
}

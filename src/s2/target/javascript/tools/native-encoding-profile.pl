#!/usr/bin/perl
# native-encoding-profile.pl
#
# Trusted installed native charset registry and mapping extraction.
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
use lib "$FindBin::Bin/../../../../../cgi-bin";
use DBI ();
our $database_attempted;

BEGIN {
    no warnings 'redefine';
    *DBI::connect =
        sub { $database_attempted = 1; die "Database access forbidden in encoding extraction\n" };
    *DBI::connect_cached =
        sub { $database_attempted = 1; die "Database access forbidden in encoding extraction\n" };
}
use LJ::ConvUTF8;
use Unicode::CheckUTF8;
use Cwd qw(abs_path);
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use File::Find ();
# Unicode::String loads this lazily in UTF7; bind its PM and XS source too.
use MIME::Base64 ();
my ( %names, %converters, %files );

sub file_bytes {
    my ($file) = @_;
    $file = abs_path($file) // die "Encoding dependency missing\n";
    open my $in, '<:raw', $file or die "Encoding dependency unavailable\n";
    local $/;
    my $bytes = <$in>;
    close $in;
    $files{$file} = sha256_hex($bytes);
    return $bytes;
}
file_bytes( abs_path(__FILE__) );
file_bytes( abs_path($^X) );
file_bytes( "$FindBin::Bin/../../../../../cgi-bin/LJ/TextUtil.pm" );
my $registry = Unicode::Map->new;
my %mapids   = map { lc($_) => $_ } $registry->ids;
my %string   = map { $_ => 1 } qw(utf8 ucs2 ucs4 utf7 utf16);
my %jcode    = map { $_ => 1 }
    qw(sjis s-jis s_jis shiftjis shift-jis shift_jis iso-2022-jp iso_2022_jp jis euc-jp);
my $aliases = Unicode::MapUTF8::utf8_charset_alias();

for my $name ( Unicode::MapUTF8::utf8_supported_charset() ) {
    my $base = $aliases->{$name} // $name;
    if ( $string{$base} ) {
        $names{ lc($name) } = "string:$base";
        $converters{"string:$base"} = { kind => 'string', name => $base };
        next;
    }
    if ( $jcode{$base} ) {
        $names{ lc($name) } = "jcode:$base";
        $converters{"jcode:$base"} = { kind => 'jcode', name => $base };
        next;
    }
    if ( my $map = Unicode::Map8->new($base) ) {
        my $canonical = $map->{charset};
        my $id        = "map8:$canonical";
        $names{ lc($name) } = $id;
        next if $converters{$id};
        my @entries = map { unpack( 'H*', $map->to16( chr($_) ) ) } 0 .. 255;
        $converters{$id} = { kind => 'map8', entries => \@entries };
        next;
    }
    my $map = Unicode::Map->new( $mapids{ lc($base) } // die "Unclassified installed encoding\n" );
    my $canonical = $map->{P_CSID};
    my $id        = "map:$canonical";
    $names{ lc($name) } = $id;
    next if $converters{$id};
    my $raw = file_bytes( $map->mapping($canonical) );
    my ( %unicode, %custom );

    if ( !$map->_read_binary_mapping( $raw, 0, \%unicode, \%custom ) ) {
        $converters{$id} = {
            kind       => 'map',
            failedLoad => JSON::PP::true,
            failedHex  => unpack( 'H*', LJ::ConvUTF8->to_utf8( $base, '' ) ),
            groups     => []
        };
        next;
    }
    my @groups;
    for my $group (
        sort {
            my @a = split /,/, $a;
            my @b = split /,/, $b;
            $b[0] * $b[1] <=> $a[0] * $a[1] || $a cmp $b
        } keys %unicode
        )
    {
        my @format = split /,/, $group;
        push @groups,
            {
            width   => 0 + $format[0] * $format[1],
            entries => [
                map { [ unpack( 'H*', $_ ), unpack( 'H*', $unicode{$group}{$_} ) ] }
                sort keys %{ $unicode{$group} }
            ]
            };
    }
    $converters{$id} = { kind => 'map', groups => \@groups };
}

# Extract complete finite code-unit maps for installed Encode Japanese branches.
# Decoder framing/state remains source algorithms, not a table of whole inputs.
my %jp;
for my $encoding ( 'shiftjis', 'euc-jp' ) {
    my %entries;
    my @candidates = map { chr($_) } 0 .. 255;
    if ( $encoding eq 'shiftjis' ) {
        for my $lead ( 0x81 .. 0x9f, 0xe0 .. 0xfc ) {
            push @candidates, map { chr($lead) . chr($_) } 0x40 .. 0x7e, 0x80 .. 0xfc;
        }
    }
    else {
        for my $lead ( 0xa1 .. 0xfe ) {
            push @candidates, map { chr($lead) . chr($_) } 0xa1 .. 0xfe;
        }
        push @candidates, map { "\x8e" . chr($_) } 0x80 .. 0xff;
        for my $lead ( 0xa1 .. 0xfe ) {
            push @candidates, map { "\x8f" . chr($lead) . chr($_) } 0xa1 .. 0xfe;
        }
    }
    for my $bytes (@candidates) {
        my $decoded;
        if ( length($bytes) > 1 ) {
            $decoded =
                eval { my $copy = $bytes; Encode::decode( $encoding, $copy, Encode::FB_CROAK ) };
            next if $@;
        }
        else { $decoded = Encode::decode( $encoding, $bytes ); }
        $entries{ unpack( 'H*', $bytes ) } = unpack( 'H*', Encode::encode_utf8($decoded) );
    }
    $jp{$encoding} = \%entries;
}
my %encode_euc;
for my $output ( values %{ $jp{'euc-jp'} } ) {
    my $characters = Encode::decode_utf8( pack( 'H*', $output ) );
    $encode_euc{$output} = unpack( 'H*', Encode::encode( 'euc-jp', $characters ) );
}
my %h2z;
for my $first ( 0xa1 .. 0xdf ) {
    for my $suffix ( '', chr(0xde), chr(0xdf) ) {
        my $raw        = "\x8e" . chr($first) . ( length($suffix) ? "\x8e" . $suffix : '' );
        my $normalized = $raw;
        Encode::JP::H2Z::h2z( \$normalized );
        $h2z{ unpack( 'H*', $raw ) } = unpack( 'H*', $normalized );
    }
}

# Map8 resolves aliases from files rather than %INC. Bind the whole installed
# mapping directory, including alias registry and alternate binary/text sources.

( my $map_root = $INC{'Unicode/Map.pm'} ) =~ s/\.pm$//;
File::Find::find(
    {
        no_chdir => 1,
        wanted   => sub { file_bytes($File::Find::name) if -f $File::Find::name }
    },
    $map_root
);
File::Find::find(
    {
        no_chdir => 1,
        wanted   => sub { file_bytes($File::Find::name) if -f $File::Find::name }
    },
    $Unicode::Map8::MAPS_DIR
);
for my $module ( sort keys %INC ) {
    file_bytes( $INC{$module} ) if -f $INC{$module};
}

# Loaded XS images are interpreter dependencies just as much as their wrappers.
for my $file (@DynaLoader::dl_shared_objects) { file_bytes($file) if -f $file; }
die "Database access attempted during encoding extraction\n" if $database_attempted;
binmode STDOUT, ':raw';
print JSON::PP->new->canonical->utf8->encode(
    {
        schema     => 1,
        perl       => "$]",
        names      => \%names,
        converters => \%converters,
        japanese   => \%jp,
        encodeEuc  => \%encode_euc,
        h2z        => \%h2z,
        sources    => [ map { { path => $_, sha256 => $files{$_} } } sort keys %files ]
    }
);

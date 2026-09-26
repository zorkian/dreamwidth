#!/usr/bin/perl
# crossposts-native.pl
#
# Independent selected crosspost Storable bytes and retained current wrappers.
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
use utf8;
use lib "$ENV{LJHOME}/cgi-bin";
require 'ljlib.pl';
use DW::External::Account;
use Storable qw(thaw);
use JSON::PP;
use Encode qw(encode_utf8);
my $shared = { itemid => 123, url => 'https://example.test/shared' };
my @samples = (
    [ empty => {} ],
    [ simple => { 1 => { itemid => 123, url => 'https://example.test/123' } } ],
    [ two => { 2 => { itemid => 456, url => '/relative?q=a&b=c' },
               1 => { itemid => 123, url => 'https://example.test/123' } } ],
    [ unicode => { 1 => { itemid => '123', url => "https://example.test/caf\x{e9}/\x{1f642}" } } ],
    [ quote => { 1 => { itemid => 123, url => "https://example.test/a'" } } ],
    [ entity => { 1 => { itemid => 123, url => 'https://example.test/a?x=&quot;&y=<a>' } } ],
    [ feature => { 1 => { itemid => 123, url => "https://example.test/caf\x{e9}/\x{1f642}" },
        2 => { itemid => 124, url => '/relative?q=a&b=c' },
        3 => { itemid => 125, url => 'https://example.test/a?x=&quot;&y=<a>' },
        4 => { itemid => 126, url => "https://example.test/a'" } } ],
    [ active => { 1 => { itemid => 123, url => 'javascript:alert(1)' } } ],
    [ false => { 1 => { itemid => 123, url => '0' }, 2 => undef, 3 => { itemid => 4 } } ],
    [ long => { 1 => { itemid => 123, url => 'https://example.test/' . ( 'x' x 260 ) } } ],
    [ utf8bytes => { 1 => { itemid => 456, url => encode_utf8("https://example.test/caf\x{e9}/\x{1f642}") } } ],
    [ latin1byte => { 1 => { itemid => 123, url => "https://example.test/caf\xe9" } } ],
    [ invalidbyte => { 1 => { itemid => 123, url => "https://example.test/\xff" } } ],
    [ longutf8 => { 1 => { itemid => '456', url => "https://example.test/" . ( "\x{1f642}" x 70 ) } } ],
    [ alias => { 1 => $shared, 2 => $shared } ],
    [ blessed => { 1 => bless( { itemid => 123, url => 'https://example.test/blessed' }, 'SyntheticNativeReference' ) } ],
    [ arrayvalue => { 1 => [ 123, 'https://example.test/array' ] } ],
    [ numericurl => { 1 => { itemid => 123, url => 123 } } ],
    [ overbound => { 1 => { itemid => 123, url => 'https://example.test/' . ( 'x' x 8192 ) } } ],
);
no warnings qw(redefine once);
local *LJ::get_db_reader = sub { die 'No database reads' };
local *LJ::get_db_writer = sub { die 'No database writes' };
my @rows;
for my $sample (@samples) {
    my ( $id, $input ) = @$sample;
    my $bytes = DW::External::Account->xpost_hash_to_string($input);
    my ( %current, $error );
    eval { %current = LJ::currents( { xpostdetail => $bytes }, undef ); 1 } or $error = $@;
    push @rows, { id => $id, hex => unpack( 'H*', $bytes ), bytes => length($bytes),
        nativeXpostPresent => exists( $current{Xpost} ) ? JSON::PP::true : JSON::PP::false,
        nativeHtmlHex => unpack( 'H*', $current{Xpost} // '' ), nativeError => $error };
}
my $ordinary = DW::External::Account->xpost_hash_to_string( { 1 => { itemid => 123, url => 'https://example.test/123' } } );
for my $sample ( [ trailing => $ordinary . 'junk' ], [ truncated => substr( $ordinary, 0, -1 ) ] ) {
    my ( $decoded, $error );
    eval { $decoded = thaw( $sample->[1] ); 1 } or $error = $@;
    push @rows, { id => $sample->[0], hex => unpack( 'H*', $sample->[1] ),
        nativeThawAccepted => defined($decoded) ? JSON::PP::true : JSON::PP::false, nativeError => $error };
}
print JSON::PP->new->canonical->utf8->encode( { version => $Storable::VERSION,
    opaqueHex => unpack('H*',DW::External::Account->xpost_hash_to_string({1=>123,2=>124,3=>125,4=>126})),
    writeVersion => Storable::BIN_WRITE_VERSION_NV(), magic => Storable::read_magic($ordinary), rows => \@rows } );

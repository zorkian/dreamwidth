# native-entities.pl
#
# Independent native scalar entity and attribute projection oracle.
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
use HTML::Entities ();
use HTML::Parser;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
open my $native, '<:raw', $INC{'HTML/Entities.pm'} or die "Native entity source unavailable";
my $native_bytes = do { local $/; <$native> };
close $native;
my @inputs = (
    'Image',                             'Café 😀',
    '&amp;amp;',                         '&notit;',
    '&not=',                             '&amp=',
    '&AMP;',                             '&apos;',
    '&NoBreak;',                         '&Tab;',
    '&NewLine;',                         '&fjlig;',
    '&CounterClockwiseContourIntegral;', '&unknown;',
    '&#;',                               '&#x;',
    '&#-1;',                             '&#+65;',
    '&1amp;',                            '&amp_',
    '&ampé',                            '&amp0',
    '&constructor;',                     '&toString;',
    '&__proto__;',                       '&amp:',
    '&amp-',                             '&amp.',
    '&amp\r',                            '&&amp;;',
    '&#x000000000000000001f600;'
);

for my $key ( sort keys %HTML::Entities::entity2char ) {
    my $bare = $key;
    $bare =~ s/;$//;
    push @inputs, map { '&' . $bare . $_ } ( ';', '', 'x', '1', '=', '=x', ' x', ';;', '_', 'é' );
}
for my $n (
    0 .. 160,
    0xd7ff .. 0xd801,
    0xdffe .. 0xe000,
    0xfdcf .. 0xfdf0,
    0xfffd .. 0x10001,
    0x1fffd .. 0x20001,
    0x10fffd .. 0x110001,
    4294967295,
    4294967296
    )
{
    push @inputs, map {
        my $v = $_;
        map { $v . $_ } ( ';', '', 'x', 'g' )
    } ( '&#' . $n, '&#x' . sprintf( '%x', $n ), '&#X' . sprintf( '%X', $n ), '&#000' . $n );
}
push @inputs, map { '&#' . $_ . ';' } ( '9' x 20, '0' x 32 . '65', '0' x 80 . '65' );
my %seen;
@inputs = grep { !$seen{$_}++ } @inputs;
my @rows;
for my $s (@inputs) {
    my $v;
    my $p = HTML::Parser->new( api_version => 3, start_h => [ sub { $v = $_[0]{alt} }, 'attr' ] );
    $p->parse( '<img alt="' . $s . '">' );
    $p->eof;
    push @rows, { input => $s, parser => $v, entities => HTML::Entities::decode_entities($s) };
}
print JSON::PP->new->canonical->utf8->encode( { version => $HTML::Entities::VERSION, sourceSha256 => sha256_hex($native_bytes), names => [ sort keys %HTML::Entities::entity2char ], rows => \@rows } );

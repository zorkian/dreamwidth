#!/usr/bin/perl
#
# cleaner-native-entry-oracle.pl
#
# Reclean native clean_event input bytes as new html_raw0 entry records.
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
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use Digest::SHA qw(sha256_hex);
use Encode ();
use JSON::PP;
use LJ::CleanHTML;
use MIME::Base64 qw(decode_base64 encode_base64);

my ($manifest_path) = @ARGV;
die "Usage: perl cleaner-native-entry-oracle.pl <native-derived-entry-cases.json>\n"
    unless defined $manifest_path && @ARGV == 1 && -f $manifest_path;
open my $fh, '<:raw', $manifest_path or die "Cannot read derived manifest: $!\n";
local $/;
my $source = <$fh>;
close $fh;
my $manifest = JSON::PP->new->utf8->decode($source);
die "Unexpected native-derived entry manifest\n"
    unless ref $manifest eq 'HASH' && ($manifest->{schema} // 0) == 1
    && ($manifest->{kind} // '') eq 'native-call-derived-html_raw0-replay'
    && ($manifest->{perlInputEncoding} // '') eq 'raw-utf8-bytes-from-logtext2'
    && ref $manifest->{cases} eq 'ARRAY' && @{ $manifest->{cases} } == 384
    && ref $manifest->{omitted} eq 'ARRAY' && !@{ $manifest->{omitted} }
    && ref $manifest->{perlOptions} eq 'HASH'
    && ($manifest->{perlOptions}{editor} // '') eq 'html_raw0'
    && ($manifest->{perlOptions}{cuturl} // '') eq $manifest->{entryUrl}
    && ($manifest->{perlOptions}{journal} // '') eq 's2js_slice3'
    && ($manifest->{perlOptions}{ditemid} // 0) == 123;

my %seen;
my @records;
for my $case (@{ $manifest->{cases} }) {
    die "Invalid native-derived replay case\n"
        unless ref $case eq 'HASH'
        && ($case->{id} // '') =~ m{^t/cleaner-[a-z-]+\.t#call-[0-9]{4}:html_raw0$}
        && !$seen{ $case->{id} }++
        && ($case->{nativeMethod} // '') eq 'clean_event'
        && ($case->{replayInputUtf8Flag} // 1) == 0
        && ($case->{rawInputBytes} // -1) <= 65536;
    my $value = decode_base64($case->{rawInputBase64} // '');
    die "Native-derived input bytes changed\n"
        unless length($value) == $case->{rawInputBytes}
        && sha256_hex($value) eq $case->{rawInputSha256};
    my $validation_copy = $value;
    Encode::decode('UTF-8', $validation_copy, Encode::FB_CROAK);
    my %opts = %{ $manifest->{perlOptions} };
    my $ok = eval { LJ::CleanHTML::clean_event(\$value, \%opts); 1 };
    my $error = $@;
    my $output_bytes = Encode::is_utf8($value)
        ? Encode::encode('UTF-8', $value) : $value;
    push @records, {
        id => $case->{id},
        nativeSource => $case->{nativeSource},
        nativeCallOrdinal => $case->{nativeCallOrdinal},
        nativeContext => $case->{nativeContext},
        perlOptions => \%opts,
        inputSha256 => $case->{rawInputSha256},
        inputUtf8Flag => JSON::PP::false,
        outputUtf8Flag => Encode::is_utf8($value) ? JSON::PP::true : JSON::PP::false,
        outputBase64 => encode_base64($output_bytes, ''),
        outputSha256 => sha256_hex($output_bytes),
        outputBytes => length($output_bytes),
        died => $ok ? JSON::PP::false : JSON::PP::true,
        error => $ok ? undef : $error,
    };
}
binmode STDOUT, ':raw';
print JSON::PP->new->canonical->utf8->pretty->encode({
    schema => 1,
    kind => 'retained-perl-native-derived-html_raw0-output',
    manifestSha256 => sha256_hex($source),
    records => \@records,
});

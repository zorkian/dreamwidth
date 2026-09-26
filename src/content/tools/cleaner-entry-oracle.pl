#!/usr/bin/perl
#
# cleaner-entry-oracle.pl
#
# Record retained Perl output for separate synthetic html_raw0 entry replays.
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
use MIME::Base64 qw(encode_base64);

my ($manifest_path) = @ARGV;
die "Usage: perl cleaner-entry-oracle.pl <entry-replay-cases.json>\n"
    unless defined $manifest_path && @ARGV == 1 && -f $manifest_path;
open my $fh, '<:raw', $manifest_path or die "Cannot open replay manifest: $!\n";
local $/;
my $manifest = JSON::PP->new->utf8->decode(<$fh>);
close $fh;
die "Unexpected entry replay manifest\n"
    unless ref $manifest eq 'HASH' && ($manifest->{schema} // 0) == 1
    && ($manifest->{kind} // '') eq 'distinct-html_raw0-entry-replay'
    && ref $manifest->{cases} eq 'ARRAY' && @{ $manifest->{cases} } == 26
    && ref $manifest->{perlOptions} eq 'HASH'
    && ($manifest->{perlInputEncoding} // '') eq 'raw-utf8-bytes-from-logtext2'
    && ($manifest->{perlOptions}{editor} // '') eq 'html_raw0'
    && ($manifest->{perlOptions}{cuturl} // '') eq $manifest->{entryUrl}
    && ($manifest->{perlOptions}{journal} // '') eq 's2js_slice3'
    && ($manifest->{perlOptions}{ditemid} // 0) == 123;
my %seen;
my @records;
for my $case (@{ $manifest->{cases} }) {
    die "Invalid replay case\n"
        unless ref $case eq 'HASH' && ($case->{id} // '') =~ /^[a-z][a-z0-9-]{1,60}$/
        && !$seen{ $case->{id} }++ && !ref $case->{body}
        && defined $case->{body} && length($case->{body}) <= 65536
        && ref $case->{reparse} eq 'ARRAY' && @{ $case->{reparse} };
    my %opts = %{ $manifest->{perlOptions} };
    if (exists $case->{options}) {
        die "Invalid replay option object\n" unless ref $case->{options} eq 'HASH';
        for my $key (keys %{ $case->{options} }) {
            die "Unapproved replay option\n"
                unless $key =~ /^(?:remove_colors|remove_sizes|remove_fonts)$/
                && $case->{options}{$key} == 1;
            $opts{$key} = $case->{options}{$key};
        }
    }
    # LJ::Entry::_load_text receives unflagged UTF-8 bytes from get_logtext2;
    # the source body in the JSON manifest is Unicode only for readable corpus
    # storage. Feed the real cleaner the same byte/flag shape as event_html.
    my $value = Encode::encode('UTF-8', $case->{body});
    my $input_utf8 = Encode::is_utf8($value) ? JSON::PP::true : JSON::PP::false;
    my $input_bytes = Encode::is_utf8($value)
        ? Encode::encode('UTF-8', $value) : $value;
    my $ok = eval { LJ::CleanHTML::clean_event(\$value, \%opts); 1 };
    my $error = $@;
    my $output_bytes = Encode::is_utf8($value)
        ? Encode::encode('UTF-8', $value) : $value;
    push @records, {
        id => $case->{id},
        source => $case->{source},
        reparse => $case->{reparse},
        perlOptions => \%opts,
        inputUtf8Flag => $input_utf8,
        inputSha256 => sha256_hex($input_bytes),
        inputBytes => length($input_bytes),
        outputUtf8Flag => Encode::is_utf8($value) ? JSON::PP::true : JSON::PP::false,
        outputBase64 => encode_base64($output_bytes, ''),
        outputSha256 => sha256_hex($output_bytes),
        outputBytes => length($output_bytes),
        died => $ok ? JSON::PP::false : JSON::PP::true,
        error => $ok ? undef : $error,
    };
}
my $result = {
    schema => 1,
    kind => 'retained-perl-entry-html_raw0-output',
    manifestSha256 => sha256_hex(do {
        open my $raw, '<:raw', $manifest_path or die "Cannot reread manifest: $!\n";
        local $/;
        <$raw>;
    }),
    records => \@records,
};
binmode STDOUT, ':raw';
print JSON::PP->new->canonical->utf8->pretty->encode($result);

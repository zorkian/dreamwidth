#!/usr/bin/perl
#
# cleaner-native-capture.pl
#
# Record byte-exact LJ::CleanHTML calls from unmodified native test suites.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

package DW::Content::NativeCapture;

use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use Encode ();
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use Test::Builder;

my $ordinal = 0;

sub bytes {
    my ($text) = @_;
    return undef unless defined $text;
    return Encode::is_utf8($text) ? Encode::encode('UTF-8', $text) : $text;
}

sub record {
    my ($method, $before, $after, $options, $source_file, $source_line, $error) = @_;
    my $before_bytes = bytes($before);
    my $after_bytes = bytes($after);
    my (%scalar_options, @ref_keys);
    if (ref $options eq 'HASH') {
        for my $key (sort keys %$options) {
            if (ref $options->{$key}) { push @ref_keys, $key; }
            else { $scalar_options{$key} = $options->{$key}; }
        }
    }
    my $case = {
        suite => $ENV{S2_NATIVE_SUITE},
        callOrdinal => ++$ordinal,
        beforeTap => Test::Builder->new->current_test,
        source => $ENV{S2_NATIVE_SOURCE},
        sourceLine => $source_line,
        directCallerFile => $source_file,
        method => $method,
        scalarOptions => \%scalar_options,
        optionRefKeys => \@ref_keys,
        inputPresent => defined $before ? JSON::PP::true : JSON::PP::false,
        inputUtf8Flag => defined $before && Encode::is_utf8($before)
            ? JSON::PP::true : JSON::PP::false,
        inputBase64 => defined $before_bytes ? encode_base64($before_bytes, '') : undef,
        inputSha256 => defined $before_bytes ? sha256_hex($before_bytes) : undef,
        outputPresent => defined $after ? JSON::PP::true : JSON::PP::false,
        outputUtf8Flag => defined $after && Encode::is_utf8($after)
            ? JSON::PP::true : JSON::PP::false,
        outputBase64 => defined $after_bytes ? encode_base64($after_bytes, '') : undef,
        outputSha256 => defined $after_bytes ? sha256_hex($after_bytes) : undef,
        died => $error ? JSON::PP::true : JSON::PP::false,
    };
    my $output = $ENV{S2_NATIVE_CAPTURE_PATH}
        or die "Native capture output path missing\n";
    open my $fh, '>>:raw', $output or die "Cannot open native capture: $!\n";
    print {$fh} JSON::PP->new->canonical->utf8->encode($case), "\n"
        or die "Cannot write native capture: $!\n";
    close $fh or die "Cannot close native capture: $!\n";
}

sub install {
    no strict 'refs';
    no warnings 'redefine';
    for my $method (qw(clean_event clean_comment clean_subject clean_subject_all
        clean_and_trim_subject clean_userbio clean_embed)) {
        my $symbol = "LJ::CleanHTML::$method";
        my $original = *{$symbol}{CODE} or next;
        *{$symbol} = sub {
            my ($package, $source_file, $source_line) = caller;
            my $before = ref $_[0] eq 'SCALAR' ? ${$_[0]} : undef;
            my $options = ref $_[1] eq 'HASH' ? { %{ $_[1] } } : $_[1];
            my $want = wantarray;
            my (@list, $scalar);
            my $ok = eval {
                if (!defined $want) { $original->(@_); }
                elsif ($want) { @list = $original->(@_); }
                else { $scalar = $original->(@_); }
                1;
            };
            my $error = $@;
            my $after = ref $_[0] eq 'SCALAR' ? ${$_[0]} : undef;
            record($method, $before, $after, $options, $source_file, $source_line, $error);
            die $error unless $ok;
            return unless defined $want;
            return @list if $want;
            return $scalar;
        };
    }
}

1;

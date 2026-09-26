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
my $entry_ordinal = 0;
my @active;
my @records;

sub bytes {
    my ($text) = @_;
    return undef unless defined $text;
    return Encode::is_utf8($text) ? Encode::encode('UTF-8', $text) : $text;
}

sub positional_args {
    my (@args) = @_;
    return [ map {
        if (!defined $_) { { kind => 'undef', value => undef } }
        elsif (!ref $_) { { kind => 'scalar', value => $_ } }
        elsif (ref $_ eq 'HASH') {
            my (%scalars, @refs);
            for my $key (sort keys %$_) {
                if (ref $_->{$key}) { push @refs, { key => $key, kind => ref $_->{$key} }; }
                else { $scalars{$key} = $_->{$key}; }
            }
            { kind => 'HASH', scalarOptions => \%scalars, optionRefs => \@refs };
        }
        else { { kind => ref $_ } }
    } @args ];
}

sub repo_file {
    my ($file) = @_;
    my $root = "$ENV{LJHOME}/";
    return substr($file, length($root)) if index($file, $root) == 0;
    return $file if $file =~ m{^(?:t|cgi-bin)/};
    die "Native call escaped repository: $file\n";
}

sub flush_records {
    return unless @records;
    my %call_for_entry = map { $_->{entryOrdinal} => $_->{callOrdinal} } @records;
    my $output = $ENV{S2_NATIVE_CAPTURE_PATH}
        or die "Native capture output path missing\n";
    open my $fh, '>:raw', $output or die "Cannot open native capture: $!\n";
    for my $case (@records) {
        my $parent_entry = delete $case->{parentEntryOrdinal};
        $case->{parentOrdinal} = defined $parent_entry
            ? $call_for_entry{$parent_entry} : undef;
        die "Native parent call missing\n"
            if defined $parent_entry && !defined $case->{parentOrdinal};
        print {$fh} JSON::PP->new->canonical->utf8->encode($case), "\n"
            or die "Cannot write native capture: $!\n";
    }
    close $fh or die "Cannot close native capture: $!\n";
}

END { flush_records(); }

sub record {
    my ($method, $before, $after, $args, $caller_file, $caller_line,
        $test_line, $depth, $entry_id, $parent_entry, $error) = @_;
    my $before_bytes = bytes($before);
    my $after_bytes = bytes($after);
    my (%scalar_options, @ref_keys);
    if (ref $args->[0] eq 'HASH') {
        for my $key (sort keys %{ $args->[0] }) {
            if (ref $args->[0]{$key}) { push @ref_keys, $key; }
            else { $scalar_options{$key} = $args->[0]{$key}; }
        }
    }
    my $case = {
        suite => $ENV{S2_NATIVE_SUITE},
        callOrdinal => ++$ordinal,
        beforeTap => Test::Builder->new->current_test,
        source => $ENV{S2_NATIVE_SOURCE},
        sourceLine => $test_line,
        directCallerFile => repo_file($caller_file),
        directCallerLine => $caller_line,
        depth => $depth,
        entryOrdinal => $entry_id,
        parentEntryOrdinal => $parent_entry,
        method => $method,
        scalarOptions => \%scalar_options,
        optionRefKeys => \@ref_keys,
        positionalArgs => positional_args(@$args),
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
    push @records, $case;
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
            my $test_line;
            for my $frame (0 .. 32) {
                my @site = caller($frame);
                last unless @site;
                if ($site[1] eq $ENV{S2_NATIVE_SOURCE}) {
                    $test_line = $site[2];
                    last;
                }
            }
            die "Native test caller missing\n" unless defined $test_line;
            my $entry_id = ++$entry_ordinal;
            my $parent_entry = @active ? $active[-1] : undef;
            my $depth = scalar @active;
            push @active, $entry_id;
            my $before = ref $_[0] eq 'SCALAR' ? ${$_[0]} : undef;
            my @args = map { ref $_ eq 'HASH' ? { %$_ } : $_ } @_[1 .. $#_];
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
            pop @active;
            record($method, $before, $after, \@args, $source_file, $source_line,
                $test_line, $depth, $entry_id, $parent_entry, $error);
            die $error unless $ok;
            return unless defined $want;
            return @list if $want;
            return $scalar;
        };
    }
}

1;

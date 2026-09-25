#!/usr/bin/perl
# image-plan.pl
#
# Offline synthetic image-membership and retained proxy oracle; never a serving helper.
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
use HTML::Parser;
use JSON::PP;
use Encode qw(encode decode FB_CROAK LEAVE_SRC);
use LJ::CleanHTML;
use DW::Proxy;

die "This probe requires ordinary proxy-absent local configuration\n"
    if $LJ::PROXY_URL || $LJ::PROXY_SALT_FILE;
my $json = do { local $/; <STDIN> };
die "Oversized offline probe\n" if length($json) > 262144;
my $job    = decode_json($json);
my $result = eval { plan($job) };
print encode_json( $@ ? { kind => 'unsupported' } : $result ), "\n";

sub plan {
    my ($job) = @_;
    die "Invalid offline plan" unless ref($job) eq 'HASH' && ref( $job->{input} ) eq 'HASH';
    my $input = $job->{input};
    my $raw   = encode( 'UTF-8', $input->{body}, FB_CROAK | LEAVE_SRC );
    die "Oversized body" if length($raw) > 65536;
    my $context = $input->{context};
    die "Wrong context"
        unless $input->{format} eq 'html_raw0'
        && $context->{urls}{imageProxy} eq 'host-resolved'
        && $job->{proxy} eq 'https://proxy.example.test';

    # Declared synthetic file only, created by the offline test host. These local
    # overrides exist only in this process; never read a configured real salt.
    die "Invalid synthetic salt path"
        unless $job->{saltPath} =~ m{\A/tmp/slice4-image-test-[^/]+/salt\z};
    local $LJ::PROXY_URL         = $job->{proxy};
    local $LJ::PROXY_SALT_FILE   = $job->{saltPath};
    local $LJ::DOMAIN            = $context->{urls}{siteDomain};
    local %LJ::KNOWN_HTTPS_SITES = map { $_ => 1 } @{ $context->{urls}{knownHttpsSites} };

    my ( @stack, @candidates );
    my $cursor  = 0;
    my $events  = 0;
    my $consume = sub {
        my ( $offset, $text ) = @_;
        die "Unaccounted parser bytes" unless $offset == $cursor;
        $cursor += length($text);
        die "Too many tokens" if ++$events > 4096;
    };
    my $parser = HTML::Parser->new( api_version => 3 );
    $parser->handler(
        start => sub {
            my ( $tag, $attrs, $tokens, $positions, $offset, $text ) = @_;
            $consume->( $offset, $text );
            die "Uncovered element" unless $tag =~ /\A(?:div|p|span|a|img|script)\z/;
            die "Incomplete start" unless substr( $text, -1 ) eq '>';
            die "Ambiguous block nesting" if $tag =~ /\A(?:p|div)\z/ && grep { $_ eq 'p' } @stack;
            die "Nested anchor"           if $tag eq 'a'             && grep { $_ eq 'a' } @stack;
            my ( %seen, %spans );
            for ( my $i = 1 ; $i < @$tokens ; $i += 2 ) {
                my $name = lc $tokens->[$i];
                die "Duplicate or unexamined attribute"
                    if $seen{$name}++
                    || $name !~ /\A(?:src|srcset|style|alt|class|title|href)\z/;
                my ( $start, $length ) = @$positions[ 2 * ( $i + 1 ), 2 * ( $i + 1 ) + 1 ];
                die "Missing attribute value" unless $length;
                my $value = substr( $text,  $start, $length );
                my $quote = substr( $value, 0,      1 );
                die "Unquoted or incomplete value"
                    unless ( $quote eq q{"} || $quote eq q{'} )
                    && substr( $value, -1 ) eq $quote
                    && $length >= 2;
                $spans{$name} = {
                    byteStart => $offset + $start + 1,
                    byteEnd   => $offset + $start + $length - 1
                };
            }
            if ( $tag eq 'img' ) {
                die "Missing image source" unless defined $attrs->{src} && length $attrs->{src};
                for my $name (qw(src srcset)) {
                    next unless exists $attrs->{$name};
                    my @urls;
                    if ( $name eq 'src' ) { @urls = ( $attrs->{$name} ); }
                    else {
                        # Qualification-only descriptor grammar. Commas inside URLs,
                        # missing descriptors and alternate repairs are ambiguous.
                        for my $part ( split /,/, $attrs->{$name}, -1 ) {
                            die "Ambiguous srcset"
                                unless $part =~ /\A\s*(\S+)\s+[1-9][0-9]*(?:x|w)\s*\z/;
                            push @urls, $1;
                        }
                    }
                    for my $url (@urls) {
                        die "Ambiguous image URL" if $url =~ /[\x00-\x20<>"']/;
                        push @candidates, { attribute => $name, %{ $spans{$name} }, url => $url };
                        die "Image bound" if @candidates > 256;
                    }
                }
            }
            else {
                die "Depth bound" if @stack >= 16;
                push @stack, $tag;
            }
        },
        'tagname,attr,tokens,tokenpos,offset,text'
    );
    $parser->handler(
        end => sub {
            my ( $tag, $offset, $text ) = @_;
            $consume->( $offset, $text );
            die "Mismatched end" unless @stack && pop(@stack) eq $tag;
        },
        'tagname,offset,text'
    );
    $parser->handler(
        text => sub {
            my ( $offset, $text ) = @_;
            $consume->( $offset, $text );
            die "Unparsed markup" if $text =~ /</ && ( !@stack || $stack[-1] ne 'script' );
        },
        'offset,text'
    );
    $parser->handler(
        comment => sub {
            my ( $offset, $text ) = @_;
            $consume->( $offset, $text );

            # HTML::Parser also labels malformed unfinished tags as comments. Such
            # recovery is not an authoritative image-membership plan.
            die "Ambiguous comment/token"
                unless index( $text, '<!--' ) == 0
                && substr( $text, -3 ) eq '-->';
        },
        'offset,text'
    );
    $parser->handler(
        default => sub {
            die "Uncovered parser event"
                unless $_[0] eq 'start_document' || $_[0] eq 'end_document';
        },
        'event'
    );
    $parser->parse($raw);
    $parser->eof;
    die "Incomplete or repaired markup" if @stack || $cursor != length($raw);

    my @observed;
    my $native_https = \&LJ::CleanHTML::https_url;
    my $native_proxy = \&DW::Proxy::get_proxy_url;
    my $used_proxy   = 0;
    my $clean        = $raw;
    {
        no warnings 'redefine';
        local *DW::Proxy::get_proxy_url = sub {
            my $resolved = $native_proxy->(@_);
            $used_proxy = defined($resolved) ? 1 : 0;
            return $resolved;
        };
        local *LJ::CleanHTML::https_url = sub {
            my ( $url, @opts ) = @_;
            $used_proxy = 0;
            my $resolved = $native_https->( $url, @opts );
            push @observed, { url => $url, resolved => $resolved, proxied => $used_proxy };
            return $resolved;
        };

        # No journal is supplied: the real helper's source component is '-'.
        # Qualification tests this explicit synthetic context, not a fake user.
        LJ::CleanHTML::clean_event( \$clean, { editor => 'html_raw0' } );
    }
    die "Eligibility count mismatch" unless @observed == @candidates;
    my ( @requests, @resolved, @all );
    for my $i ( 0 .. $#candidates ) {
        my $candidate = $candidates[$i];
        my $native    = $observed[$i];
        die "Eligibility order/canonicalization mismatch"
            unless $candidate->{url} eq $native->{url};
        push @all,
            {
            url      => decode( 'UTF-8', $native->{url},      FB_CROAK | LEAVE_SRC ),
            resolved => decode( 'UTF-8', $native->{resolved}, FB_CROAK | LEAVE_SRC )
            };
        next unless $native->{proxied};
        my $ordinal = scalar @requests;
        push @requests,
            {
            ordinal   => $ordinal,
            attribute => $candidate->{attribute},
            byteStart => $candidate->{byteStart},
            byteEnd   => $candidate->{byteEnd},
            url       => decode( 'UTF-8', $candidate->{url}, FB_CROAK | LEAVE_SRC )
            };
        push @resolved,
            {
            ordinal => $ordinal,
            url     => decode( 'UTF-8', $native->{resolved}, FB_CROAK | LEAVE_SRC )
            };
    }
    return {
        kind       => 'plan',
        requests   => \@requests,
        images     => \@resolved,
        all        => \@all,
        nativeHtml => decode( 'UTF-8', $clean, FB_CROAK | LEAVE_SRC )
    };
}

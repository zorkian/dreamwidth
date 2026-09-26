#!/usr/bin/perl
#
# live-config.pl
#
# Export local public app settings without issuing a journal HTTP request.
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
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use File::Path qw(make_path);
use HTML::Parser;
use JSON::PP;
use LJ::Web;

die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
die "Anonymous CAPTCHA is enabled\n" if $LJ::CAPTCHA_HCAPTCHA_SITEKEY;
die "Unexpected local site root\n" unless ($LJ::SITEROOT // '') eq '';
die "Unexpected local recent scrollback limit\n" unless $LJ::MAX_SCROLLBACK_LASTN == 100;
die "Local image proxy unexpectedly configured\n"
    if $LJ::PROXY_URL || $LJ::PROXY_SALT_FILE;
my $placeholder_html = LJ::img('placeholder');
die "Unexpected placeholder helper shape\n"
    unless defined $placeholder_html && $placeholder_html =~ m!^<img\b[^<>]*/>$!s;
my ($placeholder, $placeholder_count) = (undef, 0);
my $parser = HTML::Parser->new(
    api_version => 3,
    start_h => [ sub {
        my ($tag, $attrs) = @_;
        die "Unexpected placeholder element\n" unless $tag eq 'img' && !$placeholder_count++;
        my %copy = %$attrs;
        die "Unexpected placeholder close marker\n" unless (delete $copy{'/'}) eq '/';
        die "Unexpected placeholder attributes\n"
            unless join(',', sort keys %copy) eq 'alt,border,height,src,title,width';
        die "Unexpected placeholder border\n" unless $copy{border} eq '0';
        die "Invalid placeholder dimensions\n"
            unless $copy{width} =~ /^[1-9][0-9]*$/
            && $copy{height} =~ /^[1-9][0-9]*$/;
        $placeholder = {
            src => $copy{src}, width => 0 + $copy{width}, height => 0 + $copy{height},
            alt => $copy{alt}, title => $copy{title},
        };
    }, 'tagname, attr' ],
    text_h => [ sub { die "Unexpected placeholder text\n" if $_[0] =~ /\S/ }, 'text' ],
);
$parser->parse($placeholder_html);
$parser->eof;
die "Missing placeholder image\n" unless $placeholder_count == 1 && $placeholder->{src};
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
make_path($dir) unless -d $dir;
my $public = {
    canonicalAppOrigin => 'http://localhost:8080',
    listenOrigin => 'http://localhost:8081',
    siteRoot => $LJ::SITEROOT // '',
    statPrefix => $LJ::STATPREFIX // '',
    imgPrefix => $LJ::IMGPREFIX // '',
    palImgRoot => $LJ::PALIMGROOT // '',
    userpicRoot => $LJ::USERPIC_ROOT // '',
    userpicUrlHookConfigured => LJ::Hooks::are_hooks('construct_userpic_url') ? JSON::PP::true : JSON::PP::false,
    siteName => $LJ::SITENAME // '',
    siteNameShort => $LJ::SITENAMESHORT // '',
    siteNameAbbrev => $LJ::SITENAMEABBREV // '',
    appleTouchIcon => $LJ::APPLE_TOUCH_ICON // '',
    facebookPreviewIcon => $LJ::FACEBOOK_PREVIEW_ICON // '',
    anonymousCaptchaDisabled => JSON::PP::true,
    entryContent => {
        imagePlaceholder => $placeholder,
        urls => {
            siteDomain => $LJ::DOMAIN // '',
            knownHttpsSites => [ sort grep { $LJ::KNOWN_HTTPS_SITES{$_} }
                keys %LJ::KNOWN_HTTPS_SITES ],
            formDomainBanned => [ sort grep { $LJ::FORM_DOMAIN_BANNED{$_} }
                keys %LJ::FORM_DOMAIN_BANNED ],
            imageProxy => 'not-configured',
        },
    },
};
my $json = JSON::PP->new->canonical->pretty->encode($public);
my $path = "$dir/public-config.json";
open my $output, '>:raw', $path or die "Cannot write public config: $!\n";
print {$output} $json or die "Cannot write public config: $!\n";
close $output or die "Cannot close public config: $!\n";
print "Public config exported without an HTTP request\n";

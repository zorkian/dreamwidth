#!/usr/bin/perl
#
# live-oracle.pl
#
# Capture the real local Perl HTTP page and public configuration for comparison.
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
use Digest::SHA qw(sha256_hex);
use Encode ();
use HTTP::Request::Common;
use JSON::PP;
use Plack::Test;

my ($origin, $outdir) = @ARGV;
die "Usage: perl tools/live-oracle.pl http://localhost:<app-port> <output-dir>\n"
    unless @ARGV == 2 && $origin =~ m!^http://localhost:\d{1,5}$! && -d $outdir;
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
die "Anonymous CAPTCHA is enabled\n" if $LJ::CAPTCHA_HCAPTCHA_SITEKEY;
my $u = LJ::load_user('s2js_slice3') or die "Missing marked journal\n";
die "Unmarked journal\n" unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1';
my $app = do "$ENV{LJHOME}/app.psgi";
die "Cannot load real Plack app: $@\n" unless ref $app eq 'CODE';

my $response;
test_psgi $app, sub {
    my $callback = shift;
    $response = $callback->(GET "$origin/users/s2js_slice3/");
};
die "Real Perl journal HTTP route failed\n" unless $response && $response->code == 200;
my $body = $response->content;
$body = Encode::encode('UTF-8', $body) if Encode::is_utf8($body);
die "Expected both owned entries in real HTTP response\n"
    unless $body =~ /Live sample 1/ && $body =~ /Live sample 2/;
open my $html, '>:raw', "$outdir/page-oracle.html" or die "Cannot write HTTP oracle: $!\n";
print {$html} $body;
close $html or die "Cannot close HTTP oracle: $!\n";

my $public = {
    canonicalAppOrigin => $origin,
    siteRoot => $LJ::SITEROOT // '',
    statPrefix => $LJ::STATPREFIX // '',
    imgPrefix => $LJ::IMGPREFIX // '',
    palImgRoot => $LJ::PALIMGROOT // '',
    userpicRoot => $LJ::USERPIC_ROOT // '',
    siteName => $LJ::SITENAME // '',
    siteNameShort => $LJ::SITENAMESHORT // '',
    siteNameAbbrev => $LJ::SITENAMEABBREV // '',
    appleTouchIcon => $LJ::APPLE_TOUCH_ICON // '',
    facebookPreviewIcon => $LJ::FACEBOOK_PREVIEW_ICON // '',
    anonymousCaptchaDisabled => JSON::PP::true,
};
open my $config, '>:raw', "$outdir/public-config.json" or die "Cannot write config: $!\n";
print {$config} JSON::PP->new->canonical->pretty->encode($public);
close $config or die "Cannot close config: $!\n";
my $metadata = {
    status => $response->code,
    content_type => $response->header('Content-Type') // '',
    cache_control => $response->header('Cache-Control') // '',
    bytes => length($body), sha256 => sha256_hex($body),
};
open my $meta, '>:raw', "$outdir/response-metadata.json" or die "Cannot write metadata: $!\n";
print {$meta} JSON::PP->new->canonical->pretty->encode($metadata);
close $meta or die "Cannot close metadata: $!\n";
print "Real Perl HTTP 200: $metadata->{bytes} bytes; public config and oracle in $outdir\n";

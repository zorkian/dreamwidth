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
our $COMPARISON_CLOCK_ACTIVE;
BEGIN {
    # Compile the real app against a switch; only the comparison GET uses it.
    *CORE::GLOBAL::time = sub () { $main::COMPARISON_CLOCK_ACTIVE ? 1790294400 : CORE::time() };
    require "$ENV{LJHOME}/cgi-bin/ljlib.pl";
}
use Digest::SHA qw(sha256_hex);
use Encode ();
use HTTP::Request::Common;
use JSON::PP;
use Plack::Test;

my ($origin, $outdir, $mode, $cookie_value) = @ARGV;
my $comparison = defined $mode && $mode eq '--comparison';
die "Usage: perl tools/live-oracle.pl http://localhost:<app-port> <output-dir> [--comparison <ljuniq-value>]\n"
    unless (@ARGV == 2 || (@ARGV == 4 && $comparison))
    && $origin =~ m!^http://localhost:\d{1,5}$! && -d $outdir;
my ($comparison_uniq) = $comparison
    ? ($cookie_value =~ /^([A-Za-z0-9]{15}):1790294400:[A-Za-z0-9]+$/)
    : ();
die "Invalid comparison ljuniq value\n" if $comparison && !$comparison_uniq;
die "Comparison requires fixed Perl hash order at process start\n"
    if $comparison && (($ENV{PERL_HASH_SEED} // '') ne '0'
    || ($ENV{PERL_PERTURB_KEYS} // '') ne '0');
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
die "Anonymous CAPTCHA is enabled\n" if $LJ::CAPTCHA_HCAPTCHA_SITEKEY;
my $u = LJ::load_user('s2js_slice3') or die "Missing marked journal\n";
die "Unmarked journal\n" unless ($u->bio(1) // '') eq 's2-js-slice3 live dev v1';
my $app = do "$ENV{LJHOME}/app.psgi";
die "Cannot load real Plack app: $@\n" unless ref $app eq 'CODE';

my $response;
if ($comparison) {
    # This uses the ordinary local helper and its real signing key before any
    # request-scoped random override. No key is exported or used by the renderer.
    my ($hour, $secret) = LJ::get_secret(1790294400);
    die "Cannot prepare local comparison signing key\n"
        unless $hour == 1790294400 && defined $secret && length $secret;
    {
        no warnings 'redefine';
        local $COMPARISON_CLOCK_ACTIVE = 1;
        local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = $comparison_uniq;
        local *LJ::rand_chars = sub {
            my ($length, $charset) = @_;
            die "Unsupported comparison random charset\n"
                if defined $charset && $charset ne 'default';
            return 'a' x $length;
        };
        test_psgi $app, sub {
            my $callback = shift;
            $response = $callback->(GET "$origin/users/s2js_slice3/",
                Cookie => "ljuniq=$cookie_value");
        };
        die "Comparison GET is not anonymous\n" if LJ::get_remote();
        my ($challenge) = ($response ? $response->content : '')
            =~ /name="lj_form_auth" value="([^"]+)"/;
        die "Missing real comparison form challenge\n" unless $challenge;
        die "Comparison challenge has unexpected nonce or identity\n"
            unless $challenge =~ /^c0:1790294400:\d+:86400:aaaaaaaaaa-0-\Q$comparison_uniq\E:[0-9a-f]{32}$/;
        die "Real local challenge verification failed\n"
            unless DW::Auth::Challenge->check($challenge, { dont_check_count => 1 });
    }
}
else {
    test_psgi $app, sub {
        my $callback = shift;
        $response = $callback->(GET "$origin/users/s2js_slice3/");
    };
}
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
my @headers;
$response->headers->scan(sub { push @headers, [@_] });
@headers = sort { lc($a->[0]) cmp lc($b->[0]) || $a->[1] cmp $b->[1] } @headers;
my $metadata = {
    status => $response->code,
    response_headers => \@headers,
    bytes => length($body), sha256 => sha256_hex($body),
    comparison => $comparison ? JSON::PP::true : JSON::PP::false,
};
if ($comparison) {
    $metadata->{comparison_time} = 1790294400;
    $metadata->{comparison_uniq} = $comparison_uniq;
    $metadata->{comparison_cookie} = $cookie_value;
    $metadata->{comparison_random10} = 'aaaaaaaaaa';
    $metadata->{perl_hash_seed} = $ENV{PERL_HASH_SEED};
    $metadata->{perl_perturb_keys} = $ENV{PERL_PERTURB_KEYS};
}
open my $meta, '>:raw', "$outdir/response-metadata.json" or die "Cannot write metadata: $!\n";
print {$meta} JSON::PP->new->canonical->pretty->encode($metadata);
close $meta or die "Cannot close metadata: $!\n";
print "Real Perl HTTP 200: $metadata->{bytes} bytes; public config and oracle in $outdir\n";

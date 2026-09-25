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
use JSON::PP;

die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
die "Anonymous CAPTCHA is enabled\n" if $LJ::CAPTCHA_HCAPTCHA_SITEKEY;
die "Unexpected local site root\n" unless ($LJ::SITEROOT // '') eq '';
die "Unexpected local recent scrollback limit\n" unless $LJ::MAX_SCROLLBACK_LASTN == 100;
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
    siteName => $LJ::SITENAME // '',
    siteNameShort => $LJ::SITENAMESHORT // '',
    siteNameAbbrev => $LJ::SITENAMEABBREV // '',
    appleTouchIcon => $LJ::APPLE_TOUCH_ICON // '',
    facebookPreviewIcon => $LJ::FACEBOOK_PREVIEW_ICON // '',
    anonymousCaptchaDisabled => JSON::PP::true,
};
my $json = JSON::PP->new->canonical->pretty->encode($public);
my $path = "$dir/public-config.json";
open my $output, '>:raw', $path or die "Cannot write public config: $!\n";
print {$output} $json or die "Cannot write public config: $!\n";
close $output or die "Cannot close public config: $!\n";
print "Public config exported without an HTTP request\n";

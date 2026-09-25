#!/usr/bin/perl
# cookie-oracle.pl
#
# Offline differential of the actual retained cookie and challenge protocol.
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
BEGIN {
    *CORE::GLOBAL::time = sub () { 1790294400 };
    require "$ENV{LJHOME}/cgi-bin/ljlib.pl";
}
use DW::Request::Standard;
use DW::Cache;
use LJ::UniqCookie;
use DW::Auth::Challenge;
use HTTP::Request;
use JSON::PP;

# Protocol unit differential uses one declared fixture key, never an app key.
# Integrated real-local-key verification is separately performed by live-oracle.
# No journal GET, application rendering or serving code calls this test helper.
local $/;
my $headers = JSON::PP->new->utf8->decode(<STDIN>);
die "Expected bounded headers\n" unless ref $headers eq 'ARRAY' && @$headers <= 200;
die "Unsupported local cookie transformation\n" if LJ::Hooks::are_hooks('transform_ljuniq_value');
my @results;
{
    no warnings 'redefine';
    local *LJ::rand_chars = sub { return 'a' x $_[0] };
    local *LJ::get_secret = sub { return (1790294400, '0123456789abcdefghijklmnopqrstuv') };
    for my $header (@$headers) {
        die "Oversized header\n" if defined $header && (ref $header || length($header) > 200);
        DW::Request->reset;
        DW::Cache->request->clear;
        my $http = HTTP::Request->new(GET => 'http://localhost:8080/protocol-unit-test');
        $http->header(Cookie => $header) if defined $header;
        my $r = DW::Request::Standard->new($http);
        my @parts = LJ::UniqCookie->parts_from_cookie;
        LJ::UniqCookie->ensure_cookie_value;
        my $token = LJ::form_auth(1);
        my $set = $r->{res}->header('Set-Cookie');
        push @results, {parts => \@parts, uniq => LJ::UniqCookie->current_uniq,
            challenge => $token, setCookie => defined $set ? "$set" : undef};
    }
}
print JSON::PP->new->utf8->encode(\@results);

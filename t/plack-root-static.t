#!/usr/bin/perl
# Regression coverage for the explicit root-level static-file allowlist
# app.psgi serves in place of the deleted BML engine fallback (E3), which
# used to serve every plain file under any htdocs overlay as a side effect
# of resolving unmatched paths. Confirms each legitimate file the old
# fallback served is still reachable with the correct content type
# (including /favicon.ico on a journal host), and that the excluded paths
# the old blanket fallback also exposed stay unreachable.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

test_psgi $app, sub {
    my $cb = shift;

    subtest 'allow-listed root-level files and rte/ assets are served with the right type' => sub {
        for my $case (
            [ '/robots.txt',           qr{^text/plain} ],
            [ '/favicon.ico',          qr{^image/(?:vnd\.microsoft\.icon|x-icon)} ],
            [ '/apple-touch-icon.png', qr{^image/png} ],
            [ '/protocol.dat',         qr{^text/plain} ],
            [ '/500-error.html',       qr{^text/html} ],
            [ '/rte/blank.html',       qr{^text/html} ],
            [ '/rte/index.html',       qr{^text/html} ],
            [ '/rte/palette.html',     qr{^text/html} ],
            )
        {
            my ( $path, $type ) = @$case;
            my $res = $cb->( GET $path );
            is( $res->code, 200, "$path is 200" );
            like( $res->header('Content-Type') // '', $type,
                "$path has the expected content type" );
        }
    };

    subtest '500-error.html is served from the dw-nonfree overlay, not the base file' => sub {
        my $res = $cb->( GET '/500-error.html' );
        is( $res->code, 200, '/500-error.html is 200' );
        like( $res->content, qr/downforeveryoneorjustme/,
            'overlay priority still favors ext/dw-nonfree over the base htdocs file' );
    };

    subtest 'the old blanket fallback\'s excluded paths stay unreachable' => sub {
        for my $path (
            '/inc/account-codes',  '/doc/.placeholder',
            '/preview/index.html', '/scss/foundation/normalize.scss',
            )
        {
            my $res = $cb->( GET $path );
            is( $res->code, 404, "$path is still 404" );
        }
    };
};

subtest 'favicon.ico is served on a journal subdomain, not just the site host' => sub {
    local $LJ::USER_DOMAIN = 'example.org';
    local $LJ::DOMAIN_WEB  = 'www.example.org';
    local $LJ::DOMAIN      = 'example.org';

    test_psgi $app, sub {
        my $cb  = shift;
        my $res = $cb->( GET 'http://someuser.example.org/favicon.ico' );
        is( $res->code, 200, 'journal-host favicon.ico is 200' );
        like(
            $res->header('Content-Type') // '',
            qr{^image/(?:vnd\.microsoft\.icon|x-icon)},
            'journal-host favicon.ico has the expected content type'
        );
    };
};

done_testing;

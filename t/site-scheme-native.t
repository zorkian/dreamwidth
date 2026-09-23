#!/usr/bin/perl
# Locks two properties E3's engine deletion must preserve: every selectable
# DW::SiteScheme is TT-capable (only the internal tt_runner scheme is not),
# and rendering a native page through DW::Template never touches BML.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use File::Find;
use Test::More;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Request;
use DW::Request::Plack;
use DW::SiteScheme;
use DW::Template;
use LJ::Widget::Search;

sub request {
    DW::Request->reset;
    open my $input, '<', \( my $body = '' ) or die $!;
    return DW::Request->get(
        plack_env => {
            REQUEST_METHOD    => 'GET',
            PATH_INFO         => '/',
            QUERY_STRING      => '',
            SERVER_NAME       => 'localhost',
            SERVER_PORT       => 80,
            HTTP_HOST         => 'localhost',
            'psgi.version'    => [ 1, 1 ],
            'psgi.url_scheme' => 'http',
            'psgi.input'      => $input,
            'psgi.errors'     => do { open my $fh, '>', \( my $err = '' ); $fh },
        }
    );
}

subtest 'every selectable site scheme supports the TT engine' => sub {
    request();
    my @available = DW::SiteScheme->available;
    ok( scalar(@available) > 0, 'at least one scheme is selectable' );
    for my $row (@available) {
        my $scheme = DW::SiteScheme->get( $row->{scheme} );
        ok( $scheme->supports_tt, "$row->{scheme} supports_tt" );
    }
};

subtest 'tt_runner is the only scheme with the bml engine' => sub {
    request();
    is( DW::SiteScheme->get('tt_runner')->engine, 'bml', 'tt_runner engine is bml' );
    ok( !DW::SiteScheme->get('tt_runner')->supports_tt, 'tt_runner does not support_tt' );

    # DW::SiteScheme::engine() reads only a scheme's own row, never an
    # inherited parent's, so the only way any scheme can have the bml engine
    # is a literal engine => 'bml' on its own row. Confirm there is exactly
    # one such row in-tree, and it is tt_runner's.
    my @hits;
    find(
        {
            wanted => sub {
                return unless -f $_ && /\.pm$/;
                open my $fh, '<', $_ or return;
                while ( my $line = <$fh> ) {
                    push @hits, "$File::Find::name:$.: $line"
                        if $line =~ /engine\s*=>\s*['"]bml['"]/;
                }
            },
            no_chdir => 1,
        },
        "$ENV{LJHOME}/cgi-bin",
        "$ENV{LJHOME}/ext",
    );
    is( scalar(@hits), 1, "exactly one engine => 'bml' assignment exists in-tree" )
        or diag(@hits);
    like( $hits[0] // '', qr/tt_runner/, 'that one assignment is on the tt_runner row' );
};

subtest 'rendering a native page through DW::Template never touches BML' => sub {
    request();
    no warnings 'redefine';
    local *BML::ml         = sub { die 'native TT rendering must not call BML::ml' };
    local *DW::BML::render = sub { die 'native TT rendering must not call DW::BML::render' };

    my $ok = eval { DW::Template->render_string('native rendering marker text'); 1 };
    ok( $ok, 'render_string completes without calling BML::ml or DW::BML::render' )
        or diag("died: $@");
    ok( DW::Request->get->response_bytes_written, 'render_string actually produced a body' );
};

done_testing;

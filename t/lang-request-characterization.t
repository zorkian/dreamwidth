#!/usr/bin/perl
# Characterize legacy language state before native request-language migration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin";
use Test::More;
use HTTP::Request::Common;
use Plack::Middleware::DW::RequestWrapper;
use Plack::Test;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::BML;
use DW::Request;
use DW::Request::Plack;
use LJ::Lang;

sub request {
    my ($scope) = @_;
    DW::Request->reset;
    open my $input, '<', \( my $body = '' ) or die $!;
    my $r = DW::Request->get(
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
        },
    );
    $r->note( ml_scope => $scope ) if defined $scope;
    return $r;
}

subtest 'BML scope survives language changes without a matching request note' => sub {
    request();
    BML::set_language_scope('/customize/index.bml');
    BML::set_language( 'en', sub { return $_[1]; } );
    is(
        LJ::Lang::ml('.setstyle.user'),
        '/customize/index.bml.setstyle.user',
        'BML scope survives language setup'
    );

    request('/different.tt');
    BML::set_language_scope('/customize/index.bml');
    BML::set_language( 'en', sub { return $_[1]; } );
    is(
        LJ::Lang::ml('.setstyle.user'),
        '/customize/index.bml.setstyle.user',
        'BML scope wins over a different request note'
    );
    DW::Request->reset;
};

subtest 'web keys, scope, and substitutions use the configured getter' => sub {
    my @calls;
    request('/entry/form.tt');
    local $BML::ML_SCOPE = '';
    BML::set_language( 'en', sub { push @calls, [@_]; return join '|', @_[ 0, 1 ]; } );
    is(
        LJ::Lang::ml( '.draft.autosave', { time => 3 } ),
        'en|/entry/form.tt.draft.autosave',
        'relative key uses request scope'
    );
    is(
        LJ::Lang::ml( '/customize/index.bml.title', { name => 'x' } ),
        'en|/customize/index.bml.title',
        'full BML key stays full'
    );
    is_deeply( $calls[0][3], { time => 3 }, 'substitutions reach language getter unchanged' );
};

subtest 'debug language returns keys without invoking a getter' => sub {
    request('/entry/form.tt');
    local $BML::ML_SCOPE = '';
    BML::set_language( 'debug', sub { die 'debug must not translate' } );
    is( LJ::Lang::ml('.draft.autosave'), '.draft.autosave', 'debug preserves relative key' );
    is(
        BML::ml('/entry/form.tt.draft.autosave'),
        '/entry/form.tt.draft.autosave',
        'debug preserves full key'
    );
};

subtest 'nonweb callers use default language and direct translation' => sub {
    DW::Request->reset;
    local $LJ::DEFAULT_LANG = 'zz';
    no warnings 'redefine';
    local *LJ::Lang::get_text = sub { return join ':', @_[ 0, 1 ]; };
    is( LJ::Lang::ml( 'worker.key', { ignored => 1 } ),
        'zz:worker.key', 'background caller defaults without BML request state' );
};

subtest 'source-language cold and warm requests agree' => sub {
    local $LJ::IS_DEV_SERVER = 1;
    LJ::start_request();
    my $cold = LJ::Lang::get_text( 'en', '/entry/form.tt.draft.autosave', undef, { time => 3 } );
    my $warm = LJ::Lang::get_text( 'en', '/entry/form.tt.draft.autosave', undef, { time => 3 } );
    like( $cold, qr/3/, 'cold lookup loads scoped source text with substitution' );
    is( $warm, $cold, 'warm request lookup is compatible with cold lookup' );
    LJ::end_request();
};

subtest 'RequestWrapper sequential PSGI requests retain legacy BML scope' => sub {
    my $app = Plack::Middleware::DW::RequestWrapper->wrap(
        sub {
            my $env = shift;
            BML::set_language( 'en', sub { return $_[1]; } );
            if ( $env->{PATH_INFO} eq '/first' ) {
                BML::set_language_scope('/first.bml');
            }
            else {
                DW::Request->get->note( ml_scope => '/second.tt' );
            }
            my $body = LJ::Lang::ml('.key');
            return [ 200, [ 'Content-Type' => 'text/plain' ], [$body] ];
        }
    );
    test_psgi $app, sub {
        my $cb = shift;
        is( $cb->( GET '/first' )->content, '/first.bml.key', 'first PSGI request has BML scope' );
        is( $cb->( GET '/second' )->content,
            '/second.tt.key', 'second PSGI request is isolated from BML scope' );
    };
};

subtest 'sequential requests expose the global BML scope migration gap' => sub {
    request('/first.bml');
    BML::set_language_scope('/first.bml');
    BML::set_language( 'en', sub { return $_[1]; } );
    is( LJ::Lang::ml('.key'), '/first.bml.key', 'BML page scope resolves relative key' );

    request('/second.tt');
    BML::set_language( 'en', sub { return $_[1]; } );
    is( LJ::Lang::ml('.key'), '/second.tt.key', 'next request does not inherit prior BML scope' );
    DW::Request->reset;
};

done_testing;

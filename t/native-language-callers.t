#!/usr/bin/perl
# Regression coverage for native request-language controller callers.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
no warnings 'redefine';

use lib "$ENV{LJHOME}/cgi-bin";
use Test::More;
use LJ::JSON qw(from_json);

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Request;
use DW::Request::Plack;
use LJ::Lang;
use DW::Controller::MassPrivacy;
use DW::Controller::RPC::CutExpander;
use DW::Controller::Customize::Advanced;

sub request {
    my ($query) = @_;
    DW::Request->reset;
    open my $input, '<', \( my $body = '' ) or die $!;
    return DW::Request->get(
        plack_env => {
            REQUEST_METHOD    => 'GET',
            PATH_INFO         => '/',
            QUERY_STRING      => $query || '',
            SERVER_NAME       => 'localhost',
            SERVER_PORT       => 80,
            HTTP_HOST         => 'localhost',
            'psgi.version'    => [ 1, 1 ],
            'psgi.url_scheme' => 'http',
            'psgi.input'      => $input,
            'psgi.errors'     => do { open my $fh, '>', \( my $err = '' ); $fh },
        },
    );
}

{

    package NativeLanguageCallers::MassPrivacyUser;
    sub new { bless {}, shift }
    sub can_use_mass_privacy { return $_[0]->{allowed} }
}

subtest 'MassPrivacy renders native translated security labels only for permitted users' => sub {
    my $r = request();
    my @lookups;
    LJ::Lang::set_request_context(
        lang   => 'en',
        getter => sub {
            my ( $lang, $code ) = @_;
            push @lookups, $code;
            return "native:$code";
        },
    );

    my $vars;
    my $user = NativeLanguageCallers::MassPrivacyUser->new;
    $user->{allowed} = 1;
    local $LJ::DISABLED{mass_privacy};
    local *LJ::get_remote                   = sub { return $user; };
    local *LJ::remote_bounce_url            = sub { return undef; };
    local *DW::Captcha::should_captcha_view = sub { return 0; };
    local *DW::Template::render_template    = sub {
        my ( $class, $template, $render_vars ) = @_;
        is( $template, 'editprivacy.tt', 'permitted request reaches the editprivacy template' );
        $vars = $render_vars;
        return 'RENDERED';
    };

    is( DW::Controller::MassPrivacy::editprivacy_handler(),
        'RENDERED', 'permitted handler renders' );
    is_deeply(
        $vars->{security_list},
        [
            'public',  'native:label.security.public2',
            'friends', 'native:label.security.accesslist',
            'private', 'native:label.security.private2',
        ],
        'security labels come from the native request getter'
    );
    is_deeply(
        [ @lookups[ 0 .. 5 ] ],
        [
            'label.security.public2',    'label.security.accesslist',
            'label.security.private2',   'label.security.public2',
            'label.security.accesslist', 'label.security.private2',
        ],
        'security label lookup precedes the legacy month labels'
    );

    $user->{allowed} = 0;
    @lookups = ();
    local *DW::Controller::MassPrivacy::error_ml = sub { return LJ::Lang::ml( $_[0] ); };
    is(
        DW::Controller::MassPrivacy::editprivacy_handler(),
        'native:/editprivacy.tt.unable',
        'denied user receives the native translated error'
    );
    is_deeply( \@lookups, ['/editprivacy.tt.unable'], 'denial does not render security controls' );
    DW::Request->reset;
};

subtest 'CutExpander returns translated native errors for denied and missing entries' => sub {
    for my $case (
        [ '', 'request without cut parameters is denied' ],
        [ 'journal=this_journal_does_not_exist&ditemid=1&cutid=1', 'missing entry is denied' ],
        )
    {
        my ( $query, $description ) = @$case;
        my $r = request($query);
        LJ::Lang::set_request_context(
            lang   => 'en',
            getter => sub {
                my ( $lang, $code ) = @_;
                return "native:$code";
            },
        );

        DW::Controller::RPC::CutExpander::cutexpander_handler();
        my $response = $r->res;
        is( $response->[0], 200, "$description retains the legacy HTTP status" );
        my $json = from_json( join '', @{ $response->[2] } );
        is( $json->{error}, 'native:error.nopermission', "$description uses native translation" );
        DW::Request->reset;
    }
};

subtest 'Advanced layer browser formats object values with its full template key' => sub {
    my $r = request();
    my @calls;
    LJ::Lang::set_request_context(
        lang   => 'en',
        getter => sub {
            my ( $lang, $code, $unused, $vars ) = @_;
            push @calls, [ $code, $vars ];
            return "native:$code:$vars->{type}";
        },
    );

    my $vars;
    my $user = NativeLanguageCallers::MassPrivacyUser->new;
    $user->{allowed} = 1;
    local *LJ::get_remote                   = sub { return $user; };
    local *LJ::remote_bounce_url            = sub { return undef; };
    local *DW::Captcha::should_captcha_view = sub { return 0; };
    local *LJ::S2::get_public_layers        = sub { return {}; };
    local *LJ::S2::load_layer_info          = sub { return; };
    local *DW::Template::render_template    = sub {
        my ( $class, $template, $render_vars ) = @_;
        is( $template, 'customize/advanced/layerbrowse.tt', 'layer browser reaches its template' );
        $vars = $render_vars;
        return 'RENDERED';
    };

    is( DW::Controller::Customize::Advanced::layerbrowse_handler(),
        'RENDERED', 'layer browser handler builds its formatter' );
    is(
        $vars->{format_value}->( { _type => 'Widget <unsafe>' } ),
        'native:/customize/advanced/layerbrowse.tt.propformat.object:Widget &lt;unsafe&gt;',
        'object formatter substitutes escaped object type through native getter'
    );
    is_deeply(
        \@calls,
        [
            [
                '/customize/advanced/layerbrowse.tt.propformat.object',
                { type => 'Widget &lt;unsafe&gt;' },
            ],
        ],
        'object formatting resolves the full TT key before template rendering'
    );
    DW::Request->reset;
};

done_testing;

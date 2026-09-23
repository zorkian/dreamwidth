#!/usr/bin/perl
# Native language coverage for LJ error and warning list headings.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;
use Test::More;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Request;
use DW::Request::Plack;
use LJ::Lang;
use LJ::Test qw(temp_user);
use LJ::Web;

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

sub native_context {
    my ( $prefix, $calls ) = @_;
    LJ::Lang::set_request_context(
        lang   => 'fr',
        getter => sub {
            push @$calls, $_[1];
            return "$prefix:$_[1]";
        },
    );
}

subtest 'native request getter preserves exact BML wrappers and error objects' => sub {
    my @calls;
    request();
    native_context( 'A', \@calls );

    my $errors = LJ::error_list('first error');
    like(
        $errors,
        qr/\A<\?errorbar <strong>A:error\.procrequest<\/strong><ul>/,
        'error list retains its BML wrapper while using the request-native full key'
    );
    like( $errors, qr/first error/,           'error object/list body remains unchanged' );
    like( $errors, qr/ <\/ul> errorbar\?>\z/, 'error list retains its closing BML wrapper' );

    my $warnings = LJ::warning_list('first warning');
    like(
        $warnings,
        qr/\A<\?warningbar <strong>A:label\.warning<\/strong><ul>/,
        'warning list retains its BML wrapper while using the request-native full key'
    );
    like( $warnings, qr/<li>first warning<\/li>/, 'warning list body remains unchanged' );
    like( $warnings, qr/ <\/ul> warningbar\?>\z/, 'warning list retains its closing BML wrapper' );

    is_deeply(
        \@calls,
        [qw(error.procrequest label.warning)],
        'only the two migrated global heading keys reach the request getter'
    );
};

subtest 'sequential request contexts do not leak heading translations' => sub {
    my @first;
    request();
    native_context( 'A', \@first );
    like( LJ::error_list('error'), qr/A:error\.procrequest/,
        'first request uses first error heading' );

    my @second;
    request();
    native_context( 'B', \@second );
    my $errors   = LJ::error_list('error');
    my $warnings = LJ::warning_list('warning');
    like( $errors,   qr/B:error\.procrequest/, 'second request uses second error heading' );
    like( $warnings, qr/B:label\.warning/,     'second request uses second warning heading' );
    unlike( $warnings, qr/A:label\.warning/, 'second request does not leak first getter output' );
    is_deeply(
        \@second,
        [qw(error.procrequest label.warning)],
        'second request invokes both current heading keys only'
    );
};

subtest 'no request uses configured native default fallback' => sub {
    DW::Request->reset;
    local $LJ::DEFAULT_LANG = 'en';
    my $error_heading   = LJ::Lang::get_text( 'en', 'error.procrequest' );
    my $warning_heading = LJ::Lang::get_text( 'en', 'label.warning' );
    my $errors          = LJ::error_list('error');
    my $warnings        = LJ::warning_list('warning');
    like( $errors, qr/\Q$error_heading\E/,
        'no-request error list uses configured native fallback' );
    like( $warnings, qr/\Q$warning_heading\E/,
        'no-request warning list uses configured native fallback' );
    unlike(
        $errors . $warnings,
        qr/(?:\[missing string|\[ml_getter not defined\])/,
        'no-request helpers have neither missing-string nor BML-getter output'
    );
};

subtest 'debug preserves full global keys without a getter' => sub {
    request();
    LJ::Lang::set_request_context(
        lang   => 'debug',
        getter => sub { die 'debug must not translate' }
    );
    like(
        LJ::error_list('error'),
        qr/<strong>error\.procrequest<\/strong>/,
        'debug error heading remains its full native key'
    );
    like(
        LJ::warning_list('warning'),
        qr/<strong>label\.warning<\/strong>/,
        'debug warning heading remains its full native key'
    );
};

subtest 'bad_input retains legacy error-object behavior without a heading lookup' => sub {
    my @calls;
    request();
    native_context( 'BAD', \@calls );
    my $nested = LJ::errobj( 'Multiple',
        errors => [ LJ::errobj('nested error one'), LJ::errobj('nested error two') ], );
    my $html = LJ::bad_input( 'plain error', $nested );
    like( $html, qr/\A<\?badcontent\?>/, 'bad_input retains its legacy processing token' );
    like( $html, qr/plain error/,        'bad_input retains the supplied plain error bullet' );
    like(
        $html,
        qr/nested error one.*nested error two/s,
        'bad_input retains nested/multiple error bullets'
    );
    is_deeply( \@calls, [], 'bad_input does not look up either migrated heading' );
};

subtest 'actual entry_form reaches the native error heading once' => sub {
    my $user = temp_user();
    $user->update_self( { status => 'A' } );
    my @calls;
    request();
    native_context( 'FORM', \@calls );
    no warnings 'redefine';
    local *BML::ml = sub { return $_[0] };
    my ( $head, $onload ) = ( '', '' );
    my $html = LJ::entry_form(
        { remote => $user, mode => 'update', auth => '', event => '', richtext_default => 0 },
        \$head, \$onload, { entry => 'entry form error marker' },
    );
    like( $html, qr/FORM:error\.procrequest/,
        'entry_form renders the native request-local error heading' );
    is( scalar( () = $html =~ /entry form error marker/g ),
        1, 'entry_form retains the supplied entry error exactly once' );
    is( scalar( grep { $_ eq 'error.procrequest' } @calls ),
        1, 'entry_form invokes the migrated heading key exactly once' );
};

done_testing;

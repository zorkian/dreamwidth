#!/usr/bin/perl
# Native request-language coverage for LJ::std_max_length.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
no warnings 'redefine';
use Test::More;
BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Request;
use DW::Request::Plack;
use LJ::Lang;
use LJ::Test qw(temp_user);
use LJ::Web;
use LJ::Widget::JournalTitles;

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
sub lang { request(); LJ::Lang::set_request_context( lang => $_[0] ) }
subtest 'raw request language preserves existing maxlength mapping and isolation' => sub {
    lang('en');
    is( LJ::std_max_length(), 80, 'en remains 80' );
    lang('ru');
    is( LJ::std_max_length(), 100, 'listed ru remains 100' );
    lang('fr');
    is( LJ::std_max_length(), 80, 'unlisted language remains 80' );
    lang('debug');
    is( LJ::std_max_length(), 80, 'debug remains raw non-listed 80' );
    local $LJ::DEFAULT_LANG = 'ru';
    DW::Request->reset;
    is( LJ::std_max_length(), 80, 'no request remains 80 even when application default is listed' );
};
subtest 'actual JournalTitles save uses request maxlength boundary with fresh persistence' => sub {
    my $u = temp_user();
    $u->update_self( { status => 'A' } );
    my $value = 'x' x 105;
    no warnings 'redefine';
    local *LJ::Widget::JournalTitles::get_effective_remote = sub { $u };
    lang('en');
    LJ::Widget::JournalTitles->handle_post(
        { which_title => 'journaltitle', title_value => $value } );
    my $fresh = LJ::load_user( $u->user, 'force' );
    is( length( $fresh->prop('journaltitle') ), 80, 'English save stores 80 characters' );
    lang('ru');
    LJ::Widget::JournalTitles->handle_post(
        { which_title => 'journaltitle', title_value => $value } );
    $fresh = LJ::load_user( $u->user, 'force' );
    is( length( $fresh->prop('journaltitle') ), 100, 'listed-language save stores 100 characters' );
};
subtest 'actual entry form renders the native maxlength on current fields' => sub {
    my $u = temp_user();
    $u->update_self( { status => 'A' } );
    lang('ru');
    local *BML::ml      = sub { return $_[0] };
    local *LJ::Lang::ml = sub { return $_[0] };
    my ( $head, $onload ) = ( '', '' );
    my $html = LJ::entry_form(
        { remote => $u, mode => 'update', auth => '', event => '', richtext_default => 0 },
        \$head, \$onload, {} );
    like(
        $html,
qr/name="prop_current_location"[^>]*maxlength="100"|maxlength="100"[^>]*name="prop_current_location"/,
        'entry form current location reflects listed-language maxlength'
    );
    like(
        $html,
qr/name="prop_current_music"[^>]*maxlength="100"|maxlength="100"[^>]*name="prop_current_music"/,
        'entry form current music reflects listed-language maxlength'
    );
};
done_testing;

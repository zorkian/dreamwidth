# Characterize settings hub form contracts before controller migration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
plan skip_all => 'Settings integration requires a development server'
    unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $u     = temp_user();
my $other = temp_user();
$u->set_prop( timeformat_24 => 0 );
$u->set_prop( timezone      => 'Etc/UTC' );
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'settingsMutationProbe';
test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub {
        my $request = shift;
        $request->header( Cookie => $cookie );
        return $send->($request);
    };
    for my $path ( '/manage/settings/', '/manage/settings/index', '/manage/settings/index.bml' ) {
        my $response = $cb->( GET $path . '?cat=display' );
        is( $response->code, 200, "$path accepts old entry point" );
        like( $response->content, qr/id=['"]settings_form/, 'settings form is available' );
    }
    my $url    = '/manage/settings/?cat=display';
    my $res    = $cb->( GET $url);
    my ($form) = grep { ( $_->attr('id') || '' ) eq 'settings_form' }
        HTML::Form->parse( $res->content, 'http://localhost' . $url );
    ok( $form, 'actual display form parsed' ) or return;
    $form->value( 'DW__Setting__TimeFormat_timeformat', 1 );
    $form->value( 'LJ__Setting__TimeZone_timezone',     'Europe/London' );
    my $req = $form->click;
    $req->uri( 'http://localhost' . $url );
    $res = $cb->($req);
    is( $res->code, 200, 'real display form submitted' );
    like( $res->content, qr/id=['"]settings_form/, 'successful save renders form' );
    unlike(
        $res->content,
        qr/unblessed|undef error|BML ERROR/,
        'no server exception in save response'
    );
    $res = $cb->( GET $url);
    ($form) = grep { ( $_->attr('id') || '' ) eq 'settings_form' }
        HTML::Form->parse( $res->content, 'http://localhost' . $url );
    is( $form->value('DW__Setting__TimeFormat_timeformat'), 1, 'time format survives fresh GET' );
    is( $form->value('LJ__Setting__TimeZone_timezone'),
        'Europe/London', 'timezone survives fresh GET' );
    my $fresh = LJ::load_userid( $u->id, 1 );
    is( $fresh->prop('timeformat_24'), 1, 'time format persists on forced fresh user' );
    is( $fresh->prop('timezone'), 'Europe/London', 'timezone persists on forced fresh user' );
    my $token = $form->value('lj_form_auth');
    $form->value( 'DW__Setting__TimeFormat_timeformat', 0 );
    $form->value( 'lj_form_auth',                       'invalid' );
    $req = $form->click;
    $req->uri( 'http://localhost' . $url );
    $res = $cb->($req);
    like( $res->content, qr/Invalid form/i, 'invalid token is explained' );
    $res = $cb->( GET $url);
    ($form) = grep { ( $_->attr('id') || '' ) eq 'settings_form' }
        HTML::Form->parse( $res->content, 'http://localhost' . $url );
    is( $form->value('DW__Setting__TimeFormat_timeformat'), 1, 'invalid token does not mutate' );
    $other->set_prop( timeformat_24 => 0 );
    my $other_before = $other->prop('timeformat_24') || 0;
    $res = $cb->(
        POST $url . '&authas=' . $other->user,
        Content => [
            lj_form_auth                         => $token,
            'DW__Setting__TimeFormat_timeformat' => 1
        ]
    );
    unlike( $res->content, qr/id=['"]settings_form/, 'valid-token unauthorized target denied' );
    is( LJ::load_userid( $other->id, 1 )->prop('timeformat_24') || 0,
        $other_before, 'denied target unchanged' );
};
done_testing;

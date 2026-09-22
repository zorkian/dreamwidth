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
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'settingsMutationProbe';
test_psgi $app, sub {
    my $cb = shift;
    for my $path ( '/manage/settings/', '/manage/settings/index', '/manage/settings/index.bml' ) {
        my $response = $cb->( GET $path . '?cat=display&as=' . $u->user );
        is( $response->code, 200, "$path accepts old entry point" );
        like( $response->content, qr/id=['"]settings_form/, 'settings form is available' );
    }
    my $url    = '/manage/settings/?cat=display&as=' . $u->user;
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
    $res = $cb->( GET $url);
    ($form) = grep { ( $_->attr('id') || '' ) eq 'settings_form' }
        HTML::Form->parse( $res->content, 'http://localhost' . $url );
    is( $form->value('DW__Setting__TimeFormat_timeformat'), 1, 'time format survives fresh GET' );
    is( $form->value('LJ__Setting__TimeZone_timezone'),
        'Europe/London', 'timezone survives fresh GET' );
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
    is( LJ::load_userid( $other->id )->prop('timeformat_24') || 0,
        $other_before, 'denied target unchanged' );
};
done_testing;

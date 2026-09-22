# Characterize settings hub form contracts before controller migration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_comm temp_user);
plan skip_all => 'Settings integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

{

    package LJ::Setting::BMLMigrationFixture;
    use base 'LJ::Setting';
    sub label { 'BML migration fixture' }

    sub option {
        my ( $class, $u, $errs, $args ) = @_;
        my $value = $class->get_arg( $args, 'value' ) || $u->prop('opt_shortcuts');
        return LJ::html_text( { name => $class->pkgkey . 'value', value => $value } )
            . $class->errdiv( $errs, 'value' );
    }

    sub error_check {
        my ( $class, $u, $args ) = @_;
        $class->errors( value => 'Fixture value must be valid' )
            unless $class->get_arg( $args, 'value' ) eq 'valid';
        return 1;
    }

    sub save {
        my ( $class, $u, $args ) = @_;
        $class->error_check( $u, $args );
        $u->set_prop( opt_shortcuts => $class->get_arg( $args, 'value' ) );
        return 1;
    }
}

package main;
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

sub settings_cookie {
    my ($user) = @_;
    my $session = LJ::Session->create( $user, nolog => 1 );
    return
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
}

sub settings_form {
    my ( $content, $url ) = @_;
    return
        grep { ( $_->attr('id') || '' ) eq 'settings_form' }
        HTML::Form->parse( $content, 'http://localhost' . $url );
}

test_psgi $app, sub {
    my $send     = shift;
    my $anon_url = '/manage/settings/?cat=display';
    my $res      = $send->( GET $anon_url );
    is( $res->code, 200, 'anonymous display settings render' );
    my ($form) = settings_form( $res->content, $anon_url );
    ok( $form, 'anonymous display settings expose the cookie-backed form contract' );
    ok( defined $form->value('lj_form_auth'), 'anonymous form retains CSRF contract' );
    ok(
        !defined $form->value('DW__Setting__TimeFormat_timeformat'),
        'anonymous form omits account-backed display settings'
    );
    $form->value( 'DW__Setting__MobileView_val', 1 );
    my $request = $form->click;
    $request->uri( 'http://localhost' . $anon_url );
    $res = $send->($request);
    is( $res->code, 200, 'anonymous MobileView form save returns a rendered response' );
    like( $res->header('Set-Cookie') || '',
        qr/no_mobile=1/, 'anonymous MobileView save sets cookie' );
    my @set_cookies  = $res->headers->header('Set-Cookie');
    my @cookie_pairs = map { /^([^;]+)/ ? $1 : () } @set_cookies;
    diag( 'anonymous MobileView Set-Cookie: ' . join( ' | ', @set_cookies ) );
    $res = $send->( GET $anon_url, Cookie => join( '; ', @cookie_pairs ) );
    ($form) = settings_form( $res->content, $anon_url );
    is( $form->value('DW__Setting__MobileView_val'),
        1, 'anonymous MobileView cookie survives a fresh rendered request' );
    $form->value( 'DW__Setting__MobileView_val', 0 );
    $form->value( 'lj_form_auth',                'invalid' );
    $request = $form->click;
    $request->uri( 'http://localhost' . $anon_url );
    $request->header( Cookie => join( '; ', @cookie_pairs ) );
    $res = $send->($request);
    like( $res->content, qr/Invalid form/i, 'anonymous invalid token is explained' );
    unlike( join( ' | ', $res->headers->header('Set-Cookie') || () ),
        qr/no_mobile=/, 'anonymous invalid token does not update the MobileView cookie' );
    $res = $send->( GET $anon_url, Cookie => join( '; ', @cookie_pairs ) );
    ($form) = settings_form( $res->content, $anon_url );
    is( $form->value('DW__Setting__MobileView_val'),
        1, 'anonymous invalid token does not clear the cookie-backed setting' );
};

test_psgi $app, sub {
    my $send  = shift;
    my $maint = temp_user();
    my $comm  = temp_comm();
    LJ::set_rel( $comm, $maint, 'A' );
    my $cookie = settings_cookie($maint);
    my $cb     = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };
    my $url    = '/manage/settings/?authas=' . $comm->user . '&cat=community';
    my $res    = $cb->( GET $url );
    is( $res->code, 200, 'maintainer community settings render through authas' );
    my ($form) = settings_form( $res->content, $url );
    ok( $form, 'maintainer receives rendered community save form' ) or return;
    $form->value( 'DW__Setting__CommunityMembership_communitymembership', 'closed' );
    my $req = $form->click;
    $req->uri( 'http://localhost' . $url );
    $res = $cb->($req);
    like( $res->content, qr/successfully saved/i, 'community form save reports success' );
    is( ( LJ::load_userid( $comm->id, 1 )->get_comm_settings )[0],
        'closed', 'maintainer community membership survives fresh load' );

    my $outsider        = temp_user();
    my $outsider_cookie = settings_cookie($outsider);
    my $outsider_form_res =
        $send->( GET '/manage/settings/?cat=display', Cookie => $outsider_cookie );
    my ($outsider_form) =
        settings_form( $outsider_form_res->content, '/manage/settings/?cat=display' );
    my $before = ( LJ::load_userid( $comm->id, 1 )->get_comm_settings )[0];
    my $bad    = $send->(
        POST $url,
        Cookie  => $outsider_cookie,
        Content => [
            lj_form_auth => $outsider_form->value('lj_form_auth'),
            'DW__Setting__CommunityMembership_communitymembership' => 'open'
        ]
    );
    unlike( $bad->content, qr/id=['"]settings_form/,
        'unauthenticated authas community POST is denied' );
    is( ( LJ::load_userid( $comm->id, 1 )->get_comm_settings )[0],
        $before, 'denied community target remains unchanged' );
};

test_psgi $app, sub {
    my $send   = shift;
    my $owner  = temp_user();
    my $viewer = temp_user();
    $viewer->grant_priv( 'canview', 'subscriptions' );
    my $inactive =
        $owner->subscribe( event => 'JournalNewEntry', journalid => 0, method => 'Inbox' );
    $inactive->_deactivate;
    my $legacy = $owner->subscribe(
        event   => 'AddedToCircle',
        journal => $owner,
        method  => 'Inbox',
        arg1    => 1
    );
    my $cookie = settings_cookie($owner);
    my $cb     = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };
    my $url    = '/manage/settings/?cat=notifications';
    my $res    = $cb->( GET $url );
    is( $res->code, 200, 'owner notification settings render' );
    my ($form) = settings_form( $res->content, $url );
    ok( $form, 'owner notification settings expose mutation form' ) or return;
    my $token = $form->value('lj_form_auth');
    $res = $cb->( POST $url, Content => [ lj_form_auth => $token, deleteinactive => 1 ] );
    ok( !grep( { $_->id == $inactive->id } LJ::load_userid( $owner->id, 1 )->subscriptions ),
        'deleteinactive removes an inactive subscription through POST' );
    $res = $cb->( GET $url . '&deletesub_' . $legacy->id . '=1' );
    ok(
        !grep( { $_->id == $legacy->id } LJ::load_userid( $owner->id, 1 )->subscriptions ),
        'legacy deletesub GET currently mutates and must be replaced safely during migration'
    );

    my $fresh_owner = LJ::load_userid( $owner->id, 1 );
    my $protected   = $fresh_owner->subscribe(
        event   => 'AddedToCircle',
        journal => $fresh_owner,
        method  => 'Inbox',
        arg1    => 99
    );
    $protected->_deactivate;
    my $viewer_cookie = settings_cookie($viewer);
    my $inspect       = $send->(
        GET '/manage/settings/?cat=notifications&user=' . $owner->user,
        Cookie => $viewer_cookie
    );
    is( $inspect->code, 200, 'privileged notification inspection renders' );
    unlike( $inspect->content, qr/id=['"]settings_form/,
        'privileged inspection exposes no mutation form' );
    ok(
        grep( { $_->id == $protected->id } LJ::load_userid( $owner->id, 1 )->subscriptions ),
        'privileged target has an eligible inactive subscription before forged action'
    );
    my $viewer_form_res = $send->( GET '/manage/settings/?cat=display', Cookie => $viewer_cookie );
    my ($viewer_form) = settings_form( $viewer_form_res->content, '/manage/settings/?cat=display' );
    my $post = $send->(
        POST '/manage/settings/?cat=notifications&user=' . $owner->user,
        Cookie  => $viewer_cookie,
        Content => [ lj_form_auth => $viewer_form->value('lj_form_auth'), deleteinactive => 1 ]
    );
    ok( grep( { $_->id == $protected->id } LJ::load_userid( $owner->id, 1 )->subscriptions ),
        'privileged inspection POST cannot mutate owner subscription' );
};

test_psgi $app, sub {
    my $send   = shift;
    my $user   = temp_user();
    my $cookie = settings_cookie($user);
    my $cb     = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };

    my $shortcuts_url = '/manage/settings/?cat=shortcuts';
    my $res           = $cb->( GET $shortcuts_url );
    my ($form) = settings_form( $res->content, $shortcuts_url );
    ok( $form, 'shortcuts category has a rendered save form' ) or return;
    $form->value( 'DW__Setting__Shortcuts_val', 1 );
    my $request = $form->click;
    $request->uri( 'http://localhost' . $shortcuts_url );
    $res = $cb->($request);
    like( $res->content, qr/successfully saved/i, 'shortcuts save has a success response body' );
    is( LJ::load_userid( $user->id, 1 )->prop('opt_shortcuts'),
        'Y', 'shortcuts choice persists on a forced fresh user' );

    my $privacy_url = '/manage/settings/?cat=display';
    $res = $cb->( GET $privacy_url );
    ($form) = settings_form( $res->content, $privacy_url );
    ok( $form, 'display category has a rendered save form' ) or return;
    my $safe_key = 'LJ__Setting__SafeSearch_safesearch';
    ok( defined $form->value($safe_key), 'display form renders SafeSearch validation control' )
        or return;
    $form->value( $safe_key, 'not-valid' );
    $request = $form->click;
    $request->uri( 'http://localhost' . $privacy_url );
    $res = $cb->($request);
    like( $res->content, qr/invalid/i, 'invalid display value has useful validation text' );
    unlike( $res->content, qr/value=['"]not-valid['"]/,
        'legacy select validation does not render an invalid non-option value' );
    unlike( LJ::load_userid( $user->id, 1 )->prop('safe_search') || '',
        qr/not-valid/, 'invalid display value does not persist' );
};

{
    local $INC{'LJ/Setting/BMLMigrationFixture.pm'} = __FILE__;
    local $LJ::HOOKS{settings_extra_cats}           = [
        sub {
            my ( $order, $cats ) = @_;
            push @$order, 'migration_fixture';
            $cats->{migration_fixture} = {
                name     => 'Migration fixture',
                visible  => 1,
                disabled => 0,
                form     => 1,
                desc     => 'Temporary test fixture',
                settings => ['LJ::Setting::BMLMigrationFixture'],
            };
        }
    ];
    test_psgi $app, sub {
        my $send   = shift;
        my $user   = temp_user();
        my $cookie = settings_cookie($user);
        my $url    = '/manage/settings/?cat=migration_fixture';
        my $res    = $send->( GET $url, Cookie => $cookie );
        my ($form) = settings_form( $res->content, $url );
        ok( $form, 'hook-added category renders its form' ) or return;
        my $key = 'LJ__Setting__BMLMigrationFixture_value';
        ok( defined $form->value($key), 'hook-added setting renders its field' );
        my $request = POST $url,
            Content => [
            lj_form_auth => $form->value('lj_form_auth'),
            $key         => 'valid'
            ];
        $request->header( Cookie => $cookie );
        $res = $send->($request);
        like(
            $res->content,
            qr/successfully saved/i,
            'hook-added setting saves through rendered form'
        );
        is( LJ::load_userid( $user->id, 1 )->prop('opt_shortcuts'),
            'valid', 'hook-added setting persists on a fresh user' );
        ($form) = settings_form( $res->content, $url );
        $request = POST $url,
            Content => [
            lj_form_auth => $form->value('lj_form_auth'),
            $key         => 'invalid'
            ];
        $request->header( Cookie => $cookie );
        $res = $send->($request);
        like(
            $res->content,
            qr/Fixture value must be valid/,
            'hook setting reports validation error'
        );
        like( $res->content, qr/value=['"]invalid['"]/, 'hook setting preserves invalid input' );
        is( LJ::load_userid( $user->id, 1 )->prop('opt_shortcuts'),
            'valid', 'hook validation leaves persisted property unchanged' );
    };
}

test_psgi $app, sub {
    my $send  = shift;
    my $maint = temp_user();
    my $comm  = temp_comm();
    LJ::set_rel( $comm, $maint, 'A' );
    my $cookie = settings_cookie($maint);
    my $url    = '/manage/settings/?authas=' . $comm->user . '&cat=community';
    my $res    = $send->( GET $url, Cookie => $cookie );
    my ($form) = settings_form( $res->content, $url );
    ok( $form, 'community posting and moderation controls render for a maintainer' ) or return;

    my $postlevel_key  = 'DW__Setting__CommunityPostLevel_communitypostlevel';
    my $moderation_key = 'DW__Setting__CommunityEntryModeration_val';
    ok( defined $form->value($postlevel_key), 'community posting level control is rendered' )
        or return;
    ok( grep( { ( $_->name || '' ) eq $moderation_key } $form->inputs ),
        'community moderation control is rendered' )
        or return;
    $form->value( $postlevel_key,  'select' );
    $form->value( $moderation_key, 1 );
    my $request = $form->click;
    $request->uri( 'http://localhost' . $url );
    $request->header( Cookie => $cookie );
    $res = $send->($request);
    like(
        $res->content,
        qr/successfully saved/i,
        'community posting and moderation save reports success'
    );
    my $fresh = LJ::load_userid( $comm->id, 1 );
    is( ( $fresh->get_comm_settings )[1], 'select', 'community post level survives forced reload' );
    is( $fresh->prop('moderated'),        1,        'community moderation survives forced reload' );

    ($form) = settings_form( $res->content, $url );
    $form->value( $postlevel_key, 'not-a-level' );
    $request = $form->click;
    $request->uri( 'http://localhost' . $url );
    $request->header( Cookie => $cookie );
    $res = $send->($request);
    like( $res->content, qr/invalid/i,
        'invalid community posting level has useful validation text' );
    unlike( $res->content, qr/not-a-level/,
        'legacy select validation does not render an invalid non-option community level' );
    is( ( LJ::load_userid( $comm->id, 1 )->get_comm_settings )[1],
        'select', 'invalid community posting level does not persist' );
};

test_psgi $app, sub {
    my $send   = shift;
    my $user   = temp_user();
    my $cookie = settings_cookie($user);
    my $url    = '/manage/settings/?cat=privacy';
    my $res    = $send->( GET $url, Cookie => $cookie );
    my ($form) = settings_form( $res->content, $url );
    ok( $form, 'privacy category has a rendered save form' ) or return;
    my $key = 'LJ__Setting__UserMessaging_usermsg';
    ok( defined $form->value($key), 'privacy UserMessaging control is rendered' ) or return;
    $form->value( $key, 'M' );
    my $request = $form->click;
    $request->uri( 'http://localhost' . $url );
    $request->header( Cookie => $cookie );
    $res = $send->($request);
    like( $res->content, qr/successfully saved/i, 'privacy control save has a success response' );
    is( LJ::load_userid( $user->id, 1 )->prop('opt_usermsg'),
        'M', 'privacy control persists on a forced fresh user' );

    ($form) = settings_form( $res->content, $url );
    $form->value( $key, 'invalid' );
    $request = $form->click;
    $request->uri( 'http://localhost' . $url );
    $request->header( Cookie => $cookie );
    $res = $send->($request);
    like( $res->content, qr/invalid/i, 'invalid privacy value has useful validation text' );
    is( LJ::load_userid( $user->id, 1 )->prop('opt_usermsg'),
        'M', 'invalid privacy value leaves the prior value unchanged' );
};

done_testing;

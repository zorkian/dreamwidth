# Baseline contracts for the pending customization-page migration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user temp_comm);

# This integration test uses the devcontainer database with compiled themes.
# All users and styles created below belong to temporary, cleaned-up users.
plan skip_all => 'Customization integration requires a development server'
    unless $LJ::IS_DEV_SERVER;
my $public = LJ::S2::get_public_layers();
plan skip_all => 'Install the ciel/indil S2 theme for customization integration tests'
    unless $public->{'ciel/indil'};
local $LJ::DEFAULT_STYLE = { core => 'core2', layout => 'ciel/layout', theme => 'ciel/indil' };
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
local $LJ::IS_DEV_SERVER              = 1;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'customizeBaseline';
my $u        = temp_user();
my $stranger = temp_user();
my $comm     = temp_comm();
LJ::set_rel( $comm, $u, 'A' );
test_psgi $app, sub {
    my $cb  = shift;
    my $res = $cb->( GET '/customize/' );
    unlike( $res->content, qr/id="journaltitle"/, 'anonymous has no customization controls' );
    for my $target ( $u, $comm ) {
        my $query = '?as=' . $u->user . '&authas=' . $target->user;
        my $url   = '/customize/' . $query;
        $res = $cb->( GET $url);
        is( $res->code, 200, 'authorized personal/community theme browser' );
        like( $res->content, qr/id="journaltitle"/, 'title widget renders' );
        is( $target->prop('stylesys'), 2, 'S2 enabled' );
        my $style = LJ::S2::load_style( $target->prop('s2_style') );
        is( $style->{userid}, $target->id, 'style belongs to effective user' );
        my ($token) = $res->content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
        ok( $token, 'form token available' );
        $res = $cb->( POST $url, Content => [ nextpage => 1, lj_form_auth => $token ] );
        like( $res->header('Location'), qr{/customize/options}, 'next-page redirect' );
        like( $res->header('Location'), qr/authas=/,            'community identity retained' )
            if $target->is_community;
        $res = $cb->( POST $url, Content => [ nextpage => 1, lj_form_auth => 'invalid' ] );
        ok( !$res->header('Location'), 'invalid next-page token does not redirect' );

        my $theme_nav_url = $url . '&page=2&show=24';
        $res = $cb->( GET $theme_nav_url );
        my ($theme_nav_token) = $res->content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
        $res = $cb->(
            POST $theme_nav_url,
            Content => [
                lj_form_auth              => $theme_nav_token,
                'Widget[ThemeNav]_search' => 'encoded search',
            ]
        );
        is( $res->code, 302, 'ThemeNav POST produces a real redirect response' );
        is(
            $res->header('Location'),
            "$LJ::SITEROOT/customize/?search=encoded+search&authas=" . $target->user . '&show=24',
            'ThemeNav redirect carries authas and show through the BML page'
        );
        $res = $cb->(
            POST $theme_nav_url,
            Content => [
                lj_form_auth              => 'invalid',
                'Widget[ThemeNav]_search' => 'denied search',
            ]
        );
        ok( !$res->header('Location'), 'invalid ThemeNav token does not redirect' );

        for my $path ( '/customize/', '/customize/options' ) {
            $res = $cb->( GET $path . $query );
            my ($page_token) = $res->content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
            my $title = 'Characterized ' . $path . ' ' . $target->user;
            $res = $cb->(
                POST $path . $query,
                Content => [
                    lj_form_auth                        => $page_token,
                    'Widget[JournalTitles]_which_title' => 'journaltitle',
                    'Widget[JournalTitles]_title_value' => $title,
                ]
            );
            is( LJ::load_userid( $target->id )->prop('journaltitle'),
                $title, 'title persists through page widget dispatch' );
            unlike(
                $res->content,
                qr/(?:LJ::Error::DieObject|ARRAY\()/,
                'successful widget POST has no object-pointer error banner'
            );
            $res = $cb->(
                POST $path . $query,
                Content => [
                    lj_form_auth                        => 'invalid',
                    'Widget[JournalTitles]_which_title' => 'journaltitle',
                    'Widget[JournalTitles]_title_value' => 'Denied title',
                ]
            );
            is( LJ::load_userid( $target->id )->prop('journaltitle'),
                $title, 'invalid token cannot change title' );
            like( $res->content, qr/Invalid form/i, 'invalid widget token shows its error message' )
                if $path eq '/customize/';
            unlike(
                $res->content,
                qr/(?:LJ::Error::DieObject|ARRAY\()/,
                'invalid widget token has no object-pointer error banner'
            );
        }
        for my $group (qw(presentation colors fonts images text modules customcss display)) {
            $res = $cb->( GET '/customize/options' . $query . '&group=' . $group );
            is( $res->code, 200, "$group options render" );
            unlike( $res->content, qr/\[Error:|BML ERROR|Invalid user\./, 'no rendering failure' );
        }
    }
    $res = $cb->( GET '/customize/?as=' . $u->user . '&authas=' . $stranger->user );
    unlike( $res->content, qr/id="journaltitle"/, 'unmanaged user denied' );
    ok( !$stranger->prop('s2_style'), 'denied access does not create a style' );
};
done_testing;

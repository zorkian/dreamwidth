#!/usr/bin/perl
# Exercise public personal-owned legacy edit GET activation through app.psgi.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::BML;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Owned edit GET activation requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub native_form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], $_[1] )
    )[0];
}

sub fresh {
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $_[0], ditemid => $_[1] );
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $entry = $owner->t_post_fake_entry(
    subject  => 'Public GET owned subject',
    body     => 'Public GET owned body',
    security => 'private',
);
$entry->set_prop( editor => 'html_raw0' );
my $other = temp_user();
$other->update_self( { status => 'A' } );
$other->t_post_fake_entry(
    subject  => 'Public GET foreign collision one',
    body     => 'Public GET foreign collision one body',
    security => 'private',
);
$other->t_post_fake_entry(
    subject  => 'Public GET foreign collision two',
    body     => 'Public GET foreign collision two body',
    security => 'private',
);
my $foreign = $other->t_post_fake_entry(
    subject  => 'Public GET foreign subject',
    body     => 'Public GET foreign body',
    security => 'private',
);
my $community = temp_comm();
LJ::set_rel( $community, $owner, 'P' );

my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'publicOwnedEditGet';

sub request {
    my ( $send, $request ) = @_;
    $request->header( Cookie => $cookie );
    return $send->($request);
}

test_psgi $app, sub {
    my $send      = shift;
    my $raw_query = 'itemid=' . $entry->ditemid . '&encoded=a%2Fb%26c&repeated=one&repeated=two';

    for my $suffix ( '', '.bml' ) {
        my $path = '/editjournal' . $suffix . '?' . $raw_query;
        my $res  = request( $send, GET $path );
        is( $res->code, 200, "$path public GET renders" );
        my $form = native_form( $res->content, 'http://localhost' . $path );
        ok( $form, "$path public GET uses the native edit form" ) or next;
        is( $form->value('subject'), 'Public GET owned subject', "$path retains owned subject" );
        is( $form->value('event'), 'Public GET owned body', "$path retains owned body" );
        is( $form->value('security'), 'private',   "$path retains private security" );
        is( $form->value('editor'),   'html_raw0', "$path retains stored editor" );
        is(
            $form->action,
            'http://localhost/entry/'
                . $owner->user . '/'
                . $entry->ditemid
                . '/edit?'
                . $raw_query,
            "$path canonical native action preserves encoded and repeated query pairs"
        );
    }

    is(
        fresh( $owner, $entry->ditemid )->subject_raw,
        'Public GET owned subject',
        'public GET does not mutate the owned subject'
    );
    is(
        fresh( $owner, $entry->ditemid )->event_raw,
        'Public GET owned body',
        'public GET does not mutate the owned body'
    );

    my @excluded = (
        [ '/editjournal?itemid=0', 'zero itemid' ],
        [
            '/editjournal?itemid=' . $entry->ditemid . '&itemid=' . $entry->ditemid,
            'repeated itemid'
        ],
        [
            '/editjournal?itemid=' . $entry->ditemid . '&authas=' . $other->user,
            'different authas'
        ],
        [
            '/editjournal?itemid=' . $entry->ditemid . '&usejournal=' . $community->user,
            'community target'
        ],
        [ '/editjournal?itemid=' . $foreign->ditemid, 'foreign poster' ],
    );

    my $bml_calls  = 0;
    my $render_bml = \&DW::BML::render;
    no warnings 'redefine';
    local *DW::BML::render = sub {
        $bml_calls++ if $_[1] && $_[1] =~ m!/editjournal\.bml$!;
        return $render_bml->(@_);
    };
    for my $case (@excluded) {
        my ( $path, $label ) = @$case;
        my $res = request( $send, GET $path );
        is( $res->code, 200, "$label keeps a public response" );
        unlike( $res->content, qr/id="js-post-entry"/,
            "$label does not enter native edit rendering" );
    }
    is(
        $bml_calls,
        scalar @excluded,
        'each excluded item-bearing GET falls through to retained BML'
    );

    my $post     = POST '/editjournal?itemid=' . $entry->ditemid, [ mode => 'editevent' ];
    my $post_res = request( $send, $post );
    is( $post_res->code, 200, 'item-bearing POST retains its existing response path' );
    unlike( $post_res->content, qr/id="js-post-entry"/,
        'item-bearing POST does not enter GET renderer' );
};

done_testing;

#!/usr/bin/perl
# Exercise the production legacy-update route activation without a test overlay.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Legacy update activation requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub form_from_content {
    my ( $content, $base ) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, $base )
    )[0];
}

sub entry_count {
    my ($u) = @_;
    my $fresh = LJ::load_userid( $u->id, 1 );
    return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $fresh->id );
}

sub moderation_count {
    my ($u) = @_;
    return LJ::get_cluster_master($u)
        ->selectrow_array( 'SELECT COUNT(*) FROM modlog WHERE journalid=?', undef, $u->id );
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyUpdateActivation';

sub get_form {
    my ( $path, $label ) = @_;
    my ( $res, $form );
    test_psgi $app, sub {
        my $send = shift;
        $res = $send->( GET $path, Cookie => $cookie );
    };
    is( $res->code, 200, "$label GET returns retained form representation" );
    $form = form_from_content( $res->content, 'http://localhost' . $path );
    ok( $form, "$label GET falls through to the retained BML form" );
    return $form;
}

sub post_form {
    my ( $form, $path, $label ) = @_;
    my $post = $form->click('action:update');
    $post->uri( 'http://localhost' . $path );
    $post->header( Cookie  => $cookie );
    $post->header( Referer => 'http://localhost' . $path );
    my $res;
    test_psgi $app, sub { $res = shift->($post); };
    is( $res->code, 200, "$label POST returns HTTP 200" );
    return $res;
}

for my $path ( '/update', '/update.bml' ) {
    my $form = get_form( $path, "$path owner" ) or next;
    $form->value( subject  => "$path activation owner subject" );
    $form->value( event    => "$path activation owner body" );
    $form->value( security => 'private' );
    my $before = entry_count($owner);
    my $res    = post_form( $form, $path, "$path owner" );
    like( $res->content, qr/successlinks/,
        "$path valid retained POST uses native success rendering" );
    unlike( $res->content, qr/id="updateForm"/,
        "$path valid retained POST does not rerender BML form" );
    is(
        entry_count($owner),
        $before + 1,
        "$path valid retained POST persists exactly one owner entry"
    );
}

my $community = temp_comm();
LJ::set_rel( $community, $owner, 'P' );
ok( $owner->can_post_to($community), 'activation owner can post to disposable community' );
my $community_path = '/update?usejournal=' . $community->user;
my $community_form = get_form( $community_path, 'community' );
if ($community_form) {
    $community_form->value( subject  => 'activation community subject' );
    $community_form->value( event    => 'activation community body' );
    $community_form->value( security => 'public' );
    my ( $owner_before, $community_before ) = ( entry_count($owner), entry_count($community) );
    my $res = post_form( $community_form, $community_path, 'community' );
    like( $res->content, qr/successlinks/, 'community POST uses native success rendering' );
    is(
        entry_count($community),
        $community_before + 1,
        'community POST persists one community entry'
    );
    is( entry_count($owner), $owner_before, 'community POST does not persist owner entry' );
}

my $moderated = temp_comm();
$moderated->set_prop( moderated => 1 );
LJ::set_rel( $moderated, $owner, 'P' );
ok( $owner->can_post_to($moderated), 'activation owner can post to moderated community' );
$owner->set_draft_text('activation moderated draft');
$owner->set_prop( draft_properties => nfreeze( { subject => 'activation draft subject' } ) );
my $moderated_path = '/update.bml?usejournal=' . $moderated->user;
my $moderated_form = get_form( $moderated_path, 'moderated community' );

if ($moderated_form) {
    $moderated_form->value( subject => 'activation moderated subject' );
    $moderated_form->value( event   => 'activation moderated body' );
    my $before = moderation_count($moderated);
    my $res    = post_form( $moderated_form, $moderated_path, 'moderated community' );
    like(
        $res->content,
        qr/(?:moderation|moderated|approval|queue)/i,
        'moderated POST uses native moderation response'
    );
    is( moderation_count($moderated), $before + 1, 'moderated POST queues exactly one request' );
    is( entry_count($moderated), 0, 'moderated POST does not publish a community entry' );
    my $fresh_owner = LJ::load_userid( $owner->id, 1 );
    is( $fresh_owner->raw_prop('entry_draft'),
        undef, 'moderated POST clears the stored draft body through legacy housekeeping' );
    is_deeply(
        thaw( $fresh_owner->prop('draft_properties') ),
        { subject => 'activation draft subject' },
        'moderated POST preserves draft properties through legacy housekeeping'
    );
}

my $empty_form = get_form( '/update', 'empty-body fallback' );
if ($empty_form) {
    $empty_form->value( subject => 'activation empty body subject' );
    $empty_form->value( event   => '' );
    my $before = entry_count($owner);
    my $res    = post_form( $empty_form, '/update', 'empty-body fallback' );
    like( $res->content, qr/id="js-post-entry"/,
        'empty body rerenders the native correction form' );
    is( entry_count($owner), $before, 'empty body does not persist an entry' );
}

my $preview_form = get_form( '/update', 'preview fallback' );
if ($preview_form) {
    $preview_form->value( subject => 'activation preview subject' );
    $preview_form->value( event   => 'activation preview body' );

    # update.bml recognizes this legacy action even though the retained form
    # has no visible preview submit in this configuration. Keep its real token
    # and ordinary controls rather than routing it through the native schema.
    my $preview = POST(
        '/update',
        [
            'action:preview' => 'Preview',
            lj_form_auth     => $preview_form->value('lj_form_auth'),
            subject          => $preview_form->value('subject'),
            event            => $preview_form->value('event'),
            security         => $preview_form->value('security'),
        ]
    );
    $preview->header( Cookie  => $cookie );
    $preview->header( Referer => 'http://localhost/update' );
    my $res;
    test_psgi $app, sub { $res = shift->($preview); };
    is( $res->code, 200, 'unsupported preview action remains HTTP 200 through BML' );
    like( $res->content, qr/name="event"/,
        'unsupported preview action retains the BML body control' );
    like( $res->content, qr/entryPreview\(/,
        'unsupported preview action retains BML preview controls' );
    like(
        $res->content,
        qr/activation preview subject/,
        'unsupported preview retains submitted subject'
    );
    unlike( $res->content, qr/id="js-post-entry"/,
        'unsupported preview action does not use native correction form' );
}

my $invalid_get;
test_psgi $app, sub {
    my $send = shift;
    $invalid_get = $send->( GET '/update.bml?usejournal=does-not-exist', Cookie => $cookie );
};
is( $invalid_get->code, 200, 'invalid GET usejournal retains BML status' );
unlike( $invalid_get->content, qr/id="js-post-entry"/,
    'invalid GET usejournal remains outside native handler' );
like(
    $invalid_get->content,
    qr/(?:invalid|does not exist|not found)/i,
    'invalid GET usejournal retains a meaningful BML error'
);

done_testing;

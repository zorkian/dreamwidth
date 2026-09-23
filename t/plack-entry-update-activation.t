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
use LJ::SpellCheck;
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

sub post_legacy_action {
    my ( $path, $fields, $label ) = @_;
    my $post = POST( $path, $fields );
    $post->header( Cookie  => $cookie );
    $post->header( Referer => 'http://localhost' . $path );
    my $res;
    test_psgi $app, sub { $res = shift->($post); };
    is( $res->code, 200, "$label returns HTTP 200" );
    return $res;
}

sub native_form_from_content {
    my ( $content, $base ) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, $base )
    )[0];
}

# The reviewed rerender actions are now enabled only through the real public
# registration.  Exercise every legacy spelling and retain the real BML token
# rather than mounting an adapter-only test route.
for my $path ( '/update', '/update.bml' ) {
    for my $action (
        [ showform         => 1,         'showform' ],
        [ moreoptsbtn      => 1,         'moreopts' ],
        [ 'action:preview' => 'Preview', 'direct preview' ],
        )
    {
        my ( $field, $value, $name ) = @$action;
        my $legacy  = get_form( $path, "$path $name rerender" ) or next;
        my $subject = "$path $name public transform subject";
        my $body    = "$path $name public transform body";
        my $before  = entry_count($owner);
        my $res     = post_legacy_action(
            $path,
            [
                $field       => $value,
                lj_form_auth => $legacy->value('lj_form_auth'),
                subject      => $subject,
                event        => $body,
                security     => 'private',
                prop_taglist => "$name-public-tag",
            ],
            "$path $name"
        );
        my $native = native_form_from_content( $res->content, 'http://localhost/entry/new' );
        ok( $native, "$path $name uses native correction form" ) or next;
        is( $native->value('subject'), $subject, "$path $name retains subject" );
        is( $native->value('event'),   $body,    "$path $name retains body" );
        is( entry_count($owner),       $before,  "$path $name does not persist an entry" );
    }
}

# Dynamic transforms retain the hook ABI under the public app: one mutable
# invocation and no legacy decoder invocation.
my $dynamic_form = get_form( '/update.bml', 'public dynamic transform' );
if ($dynamic_form) {
    my ( $calls, $decode ) = ( 0, 0 );
    my $before = entry_count($owner);
    local $LJ::HOOKS{transform_update_public_activation} = [
        sub {
            my ( $get, $post ) = @_;
            ++$calls;
            $post->{subject}      = 'public dynamic subject';
            $post->{event}        = 'public dynamic body';
            $post->{prop_taglist} = 'public-dynamic-tag';
        }
    ];
    local $LJ::HOOKS{decode_entry_form} = [ sub { ++$decode; } ];
    my $res = post_legacy_action(
        '/update.bml',
        [
            transform    => 'public_activation',
            lj_form_auth => $dynamic_form->value('lj_form_auth'),
            subject      => 'ignored submitted subject',
            event        => 'ignored submitted body',
            security     => 'public',
        ],
        'public dynamic transform'
    );
    my $native = native_form_from_content( $res->content, 'http://localhost/entry/new' );
    ok( $native, 'public dynamic transform returns native correction form' );
    is(
        $native->value('subject'),
        'public dynamic subject',
        'dynamic hook mutation retains subject'
    ) if $native;
    is( $native->value('event'), 'public dynamic body', 'dynamic hook mutation retains body' )
        if $native;
    is( $calls,              1,       'public dynamic transform runs exactly once' );
    is( $decode,             0,       'public dynamic transform does not invoke the decoder hook' );
    is( entry_count($owner), $before, 'public dynamic transform does not persist an entry' );
}

# The public spellcheck path is nonpersisting whether configured, unavailable
# after form render, or rejected for a missing/invalid old form token.
my $spell_before = entry_count($owner);
{
    local $LJ::SPELLER = 'public-activation-stub';
    my $spell_form = get_form( '/update', 'public configured spellcheck' );
    if ($spell_form) {
        ok(
            $spell_form->find_input('action:spellcheck'),
            'configured retained form renders Spell Check control'
        );
        my $checks = 0;
        no warnings 'redefine';
        local *LJ::SpellCheck::check_html = sub {
            ++$checks;
            return '<em class="public-spell-result">public suggestion</em>';
        };
        my $configured = post_legacy_action(
            '/update',
            [
                'action:spellcheck' => 'Spell Check',
                lj_form_auth        => $spell_form->value('lj_form_auth'),
                subject             => 'public spellcheck subject',
                event               => 'public misspell body',
                security            => 'private',
            ],
            'public configured spellcheck'
        );
        like(
            $configured->content,
            qr/public suggestion/,
            'configured public spellcheck shows checker result'
        );
        is( $checks, 1, 'configured public spellcheck invokes checker once' );
        is( entry_count($owner), $spell_before, 'configured public spellcheck does not persist' );

        my $unavailable;
        {
            local $LJ::SPELLER;
            $unavailable = post_legacy_action(
                '/update',
                [
                    'action:spellcheck' => 'Spell Check',
                    lj_form_auth        => $spell_form->value('lj_form_auth'),
                    subject             => 'public unavailable subject',
                    event               => 'public unavailable body',
                    security            => 'private',
                ],
                'public unavailable spellcheck'
            );
        }
        like(
            $unavailable->content,
            qr/Spell check is currently unavailable/,
            'unavailable public spellcheck rerenders a meaningful result'
        );
        is( entry_count($owner), $spell_before, 'unavailable public spellcheck does not persist' );

        for my $token_case ( [ missing => undef ], [ invalid => 'not-a-valid-token' ], ) {
            my ( $label, $token ) = @$token_case;
            my $before_checks = $checks;
            my @fields        = (
                'action:spellcheck' => 'Spell Check',
                subject             => "public $label token subject",
                event               => "public $label token body",
                security            => 'private',
            );
            push @fields, ( lj_form_auth => $token ) if defined $token;
            my $denied = post_legacy_action( '/update', \@fields, "public $label spellcheck" );
            like(
                $denied->content,
                qr/(?:Invalid form submission|invalid form)/i,
                "public $label spellcheck shows form-auth error"
            );
            is( $checks, $before_checks, "public $label spellcheck does not invoke checker" );
            is( entry_count($owner), $spell_before, "public $label spellcheck does not persist" );
        }
    }
}

# GET, alternate-login, and share requests are deliberately still BML
# fallthroughs; registration must not turn them into the native correction form.
for my $case ( [ '/update?altlogin=1', 'alternate-login GET' ],
    [ '/update?share=not-a-url', 'share GET' ], )
{
    my ( $path, $label ) = @$case;
    my $res;
    test_psgi $app, sub { $res = shift->( GET $path, Cookie => $cookie ); };
    is( $res->code, 200, "$label retains BML HTTP status" );
    like( $res->content, qr/id=['"]updateForm['"]/, "$label retains BML update form" );
    unlike( $res->content, qr/id="js-post-entry"/, "$label remains outside native rerender" );
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

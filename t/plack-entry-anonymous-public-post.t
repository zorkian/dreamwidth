#!/usr/bin/perl
# Exercise public anonymous retained update POST composition without route overlays.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Storable qw(nfreeze thaw);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use LJ::Entry;
use LJ::Test qw(temp_user);

plan skip_all => 'Anonymous public update activation requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub retained_form {
    my ( $content, $path ) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('user')
                && $_->find_input('password')
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, "http://localhost$path" )
    )[0];
}

sub visible_click {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing visible $name" unless $input;
    return $input->click($form);
}

sub fresh_state {
    my ($userid) = @_;
    my $user   = LJ::load_userid( $userid, 1 );
    my $frozen = $user->prop('draft_properties') || '';
    my ($count) =
        $user->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $user->id );
    return {
        count            => $count || 0,
        draft            => $user->draft_text,
        draft_properties => length $frozen ? thaw($frozen) : {},
        editor           => $user->prop('entry_editor') || '',
        editor2          => $user->entry_editor2 || '',
        formatting       => $user->prop('disable_auto_formatting') || 0,
        displaydate      => $user->displaydate_check || 0,
    };
}

sub form_post {
    my ( $send, $path, $user, $password, %values ) = @_;
    my $get = $send->( GET $path );
    is( $get->code, 200, "$path GET renders the retained anonymous form" );
    my $form = retained_form( $get->content, $path );
    ok( $form, "$path GET has a real retained anonymous form" ) or return;
    $form->action("http://localhost$path");
    $form->value( user     => $user->user ) unless $values{missing_user};
    $form->value( password => $password )   unless $values{missing_password};
    $form->find_input('password')->disabled(1) if $values{missing_password};
    $form->value( subject          => $values{subject} );
    $form->value( event            => $values{body} );
    $form->value( security         => $values{security} || 'private' );
    $form->value( prop_taglist     => $values{tags} ) if defined $values{tags};
    $form->value( prop_xpost_check => 0 ) if $form->find_input('prop_xpost_check');
    my $post = visible_click( $form, 'action:update' );
    $post->uri("http://localhost$path");
    $post->header( Referer => "http://localhost$path" );
    return $post;
}

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $password = 'anonymous-public-' . LJ::rand_chars(24);
$owner->set_password($password);
$owner->set_draft_text('public anonymous draft sentinel');
$owner->set_prop( draft_properties => nfreeze( { subject => 'public frozen subject' } ) );
$owner->set_prop( entry_editor     => 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_prop( disable_auto_formatting => 0 );
$owner->displaydate_check(1);
my $owner_id = $owner->id;

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'anonymousPublicPost';

test_psgi $app, sub {
    my $send = shift;
    my ( $authenticated_calls, $anonymous_calls );
    my $authenticated = \&DW::Controller::Entry::legacy_update_handler;
    my $anonymous     = \&DW::Controller::Entry::legacy_anonymous_update_handler;

    no warnings 'redefine';
    local *DW::Controller::Entry::legacy_update_handler = sub {
        ++$authenticated_calls;
        return $authenticated->(@_);
    };
    local *DW::Controller::Entry::legacy_anonymous_update_handler = sub {
        ++$anonymous_calls;
        return $anonymous->(@_);
    };
    local *LJ::Protocol::schedule_xposts =
        sub { die 'anonymous public post must not schedule xposts' };

    for my $case (
        [ '/update',     'public slash subject', 'public slash body', 'private' ],
        [ '/update.bml', 'public bml subject',   'public bml body',   'friends' ],
        )
    {
        my ( $path, $subject, $body, $security ) = @$case;
        my $before = fresh_state($owner_id);
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, $path, $owner, $password,
            subject  => $subject,
            body     => $body,
            security => $security,
            tags     => 'public-one, public-two'
        );
        my $res = $send->($post);
        is( $authenticated_calls, 1,
            "$path invokes the authenticated handler before anonymous composition" );
        is( $anonymous_calls, 1,
            "$path invokes the anonymous handler after the authenticated structural decline" );
        is( $res->code, 200, "$path claimed anonymous POST returns native HTTP 200" );
        like(
            $res->content,
            qr/class=['"]successlinks['"]/,
            "$path claimed anonymous POST renders native success"
        );
        unlike( $res->content, qr/id=['"]updateForm['"]/,
            "$path claimed anonymous POST does not fall through to BML" );
        my $after = fresh_state($owner_id);
        is( $after->{count}, $before->{count} + 1, "$path creates exactly one fresh entry" );
        LJ::Entry::reset_singletons();
        my $entry = LJ::Entry->new( LJ::load_userid( $owner_id, 1 ), jitemid => $after->{count} );
        is( $entry->subject_raw, $subject, "$path persists the exact subject" );
        is( $entry->event_raw,   $body,    "$path persists the exact body" );

        if ( $security eq 'friends' ) {
            is( $entry->allowmask, 1, "$path maps the supported friends security value" );
        }
        else {
            is( $entry->security, 'private', "$path persists private security" );
        }
        is_deeply(
            { map { $_ => $after->{$_} } qw(draft draft_properties editor editor2 displaydate) },
            { map { $_ => $before->{$_} } qw(draft draft_properties editor editor2 displaydate) },
            "$path legacy success preserves remote-only draft/editor/displaydate state"
        );
    }

    for my $path ( '/update', '/update.bml' ) {

        # Use one distinct owner per alias so the retained login rate limiter
        # cannot turn the second wrong-password proof into a rate-limit result.
        my $wrong_owner = temp_user();
        $wrong_owner->update_self( { status => 'A' } );
        $wrong_owner->set_password( 'anonymous-public-correct-' . LJ::rand_chars(12) );
        $wrong_owner->set_draft_text("$path wrong-password draft sentinel");
        $wrong_owner->set_prop(
            draft_properties => nfreeze( { subject => "$path frozen subject" } ) );
        $wrong_owner->set_prop( entry_editor => 'always_plain' );
        $wrong_owner->entry_editor2('markdown0');
        $wrong_owner->set_prop( disable_auto_formatting => 1 );
        $wrong_owner->displaydate_check(1);
        my $wrong_owner_id = $wrong_owner->id;
        my $before         = fresh_state($wrong_owner_id);
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, $path, $wrong_owner, 'wrong-public-password',
            subject  => "wrong $path subject",
            body     => "wrong $path body",
            security => 'private'
        );
        my $res = $send->($post);
        is( $authenticated_calls, 1,
            "$path wrong-password request reaches authenticated handler once" );
        is( $anonymous_calls, 1,
            "$path wrong-password request is claimed by anonymous handler once" );
        is( $res->code, 200, "$path wrong-password retry returns HTTP 200" );
        like(
            $res->content,
            qr/Error logging on:\s+Invalid password/,
            "$path shows the localized protocol error"
        );
        unlike( $res->content, qr/wrong-public-password/,
            "$path does not echo submitted password" );
        my ($retry) = grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, "http://localhost$path" );
        ok( $retry, "$path wrong-password result is the native retry form" );
        is(
            $retry ? $retry->value('subject') : undef,
            "wrong $path subject",
            "$path retains retry subject"
        );
        is(
            $retry ? $retry->value('event') : undef,
            "wrong $path body",
            "$path retains retry body"
        );
        is_deeply(
            [
                grep { length } map { $_->value // '' }
                grep { ( $_->name || '' ) eq 'password' } $retry->inputs
            ],
            [],
            "$path retry blanks every password control"
        ) if $retry;
        is_deeply( fresh_state($wrong_owner_id),
            $before, "$path wrong password leaves fresh owner state unchanged" );
    }

    for my $case (
        [ 'empty password',   { password         => '' } ],
        [ 'missing password', { missing_password => 1 } ],
        [ 'community target', { usejournal       => 'missing-anonymous-target' } ],
        )
    {
        my ( $label, $changes ) = @$case;
        my $before = fresh_state($owner_id);
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, '/update.bml', $owner, $changes->{password} // $password,
            subject          => "$label subject",
            body             => "$label body",
            security         => 'private',
            missing_password => $changes->{missing_password}
        );
        if ( $changes->{usejournal} ) {
            $post->content( $post->content . '&usejournal=' . $changes->{usejournal} );
            $post->header( 'Content-Length' => length $post->content );
        }
        my $res = $send->($post);
        is( $authenticated_calls, 1,
            "$label reaches authenticated handler before retained fallback" );
        is( $anonymous_calls, 1, "$label reaches anonymous classifier before retained fallback" );
        unlike( $res->content, qr/id=['"]js-post-entry['"]/,
            "$label does not enter the native retry renderer" );
        like(
            $res->content,
            qr/(?:id=['"]updateForm['"]|Invalid users passed to)/,
            "$label retains a meaningful BML fallback response"
        );
        is_deeply( fresh_state($owner_id), $before, "$label leaves fresh owner state unchanged" );
    }
};

done_testing;

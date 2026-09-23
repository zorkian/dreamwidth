#!/usr/bin/perl
# Characterize retained anonymous /update password posting without replacing it.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Storable qw(nfreeze thaw);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Test qw(temp_user);

plan skip_all => 'Anonymous retained update characterization requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $production_update_route = $DW::Routing::string_choices{'app/update'};

sub update_form {
    my ( $content, $path ) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('user')
                && $_->find_input('password')
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost' . $path )
    )[0];
}

sub entry_count {
    my ($userid) = @_;
    my $fresh = LJ::load_userid( $userid, 1 );
    return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $fresh->id );
}

sub fresh_entry {
    my ( $user, $jitemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $user, jitemid => $jitemid );
}

sub fresh_user_state {
    my ($userid) = @_;
    my $fresh  = LJ::load_userid( $userid, 1 );
    my $frozen = $fresh->prop('draft_properties') || '';
    return {
        draft_body              => $fresh->draft_text,
        draft_props             => length $frozen ? thaw($frozen) : {},
        entry_editor            => $fresh->prop('entry_editor') || '',
        entry_editor2           => $fresh->prop('entry_editor2') || '',
        disable_auto_formatting => $fresh->prop('disable_auto_formatting') || 0,
    };
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $owner_id = $owner->id;

# This value stays test-local and is never included in a diagnostic, assertion label,
# URL, or response comparison.
my $password = join '-', 'anonymous-update-fixture', LJ::rand_chars(24);
$owner->set_password($password);
$owner->set_prop( entry_editor            => 'plain' );
$owner->set_prop( entry_editor2           => 'markdown0' );
$owner->set_prop( disable_auto_formatting => 0 );

ok( $owner->set_draft_text('Anonymous retained draft body sentinel'),
    'seeded anonymous owner draft body sentinel' );
$owner->set_prop(
    draft_properties => nfreeze(
        {
            subject => 'Anonymous retained draft subject sentinel',
            editor  => 'html_raw0',
            taglist => 'anonymous-retained-sentinel',
        }
    )
);
my $state_before = fresh_user_state($owner_id);

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'anonymousUpdatePostBaseline';
my $scheduled = 0;

test_psgi $app, sub {
    my $send = shift;

    # No Cookie header is attached anywhere in this baseline.  The account is
    # authenticated solely through the retained visible user/password controls.
    my $request = sub { $send->( $_[0] ) };

    no warnings 'redefine';
    local *LJ::Protocol::schedule_xposts = sub { $scheduled++ };

    for my $case (
        {
            path         => '/update',
            subject      => 'Anonymous retained slash subject',
            body         => 'Anonymous retained slash body',
            security     => 'private',
            event_format => 1,
        },
        {
            path         => '/update.bml',
            subject      => 'Anonymous retained bml subject',
            body         => 'Anonymous retained bml body',
            security     => 'friends',
            event_format => 0,
        },
        )
    {
        my $res = $request->( GET $case->{path} );
        is( $res->code, 200, "$case->{path} anonymous GET renders retained form" );
        unlike( $res->header('Location') || '',
            qr{/entry/new}, "$case->{path} anonymous GET does not redirect to native editor" );

        my $form = update_form( $res->content, $case->{path} );
        ok( $form, "$case->{path} exposes the actual retained anonymous form" ) or next;
        ok( $form->find_input('action:update'),
            "$case->{path} form exposes the retained update action" );
        is( $form->value('password') // '',
            '', "$case->{path} initial retained password control is blank" );

        $form->action( 'http://localhost' . $case->{path} );
        $form->value( user             => $owner->user );
        $form->value( password         => $password );
        $form->value( subject          => $case->{subject} );
        $form->value( event            => $case->{body} );
        $form->value( security         => $case->{security} );
        $form->value( prop_xpost_check => 0 ) if $form->find_input('prop_xpost_check');
        $form->value( event_format     => 'preformatted' )
            if $case->{event_format} && $form->find_input('event_format');

        my $before = entry_count($owner_id);
        my $post   = $form->click('action:update');
        $post->uri( 'http://localhost' . $case->{path} );
        $post->header( Referer => 'http://localhost' . $case->{path} );
        $res = $request->($post);

        is( $res->code, 200, "$case->{path} password POST returns a retained response" );
        like(
            $res->content,
            qr/(?:posted|success|updated)/i,
            "$case->{path} password POST has a meaningful success response"
        );
        is(
            entry_count($owner_id),
            $before + 1,
            "$case->{path} password POST creates exactly one entry"
        );

        my $fresh = LJ::load_userid( $owner_id, 1 );
        my ($jitemid) = $fresh->selectrow_array(
            'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
            undef, $owner_id );
        my $entry = fresh_entry( $fresh, $jitemid );
        ok( $entry, "$case->{path} persisted entry force-loads" ) or next;
        is( $entry->subject_raw, $case->{subject}, "$case->{path} preserves its subject" );
        is( $entry->event_raw,   $case->{body},    "$case->{path} preserves its body" );

        if ( $case->{security} eq 'friends' ) {
            is( $entry->security,  'usemask', "$case->{path} maps friends to usemask" );
            is( $entry->allowmask, 1,         "$case->{path} preserves the friends allowmask" );
        }
        else {
            is( $entry->security, 'private', "$case->{path} preserves private security" );
        }
        my $after_state = fresh_user_state($owner_id);
        is_deeply(
            {
                draft_body    => $after_state->{draft_body},
                draft_props   => $after_state->{draft_props},
                entry_editor  => $after_state->{entry_editor},
                entry_editor2 => $after_state->{entry_editor2},
            },
            {
                draft_body    => $state_before->{draft_body},
                draft_props   => $state_before->{draft_props},
                entry_editor  => $state_before->{entry_editor},
                entry_editor2 => $state_before->{entry_editor2},
            },
            "$case->{path} anonymous password POST leaves remote-only draft/editor state unchanged"
        );
        is( $after_state->{disable_auto_formatting},
            $case->{event_format},
            "$case->{path} success updates disable_auto_formatting from event_format" );
    }

    for my $case (
        {
            label      => 'wrong password',
            password   => join( '-', 'wrong', LJ::rand_chars(24) ),
            subject    => 'Anonymous wrong-password subject',
            body       => 'Anonymous wrong-password body',
            want_error => qr/Error logging on.*Invalid password/s,
        },
        {
            label      => 'empty password',
            password   => '',
            subject    => 'Anonymous empty-password subject',
            body       => 'Anonymous empty-password body',
            want_error => qr/Enter Password/,
        },
        {
            label      => 'empty body',
            password   => $password,
            subject    => 'Anonymous empty-body subject',
            body       => '',
            want_error => qr/Must provide entry text/,
        },
        )
    {
        my $path = '/update.bml';
        my $res  = $request->( GET $path );
        my $form = update_form( $res->content, $path );
        ok( $form, "$case->{label} starts from the retained anonymous form" ) or next;
        $form->action( 'http://localhost' . $path );
        $form->value( user     => $owner->user );
        $form->value( password => $case->{password} );
        $form->value( subject  => $case->{subject} );
        $form->value( event    => $case->{body} );

        my $before = entry_count($owner_id);
        my $post   = $form->click('action:update');
        $post->uri("http://localhost$path");
        $post->header( Referer => "http://localhost$path" );
        $res = $request->($post);

        is( $res->code, 200, "$case->{label} returns a retained HTTP response" );
        like( $res->content, $case->{want_error},
            "$case->{label} has a meaningful error response" );
        is( entry_count($owner_id), $before, "$case->{label} creates no entry" );
        is_deeply( fresh_user_state($owner_id),
            $state_before, "$case->{label} leaves draft/editor and formatting state unchanged" );

        my $retry = update_form( $res->content, $path );
        ok( $retry, "$case->{label} rerenders the retained anonymous form" );
        is( $retry ? ( $retry->value('user') // '' ) : '',
            $owner->user, "$case->{label} retry retains the submitted username" );
        is( $retry ? ( $retry->value('subject') // '' ) : '',
            $case->{subject}, "$case->{label} retry retains the submitted subject" );
        is( $retry ? ( $retry->value('event') // '' ) : '',
            $case->{body}, "$case->{label} retry retains the submitted body" );
        is( $retry ? ( $retry->value('password') // '' ) : '',
            '', "$case->{label} retry password control remains blank" );
    }

    is( $scheduled, 0, 'anonymous retained requests schedule no outbound crossposts' );
};

is( $DW::Routing::string_choices{'app/update'},
    $production_update_route, 'anonymous baseline leaves the production update route unchanged' );

done_testing;

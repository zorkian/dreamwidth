#!/usr/bin/perl
# Exercise public anonymous retained update POST composition without route overlays.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze thaw);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);
use LJ::Test::LegacyOwnedEditRoute;

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
        count => $count            || 0,
        draft => $user->draft_text || '',
        draft_properties => length $frozen ? thaw($frozen) : {},
        editor           => $user->prop('entry_editor') || '',
        editor2          => $user->entry_editor2 || '',
        formatting       => $user->prop('disable_auto_formatting') || 0,
        displaydate      => $user->displaydate_check || 0,
    };
}

sub fresh_latest_entry {
    my ($userid) = @_;
    my $user = LJ::load_userid( $userid, 1 );
    my ($jitemid) = $user->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $user->id );
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $user, jitemid => $jitemid );
}

sub form_post {
    my ( $send, $path, $user, $password, %values ) = @_;
    my $get_request = GET $path;
    $get_request->header( Cookie => $values{cookie} ) if $values{cookie};
    my $get;
    if ( $values{retained_get} ) {
        LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route( 'app/update',
            sub { $get = $send->($get_request); } );
    }
    else {
        $get = $send->($get_request);
    }
    is( $get->code, 200, "$path GET renders the retained anonymous form" );
    my $form = retained_form( $get->content, $path );
    ok( $form, "$path GET has a real retained anonymous form" ) or return;
    ok( !$form->find_input('prop_picture_keyword'),
        "$path anonymous retained form has no userpic selector" );
    $form->action("http://localhost$path");
    $form->value( user     => $user->user ) unless $values{missing_user};
    $form->value( password => $password )   unless $values{missing_password};
    $form->find_input('password')->disabled(1) if $values{missing_password};
    $form->value( subject      => $values{subject} );
    $form->value( event        => $values{body} );
    $form->value( security     => $values{security} || 'private' );
    $form->value( prop_taglist => $values{tags} ) if defined $values{tags};
    my $has_usejournal = $form->find_input('usejournal') ? 1 : 0;
    $form->value( usejournal => $values{usejournal} )
        if defined $values{usejournal} && $has_usejournal;
    $form->value( prop_xpost_check => 0 ) if $form->find_input('prop_xpost_check');
    my $post = visible_click( $form, 'action:update' );

    for my $pair ( @{ $values{extra_pairs} || [] } ) {
        $post->content( $post->content . '&' . $pair->[0] . '=' . $pair->[1] );
    }

    if ( defined $values{usejournal} && !$has_usejournal ) {
        $post->content( $post->content . '&usejournal=' . $values{usejournal} );
    }
    $post->header( 'Content-Length' => length $post->content );
    $post->uri("http://localhost$path");
    $post->header( Referer => "http://localhost$path" );
    $post->header( Cookie  => $values{cookie} ) if $values{cookie};
    return $post;
}

sub trace_anonymous_post {
    my ( $send, $post, %opts ) = @_;
    my ( @sequence, @protocol, @refs );
    my $auth_okay        = \&LJ::auth_okay;
    my $do_request       = \&LJ::do_request;
    my $protocol_request = \&LJ::Protocol::do_request;
    my $run_hook         = \&LJ::Hooks::run_hook;
    my $run_hooks        = \&LJ::Hooks::run_hooks;
    my $response;

    {
        no warnings 'redefine';
        local *LJ::auth_okay = sub {
            push @sequence, 'auth';
            return $auth_okay->(@_);
        };
        local *LJ::do_request = sub {
            my ( $request, $response_hash, $flags ) = @_;
            my $mode = $request->{mode} || '';
            push @sequence, $mode;
            push @protocol, [ $mode, refaddr($request) ];
            if ( $opts{force_login_error} && $mode eq 'login' ) {
                %$response_hash = ( success => 'FAIL', errmsg => 'forced public login error' );
                return;
            }
            if ( $opts{force_flat_postevent_error} && $mode eq 'postevent' ) {
                %$response_hash = ( success => 'FAIL', errmsg => 'forced public postevent error' );
                return;
            }
            return $do_request->(@_);
        };
        local *LJ::Protocol::do_request = sub {
            my ( $mode, $request, $error_ref, $flags ) = @_;
            if ( $opts{force_postevent_error} && $mode eq 'postevent' ) {
                push @sequence, 'postevent';
                push @protocol, [ $mode, refaddr($request) ];
                $$error_ref = 153;
                return undef;
            }
            return $protocol_request->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            if ( $name eq 'update_fields' ) {
                push @sequence, 'update_fields';
                $refs[0] = refaddr( $args[0] );
            }
            return $run_hook->( $name, @args );
        };
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @args ) = @_;
            if ( $name eq 'decode_entry_form' ) {
                push @sequence, 'decode';
                $refs[1] = refaddr( $args[1] );
            }
            if ( $name eq 'spam_check' ) {
                push @sequence, 'spam';
                $refs[2] = refaddr( $args[1] );
            }
            return $run_hooks->( $name, @args );
        };
        $response = $send->($post);
    }

    return {
        response => $response,
        sequence => \@sequence,
        protocol => \@protocol,
        refs     => \@refs
    };
}

sub post_with_native_attempt_counts {
    my ( $send, $post ) = @_;
    my %attempts;
    my $flat = \&DW::Controller::Entry::_legacy_flat_post_attempt;
    my $save = \&DW::Controller::Entry::_do_post;
    my $response;
    {
        no warnings 'redefine';
        local *DW::Controller::Entry::_legacy_flat_post_attempt = sub {
            ++$attempts{flat};
            return $flat->(@_);
        };
        local *DW::Controller::Entry::_do_post = sub {
            ++$attempts{save};
            return $save->(@_);
        };
        $response = $send->($post);
    }
    return ( $response, \%attempts );
}

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

my $owner            = temp_user();
my $community_target = temp_comm();
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
        my $fresh_owner = LJ::load_userid( $owner_id, 1 );
        my ($jitemid) = $fresh_owner->selectrow_array(
            'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
            undef, $fresh_owner->id );
        LJ::Entry::reset_singletons();
        my $entry = LJ::Entry->new( $fresh_owner, jitemid => $jitemid );
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
        my $trace = trace_anonymous_post( $send, $post );
        my $res   = $trace->{response};
        is_deeply(
            $trace->{sequence},
            [qw(update_fields auth login auth decode postevent auth spam)],
            "$path wrong-password retains the exact cross-stage sequence"
        );
        is( scalar grep( { $_ eq 'auth' } @{ $trace->{sequence} } ),
            3, "$path wrong-password has exactly three password checks" );
        is_deeply( [ map { $_->[0] } @{ $trace->{protocol} } ],
            [qw(login postevent)], "$path wrong-password performs one login and one postevent" );
        ok(
            $trace->{refs}[0] && $trace->{refs}[1] && $trace->{refs}[2],
            "$path records original GET and decoded POST references"
        );
        isnt(
            $trace->{refs}[0],
            $trace->{refs}[1],
            "$path keeps the flat update_fields GET request separate from decoded POST data"
        );
        is(
            $trace->{protocol}[1][1],
            $trace->{refs}[1],
            "$path passes the decoded POST reference to postevent"
        );
        is(
            $trace->{refs}[1],
            $trace->{refs}[2],
            "$path passes that exact decoded POST reference to spam checking"
        );
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
        [ '/update',     'forced login error', 'force_login_error' ],
        [ '/update.bml', 'forced login error', 'force_login_error' ],
        )
    {
        my ( $path, $label, $forced ) = @$case;
        $label = "$path $label";
        my $failure_owner = temp_user();
        $failure_owner->update_self( { status => 'A' } );
        my $failure_password = 'anonymous-public-' . LJ::rand_chars(24);
        $failure_owner->set_password($failure_password);
        $failure_owner->set_draft_text("$label draft sentinel");
        $failure_owner->set_prop(
            draft_properties => nfreeze( { subject => "$label frozen subject" } ) );
        $failure_owner->set_prop( entry_editor => 'always_plain' );
        $failure_owner->entry_editor2('markdown0');
        $failure_owner->set_prop( disable_auto_formatting => 1 );
        $failure_owner->displaydate_check(1);
        my $before = fresh_state( $failure_owner->id );
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, $path, $failure_owner, $failure_password,
            subject  => "$label subject",
            body     => "$label body",
            security => 'private'
        );
        my $trace = trace_anonymous_post( $send, $post, $forced => 1 );
        my $res   = $trace->{response};
        is( $authenticated_calls, 1, "$label reaches authenticated handler once" );
        is( $anonymous_calls,     1, "$label is claimed by anonymous handler once" );
        is_deeply( [ map { $_->[0] } @{ $trace->{protocol} } ],
            [qw(login postevent)], "$label performs one login and one postevent" );
        is_deeply(
            $trace->{sequence},
            [qw(update_fields auth login decode postevent spam)],
            "$label has one claimed failure sequence without repeated authentication"
        );
        is(
            $trace->{protocol}[1][1],
            $trace->{refs}[1],
            "$label passes decoded request to postevent"
        );
        is( $trace->{refs}[1], $trace->{refs}[2],
            "$label passes decoded request to spam checking" );
        like(
            $res->content,
            qr/Error logging on:\s+forced public login error/,
            "$label renders the meaningful retained protocol error"
        );
        unlike( $res->content, qr/id=['"]updateForm['"]/, "$label does not fall back to BML" );
        my ($retry) = grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, "http://localhost$path" );
        ok( $retry, "$label renders the native retry form" );
        is(
            $retry ? $retry->value('subject') : undef,
            "$label subject",
            "$label retains the submitted subject"
        );
        is( $retry ? $retry->value('event') : undef,
            "$label body", "$label retains the submitted body" );
        is_deeply(
            [
                grep { length } map { $_->value // '' }
                grep { ( $_->name || '' ) eq 'password' } $retry->inputs
            ],
            [],
            "$label blanks every password input"
        ) if $retry;
        my $after = fresh_state( $failure_owner->id );
        is(
            $after->{count},
            $before->{count} + 1,
            "$label retains the observed postevent persistence"
        );
        my $entry = fresh_latest_entry( $failure_owner->id );
        is(
            $entry ? $entry->subject_raw : undef,
            "$label subject",
            "$label persists the exact submitted subject"
        );
        is( $entry ? $entry->event_raw : undef,
            "$label body", "$label persists the exact submitted body" );
        is( $entry ? $entry->security : undef, 'private', "$label persists private security" );
        is_deeply(
            {
                map { $_ => $after->{$_} }
                    qw(draft draft_properties editor editor2 formatting displaydate)
            },
            {
                map { $_ => $before->{$_} }
                    qw(draft draft_properties editor editor2 formatting displaydate)
            },
            "$label does not run success housekeeping"
        );
    }

    {
        my $combined_owner = temp_user();
        $combined_owner->update_self( { status => 'A' } );
        my $combined_password = 'anonymous-public-' . LJ::rand_chars(24);
        $combined_owner->set_password($combined_password);
        $combined_owner->set_draft_text('combined failure draft sentinel');
        $combined_owner->set_prop(
            draft_properties => nfreeze( { subject => 'combined frozen subject' } ) );
        $combined_owner->set_prop( entry_editor => 'always_plain' );
        $combined_owner->entry_editor2('markdown0');
        $combined_owner->displaydate_check(1);
        my $before = fresh_state( $combined_owner->id );
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, '/update.bml', $combined_owner, $combined_password,
            subject  => 'combined failure subject',
            body     => 'combined failure body',
            security => 'private'
        );
        my $trace = trace_anonymous_post(
            $send, $post,
            force_login_error          => 1,
            force_flat_postevent_error => 1
        );
        my $res = $trace->{response};
        is( $authenticated_calls, 1, 'combined protocol errors reach authenticated handler once' );
        is( $anonymous_calls, 1, 'combined protocol errors are claimed by anonymous handler once' );
        is_deeply( [ map { $_->[0] } @{ $trace->{protocol} } ],
            [qw(login postevent)],
            'combined protocol errors still attempt one login and one postevent' );
        like(
            $res->content,
            qr/Error logging on:\s+forced public login error/,
            'combined protocol errors retain the earlier login error'
        );
        unlike(
            $res->content,
            qr/forced public postevent error/,
            'combined protocol errors do not replace the earlier login error'
        );
        my ($retry) = grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, 'http://localhost/update.bml' );
        ok( $retry, 'combined protocol errors render native retry' );
        is_deeply( fresh_state( $combined_owner->id ),
            $before, 'combined protocol errors leave fresh owner state unchanged' );
    }

    {
        my $postevent_owner = temp_user();
        $postevent_owner->update_self( { status => 'A' } );
        my $postevent_password = 'anonymous-public-' . LJ::rand_chars(24);
        $postevent_owner->set_password($postevent_password);
        $postevent_owner->set_draft_text('postevent error draft sentinel');
        $postevent_owner->set_prop(
            draft_properties => nfreeze( { subject => 'postevent frozen subject' } ) );
        $postevent_owner->set_prop( entry_editor => 'always_plain' );
        $postevent_owner->entry_editor2('markdown0');
        $postevent_owner->set_prop( disable_auto_formatting => 1 );
        $postevent_owner->displaydate_check(1);
        my $before = fresh_state( $postevent_owner->id );
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, '/update', $postevent_owner, $postevent_password,
            subject  => 'forced postevent subject',
            body     => 'forced postevent body',
            security => 'private'
        );
        my $trace = trace_anonymous_post( $send, $post, force_postevent_error => 1 );
        my $res   = $trace->{response};
        is( $authenticated_calls, 1, 'forced postevent error reaches authenticated handler once' );
        is( $anonymous_calls, 1, 'forced postevent error is claimed by anonymous handler once' );
        is_deeply( [ map { $_->[0] } @{ $trace->{protocol} } ],
            [qw(login postevent)], 'forced postevent error performs one login and one postevent' );
        like(
            $res->content,
            qr/Incorrect time value/,
            'forced postevent error renders the protocol error'
        );
        unlike( $res->content, qr/id=['"]updateForm['"]/,
            'forced postevent error does not fall back to BML' );
        my ($retry) = grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, 'http://localhost/update' );
        ok( $retry, 'forced postevent error renders native retry' );
        is(
            $retry ? $retry->value('subject') : undef,
            'forced postevent subject',
            'forced postevent error retains subject'
        );
        is(
            $retry ? $retry->value('event') : undef,
            'forced postevent body',
            'forced postevent error retains body'
        );
        is_deeply(
            $trace->{sequence},
            [qw(update_fields auth login decode postevent spam)],
            'forced postevent error has the expected post-attempt sequence'
        );
        ok( $trace->{refs}[1] && $trace->{refs}[2],
            'forced postevent error records flat decode and spam requests' );
        is(
            $trace->{refs}[1],
            $trace->{refs}[2],
            'forced postevent error sends the same flat request to decode and spam'
        );
        isnt(
            $trace->{protocol}[1][1],
            $trace->{refs}[1],
            'forced postevent error uses a distinct canonical backend request'
        );
        is_deeply( fresh_state( $postevent_owner->id ),
            $before, 'forced postevent error leaves fresh owner state unchanged' );
    }

    {
        my $session = LJ::Session->create( $owner, nolog => 1 );
        my $cookie =
              'ljmastersession='
            . $session->master_cookie_string
            . '; ljloggedin='
            . $session->loggedin_cookie_string;
        my $before = fresh_state($owner_id);
        $authenticated_calls = $anonymous_calls = 0;
        my $post = form_post(
            $send, '/update', $owner, $password,
            cookie       => $cookie,
            retained_get => 1,
            subject      => 'authenticated public subject',
            body         => 'authenticated public body',
            security     => 'private'
        );
        my $res = $send->($post);
        is( $authenticated_calls, 1,
            'authenticated session request is handled by the authenticated handler once' );
        is( $anonymous_calls, 0,
            'authenticated session request never enters anonymous composition' );
        is( $res->code, 200, 'authenticated session request returns HTTP 200' );
        like(
            $res->content,
            qr/(?:successlinks|posted|updated)/i,
            'authenticated session request has a meaningful success response'
        );
        is(
            fresh_state($owner_id)->{count},
            $before->{count} + 1,
            'authenticated session request creates one entry through its existing handler'
        );
        my $entry = fresh_latest_entry($owner_id);
        is(
            $entry ? $entry->subject_raw : undef,
            'authenticated public subject',
            'authenticated session request persists its distinct subject'
        );
        is(
            $entry ? $entry->event_raw : undef,
            'authenticated public body',
            'authenticated session request persists its distinct body'
        );
        is( $entry ? $entry->security : undef,
            'private', 'authenticated session request preserves private security' );
    }

    for my $case (
        [ 'transform',    [ transform   => 1 ] ],
        [ 'show form',    [ showform    => 1 ] ],
        [ 'more options', [ moreoptsbtn => 1 ] ],
        )
    {
        my ( $label, $pair ) = @$case;
        for my $path ( '/update', '/update.bml' ) {
            my $structural_owner = temp_user();
            $structural_owner->update_self( { status => 'A' } );
            my $wrong_password = 'structural-wrong-' . LJ::rand_chars(24);
            $structural_owner->set_password( 'structural-correct-' . LJ::rand_chars(24) );
            my $before = fresh_state( $structural_owner->id );
            $authenticated_calls = $anonymous_calls = 0;
            my $post = form_post(
                $send, $path, $structural_owner, $wrong_password,
                subject     => "$label $path subject",
                body        => "$label $path body",
                security    => 'private',
                extra_pairs => [$pair]
            );
            my ( $res, $attempts ) = post_with_native_attempt_counts( $send, $post );
            is( $authenticated_calls, 1, "$label $path reaches authenticated handler once" );
            is( $anonymous_calls,     1, "$label $path reaches anonymous classifier once" );
            is( $attempts->{flat} || 0, 0, "$label $path makes no native flat post attempt" );
            is( $attempts->{save} || 0, 0, "$label $path makes no native save attempt" );
            unlike( $res->content, qr/id=['"]js-post-entry['"]/,
                "$label $path stays out of native retry" );
            like( $res->content, qr/id=['"]updateForm['"]/,
                "$label $path retains a meaningful BML form" );
            is_deeply( fresh_state( $structural_owner->id ),
                $before, "$label $path leaves fresh owner state unchanged" );
        }
    }

    for my $case (
        [ 'empty password',   { password         => '' } ],
        [ 'missing password', { missing_password => 1 } ],
        [ 'community target', { usejournal       => $community_target->user } ],
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
            missing_password => $changes->{missing_password},
            usejournal       => $changes->{usejournal},
        );
        if ( $changes->{usejournal} ) {
            my @targets = $post->content =~ /(?:^|&)usejournal=([^&]*)/g;
            is_deeply(
                \@targets,
                [ $changes->{usejournal} ],
                'community target request contains exactly one intended usejournal value'
            );
        }
        my $res = $send->($post);
        is( $authenticated_calls, 1,
            "$label reaches authenticated handler before retained fallback" );
        is( $anonymous_calls, 1, "$label reaches anonymous classifier before retained fallback" );
        unlike( $res->content, qr/id=['"]js-post-entry['"]/,
            "$label does not enter the native retry renderer" );
        if ( $label eq 'community target' ) {
            like(
                $res->content,
qr/Error updating journal:<\/strong>\s*Client error: Don&#39;t have access to requested journal/,
                'community target retains the real BML authorization denial'
            );
            unlike(
                $res->content,
                qr/Invalid users passed to/,
                'community target is not an invalid composite usejournal error'
            );
        }
        else {
            like( $res->content, qr/id=['"]updateForm['"]/,
                "$label retains the ordinary BML fallback form" );
        }
        is_deeply( fresh_state($owner_id), $before, "$label leaves fresh owner state unchanged" );
    }
};

done_testing;

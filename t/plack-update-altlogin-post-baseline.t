#!/usr/bin/perl
# Characterize retained /update alternate-login posting without replacing it.
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

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);
use LJ::Test::LegacyOwnedEditRoute;

plan skip_all => 'Retained alternate-login characterization requires a development server'
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

sub state {
    my ($userid) = @_;
    my $fresh  = LJ::load_userid( $userid, 1 );
    my $frozen = $fresh->prop('draft_properties') || '';
    my ($entries) =
        $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $fresh->id );
    return {
        entries    => $entries,
        draft      => $fresh->draft_text,
        draft_raw  => $fresh->prop('entry_draft'),
        draft_prop => length $frozen ? thaw($frozen) : {},
        editor     => $fresh->prop('entry_editor') || '',
        editor2    => $fresh->prop('entry_editor2') || '',
        formatting => $fresh->prop('disable_auto_formatting') || 0,
    };
}

sub latest_entry {
    my ($userid) = @_;
    my $fresh = LJ::load_userid( $userid, 1 );
    my ($jitemid) = $fresh->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $fresh->id );
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $fresh, jitemid => $jitemid );
}

sub user_pair {
    my ($label) = @_;
    my $remote = temp_user();
    $remote->update_self( { status => 'A' } );
    $remote->set_prop( entry_editor => 'plain' );
    $remote->entry_editor2('markdown0');
    $remote->set_prop( disable_auto_formatting => 0 );
    $remote->set_draft_text("$label remote draft");
    $remote->set_prop( draft_properties =>
            nfreeze( { subject => "$label remote draft subject", editor => 'markdown0' } ) );

    my $actor = temp_user();
    $actor->update_self( { status => 'A' } );
    my $password = join '-', 'altlogin-post-fixture', LJ::rand_chars(24);
    $actor->set_password($password);
    $actor->set_prop( entry_editor => 'rich' );
    $actor->entry_editor2('html_raw0');
    $actor->set_prop( disable_auto_formatting => 0 );
    $actor->set_draft_text("$label actor draft");
    $actor->set_prop( draft_properties =>
            nfreeze( { subject => "$label actor draft subject", editor => 'html_raw0' } ) );

    my $session = LJ::Session->create( $remote, nolog => 1 );
    my $cookie =
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
    return ( $remote, $actor, $password, $cookie );
}

sub retained_post {
    my ( $send, $path, $remote, $actor, $password, $cookie, %opts ) = @_;
    my $get;
    LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route(
        'app/update',
        sub {
            $get = $send->( GET "$path?altlogin=1", Cookie => $cookie );
        }
    );
    is( $get->code, 200, "$opts{label} $path renders retained alternate-login form" );
    my $form = update_form( $get->content, $path );
    ok( $form, "$opts{label} $path has real retained alternate-login fields" ) or return;

    $form->action("http://localhost$path?altlogin=1");
    $form->value( user             => $actor->user );
    $form->value( password         => $password ) unless $opts{omit_password};
    $form->value( subject          => $opts{subject} );
    $form->value( event            => $opts{body} );
    $form->value( security         => 'private' );
    $form->value( event_format     => 'preformatted' ) if $form->find_input('event_format');
    $form->value( prop_xpost_check => 0 ) if $form->find_input('prop_xpost_check');
    $form->find_input('password')->disabled(1) if $opts{omit_password};

    my $post = $form->click('action:update');
    $post->uri("http://localhost$path?altlogin=1");
    $post->header( Cookie => $cookie, Referer => "http://localhost$path?altlogin=1" );
    return $post;
}

sub trace_post {
    my ( $send, @args ) = @_;
    my @sequence;
    my @protocol;
    my @hooks;
    my @update_refs;
    my @remote_ids;
    my $scheduled  = 0;
    my $auth_okay  = \&LJ::auth_okay;
    my $do_request = \&LJ::do_request;
    my $run_hook   = \&LJ::Hooks::run_hook;
    my $run_hooks  = \&LJ::Hooks::run_hooks;

    my $post = retained_post( $send, @args );
    return unless $post;

    my $response;
    {
        no warnings 'redefine';
        local *LJ::auth_okay = sub {
            push @sequence, 'auth';
            return $auth_okay->(@_);
        };
        local *LJ::do_request = sub {
            my ( $request, $response_hash, $flags ) = @_;
            push @sequence, $request->{mode};
            push @protocol,
                { mode => $request->{mode}, ref => refaddr($request), user => $request->{user} };
            return $do_request->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @hook_args ) = @_;
            if ( $name eq 'update_fields' ) {
                push @sequence,    'update_fields';
                push @update_refs, refaddr( $hook_args[0] );
                push @remote_ids,  LJ::get_remote() ? LJ::get_remote()->id : undef;
            }
            elsif ( $name eq 'after_entry_post_extra_html' ) {
                my %args = @hook_args;
                push @sequence, 'success_html';
                push @hooks, { name => $name, ref => refaddr( $args{request} ) };
                push @remote_ids, LJ::get_remote() ? LJ::get_remote()->id : undef;
            }
            return $run_hook->(@_);
        };
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @hook_args ) = @_;
            if ( $name eq 'decode_entry_form' || $name eq 'spam_check' ) {
                push @sequence, $name eq 'decode_entry_form' ? 'decode' : 'spam';
                push @hooks, { name => $name, ref => refaddr( $hook_args[1] ) };
            }
            elsif ( $name eq 'after_entry_post_extra_options' ) {
                push @sequence, 'success_options';
            }
            return $run_hooks->(@_);
        };
        local *LJ::Protocol::schedule_xposts = sub { ++$scheduled; return ( [], [] ); };
        $response = $send->($post);
    }

    return {
        response    => $response,
        sequence    => \@sequence,
        protocol    => \@protocol,
        hooks       => \@hooks,
        update_refs => \@update_refs,
        remote_ids  => \@remote_ids,
        scheduled   => $scheduled,
    };
}

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'altloginPostBaseline';

test_psgi $app, sub {
    my $send = shift;

    for my $case (
        [ '/update',     'alternate login slash subject', 'alternate login slash body' ],
        [ '/update.bml', 'alternate login bml subject',   'alternate login bml body' ],
        )
    {
        my ( $path, $subject, $body ) = @$case;
        my ( $remote, $actor, $password, $cookie ) = user_pair($path);
        my $remote_before = state( $remote->id );
        my $actor_before  = state( $actor->id );
        my $trace         = trace_post(
            $send, $path, $remote, $actor, $password, $cookie,
            label   => 'valid alternate-login',
            subject => $subject,
            body    => $body,
        );
        ok( $trace, "valid alternate-login $path builds retained form POST" ) or next;
        is( $trace->{response}->code, 200, "valid alternate-login $path returns HTTP 200" );
        like(
            $trace->{response}->content,
            qr/(?:posted|success|updated)/i,
            "valid alternate-login $path returns retained success content"
        );
        is_deeply( [ map { $_->{mode} } @{ $trace->{protocol} } ],
            [qw(login postevent)], "valid alternate-login $path delegates login then postevent" );
        is_deeply(
            $trace->{sequence},
            [qw(update_fields auth login decode postevent spam success_options success_html)],
            "valid alternate-login $path retains exact delegated and success-hook order"
        );
        is( $trace->{protocol}[0]{user},
            $actor->user, "valid alternate-login $path login seed uses credential actor" );
        is( $trace->{protocol}[1]{user},
            $actor->user, "valid alternate-login $path postevent seed uses credential actor" );
        is( scalar @{ $trace->{update_refs} },
            1, "valid alternate-login $path invokes update_fields once" );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[0]{ref},
            "valid alternate-login $path decoder ref reaches postevent"
        );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[1]{ref},
            "valid alternate-login $path postevent ref reaches spam"
        );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[2]{ref},
            "valid alternate-login $path flat request ref reaches success HTML hook"
        );
        isnt(
            $trace->{update_refs}[0],
            $trace->{protocol}[1]{ref},
            "valid alternate-login $path keeps GET hook ref distinct from decoded POST"
        );
        is_deeply(
            $trace->{remote_ids},
            [ $remote->id, $remote->id ],
            "valid alternate-login $path retains session remote at update and success hooks"
        );
        is( $trace->{scheduled}, 0, "valid alternate-login $path schedules no crosspost" );

        my $actor_after  = state( $actor->id );
        my $remote_after = state( $remote->id );
        is(
            $actor_after->{entries},
            $actor_before->{entries} + 1,
            "valid alternate-login $path creates one credential-actor entry"
        );
        is(
            $remote_after->{entries},
            $remote_before->{entries},
            "valid alternate-login $path leaves session remote entry count unchanged"
        );
        my $entry = latest_entry( $actor->id );
        ok( $entry, "valid alternate-login $path force-loads credential-actor entry" );
        is( $entry ? $entry->subject_raw : undef,
            $subject, "valid alternate-login $path persists exact subject" );
        is( $entry ? $entry->event_raw : undef,
            $body, "valid alternate-login $path persists exact body" );
        is( $entry ? $entry->security : undef,
            'private', "valid alternate-login $path persists private security" );
        is( $actor_after->{formatting},
            1, "valid alternate-login $path updates credential actor formatting" );
        is_deeply(
            { map { $_ => $actor_after->{$_} } qw(draft draft_prop editor editor2) },
            { map { $_ => $actor_before->{$_} } qw(draft draft_prop editor editor2) },
            "valid alternate-login $path leaves credential actor draft/editor state unchanged"
        );
        ok( !defined $remote_after->{draft_raw},
            "valid alternate-login $path clears the session remote draft property" );
        ok(
            !defined $remote_after->{draft},
            "valid alternate-login $path has no readable session remote draft text after clearing"
        );
        is_deeply(
            $remote_after->{draft_prop},
            $remote_before->{draft_prop},
            "valid alternate-login $path retains session remote frozen draft properties"
        );
        is(
            $remote_after->{editor},
            $remote_before->{editor},
            "valid alternate-login $path retains plain session remote editor preference"
        );
        is(
            $remote_after->{editor2},
            $remote_before->{editor2},
            "valid alternate-login $path leaves session remote editor2 unchanged"
        );
        is(
            $remote_after->{formatting},
            $remote_before->{formatting},
            "valid alternate-login $path leaves session remote formatting unchanged"
        );
    }

    for my $case (
        {
            label    => 'wrong alternate-login password',
            path     => '/update',
            password => join( '-', 'wrong', LJ::rand_chars(24) ),
            error    => qr/Error logging on.*Invalid password/s,
            sequence => [qw(update_fields auth login auth decode postevent auth spam)],
        },
        {
            label    => 'empty alternate-login password',
            path     => '/update.bml',
            password => '',
            error    => qr/Enter Password/,
            sequence => ['update_fields'],
        },
        )
    {
        my ( $remote, $actor, $good_password, $cookie ) = user_pair( $case->{label} );
        my $remote_before = state( $remote->id );
        my $actor_before  = state( $actor->id );
        my $trace         = trace_post(
            $send, $case->{path}, $remote, $actor, $case->{password}, $cookie,
            label   => $case->{label},
            subject => "$case->{label} subject",
            body    => "$case->{label} body",
        );
        ok( $trace, "$case->{label} builds retained form POST" ) or next;
        is( $trace->{response}->code, 200, "$case->{label} returns retained HTTP 200" );
        like( $trace->{response}->content,
            $case->{error}, "$case->{label} renders exact retained error" );
        is_deeply( $trace->{sequence}, $case->{sequence},
            "$case->{label} retains exact attempt order" );
        is( $trace->{scheduled}, 0, "$case->{label} schedules no crosspost" );
        is_deeply( state( $remote->id ),
            $remote_before, "$case->{label} leaves session remote state unchanged" );
        is_deeply( state( $actor->id ),
            $actor_before, "$case->{label} leaves credential actor state unchanged" );
        my $retry = update_form( $trace->{response}->content, $case->{path} );
        ok( $retry, "$case->{label} rerenders retained alternate-login form" );
        is( $retry ? ( $retry->value('user') // '' ) : '',
            $actor->user, "$case->{label} retry retains credential username" );
        is( $retry ? ( $retry->value('password') // '' ) : '',
            '', "$case->{label} retry keeps password blank" );
    }
};

is( $DW::Routing::string_choices{'app/update'},
    $production_update_route,
    'alternate-login baseline leaves production update routing unchanged' );

done_testing;

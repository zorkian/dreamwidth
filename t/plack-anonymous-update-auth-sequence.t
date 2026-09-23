#!/usr/bin/perl
# Characterize retained anonymous /update authentication and protocol sequencing.
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

sub fresh_latest_entry {
    my ($userid) = @_;
    my $fresh = LJ::load_userid( $userid, 1 );
    my ($jitemid) = $fresh->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $fresh->id );
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $fresh, jitemid => $jitemid );
}

sub fresh_state {
    my ($userid) = @_;
    my $fresh  = LJ::load_userid( $userid, 1 );
    my $frozen = $fresh->prop('draft_properties') || '';
    return {
        entries    => entry_count($userid),
        draft      => $fresh->draft_text,
        draft_prop => length $frozen ? thaw($frozen) : {},
        editor     => $fresh->prop('entry_editor') || '',
        editor2    => $fresh->prop('entry_editor2') || '',
        formatting => $fresh->prop('disable_auto_formatting') || 0,
    };
}

sub new_owner {
    my ($label) = @_;
    my $owner = temp_user();
    $owner->update_self( { status => 'A' } );

    # This password is test-local. It is never used in diagnostic text, a URL,
    # response comparison, or an assertion label.
    my $password = join '-', 'anonymous-auth-sequence', LJ::rand_chars(24);
    $owner->set_password($password);
    $owner->set_prop( entry_editor            => 'plain' );
    $owner->set_prop( entry_editor2           => 'markdown0' );
    $owner->set_prop( disable_auto_formatting => 1 );
    $owner->set_draft_text("$label draft sentinel");
    $owner->set_prop( draft_properties => nfreeze( { subject => "$label draft subject" } ) );
    return ( $owner, $password );
}

sub form_post {
    my ( $send, $path, $owner, $password, %opts ) = @_;
    my $get = $send->( GET $path );
    is( $get->code, 200, "$opts{label} $path renders the retained anonymous form" );
    my $form = update_form( $get->content, $path );
    ok( $form, "$opts{label} $path has a real retained form" ) or return;

    $form->action("http://localhost$path");
    $form->value( user             => $owner->user );
    $form->value( password         => $password ) unless $opts{missing_password};
    $form->value( subject          => $opts{subject} );
    $form->value( event            => $opts{body} );
    $form->value( security         => 'private' );
    $form->value( prop_xpost_check => 0 ) if $form->find_input('prop_xpost_check');
    $form->find_input('password')->disabled(1) if $opts{missing_password};

    my $post = $form->click('action:update');
    $post->uri("http://localhost$path");
    $post->header( Referer => "http://localhost$path" );
    return $post;
}

sub characterize_post {
    my ( $send, $path, $owner, $password, %opts ) = @_;
    my @sequence;
    my @protocol;
    my @hooks;
    my @update_refs;
    my $scheduled = 0;

    my $auth_okay  = \&LJ::auth_okay;
    my $do_request = \&LJ::do_request;
    my $run_hook   = \&LJ::Hooks::run_hook;
    my $run_hooks  = \&LJ::Hooks::run_hooks;

    my $post = form_post( $send, $path, $owner, $password, %opts );
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
            my $mode = $request->{mode} || '';
            push @sequence, $mode;
            push @protocol,
                {
                mode       => $mode,
                ref        => refaddr($request),
                has_pass   => exists $request->{password} ? 1 : 0,
                user       => $request->{user},
                usejournal => $request->{usejournal},
                tz         => $request->{tz},
                xpost      => $request->{xpost},
                };
            if ( $opts{force_login_failure} && $mode eq 'login' ) {
                %$response_hash = ( success => 'FAIL', errmsg => 'forced fixture login failure' );
                return;
            }
            return $do_request->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            if ( $name eq 'update_fields' ) {
                push @sequence,    'update_fields';
                push @update_refs, refaddr( $args[0] );
            }
            return $run_hook->( $name, @args );
        };
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @args ) = @_;
            if ( $name eq 'decode_entry_form' || $name eq 'spam_check' ) {
                push @sequence, $name eq 'decode_entry_form' ? 'decode' : 'spam';
                push @hooks, { name => $name, ref => refaddr( $args[1] ) };
            }
            return $run_hooks->( $name, @args );
        };
        local *LJ::Protocol::schedule_xposts = sub { ++$scheduled };
        $response = $send->($post);
    }

    return {
        response    => $response,
        sequence    => \@sequence,
        protocol    => \@protocol,
        hooks       => \@hooks,
        update_refs => \@update_refs,
        scheduled   => $scheduled,
    };
}

sub position {
    my ( $items, $needle ) = @_;
    for my $index ( 0 .. $#$items ) {
        return $index if $items->[$index] eq $needle;
    }
    return -1;
}

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'anonymousUpdateAuthSequence';

test_psgi $app, sub {
    my $send = shift;

    # No Cookie header is supplied. Every request starts from a rendered
    # retained form and authenticates only through its visible password fields.
    my $request = sub { $send->( $_[0] ) };

    for my $case (
        [ '/update',     'slash retained subject', 'slash retained body' ],
        [ '/update.bml', 'bml retained subject',   'bml retained body' ],
        )
    {
        my ( $path, $subject, $body ) = @$case;
        my ( $owner, $password ) = new_owner($path);
        my $before = fresh_state( $owner->id );
        my $trace  = characterize_post(
            $request, $path, $owner, $password,
            label   => 'valid password',
            subject => $subject,
            body    => $body,
        );
        ok( $trace, "valid password $path builds a real retained POST" ) or next;

        is( $trace->{response}->code, 200, "valid password $path returns retained HTTP 200" );
        like(
            $trace->{response}->content,
            qr/(?:posted|success|updated)/i,
            "valid password $path has a retained success response"
        );
        is_deeply( [ map { $_->{mode} } @{ $trace->{protocol} } ],
            [qw(login postevent)], "valid password $path runs one login then one postevent" );
        is_deeply(
            [ map { $_->{name} } @{ $trace->{hooks} } ],
            [qw(decode_entry_form spam_check)],
            "valid password $path runs decoder then spam hook"
        );
        is( scalar @{ $trace->{update_refs} },
            1, "valid password $path invokes update_fields once during the POST" );
        ok( $trace->{update_refs}[0],
            "valid password $path records the flat update_fields reference" );
        cmp_ok(
            position( $trace->{sequence}, 'update_fields' ),
            '<',
            position( $trace->{sequence}, 'auth' ),
            "valid password $path updates fields before authentication"
        );
        cmp_ok(
            position( $trace->{sequence}, 'login' ),
            '<',
            position( $trace->{sequence}, 'decode' ),
            "valid password $path logs in before decoding"
        );
        cmp_ok(
            position( $trace->{sequence}, 'decode' ),
            '<',
            position( $trace->{sequence}, 'postevent' ),
            "valid password $path decodes before posting"
        );
        cmp_ok(
            position( $trace->{sequence}, 'postevent' ),
            '<',
            position( $trace->{sequence}, 'spam' ),
            "valid password $path posts before spam checking"
        );
        is( $trace->{protocol}[0]{has_pass}, 0, "valid password $path login seed omits password" );
        is( $trace->{protocol}[1]{has_pass}, 1,
            "valid password $path postevent seed has password" );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[0]{ref},
            "valid password $path passes the decoder request to postevent"
        );
        is(
            $trace->{hooks}[0]{ref},
            $trace->{hooks}[1]{ref},
            "valid password $path passes one decoded request to spam checking"
        );
        isnt( $trace->{update_refs}[0], $trace->{hooks}[0]{ref},
"valid password $path keeps update_fields GET data separate from the decoded POST request"
        );
        ok( !defined $trace->{protocol}[1]{tz},
            "valid password $path records decoder removal of the initial timezone seed" );
        is( $trace->{protocol}[1]{xpost},
            '0', "valid password $path preserves disabled xpost seed" );
        is( $trace->{scheduled}, 0, "valid password $path schedules no crossposts" );

        my $after = fresh_state( $owner->id );
        is( $after->{entries}, $before->{entries} + 1, "valid password $path creates one entry" );
        is_deeply(
            { map { $_ => $after->{$_} } qw(draft draft_prop editor editor2) },
            { map { $_ => $before->{$_} } qw(draft draft_prop editor editor2) },
            "valid password $path leaves remote-only draft/editor state unchanged"
        );
    }

    for my $case (
        {
            label    => 'wrong password',
            path     => '/update',
            password => join( '-', 'wrong', LJ::rand_chars(24) ),
            subject  => 'wrong password retained subject',
            body     => 'wrong password retained body',
            error    => qr/Error logging on.*Invalid password/s,
            auths    => 3,
        },
        {
            label            => 'missing password',
            path             => '/update.bml',
            password         => undef,
            missing_password => 1,
            subject          => 'missing password retained subject',
            body             => 'missing password retained body',
            error            => qr/Enter Password/,
            auths            => 0,
        },
        {
            label    => 'empty password',
            path     => '/update',
            password => '',
            subject  => 'empty password retained subject',
            body     => 'empty password retained body',
            error    => qr/Enter Password/,
            auths    => 0,
        },
        )
    {
        my ( $owner, $good_password ) = new_owner( $case->{label} );
        my $before = fresh_state( $owner->id );
        my $trace  = characterize_post( $request, $case->{path}, $owner,
            defined $case->{password} ? $case->{password} : $good_password, %$case, );
        ok( $trace, "$case->{label} builds a real retained POST" ) or next;

        is( $trace->{response}->code, 200, "$case->{label} retains HTTP 200" );
        like( $trace->{response}->content,
            $case->{error}, "$case->{label} retains its meaningful error" );
        is( scalar grep( { $_ eq 'auth' } @{ $trace->{sequence} } ),
            $case->{auths}, "$case->{label} has the observed number of password checks" );
        is( $trace->{scheduled}, 0, "$case->{label} schedules no crossposts" );
        is_deeply( fresh_state( $owner->id ),
            $before, "$case->{label} leaves persisted entry and user state unchanged" );

        if ( $case->{label} eq 'wrong password' ) {
            is_deeply( [ map { $_->{mode} } @{ $trace->{protocol} } ],
                [qw(login postevent)],
                'wrong password still executes retained login then postevent' );
            is_deeply(
                [ map { $_->{name} } @{ $trace->{hooks} } ],
                [qw(decode_entry_form spam_check)],
                'wrong password still executes retained decoder and spam hook'
            );
            is_deeply(
                $trace->{sequence},
                [qw(update_fields auth login auth decode postevent auth spam)],
                'wrong password retains the exact cross-stage sequence'
            );
            is(
                $trace->{protocol}[1]{ref},
                $trace->{hooks}[0]{ref},
                'wrong password passes the decoded request to postevent'
            );
            is(
                $trace->{protocol}[1]{ref},
                $trace->{hooks}[1]{ref},
                'wrong password passes the same postevent request to spam checking'
            );
        }
        else {
            is_deeply( $trace->{protocol}, [], "$case->{label} skips retained protocol requests" );
            is_deeply( $trace->{hooks},    [], "$case->{label} skips decoder and spam hooks" );
            is_deeply( $trace->{sequence}, ['update_fields'],
                "$case->{label} stops at form rerender after update_fields" );
        }

        my $retry = update_form( $trace->{response}->content, $case->{path} );
        ok( $retry, "$case->{label} rerenders the retained form" );
        is( $retry ? ( $retry->value('user') // '' ) : '',
            $owner->user, "$case->{label} retry retains username" );
        is( $retry ? ( $retry->value('password') // '' ) : '',
            '', "$case->{label} retry keeps password blank" );
    }

    {
        my ( $owner, $password ) = new_owner('forced login failure');
        my $before = fresh_state( $owner->id );
        my $trace  = characterize_post(
            $request, '/update.bml', $owner, $password,
            label               => 'forced protocol login failure',
            subject             => 'forced login retained subject',
            body                => 'forced login retained body',
            force_login_failure => 1,
        );
        ok( $trace, 'forced protocol login failure builds a real retained POST' );
        is( $trace->{response}->code, 200, 'forced protocol login failure retains HTTP 200' );
        like(
            $trace->{response}->content,
            qr/forced fixture login failure/,
            'forced protocol login failure renders the retained login error'
        );
        is_deeply( [ map { $_->{mode} } @{ $trace->{protocol} } ],
            [qw(login postevent)],
            'forced protocol login failure still executes one postevent after login' );
        is_deeply(
            [ map { $_->{name} } @{ $trace->{hooks} } ],
            [qw(decode_entry_form spam_check)],
            'forced protocol login failure still decodes and spam checks once'
        );
        is_deeply(
            $trace->{sequence},
            [qw(update_fields auth login decode postevent spam)],
            'forced protocol login failure retains the exact cross-stage sequence'
        );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[0]{ref},
            'forced protocol login failure passes decoded request to postevent'
        );
        is(
            $trace->{protocol}[1]{ref},
            $trace->{hooks}[1]{ref},
            'forced protocol login failure passes one request to spam checking'
        );
        is( $trace->{scheduled}, 0, 'forced protocol login failure schedules no crossposts' );

        my $after = fresh_state( $owner->id );
        is(
            $after->{entries},
            $before->{entries} + 1,
            'forced protocol login failure retains the observed postevent persistence'
        );
        my $entry = fresh_latest_entry( $owner->id );
        ok( $entry, 'forced protocol login failure force-loads its new entry' );
        is(
            $entry ? $entry->subject_raw : undef,
            'forced login retained subject',
            'forced protocol login failure persists the submitted subject'
        );
        is(
            $entry ? $entry->event_raw : undef,
            'forced login retained body',
            'forced protocol login failure persists the submitted body'
        );
        is( $entry ? $entry->security : undef,
            'private', 'forced protocol login failure persists private security' );
        is_deeply(
            { map { $_ => $after->{$_} } qw(draft draft_prop editor editor2 formatting) },
            { map { $_ => $before->{$_} } qw(draft draft_prop editor editor2 formatting) },
            'forced protocol login failure keeps old response-error housekeeping behavior'
        );
    }
};

is( $DW::Routing::string_choices{'app/update'},
    $production_update_route,
    'sequence characterization leaves the production update route unchanged' );

done_testing;

#!/usr/bin/perl
# Verify alternate-login retry rendering reuses prepared legacy form state.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Storable qw(nfreeze thaw);
use Test::More;
use URI;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Controller::Entry;
use DW::Entry::Legacy;
use DW::FormErrors;
use DW::Request;
use DW::Request::Plack;
use Plack::Middleware::DW::RequestWrapper;
use LJ::Test qw(temp_user);

plan skip_all => 'Alternate-login rerender requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub native_form {
    my ($content) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost/update?altlogin=1' )
    )[0];
}

sub fresh_user_state {
    my ($userid) = @_;
    my $user   = LJ::load_userid( $userid, 1 );
    my $frozen = $user->prop('draft_properties') || '';
    return {
        draft   => $user->draft_text,
        props   => length $frozen ? thaw($frozen) : {},
        editor  => $user->prop('entry_editor') || '',
        editor2 => $user->entry_editor2 || '',
    };
}

sub form_values {
    my ( $form, $name ) = @_;
    return [ map { $_->value } grep { ( $_->name || '' ) eq $name } $form->inputs ];
}

my $session_a = temp_user();
my $poster_b  = temp_user();
$session_a->update_self( { status => 'A' } );
$poster_b->update_self(  { status => 'A' } );

for my $pair ( [ $session_a, 'A' ], [ $poster_b, 'B' ], ) {
    my ( $user, $label ) = @$pair;
    $user->set_draft_text("$label draft sentinel");
    $user->set_prop( draft_properties => nfreeze( { subject => "$label frozen subject" } ) );
    $user->set_prop( entry_editor     => 'always_plain' );
    $user->entry_editor2('markdown0');
}
my $before_a = fresh_user_state( $session_a->id );
my $before_b = fresh_user_state( $poster_b->id );

my @render_calls;
my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $post     = DW::Request->get->post_args;
        my $prepared = DW::Entry::Legacy::prepare_entry_form( { tz => 'guess' }, $post );
        my $errors   = DW::FormErrors->new;
        $errors->add_string( undef, 'alternate-login retry marker' );

        my $run_hook  = \&LJ::Hooks::run_hook;
        my $run_hooks = \&LJ::Hooks::run_hooks;
        my $auth_okay = \&LJ::auth_okay;
        my $do_post   = \&DW::Controller::Entry::_do_post;
        {
            no warnings 'redefine';
            local *LJ::Hooks::run_hook = sub {
                push @render_calls, "hook:$_[0]" if $_[0] eq 'update_fields';
                return $run_hook->(@_);
            };
            local *LJ::Hooks::run_hooks = sub {
                push @render_calls, "hooks:$_[0]"
                    if $_[0] =~ /^(?:decode_entry_form|spam_check|after_entry_post)/;
                return $run_hooks->(@_);
            };
            local *LJ::auth_okay = sub {
                push @render_calls, 'auth';
                return $auth_okay->(@_);
            };
            local *DW::Controller::Entry::_do_post = sub {
                push @render_calls, 'save';
                return $do_post->(@_);
            };
            local *LJ::Protocol::schedule_xposts =
                sub { die 'render must not schedule crossposts' };
            DW::Controller::Entry::legacy_new_rerender(
                $prepared,
                remote             => $session_a,
                errors             => $errors,
                legacy_altlogin    => { username => $poster_b->user },
                submit_action_name => 'action:update',
                action_url         => '/update?altlogin=1',
                suppress_crosspost => 1,
            );
        }
        DW::Request->get->status(200);
        return DW::Request->get->res;
    }
);

test_psgi $app, sub {
    my $send     = shift;
    my $response = $send->(
        POST '/alternate-login-rerender',
        [
            user                  => $poster_b->user,
            password              => 'secret-not-retained',
            subject               => 'Alternate retry subject',
            event                 => 'Alternate retry body',
            security              => 'friends',
            prop_taglist          => 'alternate-one, alternate-two',
            prop_current_location => 'Alternate retry location',
            prop_current_music    => 'Alternate retry music',
            comment_settings      => 'noemail',
            event_format          => 'preformatted',
            date_ymd_yyyy         => 'not-a-year',
            date_ymd_mm           => '02',
            date_ymd_dd           => '03',
            hour                  => '04',
            min                   => '05',
            editor                => 'markdown0',
            prop_xpost_check      => 1,
        ]
    );

    is( $response->code, 200, 'alternate-login retry renders' );
    like(
        $response->content,
        qr/alternate-login retry marker/,
        'alternate-login retry shows exactly supplied visible error'
    );
    unlike( $response->content, qr/secret-not-retained/,
        'alternate-login retry never echoes the submitted password' );

    my $form = native_form( $response->content );
    ok( $form, 'alternate-login retry uses the actual native entry template' )
        or BAIL_OUT('missing native alternate-login retry form');
    my $action = URI->new( $form->action );
    is( $action->path,  '/update',    'alternate-login retry has the fixed retained action path' );
    is( $action->query, 'altlogin=1', 'alternate-login retry has the fixed retained action query' );
    ok( $form->find_input('action:update'), 'alternate-login retry emits action:update' );
    ok( !$form->find_input('action:post'),
        'alternate-login retry does not emit native action:post' );

    is_deeply(
        form_values( $form, 'user' ),
        [ $poster_b->user ],
        'alternate-login retry displays posting user B while session A remains remote'
    );
    is_deeply( form_values( $form, 'password' ),
        [''], 'alternate-login retry blanks every rendered password control' );
    is( $form->value('subject'), 'Alternate retry subject', 'subject is retained' );
    is( $form->value('event'), 'Alternate retry body', 'body is retained' );
    is( $form->value('editor'),   'html_raw0', 'legacy preformatted state selects raw editor' );
    is( $form->value('security'), 'access',    'friends security maps to native access selection' );
    is( $form->value('entrytime_date'), 'not-a-year-02-03', 'raw invalid date is retained' );
    is( $form->value('entrytime_time'), '04:05',            'raw time is retained' );
    is( $form->value('taglist'),          'alternate-one, alternate-two', 'tags are retained' );
    is( $form->value('current_location'), 'Alternate retry location',     'location is retained' );
    is( $form->value('current_music'),    'Alternate retry music',        'music is retained' );
    is( $form->value('comment_settings'), 'noemail', 'comment metadata is retained' );
    ok( !$form->find_input('crosspost_entry'), 'alternate-login retry omits crosspost controls' );

    is_deeply( \@render_calls, [],
        'rerender performs no entry-processing hook, auth, or save work' );
    is_deeply( fresh_user_state( $session_a->id ),
        $before_a, 'session user A draft and editor state remain unchanged' );
    is_deeply( fresh_user_state( $poster_b->id ),
        $before_b, 'posting user B draft and editor state remain unchanged' );
};

# Existing callers retain the ordinary native defaults when they do not opt in.
my $defaults = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $prepared =
            DW::Entry::Legacy::prepare_entry_form( { tz => 'guess' }, DW::Request->get->post_args );
        DW::Controller::Entry::legacy_new_rerender( $prepared, remote => $session_a );
        DW::Request->get->status(200);
        return DW::Request->get->res;
    }
);
test_psgi $defaults, sub {
    my $response = shift->(
        POST '/ordinary-rerender',
        [ subject => 'ordinary', event => 'body', security => 'public' ]
    );
    my $form = native_form( $response->content );
    ok( $form, 'ordinary rerender still parses' );
    like( $form->action, qr{/entry/new}, 'ordinary rerender retains native action default' );
    ok( $form->find_input('action:post'),    'ordinary rerender retains native action:post' );
    ok( !$form->find_input('action:update'), 'ordinary rerender has no retained action:update' );
};

done_testing;

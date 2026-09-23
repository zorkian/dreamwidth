#!/usr/bin/perl
# Verify the callable-only anonymous retained /update GET renderer.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Hooks;
use LJ::Test qw(temp_user);
use Plack::Middleware::DW::RequestWrapper;

sub entry_form {
    my ($content) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost/entry/new' )
    )[0];
}

my $target = temp_user();
$target->update_self( { status => 'A' } );
my $sentinel = temp_user();
$sentinel->update_self( { status => 'A' } );
$sentinel->set_draft_text('anonymous renderer draft sentinel');
$sentinel->set_prop(
    draft_properties => nfreeze( { subject => 'sentinel subject', taglist => 'sentinel-tag' } ) );
$sentinel->set_prop( entry_editor => 'always_rich' );
$sentinel->entry_editor2('markdown0');
my $sentinel_id = $sentinel->id;

my ( $hook_calls, @hook_refs, @hook_repeats, @hook_cases );
my $original_enabled = \&LJ::is_enabled;
my $getter           = sub {
    my ( $lang, $key, undef, $args ) = @_;
    return LJ::Lang::get_text( $lang, $key, undef, $args )
        unless $key eq '/update.bml.title2';
    return 'Legacy anonymous ' . ucfirst( DW::Request->get->get_args->{case} );
};

my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        LJ::Lang::set_request_context( getter => $getter );
        local $LJ::DEFAULT_EDITOR = $r->get_args->{default_editor} || $LJ::DEFAULT_EDITOR;
        my $ret = DW::Controller::Entry::legacy_update_anonymous_get_handler(
            action_url => '/candidate-anonymous-action',
            datetime   => '2026-09-23 04:05',
        );
        if ( defined $ret ) {
            $r->status(200);
            return $r->res;
        }
        $r->status(299);
        $r->print('callable fallback');
        return $r->res;
    }
);

LJ::Hooks::are_hooks('update_fields');
{
    no warnings 'redefine';
    local *LJ::is_enabled = sub {
        return DW::Request->get->get_args->{rte} ? 1 : 0 if $_[0] eq 'rte_support';
        return $original_enabled->(@_);
    };
    local $LJ::DEFAULT_EDITOR = 'rich';
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs,    refaddr($get);
            push @hook_repeats, $get->{repeated};
            push @hook_cases,   $get->{case};
            if ( $get->{case} eq 'a' ) {
                $get->{subject} = 'mutated after snapshot';
                $get->{user}    = 'hook <user> & "quote"';
                return {
                    subject => 'hook <subject> & "quote"',
                    event   => 'hook <body> & "quote"',
                    tags    => 'hook <tag> & "quote"',
                };
            }
            if ( $get->{case} eq 'b' ) {
                return {
                    subject               => '',
                    event                 => '',
                    tags                  => '',
                    prop_opt_preformatted => 1,
                };
            }
            $get->{subject}      = 'mutated subject';
            $get->{event}        = 'mutated event';
            $get->{prop_taglist} = 'mutated tags';
            return {};
        }
    ];

    test_psgi $app, sub {
        my $send     = shift;
        my @requests = (
            [
                'a',
                'rte=1&case=a&usejournal='
                    . $target->user
                    . '&subject=GET%20%3Csubject%3E&event=GET%20%3Cbody%3E'
                    . '&prop_taglist=GET%20%3Ctag%3E&user=anon%20%3Cuser%3E%20%26%20%22quote%22'
                    . '&repeated=first&repeated=second'
            ],
            [
                'b',
                'rte=0&case=b&subject=second&event=second-body&prop_taglist=second-tag'
                    . '&repeated=third&repeated=fourth'
            ],
            [
                'snapshot',
                'rte=1&default_editor=plain&case=snapshot&subject=before-subject'
                    . '&event=before-event&prop_taglist=before-tags&repeated=fifth&repeated=sixth'
            ],
        );
        for my $item (@requests) {
            my ( $case, $query ) = @$item;
            my $res = $send->( GET "/__anonymous_update?$query" );
            is( $res->code, 200, "$case anonymous callable renders through real TT" );
            unlike( $res->content, qr/missing string/i, "$case has no missing translation" );
            my $title_case = ucfirst $case;
            like(
                $res->content,
                qr/<title>Legacy anonymous \Q$title_case\E<\/title>/,
                "$case receives the request-local legacy title"
            );
            my $form = entry_form( $res->content );
            ok( $form, "$case native anonymous form parses" ) or BAIL_OUT('anonymous form missing');
            is(
                $form->action,
                'http://localhost/candidate-anonymous-action',
                "$case uses only the explicit candidate action"
            );

            if ( $case eq 'a' ) {
                is( $form->value('usejournal'),
                    $target->user, 'supplied target renders as usejournal' );
            }
            else {
                is( $form->value('usejournal'),
                    '', 'absent target keeps an empty native usejournal control' );
            }
            ok( $form->find_input('username'), "$case native anonymous schema has username" );
            ok( $form->find_input('password'), "$case native anonymous schema has password" );
            my $username = $form->find_input( 'username', 'text' );
            my $password = $form->find_input( 'password', 'password' );
            ok( $username && $password, "$case has native visible anonymous credentials" );
            ok( !$form->find_input('user'),
                "$case does not claim retained user credential schema" );
            ok(
                !$form->find_input('post_as') && !$form->find_input('postas_usejournal'),
                "$case records the current native credential/target schema for later activation"
            );

            if ( $case eq 'a' ) {
                is(
                    $form->value('subject'),
                    'hook <subject> & "quote"',
                    'hook subject overrides snapshot'
                );
                is( $form->value('event'), 'hook <body> & "quote"',
                    'hook body overrides snapshot' );
                is( $form->value('taglist'), 'hook <tag> & "quote"',
                    'hook tags override snapshot' );
                is( $form->value('editor'), 'rte0', 'rich default with RTE selects RTE editor' );
                is(
                    $username->value,
                    'hook <user> & "quote"',
                    'post-hook legacy GET user prepopulates the escaped native username control'
                );
                is( $password->value, '', 'legacy GET never prepopulates an anonymous password' );
            }
            elsif ( $case eq 'b' ) {
                is( $form->value('subject'), '', 'exists-based empty hook subject is retained' );
                is( $form->value('event'),   '', 'exists-based empty hook body is retained' );
                is( $form->value('taglist'), '', 'exists-based empty hook tags are retained' );
                is( $form->value('editor'), 'html_raw0', 'preformatted hook maps to raw editor' );
            }
            else {
                is( $form->value('subject'),
                    'before-subject', 'pre-hook subject snapshot survives mutation' );
                is( $form->value('event'),
                    'before-event', 'pre-hook event snapshot survives mutation' );
                is( $form->value('taglist'),
                    'before-tags', 'pre-hook tags snapshot survives mutation' );
                is( $form->value('editor'), 'html_casual1', 'plain default maps to casual editor' );
            }
        }
    };
}

is( $hook_calls, 3, 'anonymous callable invokes update_fields once per request' );
is_deeply( \@hook_cases, [qw(a b snapshot)], 'sequential anonymous hook contexts do not leak' );
is_deeply(
    \@hook_repeats,
    [ "first\0second", "third\0fourth", "fifth\0sixth" ],
    'anonymous hooks receive original NUL-joined repeated values'
);
ok(
    $hook_refs[0]
        && $hook_refs[1]
        && $hook_refs[2]
        && $hook_refs[0] != $hook_refs[1]
        && $hook_refs[1] != $hook_refs[2],
    'anonymous hooks receive distinct original flat references'
);

my $non_get = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r   = DW::Request->get;
        my $ret = DW::Controller::Entry::legacy_update_anonymous_get_handler(
            action_url => '/candidate-anonymous-action' );
        $r->status( defined $ret ? 200 : 299 );
        $r->print( defined $ret ? 'unexpected render' : 'GET-only fallback' );
        return $r->res;
    }
);
test_psgi $non_get, sub {
    my $send = shift;
    my $res  = $send->( POST '/__anonymous_update', [] );
    is( $res->code, 299, 'non-GET callable leaves public POST handling untouched' );
};

my $direct = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        DW::Controller::Entry::new_handler();
        $r->status(200);
        return $r->res;
    }
);
test_psgi $direct, sub {
    my $send = shift;
    my $res  = $send->( GET '/entry/new' );
    is( $res->code, 200, 'direct native entry route still renders' );
    like(
        $res->content,
        qr/<title>Create Entries<\/title>/,
        'direct native entry keeps its existing title'
    );
    my $form = entry_form( $res->content );
    ok( $form, 'direct native entry form parses' );
    is( $form->action, 'http://localhost/entry/new',
        'direct native entry keeps its default action' );
};

my $fresh = LJ::load_userid( $sentinel_id, 1 );
is(
    $fresh->draft_text,
    'anonymous renderer draft sentinel',
    'anonymous rendering leaves drafts unchanged'
);
is_deeply(
    thaw( $fresh->prop('draft_properties') ),
    { subject => 'sentinel subject', taglist => 'sentinel-tag' },
    'anonymous rendering leaves draft properties unchanged'
);
is( $fresh->prop('entry_editor'),
    'always_rich', 'anonymous rendering leaves legacy preferences unchanged' );
is( $fresh->entry_editor2, 'markdown0', 'anonymous rendering leaves native preferences unchanged' );

done_testing;

#!/usr/bin/perl
# Test callable retained readonly /update GET native rendering.
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
use Plack::Middleware::DW::RequestWrapper;
use LJ::Hooks;
use LJ::Test qw(temp_comm temp_user);

sub form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], 'http://localhost/entry/new' )
    )[0];
}

my $u = temp_user();
$u->update_self( { status => 'A' } );
$u->set_prop( 'entry_editor', 'always_rich' );
$u->entry_editor2('markdown0');
$u->set_draft_text('readonly draft body');
$u->set_prop(
    draft_properties => nfreeze( { subject => 'readonly draft subject', editor => 'markdown0' } ) );
my $uid  = $u->id;
my $comm = temp_comm();
$u->join_community( $comm, 1, 1 );

my ( $hook_calls, @hook_refs, @request_refs );
my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r   = DW::Request->get;
        my $get = DW::Entry::Legacy::legacy_post_hash( $r->get_args );
        push @request_refs, refaddr($get);
        DW::Controller::Entry::legacy_update_readonly_get_handler(
            remote     => $u,
            get        => $get,
            datetime   => '2026-09-23 04:05',
            action_url => '/entry/new?encoded=one%2Ftwo&repeated=first&repeated=second',
        );
        $r->status(200);
        return $r->res;
    }
);

my $orig_readonly = \&LJ::User::readonly;
my $orig_get_text = \&LJ::Lang::get_text;
LJ::Hooks::are_hooks('update_fields');
{
    no warnings 'redefine';
    local *LJ::User::readonly = sub { return 1 if $_[0]->equals($u); return $orig_readonly->(@_); };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs, refaddr($get);
            if ( $get->{case} && $get->{case} eq 'target' ) {
                $get->{usejournal} = $comm->user;
                $get->{subject}    = 'hook must not replace the pre-hook snapshot';
                return {};
            }
            return { subject => 'hook subject', event => 'hook event', tags => 'hook tags' };
        }
    ];

    test_psgi $app, sub {
        my $send = shift;
        local $LJ::HELPURL{readonly} = 'https://help.example.invalid/readonly';
        my $res =
            $send->( GET
'/__readonly?case=target&usejournal=ignored&subject=get&event=get&prop_taglist=get&encoded=one%2Ftwo'
            );
        is( $res->code, 200, 'readonly callable renders a real response' );
        my $f = form( $res->content );
        ok( $f, 'readonly callable renders the native entry form' )
            or BAIL_OUT('native form absent');
        is( $f->value('subject'), 'get', 'pre-hook subject snapshot survives hook mutation' );
        is( $f->value('event'),   'get', 'pre-hook event snapshot remains retained' );
        is( $f->value('taglist'), 'get', 'pre-hook tag snapshot remains retained' );
        is( $f->value('usejournal'),
            $comm->user, 'post-hook target mutation selects the distinct community journal' );
        is( $f->value('editor'), 'rte0', 'readonly form retains legacy rich editor mapping' );
        is( $f->value('entrytime_date'), '2026-09-23', 'readonly form retains supplied date' );
        is( $f->value('entrytime_time'), '04:05',      'readonly form retains supplied time' );
        is(
            $f->action,
            'http://localhost/entry/new?encoded=one%2Ftwo&repeated=first&repeated=second',
            'readonly native form has canonical action and raw retry query'
        );
        like(
            $res->content,
qr{<strong>Warning:</strong>.*?<a href="https://help\.example\.invalid/readonly">read-only mode</a>}s,
            'readonly warning retains configured help anchor'
        );
        unlike(
            $res->content,
            qr/missing string/i,
            'readonly warning resolves its absolute legacy key'
        );

        local $LJ::HELPURL{readonly} = '';
        $res = $send->( GET '/__readonly?subject=second' );
        like(
            $res->content,
            qr/<strong>Warning:<\/strong>.*?read-only mode/s,
            'readonly warning remains visible without configured help URL'
        );
        my ($warning) = $res->content =~ m{(<div class="alert-box">.*?read-only mode.*?</div>)}s;
        ok( $warning, 'no-help readonly warning has a scoped native warning element' );
        unlike( $warning, qr/<a href=/, 'no-help readonly warning does not invent an anchor' );

        {
            no warnings 'redefine';
            local *LJ::Lang::get_text = sub {
                my ( $lang, $code ) = @_;
                return 'readonly getter marker' if $code eq '/update.bml.rowarn';
                return $orig_get_text->(@_);
            };
            $res = $send->( GET '/__readonly?subject=localized' );
            like(
                $res->content,
                qr/readonly getter marker/,
                'readonly warning uses the absolute legacy key through the request getter'
            );
        }
    };
}

is( $hook_calls, 3, 'readonly callable invokes update_fields once per request' );
is_deeply( \@hook_refs, \@request_refs,
    'update_fields receives each original mutable flat GET reference' );
my $fresh = LJ::load_userid( $uid, 1 );
is( $fresh->draft_text, 'readonly draft body', 'readonly rendering preserves draft body' );
is_deeply(
    thaw( $fresh->prop('draft_properties') ),
    { subject => 'readonly draft subject', editor => 'markdown0' },
    'readonly rendering preserves draft properties'
);
is( $fresh->prop('entry_editor'),
    'always_rich', 'readonly rendering preserves legacy editor preference' );
is( $fresh->entry_editor2, 'markdown0', 'readonly rendering preserves native editor preference' );

my $boundary = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r   = DW::Request->get;
        my $ret = DW::Controller::Entry::legacy_update_readonly_get_handler( remote => $u );
        $r->status(200);
        $r->print( defined $ret ? 'handled' : 'fallback' );
        return $r->res;
    }
);
{
    no warnings 'redefine';
    local *LJ::User::readonly = sub { 0 };
    test_psgi $boundary, sub {
        my $send = shift;
        my $get  = $send->( GET '/__readonly-boundary' );
        is( $get->content, 'fallback', 'non-readonly callable leaves retained fallback' );
        my $post = $send->( POST '/__readonly-boundary', [] );
        is( $post->content, 'fallback', 'non-GET callable leaves retained fallback' );
    };
}

done_testing;

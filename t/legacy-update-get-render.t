#!/usr/bin/perl
# Test render-only retained update GET compatibility mapping.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use DW::Template;
use Plack::Middleware::DW::RequestWrapper;
use LJ::Hooks;
use LJ::Test qw(temp_user);

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

my $u = temp_user();
$u->update_self( { status => 'A' } );
$u->set_prop( 'entry_editor', 'always_rich' );
$u->entry_editor2('markdown0');
$u->set_prop( 'entry_draft', '"draft sentinel"' );
$u->set_prop(
    'draft_properties',
    nfreeze(
        {
            subject => 'frozen draft subject',
            taglist => 'frozen draft tag',
            editor  => 'markdown0',
        }
    )
);

my $get = {
    subject      => 'get subject',
    event        => 'get body',
    prop_taglist => 'get tags',
    encoded      => 'one/two',
};
my $hook = {
    subject               => 'hook subject',
    event                 => 'hook body',
    tags                  => 'hook tags',
    prop_opt_preformatted => 0,
};

{
    my @calls;
    no warnings 'redefine';
    local *DW::Template::render_template = sub {
        my ( undef, $name, $vars ) = @_;
        push @calls, [ $name, $vars ];
        return 'rendered';
    };

    is(
        DW::Controller::Entry::legacy_update_get_render(
            remote        => $u,
            get           => $get,
            update_fields => $hook,
            legacy_editor => 'rich',
            rte_supported => 1,
            datetime      => '2026-09-23 04:05',
            usejournal    => undef,
        ),
        'rendered',
        'callable GET renderer returns template result'
    );
    is( scalar @calls, 1, 'renders once' );
    my $form = $calls[0][1]{formdata};
    is_deeply(
        { map { $_ => $form->{$_} } qw(subject event taglist editor) },
        {
            subject => 'hook subject',
            event   => 'hook body',
            taglist => 'hook tags',
            editor  => 'rte0',
        },
        'hook overrides retained GET prefill and supported rich maps to rte0'
    );
    is( $u->prop('entry_editor'), 'always_rich',      'GET does not rewrite legacy editor' );
    is( $u->entry_editor2,        'markdown0',        'GET does not rewrite native editor' );
    is( $u->prop('entry_draft'),  '"draft sentinel"', 'GET does not clear draft' );

    @calls = ();
    DW::Controller::Entry::legacy_update_get_render(
        remote        => $u,
        get           => $get,
        legacy_editor => 'always_plain',
        rte_supported => 1,
        datetime      => '2026-09-23 04:05',
    );
    is( $calls[0][1]{formdata}{editor},
        'html_casual1', 'plain maps to casual regardless of entry_editor2' );

    @calls = ();
    DW::Controller::Entry::legacy_update_get_render(
        remote        => $u,
        get           => $get,
        legacy_editor => 'rich',
        rte_supported => 0,
        update_fields => { prop_opt_preformatted => 1 },
        datetime      => '2026-09-23 04:05',
    );
    is( $calls[0][1]{formdata}{editor},
        'html_raw0', 'unsupported rich with effective preformat maps to raw' );
    is( $calls[0][1]{displaydate}{year}, '2026', 'caller datetime reaches native init' );

    $u->set_prop( 'disable_auto_formatting', 1 );
    @calls = ();
    DW::Controller::Entry::legacy_update_get_render(
        remote        => $u,
        get           => $get,
        legacy_editor => 'plain',
        rte_supported => 1,
        update_fields => { prop_opt_preformatted => 0 },
        datetime      => '2026-09-23 04:05',
    );
    is( $calls[0][1]{formdata}{editor},
        'html_raw0', 'false hook does not override stored legacy preformat preference' );
    $u->set_prop( 'disable_auto_formatting', 0 );
}

my %cases = (
    rich => {
        remote        => $u,
        legacy_editor => 'rich',
        rte_supported => 1,
        hook          => {
            subject => 'rich <hook> & "quotes"',
            event   => 'rich <event> & "quotes"',
            tags    => 'rich <tags> & "quotes"',
        },
        expected_editor => 'rte0',
    },
    unsupported => {
        remote        => temp_user(),
        legacy_editor => 'rich',
        rte_supported => 0,
        hook          => {
            subject               => 'raw hook subject',
            event                 => 'raw hook event',
            tags                  => 'raw hook tags',
            prop_opt_preformatted => 1,
        },
        expected_editor => 'html_raw0',
    },
    casual => {
        remote        => temp_user(),
        legacy_editor => 'always_plain',
        rte_supported => 1,
        hook          => {
            subject => 'casual hook subject',
            event   => 'casual hook event',
            tags    => 'casual hook tags',
        },
        expected_editor => 'html_casual1',
    },
    preformat_or => {
        remote        => temp_user(),
        legacy_editor => 'plain',
        rte_supported => 1,
        hook          => {
            subject               => 'OR hook subject',
            event                 => 'OR hook event',
            tags                  => 'OR hook tags',
            prop_opt_preformatted => 0,
        },
        expected_editor => 'html_raw0',
    },
);
$cases{$_}{remote}->update_self( { status => 'A' } ) for keys %cases;
$cases{preformat_or}{remote}->set_prop( 'disable_auto_formatting', 1 );

my ( $hook_calls, @hook_refs, @get_refs );
my $action_url = '/entry/new?encoded=one%2Ftwo&repeated=first&repeated=second';
my $app        = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r    = DW::Request->get;
        my $get  = $r->get_args;
        my $case = $get->{case} || 'rich';
        my $opts = $cases{$case} or die "unknown test case $case";

        # The retained wrapper owns update_fields. The production seam accepts
        # its result so callers can retain the legacy hook ABI unchanged.
        push @get_refs, refaddr($get);
        my $hook = LJ::Hooks::run_hook( 'update_fields', $get ) || {};

        DW::Controller::Entry::legacy_update_get_render(
            remote        => $opts->{remote},
            get           => $get,
            update_fields => $hook,
            legacy_editor => $opts->{legacy_editor},
            rte_supported => $opts->{rte_supported},
            datetime      => '2026-09-23 04:05',
            usejournal    => $opts->{remote}->user,
            action_url    => $action_url,
        );
        $r->status(200);
        return $r->res;
    }
);

LJ::Hooks::are_hooks('update_fields');
{
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs, refaddr($get);
            return $cases{ $get->{case} }{hook};
        }
    ];

    test_psgi $app, sub {
        my $request = shift;
        for my $case (qw(rich unsupported casual preformat_or)) {
            my $res = $request->(
                GET "/__test_legacy_update_get?case=$case&subject=get&event=get&prop_taglist=get" );
            diag( $res->content ) if $res->code != 200;
            is( $res->code, 200, "$case test-only GET wrapper renders real template" );
            my $form = entry_form( $res->content );
            ok( $form, "$case real native entry form parses" )
                or BAIL_OUT('native entry form missing');

            my $opts = $cases{$case};
            is( $form->value('subject'), $opts->{hook}{subject}, "$case form has hook subject" );
            is( $form->value('event'),   $opts->{hook}{event},   "$case form has hook event" );
            is( $form->value('taglist'), $opts->{hook}{tags},    "$case form has hook tags" );
            is(
                $form->value('editor'),
                $opts->{expected_editor},
                "$case form selects mapped editor"
            );
            is( $form->value('entrytime_date'), '2026-09-23', "$case form renders supplied date" );
            is( $form->value('entrytime_time'), '04:05',      "$case form renders supplied time" );
            is( $form->value('usejournal'), $opts->{remote}->user,
                "$case form retains usejournal" );
            is( $form->action, "http://localhost$action_url", "$case form preserves action query" );
            like( $res->content, qr/frozen draft subject/, "$case emits frozen draft restore data" )
                if $case eq 'rich';
        }
    };
}

is( $hook_calls, 4, 'test wrapper invokes update_fields once for each GET' );
is_deeply( \@hook_refs, \@get_refs, 'update_fields receives each original GET reference' );

my $fresh = LJ::load_userid( $u->id, 1 );
is( $fresh->prop('entry_editor'), 'always_rich', 'real GET preserves legacy editor preference' );
is( $fresh->entry_editor2,        'markdown0',   'real GET preserves native editor preference' );
is( $fresh->prop('entry_draft'), '"draft sentinel"', 'real GET preserves draft body' );
is_deeply(
    Storable::thaw( $fresh->prop('draft_properties') ),
    {
        subject => 'frozen draft subject',
        taglist => 'frozen draft tag',
        editor  => 'markdown0',
    },
    'real GET preserves frozen draft properties'
);

done_testing;

#!/usr/bin/perl
# Characterize retained authenticated alternate-login /update GET rendering.
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

use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Retained alternate-login GET characterization requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $production_update_route = $DW::Routing::string_choices{'app/update'};

sub retained_form {
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

sub cookie_for {
    my ($user) = @_;
    my $session = LJ::Session->create( $user, nolog => 1 );
    return
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
}

sub fresh_state {
    my ($user) = @_;
    my $fresh  = LJ::load_userid( $user->id, 1 );
    my $frozen = $fresh->prop('draft_properties') || '';
    my ($entries) =
        $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $fresh->id );
    return {
        entries    => $entries,
        draft      => $fresh->draft_text,
        props      => length $frozen ? thaw($frozen) : {},
        editor     => $fresh->prop('entry_editor') || '',
        editor2    => $fresh->entry_editor2,
        formatting => $fresh->prop('disable_auto_formatting') || 0,
    };
}

my $owner_a = temp_user();
$owner_a->update_self( { status => 'A' } );
$owner_a->set_prop( entry_editor => 'always_plain' );
$owner_a->entry_editor2('markdown0');
$owner_a->set_prop( disable_auto_formatting => 0 );
$owner_a->set_draft_text('altlogin A draft body');
$owner_a->set_prop( draft_properties => nfreeze( { subject => 'altlogin A draft subject' } ) );

my $owner_b = temp_user();
$owner_b->update_self( { status => 'A' } );
$owner_b->set_prop( entry_editor => 'always_rich' );
$owner_b->entry_editor2('html_raw0');
$owner_b->set_prop( disable_auto_formatting => 1 );
$owner_b->set_draft_text('altlogin B draft body');
$owner_b->set_prop( draft_properties => nfreeze( { subject => 'altlogin B draft subject' } ) );

my $target = temp_comm();
$target->update_self( { status => 'A' } );
$owner_a->join_community( $target, 1, 1 );
$owner_b->join_community( $target, 1, 1 );
my $cookie_a = cookie_for($owner_a);
my $cookie_b = cookie_for($owner_b);

my ( $hook_calls, @hook_refs, @hook_get_refs, @hook_repeats, @hook_cases );
my $original_identity   = \&LJ::User::identity;
my $original_can_post   = \&LJ::User::can_post;
my $original_is_enabled = \&LJ::is_enabled;
my $original_auth_okay  = \&LJ::auth_okay;
my $auth_calls;
{
    no warnings 'redefine';
    local *LJ::User::identity = sub {
        return 1 if DW::Request->get && DW::Request->get->get_args->{identity};
        return $original_identity->(@_);
    };
    local *LJ::User::can_post = sub {
        return 0 if DW::Request->get && DW::Request->get->get_args->{cantpost};
        return $original_can_post->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta = sub {
        return DW::Request->get && DW::Request->get->get_args->{beta};
    };
    local *LJ::is_enabled = sub {
        return 1 if $_[0] eq 'rte_support';
        return $original_is_enabled->(@_);
    };
    local *LJ::auth_okay = sub {
        ++$auth_calls;
        return $original_auth_okay->(@_);
    };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs,     refaddr($get);
            push @hook_get_refs, $get;
            push @hook_repeats,  $get->{repeated};
            push @hook_cases,    $get->{case};
            $get->{user}       = 'hook <user> & "quote"';
            $get->{usejournal} = $target->user;
            return {} unless $get->{case} eq 'override';
            return {
                subject               => 'hook subject',
                event                 => 'hook event',
                tags                  => 'hook tag',
                prop_opt_preformatted => 1,
            };
        }
    ];

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ( $path, $cookie ) = @_;
            my $req = GET $path;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };

        my $before_a = fresh_state($owner_a);
        for my $path (
              '/update?altlogin=1&case=snapshot&user=before-user&usejournal='
            . $owner_a->user
            . '&subject=before-subject&event=before-event&prop_taglist=before-tag&password=encoded%3Cpassword-marker%3E&repeated=one&repeated=two',
            '/update.bml?altlogin=1&case=override&user=before-user&usejournal='
            . $owner_a->user
            . '&subject=before-subject&event=before-event&prop_taglist=before-tag&repeated=three&repeated=four'
            )
        {
            my $before_hooks = $hook_calls || 0;
            my $res          = $request->( $path, $cookie_a );
            is( $res->code, 200, "$path retained altlogin GET returns HTTP 200" );
            my $form = retained_form( $res->content, $path );
            ok( $form, "$path renders the actual retained update form" ) or next;
            like(
                $res->content,
                qr/id=['"]altlogin_wrapper['"][^>]*display:\s*block/i,
                "$path shows the alternate-login credentials"
            );
            unlike(
                $res->content,
                qr/id=['"]current_username['"]/,
                "$path hides the remote identity block"
            );
            is( $form->value('user'), 'hook <user> & "quote"',
                "$path uses post-hook user prefill" );
            is( $form->value('password') // '', '', "$path keeps password blank" );
            my @update_controls = $form->inputs;
            unlike(
                join( "\0", map { defined $_->value ? $_->value : '' } @update_controls ),
                qr/password-marker/i,
                "$path keeps the password marker out of every parsed updateForm control"
            );
            is(
                $form->action,
                'http://localhost/update?altlogin=1',
                "$path keeps the normalized retained updateForm action"
            );
            is( $form->value('password') // '',
                '', "$path keeps its retained password control blank" );

            if ( $path =~ /case=snapshot/ ) {
                my ($logout_form) = grep { $_->find_input('returnto') }
                    HTML::Form->parse( $res->content, 'http://localhost' . $path );
                ok( $logout_form, 'shared logout form is separately present' );
                like(
                    ( $logout_form ? $logout_form->value('returnto') : '' ) || '',
                    qr/password=encoded%3Cpassword-marker%3E/i,
                    'only shared logout returnto retains the percent-encoded marker'
                );
            }

            like(
                $res->content,
                qr/hook\s+&lt;user&gt;\s+&amp;\s+&quot;quote&quot;/,
                "$path escapes the post-hook user in rendered markup"
            );
            is( $form->value('usejournal'), $target->user, "$path uses post-hook target" );
            is(
                $form->action,
                'http://localhost/update?altlogin=1',
                "$path keeps the retained alternate-login action"
            );
            ok( $form->find_input('action:update'),
                "$path keeps the retained update action field" );
            ok( $form->find_input('lj_form_auth'), "$path keeps its retained form token" );
            is( $hook_calls, $before_hooks + 1, "$path invokes update_fields exactly once" );
            ok( $hook_refs[-1], "$path hook receives a flat GET reference" );

            if ( $path =~ /case=snapshot/ ) {
                is( $form->value('subject'), 'before-subject',
                    'snapshot retains pre-hook subject' );
                is( $form->value('event'), 'before-event', 'snapshot retains pre-hook body' );
                is( $form->value('prop_taglist'), 'before-tag', 'snapshot retains pre-hook tags' );
                unlike(
                    $res->content,
                    qr/onload[^>]*useRichText\(\"draft\"/,
                    'nondefault plain remote editor does not request RTE on load'
                );
                is( $form->value('event_format') // '',
                    '', 'A off auto-formatting remains unselected without a hook override' );
            }
            else {
                is( $form->value('subject'),      'hook subject', 'override applies hook subject' );
                is( $form->value('event'),        'hook event',   'override applies hook body' );
                is( $form->value('prop_taglist'), 'hook tag',     'override applies hook tags' );
                is( $form->value('richtext_default') // '',
                    '', 'remote always-plain preference keeps richtext default disabled' );
                is( $form->value('event_format'),
                    'preformatted', 'hook preformat renders retained preformatted selection' );
            }
        }
        is_deeply( \@hook_cases, [qw(snapshot override)], 'sequential hook cases remain isolated' );
        is_deeply(
            \@hook_repeats,
            [ "one\0two", "three\0four" ],
            'hooks receive exact NUL-joined repeated GET values'
        );
        ok( $hook_get_refs[0] && $hook_get_refs[1],
            'each retained request supplies one flat GET reference to update_fields' );
        is_deeply( fresh_state($owner_a), $before_a,
            'altlogin GET leaves A entries, drafts, and editor state unchanged' );

        my $before_b = fresh_state($owner_b);
        my $b        = $request->(
            '/update?altlogin=1&case=snapshot&subject=B-subject&event=B-event&prop_taglist=B-tag',
            $cookie_b
        );
        my $b_form = retained_form( $b->content, '/update' );
        ok( $b_form, 'second remote renders retained altlogin form' );
        is( $b_form->value('subject'), 'B-subject', 'B does not inherit A subject' );
        is( $b_form->value('event'),   'B-event',   'B does not inherit A body' );
        like( $b->content, qr/useRichText\(\"draft\"/,
            'B retains its distinct rich editor preference in the retained onload' );
        is( $b_form->value('event_format'),
            'preformatted',
            'B on auto-formatting remains selected independently of hook preformat' );
        is_deeply( fresh_state($owner_b), $before_b,
            'altlogin GET leaves B entries, drafts, and editor state unchanged' );

        for my $case (
            [
                'invalid target',
                '/update?altlogin=1&usejournal=no-such-user',
                qr/Invalid usejournal argument\./
            ],
            [
                'identity',
                '/update.bml?altlogin=1&identity=1',
                qr/Non-DW Devcontainer users can't post entries/
            ],
            [
                'cannot post',
                '/update?altlogin=1&cantpost=1',
                qr/Sorry: you can't post at this time\./
            ],
            )
        {
            my ( $label, $path, $message ) = @$case;
            my $before_hooks = $hook_calls || 0;
            my $res          = $request->( $path, $cookie_a );
            is( $res->code, 200, "$label precedes retained altlogin form with HTTP 200" );
            unlike( $res->content, qr/id=['"]updateForm['"]/, "$label renders no retained form" );
            like( $res->content, $message, "$label keeps its preceding terminal message" );
            is( $hook_calls, $before_hooks, "$label does not invoke update_fields" );
        }
        {
            my $before_hooks = $hook_calls || 0;
            my $res          = $request->(
                '/update.bml?altlogin=1&beta=1&encoded=a%2Fb&repeated=one&repeated=two', $cookie_a
            );
            is( $res->code, 302, 'beta precedes retained altlogin form' );
            like(
                $res->header('Location') || '',
                qr{^http://localhost/entry/new\?},
                'beta keeps its retained native redirect representation'
            );
            is( $hook_calls, $before_hooks, 'beta does not invoke update_fields' );
        }
    };
}

is( $auth_calls || 0, 0, 'retained altlogin GET never invokes password authentication' );
is( $DW::Routing::string_choices{'app/update'},
    $production_update_route,
    'altlogin characterization leaves production update routing unchanged' );

done_testing;

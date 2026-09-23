#!/usr/bin/perl
# Exercise public readonly /update GET activation without a route overlay.
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

use DW::Request;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

sub native_form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], 'http://localhost/entry/new' )
    )[0];
}

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_prop( 'entry_editor', 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_draft_text('readonly activation draft');
$owner->set_prop( draft_properties =>
        nfreeze( { subject => 'readonly activation subject', editor => 'markdown0' } ) );
my $comm = temp_comm();
$owner->join_community( $comm, 1, 1 );
my $owner_id = $owner->id;
my $session  = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

my $orig_readonly         = \&LJ::User::readonly;
my $orig_readonly_handler = \&DW::Controller::Entry::legacy_update_readonly_get_handler;
my ( $hook_calls, @hook_refs, @readonly_refs );
LJ::Hooks::are_hooks('update_fields');
{
    no warnings 'redefine';
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get && DW::Request->get->get_args->{readonly};
        return $orig_readonly->(@_);
    };
    local *DW::Controller::Entry::legacy_update_readonly_get_handler = sub {
        my (%opts) = @_;
        push @readonly_refs, refaddr( $opts{get} );
        return $orig_readonly_handler->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta =
        sub { return DW::Request->get && DW::Request->get->get_args->{beta}; };
    local $LJ::HELPURL{readonly}    = 'https://help.example.invalid/readonly';
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs, refaddr($get);
            $get->{usejournal} = $comm->user;
            return {
                subject => 'hook readonly subject',
                event   => 'hook readonly body',
                tags    => 'hook-tag'
            };
        }
    ];

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };
        my $entry_count = sub {
            my $fresh = LJ::load_userid( $owner_id, 1 );
            return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
                undef, $fresh->id );
        };
        my $before_count = $entry_count->();
        my $before_draft = LJ::load_userid( $owner_id, 1 )->draft_text;
        my $before_props = thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') );

        for my $path (
              '/update?readonly=1&usejournal='
            . $owner->user
            . '&subject=raw+subject&event=raw+body&prop_taglist=raw-tag&encoded=a%2Fb&repeated=one&repeated=two',
            '/update.bml?readonly=1&usejournal='
            . $owner->user
            . '&subject=raw+subject&event=raw+body&prop_taglist=raw-tag&encoded=a%2Fb&repeated=one&repeated=two',
            )
        {
            my $res = $request->( GET $path );
            is( $res->code, 200, "$path public readonly status" );
            my $form = native_form( $res->content );
            ok( $form, "$path public readonly uses native form" )
                or BAIL_OUT('native form missing');
            is( $form->value('subject'), 'hook readonly subject', "$path keeps hook subject" );
            is( $form->value('event'),   'hook readonly body',    "$path keeps hook body" );
            is( $form->value('taglist'), 'hook-tag',              "$path keeps hook tags" );
            is( $form->value('usejournal'), $comm->user, "$path uses post-hook community target" );
            like(
                $res->content,
qr{<strong>Warning:</strong>.*?<a href="https://help\.example\.invalid/readonly">read-only mode</a>}s,
                "$path renders retained readonly help warning"
            );
            unlike( $res->content, qr/missing string/i, "$path has no missing warning string" );
            like(
                $form->action,
                qr{/entry/new\?readonly=1.*encoded=a%2Fb.*repeated=one.*repeated=two},
                "$path retains raw retry query on canonical action"
            );
        }

        my $invalid = $request->( GET '/update?readonly=1&usejournal=does-not-exist' );
        like(
            $invalid->content,
            qr/Invalid usejournal argument\./,
            'invalid target remains before readonly activation'
        );
        unlike( $invalid->content, qr/id=['"]js-post-entry['"]/,
            'invalid target does not render native form' );

        my $beta = $request->( GET '/update?readonly=1&beta=1' );
        is( $beta->code, 302, 'beta redirect remains before readonly activation' );

        for my $path ( '/update?readonly=1&altlogin=1', '/update?readonly=1&share=not-a-url' ) {
            my $res = $request->( GET $path );
            like( $res->content, qr/id=['"]updateForm['"]/, "$path retains BML fallback" );
            unlike( $res->content, qr/id=['"]js-post-entry['"]/,
                "$path does not render native form" );
        }

        my $ordinary = $request->( GET '/update?subject=ordinary' );
        ok( native_form( $ordinary->content ),
            'sequential eligible request remains native ordinary form' );

        my $anonymous = $send->( GET '/update' );
        like( $anonymous->content, qr/id=['"]updateForm['"]/,
            'anonymous GET remains retained credential form' );
        like( $anonymous->content, qr/name=['"]user['"]/,
            'anonymous retained form keeps user control' );

        is( $entry_count->(), $before_count, 'readonly GET creates no entries' );
        my $fresh = LJ::load_userid( $owner_id, 1 );
        is( $fresh->draft_text, $before_draft, 'readonly GET preserves draft body' );
        is_deeply( thaw( $fresh->prop('draft_properties') ),
            $before_props, 'readonly GET preserves draft properties' );
        is( $fresh->prop('entry_editor'),
            'always_rich', 'readonly GET preserves legacy editor preference' );
        is( $fresh->entry_editor2, 'markdown0', 'readonly GET preserves native editor preference' );
    };
}

is( scalar @readonly_refs, 2, 'readonly public aliases invoke the readonly callable once each' );
is_deeply( [ @hook_refs[ 0, 1 ] ],
    \@readonly_refs,
    'readonly public aliases pass the same original flat GET references to update_fields' );

done_testing;

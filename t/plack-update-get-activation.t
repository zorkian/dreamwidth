#!/usr/bin/perl
# Exercise the public retained /update GET activation without a route overlay.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::External::Page;
use DW::Request;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);

{

    package UpdateGetActivation::SharePage;
    sub new { my ( $class, %args ) = @_; return bless \%args, $class; }
    sub title       { return $_[0]->{title}; }
    sub url         { return $_[0]->{url}; }
    sub description { return $_[0]->{description}; }
}

plan skip_all => 'Public update GET activation requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub native_form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], 'http://localhost/entry/new' )
    )[0];
}

sub entry_count {
    my ($user) = @_;
    my $fresh = LJ::load_userid( $user->id, 1 );
    return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $fresh->id );
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_prop( 'entry_editor', 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_draft_text('public update GET saved draft');
$owner->set_prop( draft_properties =>
        nfreeze( { subject => 'public update GET draft subject', editor => 'markdown0' } ) );
my $owner_id = $owner->id;
my $session  = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'publicUpdateGetActivation';

my $original_readonly = \&LJ::User::readonly;
my $share_fetches     = 0;
{
    no warnings 'redefine';
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get && DW::Request->get->get_args->{readonly};
        return $original_readonly->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta = sub {
        return DW::Request->get && DW::Request->get->get_args->{beta};
    };
    local *DW::External::Page::new = sub {
        ++$share_fetches;
        return UpdateGetActivation::SharePage->new(
            title       => 'Shared title',
            url         => 'https://example.invalid/share',
            description => 'Shared description'
        );
    };

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };

        my $before_count = entry_count($owner);
        my $before_draft = LJ::load_userid( $owner_id, 1 )->draft_text;
        my $before_props = thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') );
        for my $path (
'/update?subject=Public+subject&event=Public+body&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two',
'/update.bml?subject=Public+subject&event=Public+body&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two'
            )
        {
            my $res = $request->( GET $path );
            is( $res->code, 200, "$path public eligible GET returns native response" );
            my $form = native_form( $res->content );
            ok( $form, "$path public eligible GET uses native entry form" ) or next;
            is( $form->value('subject'), 'Public subject', "$path retains submitted subject" );
            is( $form->value('event'),   'Public body',    "$path retains submitted body" );
            is( $form->value('taglist'), 'public-tag',     "$path maps legacy tag field" );
            is( $form->value('editor'),  'rte0',           "$path maps retained rich preference" );
            is(
                $form->action,
'http://localhost/entry/new?subject=Public+subject&event=Public+body&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two',
                "$path preserves the raw encoded/repeated retry query"
            );
        }
        is( entry_count($owner), $before_count, 'public GET creates no entry' );
        my $fresh = LJ::load_userid( $owner_id, 1 );
        is( $fresh->draft_text, $before_draft, 'public GET leaves draft body unchanged' );
        is_deeply( thaw( $fresh->prop('draft_properties') ),
            $before_props, 'public GET leaves draft properties unchanged' );

        for my $case ( [ '/update?altlogin=1', 'alternate login' ],
            [ '/update?readonly=1', 'readonly' ], )
        {
            my ( $path, $label ) = @$case;
            my $res = $request->( GET $path );
            is( $res->code, 200, "$label GET keeps retained BML status" );
            like( $res->content, qr/id=['"]updateForm['"]/,
                "$label GET falls through to retained BML form" );
            unlike( $res->content, qr/id=['"]js-post-entry['"]/,
                "$label GET does not render native form" );
        }

        my $share = $request->( GET '/update?share=not-a-url' );
        is( $share->code, 200, 'share GET keeps retained BML status' );
        my $share_form = ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
                HTML::Form->parse( $share->content, 'http://localhost/update' ) )[0];
        ok( $share_form, 'share GET reaches the retained BML form' );
        is( $share_form->value('subject'),
            'Shared title', 'retained BML share prefill uses stub title' );
        like(
            $share_form->value('event'),
            qr{https://example\.invalid/share},
            'retained BML share prefill uses stub URL'
        );
        is( $share_fetches, 1,
            'share BML fallback performs its retained share prefill exactly once' );

        my $invalid = $request->( GET '/update?usejournal=does-not-exist' );
        is( $invalid->code, 200, 'invalid target GET keeps retained BML status' );
        unlike( $invalid->content, qr/id=['"]js-post-entry['"]/,
            'invalid target GET does not render native form' );
        like(
            $invalid->content,
            qr/Invalid usejournal argument/,
            'invalid target GET keeps the exact retained BML error message'
        );

        my $anonymous = $send->( GET '/update' );
        is( $anonymous->code, 200, 'anonymous GET keeps retained BML status' );
        my $anonymous_form = ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
                HTML::Form->parse( $anonymous->content, 'http://localhost/update' ) )[0];
        ok( $anonymous_form,                     'anonymous GET retains the legacy update form' );
        ok( $anonymous_form->find_input('user'), 'anonymous legacy form has its user control' );
        ok(
            $anonymous_form->find_input('password'),
            'anonymous legacy form has its password control'
        );

        my $post = POST '/update', [ subject => 'non-GET must fall through' ];
        $post->header( Cookie => $cookie, Referer => 'http://localhost/update' );
        my $non_get = $send->($post);
        is( $non_get->code, 200, 'non-GET keeps retained handler status' );
        like( $non_get->content, qr/id=['"]updateForm['"]/,
            'non-GET remains outside GET renderer' );

        my $beta = $request->( GET '/update.bml?beta=1&encoded=a%2Fb&repeated=one&repeated=two' );
        is( $beta->code, 302, 'beta GET keeps retained redirect status' );
        is(
            $beta->header('Location'),
            'http://localhost/entry/new?beta=1&encoded=a/b&repeated=one%00two',
            'beta GET retains legacy encoded/repeated redirect query'
        );
    };
}

done_testing;

#!/usr/bin/perl
# Exercise public authenticated /update share GET activation without a route overlay.
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

use DW::External::Page;
use DW::Request;
use LJ::Session;
use LJ::Test qw(temp_user);

{

    package UpdateSharePublic::Page;
    sub new { my ( $class, %args ) = @_; return bless \%args, $class; }
    sub title       { return $_[0]->{title}; }
    sub url         { return $_[0]->{url}; }
    sub description { return $_[0]->{description}; }
}

plan skip_all => 'Public update share GET activation requires a development server'
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

sub retained_form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], 'http://localhost/update' )
    )[0];
}

sub user_state {
    my ($user) = @_;
    my $fresh  = LJ::load_userid( $user->id, 1 );
    my $frozen = $fresh->prop('draft_properties') || '';
    my ($entries) =
        $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $fresh->id );
    return {
        entries => $entries,
        draft   => $fresh->draft_text,
        props   => length $frozen ? thaw($frozen) : {},
        editor  => $fresh->prop('entry_editor') || '',
        editor2 => $fresh->prop('entry_editor2') || '',
    };
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

my $owner_a = temp_user();
$owner_a->update_self( { status => 'A' } );
$owner_a->set_prop( entry_editor => 'always_rich' );
$owner_a->entry_editor2('markdown0');
$owner_a->set_draft_text('share activation A draft');
$owner_a->set_prop( draft_properties => nfreeze( { subject => 'share A draft subject' } ) );
my $owner_b = temp_user();
$owner_b->update_self( { status => 'A' } );
$owner_b->set_prop( entry_editor => 'plain' );
$owner_b->entry_editor2('html_raw0');
my $target = temp_user();
$target->update_self( { status => 'A' } );

my $cookie_a = cookie_for($owner_a);
my $cookie_b = cookie_for($owner_b);
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'publicUpdateShareActivation';

my ( $factory_calls, @factory_urls, $hook_calls, @hook_refs, @hook_repeats );
my $original_readonly = \&LJ::User::readonly;
my $original_identity = \&LJ::User::identity;
my $original_can_post = \&LJ::User::can_post;
{
    no warnings 'redefine';
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get && DW::Request->get->get_args->{readonly};
        return $original_readonly->(@_);
    };
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
    local *DW::External::Page::new = sub {
        my ( $class, %args ) = @_;
        ++$factory_calls;
        push @factory_urls, $args{url};
        return undef if $args{url} eq 'none';
        die 'public share fixture factory exception' if $args{url} eq 'explode';
        return UpdateSharePublic::Page->new(
            title       => 'Public share title',
            url         => 'https://example.invalid/public-share?x=1&y=2',
            description => 'Public share description',
        );
    };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs,    refaddr($get);
            push @hook_repeats, $get->{repeated};
            if ( $get->{hook_target} ) {
                $get->{usejournal} = $target->user;
                return { tags => 'hook tag' };
            }
            return {};
        }
    ];

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ( $path, $cookie ) = @_;
            my $req = GET $path;
            $req->header( Cookie => $cookie ) if defined $cookie;
            return $send->($req);
        };

        my $before_a = user_state($owner_a);
        for my $path (
'/update?share=https%3A%2F%2Fexample.invalid%2Fsource&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two&hook_target=1',
'/update.bml?share=https%3A%2F%2Fexample.invalid%2Fsource&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two&hook_target=1'
            )
        {
            my $factory_before = $factory_calls // 0;
            my $hook_before    = $hook_calls    // 0;
            my $res = $request->( $path, $cookie_a );
            is( $res->code, 200, "$path claims authenticated share rendering" );
            my $form = native_form( $res->content );
            ok( $form, "$path renders native js-post-entry form" ) or next;
            like(
                $res->content,
                qr/<title>Post an Entry<\/title>/i,
                "$path keeps the localized legacy update title"
            );
            is( $form->value('subject'), 'Public share title', "$path maps page title" );
            like(
                $form->value('event'),
                qr{https://example\.invalid/public-share\?x=1&y=2},
                "$path maps the legacy page link"
            );
            like(
                $form->value('event'),
                qr/Public share description/,
                "$path maps page description"
            );
            is( $form->value('taglist'), 'hook tag', "$path applies update_fields return values" );
            is( $form->value('usejournal'), $target->user, "$path selects post-hook target" );
            is( $form->value('editor'),     'rte0',        "$path retains owner A editor" );
            is(
                $form->action,
'http://localhost/entry/new?share=https%3A%2F%2Fexample.invalid%2Fsource&prop_taglist=public-tag&encoded=a%2Fb&repeated=one&repeated=two&hook_target=1',
                "$path retains its raw canonical retry query"
            );
            is( $factory_calls,    $factory_before + 1, "$path constructs the page once" );
            is( $hook_calls,       $hook_before + 1,    "$path invokes update_fields once" );
            is( $hook_repeats[-1], "one\0two",          "$path hook sees NUL-joined repeats" );
            ok( $hook_refs[-1], "$path hook receives a flat request reference" );
        }
        is_deeply( user_state($owner_a), $before_a,
            'authenticated share GET leaves A state unchanged' );

        my $b      = $request->( '/update?share=none&subject=B+subject&event=B+event', $cookie_b );
        my $b_form = native_form( $b->content );
        ok( $b_form, 'second authenticated user receives native false-factory form' );
        is( $b_form->value('subject'),
            'B subject', 'false factory preserves B subject without A leakage' );
        is( $b_form->value('event'), 'B event',
            'false factory preserves B body without A leakage' );
        is( $b_form->value('editor'), 'html_casual1', 'second user does not inherit A editor' );

        my $ordinary = $request->( '/update?subject=ordinary', $cookie_a );
        ok( native_form( $ordinary->content ), 'ordinary authenticated GET remains native' );

        for my $case (
            [
                'invalid target', '/update?share=none&usejournal=no-such-user',
                $cookie_a,        qr/Invalid usejournal argument\./
            ],
            [
                'identity', '/update?share=none&identity=1',
                $cookie_a,  qr/Non-DW Devcontainer users can't post entries/
            ],
            [
                'cannot post', '/update?share=none&cantpost=1',
                $cookie_a,     qr/Sorry: you can't post at this time\./
            ],
            )
        {
            my ( $label, $path, $cookie, $message ) = @$case;
            my ( $factory_before, $hook_before ) = ( $factory_calls // 0, $hook_calls // 0 );
            my $res = $request->( $path, $cookie );
            is( $res->code, 200, "$label share keeps terminal HTTP status" );
            unlike(
                $res->content,
                qr/id=['"](?:updateForm|js-post-entry)['"]/,
                "$label share has no form"
            );
            like( $res->content, $message, "$label share keeps terminal message" );
            is( $factory_calls, $factory_before, "$label share does not construct a page" );
            is( $hook_calls,    $hook_before,    "$label share does not call update_fields" );
        }

        {
            my ( $factory_before, $hook_before ) = ( $factory_calls // 0, $hook_calls // 0 );
            my $res = $request->(
                '/update.bml?beta=1&share=none&encoded=a%2Fb&repeated=one&repeated=two', $cookie_a
            );
            is( $res->code, 302, 'beta share keeps retained redirect status' );
            like(
                $res->header('Location') || '',
                qr{^http://localhost/entry/new\?},
                'beta share redirects to native entry route before share work'
            );
            is( $factory_calls, $factory_before, 'beta share does not construct a page' );
            is( $hook_calls,    $hook_before,    'beta share does not call update_fields' );
        }

        for my $case (
            [ 'readonly',  '/update?share=fallback&readonly=1',     $cookie_a, 0 ],
            [ 'altlogin',  '/update.bml?share=fallback&altlogin=1', $cookie_a, 1 ],
            [ 'anonymous', '/update?share=fallback',                undef,     1 ],
            )
        {
            my ( $label, $path, $cookie, $credentials ) = @$case;
            my $factory_before = $factory_calls // 0;
            my $res            = $request->( $path, $cookie );
            is( $res->code, 200, "$label share retains HTTP status" );
            my $form = retained_form( $res->content );
            ok( $form, "$label share falls through to retained BML form" );
            unlike( $res->content, qr/id=['"]js-post-entry['"]/,
                "$label share does not render native form" );
            is(
                $form ? $form->value('subject') : '',
                'Public share title',
                "$label retained form receives share title"
            );
            is( $factory_calls, $factory_before + 1, "$label retained path constructs one page" );
            ok( $form->find_input('user'), "$label retained form keeps legacy user control" )
                if $credentials;
            like( $res->content, qr/read-only mode/i, 'readonly retained fallback keeps warning' )
                if $label eq 'readonly';
        }

        {
            my $factory_before = $factory_calls // 0;
            my $res            = $request->( '/update?share=explode', $cookie_a );
            is( $res->code, 500, 'share factory exception remains a framework error' );
            like(
                $res->content,
                qr/public share fixture factory exception/,
                'share exception stays observable'
            );
            is( $factory_calls, $factory_before + 1, 'share exception constructs only once' );
        }

        my $head = HTTP::Request->new( HEAD => 'http://localhost/update?share=none' );
        $head->header( Cookie => $cookie_a );
        my $head_res = $send->($head);
        is( $head_res->code, 200, 'HEAD share retains fallback status' );
        unlike( $head_res->content, qr/js-post-entry/, 'HEAD share does not claim native form' );

        my $post = POST '/update?share=none', [ subject => 'unchanged POST boundary' ];
        $post->header( Cookie => $cookie_a, Referer => 'http://localhost/update' );
        my $post_res = $send->($post);
        is( $post_res->code, 200, 'POST share retains existing handler status' );
        like( $post_res->content, qr/id=['"]updateForm['"]/,
            'POST share remains outside GET activation' );
    };
}

done_testing;

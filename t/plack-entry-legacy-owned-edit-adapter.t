#!/usr/bin/perl
# Exercise the unregistered owned legacy edit adapter with retained form requests.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use lib "$ENV{LJHOME}/cgi-bin";
use DW::Request;
use DW::Routing;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);

plan skip_all => 'Legacy edit integration requires a development server' unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub form_from {
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
            HTML::Form->parse( $_[0], 'http://localhost/editjournal' ) )[0];
}
sub fresh { LJ::Entry::reset_singletons(); return LJ::Entry->new( $_[0], ditemid => $_[1] ) }

# This route is registered only while this test loads app.psgi. It lets the
# normal middleware establish the cookie remote before calling the unregistered
# adapter; no production route is added.
our %adapter_entry;

sub adapter_handler {
    my $r      = DW::Request->get;
    my $remote = LJ::get_remote();
    return undef unless $r->did_post;
    my $post  = $r->post_args;
    my $entry = $adapter_entry{ $r->get_args->{itemid} || 0 };
    return undef unless DW::Entry::Legacy::legacy_edit_action($post);
    my $allowed = $entry && $remote && $entry->poster->equals($remote);
    my $token   = LJ::check_form_auth( $post->{lj_form_auth} );
    my $referer = LJ::check_referer( undef, $r->header_in('Referer') );

    unless ( $allowed && $token && $referer ) {
        $r->status(403);
        $r->print("adapter request rejected: allowed=$allowed token=$token referer=$referer");
        return $r->OK;
    }
    my %result = DW::Controller::Entry::legacy_owned_edit_post(
        entry          => $entry,
        remote         => $remote,
        journal        => $remote,
        session_remote => $remote,
        post           => $post,
        get            => $r->get_args( preserve_case => 1 ),
        legacy_seed    => { legacy_wrapper_marker => 'retained-form' },
    );
    return $result{render} if exists $result{render};
    $r->status(400);
    return $r->print('adapter action fell through');
}
DW::Routing->register_string( '/editjournal', \&adapter_handler, app => 1, no_redirects => 1 );

sub visible_click {
    my ( $form, $name ) = @_;
    my ($input) = grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) } $form->inputs;
    die "missing retained $name submit" unless $input;
    return $input->click($form);
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyOwnedAdapter';

test_psgi $app, sub {
    my $send = shift;
    for my $suffix ( '', '.bml' ) {
        my $entry = $owner->t_post_fake_entry(
            subject  => "Adapter $suffix original",
            body     => "Adapter $suffix body",
            security => 'private'
        );
        my $other = $owner->t_post_fake_entry(
            subject  => "Adapter $suffix other",
            body     => "Adapter $suffix other body",
            security => 'private'
        );
        my $path = "/editjournal$suffix?itemid=" . $entry->ditemid;
        my $get  = GET $path;
        $get->header( Cookie => $cookie );
        my $res = $send->($get);
        is( $res->code, 200, "$path renders retained owned-edit form" );
        my $form = form_from( $res->content );
        ok( $form, "$path supplies its actual retained edit form" ) or next;
        ok( $form->find_input('lj_form_auth'), "$path form supplies its CSRF token" );
        $adapter_entry{ $entry->ditemid } = $entry;
        $form->action( 'http://localhost/editjournal?itemid=' . $entry->ditemid );
        $form->value( subject => "Adapter $suffix changed" );
        $form->value( event   => "Adapter $suffix changed body" );
        my $post = visible_click( $form, 'action:save' );
        $post->header( Cookie         => $cookie );
        $post->header( Referer        => "http://localhost$path" );
        $post->header( 'Content-Type' => 'application/x-www-form-urlencoded' );
        my $adapter_res = $send->($post);
        my $content     = $adapter_res->content;
        my $result      = { status => $adapter_res->is_success ? 'ok' : undef };
        is( $result->{status}, 'ok', "$path actual retained form saves through test-only adapter" );
        like( $content, qr/(?:updated|success)/i,
            "$path adapter returns meaningful success content" );
        is(
            fresh( $owner, $entry->ditemid )->subject_raw,
            "Adapter $suffix changed",
            "$path persists changed subject"
        );
        is(
            fresh( $owner, $entry->ditemid )->event_raw,
            "Adapter $suffix changed body",
            "$path persists changed body"
        );
        is( fresh( $owner, $entry->ditemid )->security, 'private',
            "$path save preserves the retained private security selection" );
        is(
            fresh( $owner, $other->ditemid )->subject_raw,
            "Adapter $suffix other",
            "$path preserves unrelated entry"
        );

        my $again = GET $path;
        $again->header( Cookie => $cookie );
        $res                              = $send->($again);
        $form                             = form_from( $res->content );
        $adapter_entry{ $entry->ditemid } = $entry;
        $form->action( 'http://localhost/editjournal?itemid=' . $entry->ditemid );
        my $delete = $form->click('action:delete');
        $delete->header( Cookie         => $cookie );
        $delete->header( Referer        => "http://localhost$path" );
        $delete->header( 'Content-Type' => 'application/x-www-form-urlencoded' );
        $adapter_res = $send->($delete);
        $content     = $adapter_res->content;
        $result      = { status => $adapter_res->is_success ? 'ok' : undef };
        is( $result->{status}, 'ok',
            "$path actual retained delete submits through test-only adapter" );
        ok(
            !fresh( $owner, $entry->ditemid )->valid,
            "$path delete removes only the selected entry"
        );
        ok( fresh( $owner, $other->ditemid )->valid, "$path delete preserves unrelated entry" );

        my $other_path = "/editjournal$suffix?itemid=" . $other->ditemid;
        my $other_get  = GET $other_path;
        $other_get->header( Cookie => $cookie );
        $res                              = $send->($other_get);
        $form                             = form_from( $res->content );
        $adapter_entry{ $other->ditemid } = $other;
        $form->action( 'http://localhost/editjournal?itemid=' . $other->ditemid );
        my $unknown = visible_click( $form, 'action:save' );
        $unknown->content(
            $unknown->content =~ s/submit_value=[^&]*/submit_value=action%3Aunknown/r );
        $unknown->header( Cookie         => $cookie );
        $unknown->header( Referer        => "http://localhost$other_path" );
        $unknown->header( 'Content-Type' => 'application/x-www-form-urlencoded' );
        my $before_subject = fresh( $owner, $other->ditemid )->subject_raw;
        my $unknown_res    = $send->($unknown);
        ok( $unknown_res->code < 500,
            "$other_path unsupported submit falls through without server failure" );
        is( fresh( $owner, $other->ditemid )->subject_raw,
            $before_subject, "$other_path unsupported submit leaves the fresh target unchanged" );

        $res                              = $send->($other_get);
        $form                             = form_from( $res->content );
        $adapter_entry{ $other->ditemid } = $other;
        $form->action( 'http://localhost/editjournal?itemid=' . $other->ditemid );
        my $missing = visible_click( $form, 'action:save' );
        $missing->content( $missing->content =~ s/(?:^|&)lj_form_auth=[^&]*//r );
        $missing->content( $missing->content =~ s/^&//r );
        $missing->header( 'Content-Length' => length $missing->content );
        $missing->header( Cookie           => $cookie );
        $missing->header( Referer          => "http://localhost$other_path" );
        $missing->header( 'Content-Type'   => 'application/x-www-form-urlencoded' );
        my $missing_res = $send->($missing);
        is( $missing_res->code, 403,
            "$other_path missing token is rejected before adapter decode" );
        is( fresh( $owner, $other->ditemid )->subject_raw,
            $before_subject, "$other_path missing token leaves the fresh target unchanged" );

    }
};

done_testing;

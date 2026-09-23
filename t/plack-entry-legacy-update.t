#!/usr/bin/perl
# Characterize retained legacy /update posting forms before the beta route is retired.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use URI;
use Scalar::Util qw(refaddr);
use HTML::Form;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);

plan skip_all => 'Legacy update integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub update_form {
    my ($content) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost/update' )
    )[0];
}

sub fresh_entry {
    my ( $owner, $jitemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $owner, jitemid => $jitemid );
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $owner_id = $owner->id;
my $session  = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyUpdateContract';

ok( !LJ::BetaFeatures->user_in_beta( $owner => 'updatepage' ),
    'disposable owner is outside the updatepage beta and reaches the retained BML form' );

test_psgi $app, sub {
    my $send    = shift;
    my $request = sub {
        my ($req) = @_;
        $req->header( Cookie => $cookie );
        return $send->($req);
    };

    for my $index ( 0, 1 ) {
        my $path = $index ? '/update.bml' : '/update';
        my $res  = $request->( GET $path );
        is( $res->code, 200, "$path renders the retained legacy form outside beta" );
        unlike( $res->header('Location') || '', qr{/entry/new}, "$path is not beta-redirected" );
        my $form = update_form( $res->content );
        ok( $form, "$path renders the actual legacy update form" ) or next;

        for my $name (
            qw(subject event security prop_taglist prop_current_location prop_current_music lj_form_auth)
            )
        {
            ok( $form->find_input($name), "$path legacy form contains $name" );
        }
        ok( $form->find_input('action:update'), "$path has its actual update submit control" );
        is( $form->value('security'),
            'public', "$path starts with legacy public security selected" );

        my ($before_count) = $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
            undef, $owner_id );
        $form->action( 'http://localhost' . $path );
        $form->value( subject               => "Legacy $index private subject" );
        $form->value( event                 => "Legacy $index private body" );
        $form->value( security              => 'private' );
        $form->value( prop_taglist          => "legacy-$index-one, legacy-$index-two" );
        $form->value( prop_current_location => "Legacy $index location" );
        $form->value( prop_current_music    => "Legacy $index music" );
        my $post = $form->click('action:update');
        $post->uri( 'http://localhost' . $path );
        $post->header( Referer => 'http://localhost' . $path );
        my ( @success_hooks, $decoded_request, @hook_order, $spam_request, $spam_count );
        my $run_hooks = \&LJ::Hooks::run_hooks;
        my $run_hook  = \&LJ::Hooks::run_hook;
        {
            no warnings 'redefine';
            local *LJ::Hooks::run_hooks = sub {
                my ( $name, @args ) = @_;
                if ( $name eq 'decode_entry_form' ) {
                    $decoded_request = $args[1];
                    push @hook_order, 'decode';
                }
                if ( $name eq 'spam_check' ) {
                    $spam_request = $args[1];
                    push @hook_order, 'spam';
                    ($spam_count) =
                        $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
                        undef, $owner_id );
                }
                if ( $name eq 'after_entry_post_extra_options' ) {
                    push @hook_order, 'options';
                    push @success_hooks, [ $name, {@args} ];
                    return ['<li>Legacy hook option marker</li>'];
                }
                return $run_hooks->(@_);
            };
            local *LJ::Hooks::run_hook = sub {
                my ( $name, @args ) = @_;
                if ( $name eq 'after_entry_post_extra_html' ) {
                    push @hook_order, 'html';
                    push @success_hooks, [ $name, {@args} ];
                    return '<p>Legacy hook HTML marker</p>';
                }
                return $run_hook->(@_);
            };
            $res = $request->($post);
        }
        is_deeply(
            \@hook_order,
            [qw(decode spam options html)],
            "$path retains legacy decoder and post-attempt hook order"
        );
        is(
            $spam_count,
            $before_count + 1,
            "$path legacy spam hook observes the already-saved entry"
        );
        is(
            refaddr($spam_request),
            refaddr($decoded_request),
            "$path spam hook receives the original flat decoder request"
        );
        is_deeply(
            [ map { $_->[0] } @success_hooks ],
            [qw(after_entry_post_extra_options after_entry_post_extra_html)],
            "$path invokes both success hooks in the retained order"
        );
        like( $res->content, qr/Legacy hook option marker/, "$path renders extra hook option" );
        like( $res->content, qr/Legacy hook HTML marker/,   "$path renders extra hook HTML" );
        if ( @success_hooks == 2 ) {
            my $options = $success_hooks[0][1];
            my $html    = $success_hooks[1][1];
            is( $options->{user}->id, $owner_id, "$path option hook receives target journal" );
            is( $html->{user}->id,    $owner_id, "$path HTML hook receives target journal" );
            is( $html->{itemlink}, $options->{itemlink}, "$path hooks share the exact entry URL" );
            like( $html->{itemlink}, qr/\.html$/, "$path hook URL names the saved entry" );
            is(
                refaddr( $html->{request} ),
                refaddr($decoded_request),
                "$path success hook receives the original decoder request reference"
            );
            is(
                $html->{request}{prop_current_location},
                "Legacy $index location",
                "$path success hook retains flat legacy properties"
            );
        }
        is( $res->code, 200, "$path direct valid legacy POST returns a response" );
        like(
            $res->content,
            qr/(?:updated|posted|success)/i,
            "$path direct valid legacy POST has a meaningful success body"
        );

        my $fresh_owner = LJ::load_userid( $owner_id, 1 );
        my ($after_count) =
            $fresh_owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
            undef, $owner_id );
        is( $after_count, $before_count + 1,
            "$path direct POST creates exactly one private entry" );
        my ($jitemid) = $fresh_owner->selectrow_array(
            'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
            undef, $owner_id );
        my $entry = fresh_entry( $fresh_owner, $jitemid );
        ok( $entry, "$path newly created entry loads from fresh state" ) or next;
        is( $entry->security, 'private', "$path preserves private security" );
        is( $entry->subject_raw, "Legacy $index private subject", "$path preserves exact subject" );
        is( $entry->event_raw,   "Legacy $index private body",    "$path preserves exact body" );
        is_deeply(
            [ sort $entry->tags ],
            [ "legacy-$index-one", "legacy-$index-two" ],
            "$path preserves tags through prop_taglist"
        );
        is(
            $entry->prop('current_location'),
            "Legacy $index location",
            "$path preserves prop_current_location"
        );
        is(
            $entry->prop('current_music'),
            "Legacy $index music",
            "$path preserves prop_current_music"
        );
    }

    {
        no warnings 'redefine';
        local *LJ::BetaFeatures::user_in_beta = sub { 1 };
        my @query = (
            subject      => 'Encoded subject & punctuation',
            prop_taglist => 'first tag, second/tag',
            repeated     => 'first value',
            repeated     => 'second/value',
        );
        my $expected_query = {
            subject      => ['Encoded subject & punctuation'],
            prop_taglist => ['first tag, second/tag'],

            # LJ::parse_args retains repeated legacy query values in one NUL-delimited scalar.
            repeated => ["first value\0second/value"],
        };

        for my $path ( '/update', '/update.bml' ) {
            my $source = URI->new("http://localhost$path");
            $source->query_form(@query);
            my $res = $request->( GET $source->path_query );
            is( $res->code, 302, "$path beta GET redirects to the native editor" );

            my $destination = URI->new_abs( $res->header('Location') || '', 'http://localhost' );
            is( $destination->path, '/entry/new',
                "$path beta GET retains the native editor destination" );
            my %actual_query;
            my @destination_query = $destination->query_form;
            while (@destination_query) {
                my ( $name, $value ) = splice @destination_query, 0, 2;
                push @{ $actual_query{$name} }, $value;
            }
            is_deeply( \%actual_query, $expected_query,
                "$path beta GET preserves encoded and repeated query arguments" );
        }
    }
};

done_testing;

#!/usr/bin/perl
# Exercise the callable ordinary-owner legacy update adapter through test-only aliases.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use URI;
use Scalar::Util qw(refaddr);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);
use LJ::Userpic;
use Plack::Middleware::DW::RequestWrapper;

plan skip_all => 'Legacy update adapter integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

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

my $legacy_app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $legacy_app eq 'CODE';

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $owner_id = $owner->id;
my $userpic =
    LJ::Userpic->create( $owner, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
ok( $userpic, 'disposable owner userpic is created' )
    or BAIL_OUT('cannot exercise legacy update userpic field');
$userpic->set_keywords('legacy-update-pic');

my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyUpdateAdapter';

my @adapter_paths;
my @adapter_altlogin;
my $adapter_app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        push @adapter_paths,    $r->uri;
        push @adapter_altlogin, $r->get_args->{altlogin};
        LJ::set_remote($owner);
        my $render = DW::Controller::Entry::legacy_update_handler( remote => $owner );
        if ( !defined $render ) {
            $r->status(418);
            $r->print('retained BML fallback marker');
        }
        else {
            $r->status(200);
        }
        return $r->res;
    }
);

my ($entries_before) =
    $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $owner_id );

for my $index ( 0, 1 ) {
    my $path = $index ? '/update.bml' : '/update';
    my $legacy_form;
    test_psgi $legacy_app, sub {
        my $send = shift;
        my $res  = $send->( GET $path, Cookie => $cookie );
        is( $res->code, 200, "$path renders the retained old-schema form" );
        $legacy_form = update_form( $res->content );
        ok( $legacy_form, "$path provides its actual update form" )
            or BAIL_OUT('retained update form missing');
    };

    for my $field (
        qw(subject event security prop_taglist prop_current_location prop_current_music
        prop_picture_keyword date_ymd_mm date_ymd_dd date_ymd_yyyy hour min
        switched_rte_on lj_form_auth action:update)
        )
    {
        ok( $legacy_form->find_input($field), "$path old form contains $field" );
    }

    $legacy_form->action( 'http://localhost' . $path );
    $legacy_form->value( subject               => "Adapter $index exact subject" );
    $legacy_form->value( event                 => "<p>Adapter $index exact body</p>" );
    $legacy_form->value( security              => 'private' );
    $legacy_form->value( prop_taglist          => "adapter-$index-one, adapter-$index-two" );
    $legacy_form->value( prop_current_location => "Adapter $index location" );
    $legacy_form->value( prop_current_music    => "Adapter $index music" );
    $legacy_form->value( prop_picture_keyword  => 'legacy-update-pic' );
    $legacy_form->value( date_ymd_mm           => '02' );
    $legacy_form->value( date_ymd_dd           => '03' );
    $legacy_form->value( date_ymd_yyyy         => '2020' );
    $legacy_form->value( hour                  => '04' );
    $legacy_form->value( min                   => '05' );
    $legacy_form->value( switched_rte_on       => 1 );
    $legacy_form->value( date_diff             => 1 ) if $legacy_form->find_input('date_diff');
    my $post = $legacy_form->click('action:update');
    $post->uri( 'http://localhost' . $path );
    $post->header( Referer => 'http://localhost' . $path );

    my ( $decoded_request, $spam_request, @hook_order, @success_hooks );
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
            elsif ( $name eq 'spam_check' ) {
                $spam_request = $args[1];
                push @hook_order, 'spam';
            }
            elsif ( $name eq 'after_entry_post_extra_options' ) {
                push @hook_order, 'options';
                push @success_hooks, [ $name, {@args} ];
                return ['<li>Adapter hook option marker</li>'];
            }
            return $run_hooks->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            if ( $name eq 'after_entry_post_extra_html' ) {
                push @hook_order, 'html';
                push @success_hooks, [ $name, {@args} ];
                return '<p>Adapter hook HTML marker</p>';
            }
            return $run_hook->(@_);
        };
        test_psgi $adapter_app, sub {
            my $send = shift;
            my $res  = $send->($post);
            is( $res->code, 200, "$path ordinary authenticated owner post is handled" );
            like( $res->content, qr/successlinks/,
                "$path handled response is the native success template" );
            unlike(
                $res->content,
                qr/retained BML fallback marker/,
                "$path ordinary post does not fall back to BML"
            );
            like(
                $res->content,
                qr/Adapter hook option marker/,
                "$path native success includes retained legacy option hook output"
            );
            like(
                $res->content,
                qr/Adapter hook HTML marker/,
                "$path native success includes retained legacy HTML hook output"
            );
        };
    }
    is_deeply(
        \@hook_order,
        [qw(decode spam options html)],
        "$path keeps decoder, post-attempt, and success hooks in legacy order"
    );
    is(
        refaddr($spam_request),
        refaddr($decoded_request),
        "$path post-attempt hook receives the original flat decoder request"
    );
    is_deeply(
        [ map { $_->[0] } @success_hooks ],
        [qw(after_entry_post_extra_options after_entry_post_extra_html)],
        "$path calls retained success hooks in order"
    );
    is(
        refaddr( $success_hooks[1][1]{request} ),
        refaddr($decoded_request),
        "$path success hook receives the original flat decoder request"
    );
    is(
        $success_hooks[1][1]{request}{prop_current_location},
        "Adapter $index location",
        "$path success hook retains legacy flat metadata"
    );

    my $fresh_owner = LJ::load_userid( $owner_id, 1 );
    my ($jitemid) = $fresh_owner->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $owner_id );
    my $entry = fresh_entry( $fresh_owner, $jitemid );
    ok( $entry, "$path handled post persists an entry" ) or next;
    is( $entry->subject_raw, "Adapter $index exact subject", "$path persists exact subject" );
    is( $entry->event_raw, "<p>Adapter $index exact body</p>", "$path persists exact body" );
    is( $entry->security, 'private', "$path persists private security" );
    is_deeply(
        [ sort $entry->tags ],
        [ "adapter-$index-one", "adapter-$index-two" ],
        "$path persists exact tags"
    );
    is( $entry->prop('current_location'), "Adapter $index location", "$path persists location" );
    is( $entry->prop('current_music'),    "Adapter $index music",    "$path persists music" );
    is( $entry->userpic_kw,       'legacy-update-pic',   "$path persists userpic keyword" );
    is( $entry->prop('used_rte'), 1,                     "$path persists legacy RTE marker" );
    is( $entry->eventtime_mysql,  '2020-02-03 04:05:00', "$path persists submitted legacy date" );
}

sub post_to_adapter {
    my ( $path, %fields ) = @_;
    my $request = POST( $path, [%fields] );
    $request->header( Referer => 'http://localhost' . $path );
    return $request;
}

my ($entries_after_success) =
    $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $owner_id );
is( $entries_after_success, $entries_before + 2, 'two handled aliases create exactly two entries' );

for my $case (
    [
        invalid_token =>
            { 'action:update' => 'Update', lj_form_auth => 'invalid', event => 'bad token body' }
    ],
    [ empty_body => { 'action:update' => 'Update', lj_form_auth => LJ::form_auth(), event => '' } ],
    [ transform => { transform => 1, 'action:update' => 'Update', event => 'transform body' } ],
    [ preview => { 'action:preview' => 'Preview', event => 'preview body' } ],
    [ showform => { showform => 1, 'action:update' => 'Update', event => 'showform body' } ],
    [ moreopts => { moreoptsbtn => 1, 'action:update' => 'Update', event => 'moreopts body' } ],
    [
        community => {
            usejournal      => 'other-journal',
            'action:update' => 'Update',
            event           => 'community body'
        }
    ],
    [ altlogin => { 'action:update' => 'Update', event => 'altlogin body' }, '/update?altlogin=1' ],
    )
{
    my ( $name, $fields, $case_path ) = @$case;
    $case_path ||= '/update';
    my $res;
    test_psgi $adapter_app, sub {
        my $send = shift;
        $res = $send->( post_to_adapter( $case_path, %$fields ) );
    };
    if ( $name eq 'invalid_token' || $name eq 'empty_body' ) {
        is( $res->code, 200, "$name gets a native error rerender" );
        like( $res->content, qr/id="js-post-entry"/, "$name response uses the shared native form" );
    }
    else {
        is( $res->code, 418, "$name remains outside the callable adapter slice" );
        like(
            $res->content,
            qr/retained BML fallback marker/,
            "$name preserves BML fallback boundary"
        );
    }
    my $fresh_owner = LJ::load_userid( $owner_id, 1 );
    my ($count) = $fresh_owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
        undef, $owner_id );
    is( $count, $entries_after_success, "$name cannot create an entry" );
}

my $missing_referer = POST(
    '/update',
    [
        'action:update' => 'Update',
        security        => 'public',
        subject         => 'Missing referer subject',
        event           => 'Missing referer body',
        lj_form_auth    => LJ::form_auth(),
    ]
);
my $missing_referer_res;
test_psgi $adapter_app, sub {
    my $send = shift;
    $missing_referer_res = $send->($missing_referer);
};
is( $missing_referer_res->code, 200, 'missing referer gets a native error rerender' );
like( $missing_referer_res->content,
    qr/id="js-post-entry"/, 'missing referer preserves the shared native retry form' );
my $fresh_after_missing_referer = LJ::load_userid( $owner_id, 1 );
my ($count_after_missing_referer) =
    $fresh_after_missing_referer->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
    undef, $owner_id );
is( $count_after_missing_referer, $entries_after_success,
    'missing referer cannot create an entry' );

is_deeply(
    [ grep { $_ eq '/update' || $_ eq '/update.bml' } @adapter_paths ],
    [ '/update', '/update.bml', ('/update') x 9 ],
    'test-only routing invokes the callable adapter at both old aliases and guarded cases'
);
ok( grep( { defined $_ && $_ eq '1' } @adapter_altlogin ),
    'test-only routing passes the alternate-login query to the callable adapter' );

done_testing;

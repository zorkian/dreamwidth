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
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use lib "$ENV{LJHOME}/t/lib";

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);
use LJ::Userpic;
use LJ::Test::LegacyOwnedEditRoute;
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
my $production_update_route = $DW::Routing::string_choices{'app/update'};

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->create_trust_group( groupname => 'Legacy adapter custom group' );
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
my $valid_form_auth;
my $adapter_app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        push @adapter_paths,    $r->uri;
        push @adapter_altlogin, $r->get_args->{altlogin};
        LJ::set_remote($owner);
        my $render = DW::Controller::Entry::legacy_update_handler(
            remote             => $owner,
            include_transforms => 1
        );
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
        my $res;
        LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route( 'app/update',
            sub { $res = $send->( GET $path, Cookie => $cookie ); } );
        is( $res->code, 200, "$path renders the retained old-schema form" );
        $legacy_form = update_form( $res->content );
        $valid_form_auth ||= $legacy_form->value('lj_form_auth') if $legacy_form;
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
    $legacy_form->value( date_diff             => 1 )
        if $index && $legacy_form->find_input('date_diff');
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
    my %expected_seed = (
        mode       => 'postevent',
        ver        => $LJ::PROTOCOL_VER,
        user       => $owner->user,
        password   => $legacy_form->value('password'),
        usejournal => $legacy_form->value('usejournal'),
        xpost      => '0',
    );
    for my $request_name (
        [ decode  => $decoded_request ],
        [ spam    => $spam_request ],
        [ success => $success_hooks[1][1]{request} ],
        )
    {
        my ( $name, $request ) = @$request_name;
        for my $field ( sort keys %expected_seed ) {
            ok( exists $request->{$field}, "$path $name request retains legacy $field seed" );
            is( $request->{$field}, $expected_seed{$field},
                "$path $name request preserves exact legacy $field value" );
        }
        ok( !exists $request->{tz},
            "$path $name request removes the legacy timezone seed after submitted date controls" );

    }

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
    [
        empty_body => { 'action:update' => 'Update', lj_form_auth => $valid_form_auth, event => '' }
    ],
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
    my ( $decode_count, $spam_count, $res ) = ( 0, 0 );
    my $run_hooks = \&LJ::Hooks::run_hooks;
    {
        no warnings 'redefine';
        local *LJ::Hooks::run_hooks = sub {
            my ($hook_name) = @_;
            $decode_count++ if $hook_name eq 'decode_entry_form';
            $spam_count++   if $hook_name eq 'spam_check';
            return $run_hooks->(@_);
        };
        test_psgi $adapter_app, sub {
            my $send = shift;
            $res = $send->( post_to_adapter( $case_path, %$fields ) );
        };
    }
    if ( $name eq 'empty_body' ) {
        is( $res->code, 200, "$name gets a native error rerender" );
        like( $res->content, qr/id="js-post-entry"/, "$name response uses the shared native form" );
        is( $decode_count, 1, "$name invokes the legacy decoder once" );
        is( $spam_count,   1, "$name invokes post-attempt spam once" );
    }
    elsif ( $name =~ /^(?:transform|preview|showform|moreopts)$/ ) {
        is( $res->code, 200, "$name gets a native nonpersisting rerender" );
        like( $res->content, qr/id="js-post-entry"/, "$name response uses the shared native form" );
        unlike( $res->content, qr/retained BML fallback marker/,
            "$name does not fall back to BML" );
        is( $decode_count, 0, "$name does not invoke the legacy decoder" );
        is( $spam_count,   0, "$name does not invoke post-attempt spam" );
    }
    else {
        is( $res->code, 418, "$name remains outside the callable adapter slice" );
        like(
            $res->content,
            qr/retained BML fallback marker/,
            "$name preserves BML fallback boundary"
        );
        if ( $name eq 'invalid_token' ) {
            is( $decode_count, 0, 'invalid token invokes no decoder hook' );
            is( $spam_count,   0, 'invalid token invokes no post-attempt spam hook' );
        }
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
        lj_form_auth    => $valid_form_auth,
    ]
);
$missing_referer->header( Referer => 'http://untrusted.invalid/update' );
my $missing_referer_res;
test_psgi $adapter_app, sub {
    my $send = shift;
    $missing_referer_res = $send->($missing_referer);
};
is( $missing_referer_res->code, 418, 'untrusted referer falls through before hook-bearing decode' );
like(
    $missing_referer_res->content,
    qr/retained BML fallback marker/,
    'untrusted referer retains the BML fallback boundary'
);
my $fresh_after_missing_referer = LJ::load_userid( $owner_id, 1 );
my ($count_after_missing_referer) =
    $fresh_after_missing_referer->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
    undef, $owner_id );
is( $count_after_missing_referer, $entries_after_success,
    'untrusted referer cannot create an entry' );

is_deeply(
    [ grep { $_ eq '/update' || $_ eq '/update.bml' } @adapter_paths ],
    [ '/update', '/update.bml', ('/update') x 9 ],
    'test-only routing invokes the callable adapter at both old aliases and guarded cases'
);
ok( grep( { defined $_ && $_ eq '1' } @adapter_altlogin ),
    'test-only routing passes the alternate-login query to the callable adapter' );

# Community and moderation remain callable-only coverage: the test wrapper is
# deliberately the only route that invokes the adapter.
sub entry_count {
    my ($user) = @_;
    my $fresh = LJ::load_userid( $user->id, 1 );
    return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $fresh->id );
}

sub moderation_count {
    my ($community) = @_;
    my $dbcm = LJ::get_cluster_master($community);
    return $dbcm->selectrow_array( 'SELECT COUNT(*) FROM modlog WHERE journalid=?',
        undef, $community->id );
}

sub latest_moderation {
    my ($community) = @_;
    my $dbcm = LJ::get_cluster_master($community);
    my ( $posterid, $frozen ) = $dbcm->selectrow_array(
        'SELECT l.posterid, b.request_stor FROM modlog l JOIN modblob b '
            . 'ON b.journalid=l.journalid AND b.modid=l.modid '
            . 'WHERE l.journalid=? ORDER BY l.modid DESC LIMIT 1',
        undef, $community->id
    );
    return unless defined $posterid;
    return { posterid => $posterid, request => thaw($frozen) };
}

sub retained_form {
    my ( $path, $label ) = @_;
    my $form;
    test_psgi $legacy_app, sub {
        my $send = shift;
        my $res;
        LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route( 'app/update',
            sub { $res = $send->( GET $path, Cookie => $cookie ); } );
        is( $res->code, 200, "$label retained form GET succeeds" );
        $form = update_form( $res->content );
    };
    ok( $form, "$label retains an actual old update form" ) or return;
    return $form;
}

sub adapter_post {
    my ( $form, $path, $label ) = @_;
    my $post = $form->click('action:update');
    $post->uri( 'http://localhost' . $path );
    $post->header( Referer => 'http://localhost' . $path );
    my $res;
    test_psgi $adapter_app, sub { $res = shift->($post); };
    is( $res->code, 200, "$label callable adapter handles the retained POST" );
    unlike( $res->content, qr/retained BML fallback marker/, "$label does not fall back to BML" );
    return $res;
}

my $community = temp_comm();
LJ::set_rel( $community, $owner, 'P' );
ok( $owner->can_post_to($community), 'owner can post to disposable community' );
my $community_before       = entry_count($community);
my $owner_before_community = entry_count($owner);
my $community_path         = '/update?usejournal=' . $community->user;
my $community_form         = retained_form( $community_path, 'authorized community' );
my $community_response;

if ($community_form) {
    is( $community_form->value('usejournal'),
        $community->user, 'retained community form carries its submitted target' );
    $community_form->value( subject               => 'Adapter community subject' );
    $community_form->value( event                 => '<p>Adapter community body</p>' );
    $community_form->value( security              => 'public' );
    $community_form->value( prop_current_location => 'Adapter community location' );
    $community_form->value( switched_rte_on       => 1 );
    ok( $community_form->find_input('prop_xpost_check'),
        'retained community form exposes its crosspost master checkbox' );
    $community_form->value( prop_xpost_check => 1 );
    my ( $decoded, $spam, $success );
    my $run_hooks = \&LJ::Hooks::run_hooks;
    my $run_hook  = \&LJ::Hooks::run_hook;
    {
        no warnings 'redefine';
        local *LJ::Protocol::schedule_xposts = sub {
            die 'community adapter must not schedule owner crossposts';
        };
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @args ) = @_;
            $decoded = $args[1] if $name eq 'decode_entry_form';
            $spam    = $args[1] if $name eq 'spam_check';
            return $run_hooks->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            $success = {@args} if $name eq 'after_entry_post_extra_html';
            return $run_hook->(@_);
        };
        my $res = adapter_post( $community_form, $community_path, 'authorized community' );
        $community_response = $res->content;
        like(
            $res->content,
            qr/\Q$community->{user}\E|my entries/i,
            'community response retains community success context'
        );
    }
    is(
        entry_count($community),
        $community_before + 1,
        'community post creates one community entry'
    );
    is( entry_count($owner), $owner_before_community, 'community post creates no owner entry' );
    my $fresh_community = LJ::load_userid( $community->id, 1 );
    my ($community_jitemid) = $fresh_community->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $community->id );
    my $community_entry =
        $community_jitemid
        ? fresh_entry( $fresh_community, $community_jitemid )
        : undef;
    ok( $community_entry, 'community post creates a loadable community entry' )
        or diag( 'community response: '
            . ( $community_response // '' )
            . '; moderation count: '
            . moderation_count($community) );
    if ($community_entry) {
        is( $community_entry->posterid,
            $owner->id, 'community entry preserves the authenticated poster' );
        is(
            $community_entry->subject_raw,
            'Adapter community subject',
            'community entry persists subject'
        );
        is(
            $community_entry->event_raw,
            '<p>Adapter community body</p>',
            'community entry persists RTE body'
        );
        is(
            $community_entry->prop('current_location'),
            'Adapter community location',
            'community entry persists metadata'
        );
        is( $community_entry->prop('used_rte'), 1, 'community entry preserves RTE marker' );
    }
    is( refaddr($decoded), refaddr($spam), 'community spam hook receives decoded flat request' );
    is(
        refaddr($decoded),
        refaddr( $success->{request} ),
        'community success hook receives decoded flat request'
    );
    is( $success->{request}{usejournal},
        $community->user, 'community hooks receive submitted target seed' );
    for my $request ( $decoded, $spam, $success->{request} ) {
        is( $request->{mode}, 'postevent', 'community hook request retains legacy mode seed' );
        is( $request->{ver}, $LJ::PROTOCOL_VER,
            'community hook request retains legacy protocol version' );
        is( $request->{user}, $owner->user, 'community hook request retains legacy owner seed' );
        is(
            $request->{password},
            $community_form->value('password'),
            'community hook request retains submitted password seed'
        );
        is( $request->{xpost}, '0', 'community hook request retains disabled xpost seed' );
    }
}

my $other_community = temp_comm();
LJ::set_rel( $other_community, $owner, 'P' );
ok( $owner->can_post_to($other_community), 'owner can post to second disposable community' );
my $differing_form = retained_form( $community_path, 'differing POST community target' );
if ($differing_form) {
    $differing_form->value( subject    => 'Adapter differing target subject' );
    $differing_form->value( event      => 'Adapter differing target body' );
    $differing_form->value( security   => 'public' );
    $differing_form->value( usejournal => $other_community->user );
    my ( $first_before, $second_before ) =
        ( entry_count($community), entry_count($other_community) );
    adapter_post( $differing_form, $community_path, 'differing POST community target' );
    is( entry_count($community), $first_before,
        'nonempty submitted target does not use the differing GET community' );
    is(
        entry_count($other_community),
        $second_before + 1,
        'nonempty submitted target beats the differing GET community'
    );
}

# POST owns target selection: an explicit empty field and an absent field both
# select the owner, regardless of a community-valued query string.
for my $case ( [ explicit_empty => '' ], [ absent => undef ], ) {
    my ( $label, $target ) = @$case;
    my $form = retained_form( $community_path, "$label owner precedence" ) or next;
    $form->value( subject => "Adapter $label owner subject" );
    $form->value( event   => "Adapter $label owner body" );
    if ( defined $target ) {
        $form->value( usejournal => $target );
    }
    else {
        $form->find_input('usejournal')->disabled(1);
    }
    my $before_owner     = entry_count($owner);
    my $before_community = entry_count($community);
    adapter_post( $form, $community_path, "$label owner precedence" );
    is( entry_count($owner), $before_owner + 1, "$label POST selects owner" );
    is( entry_count($community), $before_community,
        "$label POST does not use GET community target" );
}

for my $target ( 'does-not-exist', $community->user ) {
    my $form = retained_form( '/update', "target $target fallback" ) or next;
    $form->value( subject    => "Adapter rejected $target subject" );
    $form->value( event      => "Adapter rejected $target body" );
    $form->value( usejournal => $target );
    if ( $target eq $community->user ) {
        LJ::clear_rel( $community, $owner, 'P' );
        ok( !$owner->can_post_to($community), 'community target is denied before callable POST' );
    }
    my ( $before_owner, $before_community ) = ( entry_count($owner), entry_count($community) );
    my $post = $form->click('action:update');
    $post->uri('http://localhost/update');
    $post->header( Referer => 'http://localhost/update' );
    my $res;
    test_psgi $adapter_app, sub { $res = shift->($post); };
    is( $res->code, 418, "target $target remains BML fallback" );
    is( entry_count($owner), $before_owner,
        "target $target cannot fall back to owner persistence" );
    is( entry_count($community), $before_community,
        "target $target cannot persist community data" );
}

my $moderated = temp_comm();
$moderated->set_prop( moderated => 1 );
LJ::set_rel( $moderated, $owner, 'P' );
ok( $owner->can_post_to($moderated), 'owner can submit to disposable moderated community' );
$owner->set_draft_text('Adapter moderation draft body');
$owner->set_prop(
    draft_properties => nfreeze( { subject => 'Adapter moderation draft subject' } ) );
my $moderated_path = '/update?usejournal=' . $moderated->user;
my $moderated_form = retained_form( $moderated_path, 'moderated community' );

if ($moderated_form) {
    $moderated_form->value( subject               => 'Adapter moderated subject' );
    $moderated_form->value( event                 => '<p>Adapter moderated body</p>' );
    $moderated_form->value( prop_current_location => 'Adapter moderated location' );
    my $before = moderation_count($moderated);
    my ( $decoded, $spam, @success );
    my $run_hooks = \&LJ::Hooks::run_hooks;
    my $run_hook  = \&LJ::Hooks::run_hook;
    {
        no warnings 'redefine';
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @args ) = @_;
            $decoded = $args[1] if $name eq 'decode_entry_form';
            $spam    = $args[1] if $name eq 'spam_check';
            return $run_hooks->(@_);
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            push @success, {@args} if $name eq 'after_entry_post_extra_html';
            return $run_hook->(@_);
        };
        my $res = adapter_post( $moderated_form, $moderated_path, 'moderated community' );
        like(
            $res->content,
            qr/(?:moderation|moderated|approval|queue)/i,
            'moderated community receives a meaningful moderation response'
        );
    }
    is(
        moderation_count($moderated),
        $before + 1,
        'moderated community creates one moderation request'
    );
    my $stored = latest_moderation($moderated);
    is( $stored->{posterid},            $owner->id,       'moderation retains poster' );
    is( $stored->{request}{usejournal}, $moderated->user, 'moderation retains submitted target' );
    is( $stored->{request}{event}, '<p>Adapter moderated body</p>', 'moderation retains body' );
    is( refaddr($decoded), refaddr($spam), 'moderation spam hook receives decoded flat request' );
    is( scalar @success, 1, 'moderation calls only legacy HTML success hook' );
    is( $success[0]{user}, undef, 'moderation success hook has no published journal link context' );
    is( refaddr( $success[0]{request} ),
        refaddr($decoded), 'moderation success hook retains decoded request identity' );

    for my $request ( $decoded, $spam, $success[0]{request} ) {
        is( $request->{mode}, 'postevent', 'moderation hook request retains legacy mode seed' );
        is( $request->{ver}, $LJ::PROTOCOL_VER,
            'moderation hook request retains legacy protocol version' );
        is( $request->{user}, $owner->user, 'moderation hook request retains legacy owner seed' );
        is(
            $request->{password},
            $moderated_form->value('password'),
            'moderation hook request retains submitted password seed'
        );
        is( $request->{usejournal},
            $moderated->user, 'moderation hook request retains submitted community seed' );
        is( $request->{xpost}, '0', 'moderation hook request retains disabled xpost seed' );
    }
    is( entry_count($moderated), 0, 'moderated submission creates no published community entry' );
    my $fresh_owner = LJ::load_userid( $owner->id, 1 );
    is( $fresh_owner->draft_text, '', 'moderated submission clears draft body' );
    is_deeply(
        thaw( $fresh_owner->prop('draft_properties') ),
        { subject => 'Adapter moderation draft subject' },
        'moderated submission retains draft properties'
    );
}

# Callable-only transform ABI: start from an actual retained form/token, then
# invoke two distinct external transform names through the adapter wrapper.
my $transform_uri =
    '/update?usejournal=' . $owner->user . '&encoded=a%2Fb%26c&repeated=one&repeated=two';
my $transform_form;
test_psgi $legacy_app, sub {
    my $send = shift;
    my $res  = $send->( GET $transform_uri, Cookie => $cookie );
    is( $res->code, 200, 'transform baseline renders retained form' );
    $transform_form = update_form( $res->content );
};
ok( $transform_form, 'transform uses a real retained form token' )
    or BAIL_OUT('missing transform form');
my $transform_token          = $transform_form->value('lj_form_auth');
my $before_transform_entries = entry_count($owner);
my $before_transform_draft   = LJ::load_userid( $owner_id, 1 )->draft_text;
for my $case (
    [ alpha => 'alpha subject', 'alpha body', 'alpha-tag' ],
    [ beta  => 'beta subject',  'beta body',  'beta-tag' ]
    )
{
    my ( $name, $subject, $body, $tag ) = @$case;
    my $post = POST(
        $transform_uri,
        [
            transform              => $name,
            lj_form_auth           => $transform_token,
            subject                => 'submitted ignored subject',
            event                  => 'submitted ignored body',
            prop_taglist           => 'submitted ignored tag',
            security               => 'custom',
            custom_bit_1           => 1,
            prop_current_location  => 'submitted location',
            prop_current_music     => 'submitted music',
            prop_opt_backdated     => 1,
            date_ymd_mm            => '02',
            date_ymd_dd            => '03',
            date_ymd_yyyy          => '2020',
            hour                   => '04',
            min                    => '05',
            date_diff              => 1,
            prop_xpost_check       => 1,
            prop_xpost_99          => 1,
            prop_xpost_password_99 => 'xpost-secret',
            event_format           => 'preformatted',
            richtext_default       => '0',
        ]
    );
    $post->header( Referer => 'http://localhost/update' );
    my ( $hook_get, $hook_post, $decode, $spam, $success, $crosspost, $calls ) =
        ( undef, undef, 0, 0, 0, 0, 0 );
    my $run_hooks = \&LJ::Hooks::run_hooks;
    my $run_hook  = \&LJ::Hooks::run_hook;
    {
        no warnings 'redefine';
        local *LJ::Hooks::run_hooks = sub {
            my ( $hook, @args ) = @_;
            if ( $hook eq "transform_update_$name" ) {
                ++$calls;
                ( $hook_get, $hook_post ) = @args;
                $hook_post->{subject}             = $subject;
                $hook_post->{event}               = $body;
                $hook_post->{prop_taglist}        = $tag;
                $hook_get->{unused_transform_get} = "get-$name";
                return;
            }
            ++$decode if $hook eq 'decode_entry_form';
            ++$spam   if $hook eq 'spam_check';
            return $run_hooks->( $hook, @args );
        };
        local *LJ::Hooks::run_hook = sub {
            my ($hook) = @_;
            ++$success if $hook eq 'after_entry_post_extra_html';
            return $run_hook->(@_);
        };
        local *LJ::Protocol::schedule_xposts = sub { ++$crosspost; return ( [], [] ); };
        my $res;
        test_psgi $adapter_app, sub { $res = shift->($post); };
        is( $res->code, 200, "$name transform returns native rerender" );
        my $form = (
            grep {
                       ( $_->attr('id') || '' ) eq 'js-post-entry'
                    && $_->find_input('subject')
                    && $_->find_input('event')
            } HTML::Form->parse( $res->content, 'http://localhost/entry/new' )
        )[0];
        ok( $form, "$name transform returns parsed native form" ) or next;
        is( $form->value('subject'), $subject, "$name hook mutation retains subject" );
        is( $form->value('event'),   $body,    "$name hook mutation retains body" );
        is( $form->value('taglist'), $tag,     "$name hook mutation retains tags" );
        is( $form->value('current_location'),
            '', "$name ignores transform metadata outside retained fallback fields" );
        is( $form->value('editor'), 'html_raw0', "$name retains event formatting" );
        like(
            $form->action,
            qr/encoded=a%2Fb%26c.*repeated=one.*repeated=two/,
            "$name retains encoded/repeated query context"
        );
    }
    is( $calls,                  1,            "$name invokes its dynamic transform hook once" );
    is( $hook_post->{transform}, $name,        "$name hook receives mutable flat POST" );
    is( $hook_get->{usejournal}, $owner->user, "$name hook receives mutable flat GET" );
    is( $decode,                 0,            "$name does not invoke decode hook" );
    is( $spam,                   0,            "$name does not invoke spam hook" );
    is( $success,                0,            "$name does not invoke success hook" );
    is( $crosspost,              0,            "$name does not schedule crossposts" );
    is( entry_count($owner), $before_transform_entries, "$name does not persist entries" );
    is( LJ::load_userid( $owner_id, 1 )->draft_text,
        $before_transform_draft, "$name does not change drafts" );
}

# Spellcheck is also callable-only here: a configured checker and a checker
# that disappears after form render both rerender without save-side hooks.
my $spell_form = retained_form( '/update', 'callable spellcheck' );
if ($spell_form) {
    $spell_form->value( subject => 'callable spellcheck subject' );
    $spell_form->value( event   => 'callable misspell body' );
    my $spell_post = POST(
        '/update',
        [
            'action:spellcheck' => 'Spell Check',
            lj_form_auth        => $spell_form->value('lj_form_auth'),
            subject             => 'callable spellcheck subject',
            event               => 'callable misspell body',
            security            => 'public',
        ]
    );
    $spell_post->header( Referer => 'http://localhost/update' );
    my ( $checked, $decode, $spam, $options, $html ) = ( 0, 0, 0, 0, 0 );
    my $run_hooks = \&LJ::Hooks::run_hooks;
    my $run_hook  = \&LJ::Hooks::run_hook;
    my $before    = entry_count($owner);
    {
        local $LJ::SPELLER = 'callable-stub';
        no warnings 'redefine';
        local *LJ::SpellCheck::check_html =
            sub { ++$checked; return '<em class="spell-suggestion">callable suggestion</em>'; };
        local *LJ::Hooks::run_hooks = sub {
            my ( $name, @args ) = @_;
            ++$decode  if $name eq 'decode_entry_form';
            ++$spam    if $name eq 'spam_check';
            ++$options if $name eq 'after_entry_post_extra_options';
            return $run_hooks->( $name, @args );
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $name, @args ) = @_;
            ++$html if $name eq 'after_entry_post_extra_html';
            return $run_hook->( $name, @args );
        };
        my $res;
        test_psgi $adapter_app, sub { $res = shift->($spell_post); };
        like(
            $res->content,
            qr/callable suggestion/,
            'configured callable spellcheck renders checker output'
        );
    }
    is( $checked, 1, 'configured callable spellcheck invokes checker once' );
    is_deeply(
        [ $decode, $spam, $options, $html ],
        [ 0,       0,     0,        0 ],
        'callable spellcheck invokes no save hook family'
    );
    is( entry_count($owner), $before, 'configured callable spellcheck creates no entry' );
    my $unavailable;
    {
        local $LJ::SPELLER;
        test_psgi $adapter_app, sub { $unavailable = shift->($spell_post); };
    }
    like(
        $unavailable->content,
        qr/Spell check is currently unavailable/,
        'unavailable callable spellcheck remains nonpersisting'
    );
    is( entry_count($owner), $before, 'unavailable callable spellcheck creates no entry' );
}

# Ordinary rerenders copy explicit empty submitted controls instead of using the
# GET fallback that is specific to transforms.
$owner->set_draft_text('ordinary rerender draft body');
$owner->set_prop( draft_properties =>
        nfreeze( { subject => 'ordinary rerender draft subject', taglist => 'draft-tag' } ) );
my $ordinary_before_props = thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') );
for my $action ( [ showform => 1 ], [ moreoptsbtn => 1 ], [ 'action:preview' => 'Preview' ] ) {
    my ( $field, $value ) = @$action;
    my $path = '/update?usejournal=' . $owner->user . '&subject=GET+subject&event=GET+body';
    my $form = retained_form( $path, "ordinary $field" ) or next;
    my $post = POST(
        $path,
        [
            $field                => $value,
            lj_form_auth          => $form->value('lj_form_auth'),
            subject               => '',
            event                 => '',
            usejournal            => '',
            security              => 'custom',
            custom_bit_1          => 1,
            prop_taglist          => '',
            prop_current_location => '',
            prop_current_music    => '',
            prop_picture_keyword  => 'legacy-update-pic',
            prop_opt_backdated    => 1,
            date_ymd_mm           => '02',
            date_ymd_dd           => '03',
            date_ymd_yyyy         => '2020',
            hour                  => '04',
            min                   => '05',
            date_diff             => 1,
            comment_settings      => 'noemail',
            prop_xpost_check      => 1,
            prop_xpost_9          => 1,
        ]
    );
    $post->header( Referer => 'http://localhost/update' );
    my ( $decode, $spam, $options, $html, $xpost ) = ( 0, 0, 0, 0, 0 );
    my $rh    = \&LJ::Hooks::run_hooks;
    my $rhook = \&LJ::Hooks::run_hook;
    my $res;
    {
        no warnings 'redefine';
        local *LJ::Hooks::run_hooks = sub {
            my ( $n, @a ) = @_;
            ++$decode  if $n eq 'decode_entry_form';
            ++$spam    if $n eq 'spam_check';
            ++$options if $n eq 'after_entry_post_extra_options';
            return $rh->( $n, @a );
        };
        local *LJ::Hooks::run_hook = sub {
            my ( $n, @a ) = @_;
            ++$html if $n eq 'after_entry_post_extra_html';
            return $rhook->( $n, @a );
        };
        local *LJ::Protocol::schedule_xposts = sub { ++$xpost; return ( [], [] ); };
        test_psgi $adapter_app, sub { $res = shift->($post); };
    }
    my $native = ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, 'http://localhost/entry/new' ) )[0];
    ok( $native, "$field returns native ordinary rerender" );
    is( $native->value('subject'),  '',       "$field retains empty submitted subject over GET" );
    is( $native->value('event'),    '',       "$field retains empty submitted body over GET" );
    is( $native->value('security'), 'custom', "$field retains custom security" );
    is( $native->value('entrytime_date'),       '2020-02-03', "$field retains submitted date" );
    is( $native->value('entrytime_outoforder'), 1,            "$field retains backdating" );
    is( $native->value('prop_picture_keyword'), 'legacy-update-pic', "$field retains userpic" );
    is_deeply(
        [ $decode, $spam, $options, $html, $xpost ],
        [ 0,       0,     0,        0,     0 ],
        "$field has no save-side hooks"
    );
    is( entry_count($owner), $before_transform_entries, "$field creates no entry" );
    is_deeply( thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') ),
        $ordinary_before_props, "$field retains full draft properties" );
}

# Explicit token regressions: spellcheck must never invoke a checker before
# the reviewed token/referer guard accepts the retained form submission.
for my $token_case ( [ missing => undef ], [ invalid => 'not-a-token' ] ) {
    my ( $label, $token ) = @$token_case;
    my $checked = 0;
    my @fields  = (
        'action:spellcheck' => 'Spell Check',
        subject             => 'token subject',
        event               => 'token body',
        security            => 'public'
    );
    push @fields, ( lj_form_auth => $token ) if defined $token;
    my $req = POST( '/update', \@fields );
    $req->header( Referer => 'http://localhost/update' );
    my $res;
    {
        local $LJ::SPELLER = 'stub';
        no warnings 'redefine';
        local *LJ::SpellCheck::check_html = sub { ++$checked; return 'bad'; };
        test_psgi $adapter_app, sub { $res = shift->($req); };
    }
    is( $checked, 0, "$label spellcheck token never invokes checker" );
    like(
        $res->content,
        qr/(?:Invalid form submission|invalid form)/i,
        "$label spellcheck token visibly errors"
    );
}

# Ordinary absent controls inherit only retained GET defaults; explicit empties
# deliberately override them. Use showform so this remains nonpersisting.
for my $case ( [ absent => 0 ], [ empty => 1 ] ) {
    my ( $label, $empty ) = @$case;
    my $path =
'/update?subject=GET-subject&event=GET-body&prop_taglist=GET-tag&prop_current_location=GET-location';
    my @f = ( showform => 1, lj_form_auth => $valid_form_auth, security => 'public' );
    push @f, ( subject => '', event => '', prop_taglist => '' ) if $empty;
    my $req = POST( $path, \@f );
    $req->header( Referer => 'http://localhost/update' );
    my $res;
    test_psgi $adapter_app, sub { $res = shift->($req); };
    my $form = ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $res->content, 'http://localhost/entry/new' ) )[0];
    ok( $form, "$label ordinary rerender parses" );
    is( $form->value('subject'), $empty ? '' : 'GET-subject', "$label subject retention" );
    is( $form->value('event'),   $empty ? '' : 'GET-body',    "$label body retention" );
    is( $form->value('taglist'), $empty ? '' : 'GET-tag',     "$label tag retention" );
    is( $form->value('current_location'), '', "$label ignores arbitrary GET metadata" );
}

{

    package LegacyTransformFixture::Account;
    sub new { my $class = shift; bless {@_}, $class }
    sub acctid         { $_[0]{id} }
    sub displayname    { $_[0]{name} }
    sub password       { $_[0]{password} }
    sub xpostbydefault { $_[0]{default} }
}

# Transform xpost controls retain truthy GET fallback when the submitted
# legacy selection/credential is explicitly empty.
my @xpost_accounts = (
    LegacyTransformFixture::Account->new(
        id       => 41,
        name     => 'Rendered account',
        password => '',
        default  => 0
    )
);
my $xpost_path =
'/update?subject=GET&event=GET&prop_xpost_check=1&prop_xpost_41=1&prop_xpost_password_41=GET-secret';
my $xpost_req = POST(
    $xpost_path,
    [
        transform              => 'xpostfallback',
        lj_form_auth           => $valid_form_auth,
        subject                => 'POST',
        event                  => 'POST',
        prop_xpost_check       => '',
        prop_xpost_41          => '',
        prop_xpost_password_41 => ''
    ]
);
$xpost_req->header( Referer => 'http://localhost/update' );
my $xpost_res;
my $prepared_xpost;
{
    no warnings 'redefine';
    local *DW::External::Account::get_external_accounts = sub { @xpost_accounts };
    my $orig_prepare = \&DW::Entry::Legacy::prepare_rerender_entry_form;
    local *DW::Entry::Legacy::prepare_rerender_entry_form =
        sub { my $prepared = $orig_prepare->(@_); $prepared_xpost = $prepared; return $prepared; };
    my $rh = \&LJ::Hooks::run_hooks;
    local *LJ::Hooks::run_hooks = sub {
        my ( $n, @a ) = @_;
        return if $n eq 'transform_update_xpostfallback';
        return $rh->( $n, @a );
    };
    test_psgi $adapter_app, sub { $xpost_res = shift->($xpost_req); };
}
my $xpost_form = ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
        HTML::Form->parse( $xpost_res->content, 'http://localhost/entry/new' ) )[0];
ok( $xpost_form, 'transform empty-xpost fallback rerender parses' );
is( $xpost_form->value('crosspost_entry'),
    1, 'empty transform xpost master inherits GET selection' );
my @xpost_passwords =
    map { $_->value } grep { ( $_->name || '' ) eq 'crosspost_password_41' } $xpost_form->inputs;
is( $prepared_xpost->{canonical}{crosspost}{41}{password},
    'GET-secret', 'empty transform xpost credential inherits GET value before native rendering' );
is( $xpost_passwords[0], '',
    'native crosspost password control deliberately does not reflect a secret' );

is( $DW::Routing::string_choices{'app/update'},
    $production_update_route,
    'scoped retained update form route restores the production update route' );

done_testing;

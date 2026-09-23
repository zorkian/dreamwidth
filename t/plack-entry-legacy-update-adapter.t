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

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);
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
        my $res  = $send->( GET $path, Cookie => $cookie );
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
        my $res  = $send->( GET $path, Cookie => $cookie );
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

done_testing;

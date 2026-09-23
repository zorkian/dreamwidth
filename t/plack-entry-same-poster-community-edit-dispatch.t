#!/usr/bin/perl
# Exercise public same-poster community retained edit POST composition.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;
use lib "$ENV{LJHOME}/cgi-bin";
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::SpellCheck;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Community dispatch integration requires a development server'
    unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
sub fresh { LJ::Entry::reset_singletons(); return LJ::Entry->new( $_[0], ditemid => $_[1] ) }

sub form_from {
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
            HTML::Form->parse( $_[0], 'http://localhost/editjournal' ) )[0];
}

sub clicked {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing $name" unless $input;
    return $input->click($form);
}

my $poster = temp_user();
$poster->update_self( { status => 'A' } );
my $manager = temp_user();
$manager->update_self( { status => 'A' } );
my $comm = temp_comm();
$poster->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $poster->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $poster->userid . '-A' );
$manager->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $manager->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );
my $other_poster = temp_user();
$other_poster->update_self( { status => 'A' } );
my $session         = LJ::Session->create( $poster,  nolog => 1 );
my $manager_session = LJ::Session->create( $manager, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
my $manager_cookie =
      'ljmastersession='
    . $manager_session->master_cookie_string
    . '; ljloggedin='
    . $manager_session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'samePosterDispatch';
my ( $personal_calls, $community_calls, @dispatch_order ) = ( 0, 0 );
my $personal  = \&DW::Controller::Entry::legacy_owned_edit_handler;
my $community = \&DW::Controller::Entry::legacy_same_poster_community_edit_handler;
no warnings 'redefine';
local *DW::Controller::Entry::legacy_owned_edit_handler =
    sub { ++$personal_calls; push @dispatch_order, 'personal'; return $personal->(@_) };
local *DW::Controller::Entry::legacy_same_poster_community_edit_handler =
    sub { ++$community_calls; push @dispatch_order, 'community'; return $community->(@_) };

test_psgi $app, sub {
    my $send    = shift;
    my $request = sub { my ($req) = @_; $req->header( Cookie => $cookie ); return $send->($req) };
    my $retained_get = sub {
        my ( $path, $request_cookie ) = @_;
        my $req = GET $path;
        $req->header( Cookie => $request_cookie || $cookie );
        return LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route( 'app/editjournal',
            sub { $send->($req) } );
    };
    for my $suffix ( '', '.bml' ) {
        my $target = $poster->t_post_fake_comm_entry(
            $comm,
            subject  => "dispatch$suffix old",
            body     => "dispatch$suffix body",
            security => 'friends'
        );
        my $other = $poster->t_post_fake_comm_entry(
            $comm,
            subject  => "dispatch$suffix other",
            body     => "dispatch$suffix other body",
            security => 'public'
        );
        my $path = "/editjournal$suffix?usejournal=" . $comm->user . '&itemid=' . $target->ditemid;
        my $res  = $retained_get->($path);
        is( $res->code, 200, "$suffix retained GET harvests form" );
        my $form = form_from( $res->content );
        ok( $form, "$suffix supplies actual retained form" ) or next;
        $form->action( 'http://localhost' . $path );
        $form->value( subject => "dispatch$suffix changed" );
        $form->value( event   => "dispatch$suffix changed body" );
        my $post = clicked( $form, 'action:save' );
        $post->header( Referer => "http://localhost$path" );
        $post->header( Cookie  => $cookie );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($post);
        is( $res->code,       200, "$suffix public save succeeds" );
        is( $personal_calls,  1,   "$suffix calls personal handler first" );
        is( $community_calls, 1,   "$suffix calls community handler after personal decline" );
        is_deeply( \@dispatch_order, [qw(personal community)], "$suffix preserves handler order" );
        like(
            $res->content,
            qr{href="/entry/\Q@{[$comm->user]}\E/\Q@{[$target->ditemid]}\E/edit"},
            "$suffix returns native success"
        );
        is(
            fresh( $comm, $target->ditemid )->subject_raw,
            "dispatch$suffix changed",
            "$suffix persists subject"
        );
        is(
            fresh( $comm, $target->ditemid )->event_raw,
            "dispatch$suffix changed body",
            "$suffix persists body"
        );
        is( fresh( $comm, $target->ditemid )->security,
            'usemask', "$suffix preserves friends security" );
        is(
            fresh( $comm, $other->ditemid )->subject_raw,
            "dispatch$suffix other",
            "$suffix preserves unrelated entry"
        );
        my $delete = $poster->t_post_fake_comm_entry(
            $comm,
            subject  => "dispatch$suffix delete",
            body     => "dispatch$suffix delete body",
            security => 'public'
        );
        my $delete_path =
            "/editjournal$suffix?usejournal=" . $comm->user . '&itemid=' . $delete->ditemid;
        $res  = $retained_get->($delete_path);
        $form = form_from( $res->content );
        ok( $form, "$suffix delete harvests retained form" ) or next;
        $form->action( 'http://localhost' . $delete_path );
        $post = clicked( $form, 'action:delete' );
        $post->header( Referer => "http://localhost$delete_path" );
        $post->header( Cookie  => $cookie );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($post);
        is( $personal_calls,  1, "$suffix delete calls personal handler first" );
        is( $community_calls, 1, "$suffix delete calls community handler after personal decline" );
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$suffix delete preserves handler order" );
        like(
            $res->content,
            qr/edited-entry-extra|success/i,
            "$suffix delete returns native response"
        );
        ok( !fresh( $comm, $delete->ditemid )->valid, "$suffix delete removes selected entry" );
        ok( fresh( $comm, $other->ditemid )->valid, "$suffix delete preserves unrelated entry" );
    }
    my $retry = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'retry old',
        body     => 'retry body',
        security => 'public'
    );
    my $retry_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $retry->ditemid;
    my $res        = $retained_get->($retry_path);
    my $form       = form_from( $res->content );
    ok( $form, 'retry harvests retained form' );
    $form->action( 'http://localhost' . $retry_path );
    $form->value( subject       => 'retry changed' );
    $form->value( event         => 'retry changed' );
    $form->value( date_ymd_yyyy => 'not-a-year' );
    my $post = clicked( $form, 'action:save' );
    $post->header( Referer => "http://localhost$retry_path" );
    $post->header( Cookie  => $cookie );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    is( $personal_calls,  1, 'invalid attempt calls personal handler first' );
    is( $community_calls, 1, 'invalid attempt calls community handler' );
    is_deeply( \@dispatch_order, [qw(personal community)],
        'invalid attempt preserves handler order' );
    like( $res->content, qr/id="js-post-entry"/,
        'invalid attempt returns native retry, never BML fallback' );
    like( $res->content, qr/not-a-year/, 'native retry retains raw date' );
    is( fresh( $comm, $retry->ditemid )->subject_raw,
        'retry old', 'invalid attempt leaves persisted entry unchanged' );
    my $declined = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'declined old',
        body     => 'declined body',
        security => 'public'
    );
    my $declined_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $declined->ditemid;
    $res  = $retained_get->($declined_path);
    $form = form_from( $res->content );
    ok( $form, 'declined action harvests retained form' );
    my $token = $form->value('lj_form_auth');

    for my $case ( [ 'no action', undef ], [ 'unknown action', 'action:unsupported' ] ) {
        my @pairs = (
            itemid       => $declined->ditemid,
            usejournal   => $comm->user,
            lj_form_auth => $token,
            subject      => 'declined changed',
            event        => 'declined changed body'
        );
        push @pairs, ( $case->[1] => '1' ) if defined $case->[1];
        $post = POST $declined_path, \@pairs;
        $post->header( Cookie  => $cookie );
        $post->header( Referer => "http://localhost$declined_path" );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($post);
        unlike( $res->content, qr/id="js-post-entry"/,
            "$case->[0] remains outside native retry rendering" );
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$case->[0] reaches both resolvers then BML" );
        is( fresh( $comm, $declined->ditemid )->subject_raw,
            'declined old', "$case->[0] leaves target unchanged" );
    }
    my $managed = $other_poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'managed old',
        body     => 'managed body',
        security => 'public'
    );
    my $managed_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $managed->ditemid;
    $res  = $retained_get->( $managed_path, $manager_cookie );
    $form = form_from( $res->content );
    ok( $form, 'manager harvests retained other-poster form' );
    for my $action (qw(delete deletespam savemaintainer)) {
        ok( $form->find_input("action:$action"), "manager retained form exposes $action" );
    }
    $form->value( lj_form_auth => 'invalid-manager-routing-token' );
    my $report_calls = 0;
    my $mark_as_spam = \&LJ::mark_entry_as_spam;
    local *LJ::mark_entry_as_spam = sub { ++$report_calls; return $mark_as_spam->(@_) };
    $post = clicked( $form, 'action:deletespam' );
    $post->header( Cookie  => $manager_cookie );
    $post->header( Referer => "http://localhost$managed_path" );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    unlike( $res->content, qr/id="js-post-entry"/,
        'invalid manager delete-spam remains BML-owned' );
    is_deeply( \@dispatch_order, [qw(personal community)],
        'invalid manager delete-spam reaches both public dispatch candidates' );
    ok( fresh( $comm, $managed->ditemid )->valid,
        'invalid manager routing assertion does not mutate entry' );
    is( $report_calls, 0, 'invalid manager delete-spam never calls report marker' );

    for my $case ( [ 'missing token', '' ], [ 'invalid token', 'invalid-community-token' ] ) {
        my $csrf_target = $poster->t_post_fake_comm_entry(
            $comm,
            subject  => "$case->[0] old",
            body     => "$case->[0] body",
            security => 'public'
        );
        my $csrf_path =
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $csrf_target->ditemid;
        $res  = $retained_get->($csrf_path);
        $form = form_from( $res->content );
        ok( $form, "$case->[0] harvests an actual retained community form" );
        $form->action( 'http://localhost' . $csrf_path );
        $form->value( subject => "$case->[0] changed subject" );
        $form->value( event   => "$case->[0] changed body" );
        my $auth = $form->find_input('lj_form_auth');
        if   ( $case->[0] eq 'missing token' ) { $auth->disabled(1); }
        else                                   { $form->value( lj_form_auth => $case->[1] ); }
        my $csrf_post = clicked( $form, 'action:save' );
        $csrf_post->header( Cookie  => $cookie );
        $csrf_post->header( Referer => "http://localhost$csrf_path" );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($csrf_post);
        unlike( $res->content, qr{id="js-post-entry"}, "$case->[0] remains retained BML denial" );
        like( $res->content, qr/Invalid form/i, "$case->[0] shows useful retained denial" );
        unlike( $res->header('Location') || '', qr/.+/, "$case->[0] denial does not redirect" );
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$case->[0] reaches both dispatch candidates before fallback" );
        is(
            fresh( $comm, $csrf_target->ditemid )->subject_raw,
            "$case->[0] old",
            "$case->[0] leaves target unchanged"
        );
    }
    my $csrf_target = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'malformed old',
        body     => 'malformed body',
        security => 'public'
    );

    for my $bad (
        [ '/editjournal?usejournal=' . $comm->user . '&itemid=0',   'zero itemid' ],
        [ '/editjournal?usejournal=' . $comm->user . '&itemid=abc', 'invalid itemid' ],
        [
            '/editjournal?usejournal='
                . $comm->user
                . '&itemid='
                . $csrf_target->ditemid
                . '&itemid='
                . $csrf_target->ditemid,
            'repeated itemid'
        ],
        )
    {
        $post = POST $bad->[0],
            [ itemid => $csrf_target->ditemid, 'action:save' => 'Save Changes' ];
        $post->header( Cookie  => $cookie );
        $post->header( Referer => 'http://localhost' . $bad->[0] );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($post);
        unlike( $res->content, qr{id="js-post-entry"}, "$bad->[1] remains retained BML-owned" );
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$bad->[1] declines before native effects" );
        is(
            fresh( $comm, $csrf_target->ditemid )->subject_raw,
            'malformed old',
            "$bad->[1] leaves target unchanged"
        );
    }
    $post = POST '/editjournal', [ mode => 'edit', selecttype => 'last' ];
    $post->header( Cookie  => $cookie );
    $post->header( Referer => 'http://localhost/editjournal' );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    is( $res->code, 200, 'itemless picker POST returns its selector result' );
    is_deeply( \@dispatch_order, [], 'itemless picker POST calls neither edit resolver' );

    my $gated = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'gated old',
        body     => 'gated body',
        security => 'public'
    );
    my $gated_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $gated->ditemid;
    {
        local *LJ::BetaFeatures::user_in_beta = sub { 1 };
        $post = POST $gated_path,
            [
            itemid        => $gated->ditemid,
            usejournal    => $comm->user,
            'action:save' => 'Save Changes',
            lj_form_auth  => 'invalid-gate-token'
            ];
        $post->header( Cookie  => $cookie );
        $post->header( Referer => "http://localhost$gated_path" );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($post);
        unlike( $res->content, qr{id="js-post-entry"}, 'beta gate remains BML-owned' );
        is_deeply( \@dispatch_order, [qw(personal community)],
            'beta gate declines through both resolvers' );
        is( fresh( $comm, $gated->ditemid )->subject_raw,
            'gated old', 'beta gate leaves target unchanged' );
        is( $res->code, 302, 'beta uses the retained redirect status' );
        is(
            $res->header('Location') || '',
            '/entry/' . $comm->user . '/' . $gated->ditemid . '/edit',
            'beta retains the exact legacy redirect location'
        );
    }
    for my $readonly_case ( [ 'actor', $poster ], [ 'community', $comm ] ) {
        $res  = $retained_get->($gated_path);
        $form = form_from( $res->content );
        ok( $form, "$readonly_case->[0] readonly case harvests valid retained form" );
        $form->action( 'http://localhost' . $gated_path );
        $form->value( subject => "$readonly_case->[0] readonly changed" );
        my $readonly_post = clicked( $form, 'action:save' );
        $readonly_post->header( Cookie  => $cookie );
        $readonly_post->header( Referer => "http://localhost$gated_path" );
        my $helper_calls = 0;
        my $helper       = \&DW::Controller::Entry::legacy_owned_edit_post;
        my $route        = $DW::Routing::string_choices{'app/editjournal'};
        my $is_readonly  = \&LJ::User::is_readonly;
        local *DW::Controller::Entry::legacy_owned_edit_post =
            sub { ++$helper_calls; return $helper->(@_) };
        local *LJ::User::is_readonly =
            sub { return 1 if $_[0]->equals( $readonly_case->[1] ); return $is_readonly->(@_) };
        local $DW::Routing::string_choices{'app/editjournal'} = {
            %$route,
            sub => sub {
                my $rendered = $route->{sub}->(@_);
                return $rendered if defined $rendered;
                my $request = DW::Request->get;
                $request->print('READONLY_BML_FALLBACK');
                return $request->OK;
            },
        };
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($readonly_post);
        like( $res->content, qr/READONLY_BML_FALLBACK/,
            "$readonly_case->[0] readonly reaches intercepted retained fallback" );
        is( $helper_calls, 0, "$readonly_case->[0] readonly declines before native edit helper" );
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$readonly_case->[0] readonly checks both dispatch candidates" );
        is( fresh( $comm, $gated->ditemid )->subject_raw,
            'gated old', "$readonly_case->[0] readonly leaves target unchanged" );
    }

    local $LJ::SPELLER = 'local-community-stub';
    my @checked;
    my $check_html = \&LJ::SpellCheck::check_html;
    local *LJ::SpellCheck::check_html =
        sub { push @checked, ${ $_[1] }; return '<em>community suggestion</em>' };
    my $spell = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'spell old',
        body     => 'spell stored body',
        security => 'public'
    );
    my $spell_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $spell->ditemid;
    $res  = $retained_get->($spell_path);
    $form = form_from( $res->content );
    ok(
        $form && $form->find_input('action:spellcheck'),
        'configured retained community form exposes spellcheck'
    );
    $form->action( 'http://localhost' . $spell_path );
    $form->value( subject => 'spell submitted subject' );
    $form->value( event   => 'misspell community body' );
    $post = clicked( $form, 'action:spellcheck' );
    $post->header( Cookie  => $cookie );
    $post->header( Referer => "http://localhost$spell_path" );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    is_deeply( \@dispatch_order, [qw(personal community)],
        'spellcheck declines through both edit resolvers' );
    like( $res->content, qr/community suggestion/, 'retained spellcheck renders local suggestion' );
    is( $checked[-1], 'misspell community body', 'local checker receives submitted body' );
    is(
        fresh( $comm, $spell->ditemid )->event_raw,
        'spell stored body',
        'spellcheck leaves stored community body unchanged'
    );

    my $competing_comm = temp_comm();
    $poster->join_community( $competing_comm, 1, 1 );
    LJ::set_rel( $competing_comm->userid, $poster->userid, 'A' );
    DW::Cache->request->remove( 'rel', $competing_comm->userid . '-' . $poster->userid . '-A' );
    my $precedence = $poster->t_post_fake_comm_entry(
        $comm,
        subject  => 'precedence old',
        body     => 'precedence body',
        security => 'public'
    );

    for my $case (
        [
            'GET usejournal wins over POST',
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $precedence->ditemid,
            [ usejournal => $competing_comm->user ]
        ],
        [
            'POST usejournal wins over GET journal',
            '/editjournal?journal=' . $competing_comm->user . '&itemid=' . $precedence->ditemid,
            [ usejournal => $comm->user ],
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $precedence->ditemid
        ],
        )
    {
        $res  = $retained_get->( $case->[3] || $case->[1] );
        $form = form_from( $res->content );
        ok( $form, "$case->[0] harvests intended community form" );
        $form->action( 'http://localhost' . $case->[1] );
        $form->value( date_ymd_yyyy => 'not-a-year' );
        $form->value( subject       => "$case->[0] changed" );
        $form->value( event         => "$case->[0] changed body" );
        my $precedence_post = clicked( $form, 'action:save' );
        $precedence_post->header( Cookie  => $cookie );
        $precedence_post->header( Referer => 'http://localhost' . $case->[1] );
        $personal_calls = $community_calls = 0;
        @dispatch_order = ();
        $res            = $send->($precedence_post);
        is_deeply( \@dispatch_order, [qw(personal community)],
            "$case->[0] reaches community resolver after personal decline" );
        like( $res->content, qr{id="js-post-entry"},
            "$case->[0] returns native nonpersisting retry" );
        like( $res->content, qr/not-a-year/, "$case->[0] retains raw invalid date" );
        like(
            $res->content,
            qr{/entry/\Q@{[$comm->user]}\E/\Q@{[$precedence->ditemid]}\E/edit},
            "$case->[0] retry targets the chosen community entry"
        );
        is(
            fresh( $comm, $precedence->ditemid )->subject_raw,
            'precedence old',
            "$case->[0] leaves intended target unchanged"
        );
    }
    my $collapse = $poster->t_post_fake_entry(
        subject  => 'collapse old',
        body     => 'collapse body',
        security => 'private'
    );
    my $collapse_path =
        '/editjournal?usejournal=' . $poster->user . '&itemid=' . $collapse->ditemid;
    $res  = $retained_get->($collapse_path);
    $form = form_from( $res->content );
    ok( $form, 'same-user collapse harvests personal retained form' );
    $form->action( 'http://localhost' . $collapse_path );
    $form->value( subject => 'collapse changed' );
    $post = clicked( $form, 'action:save' );
    $post->header( Cookie  => $cookie );
    $post->header( Referer => "http://localhost$collapse_path" );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    is_deeply( \@dispatch_order, ['personal'],
        'same-user usejournal collapse remains on personal path' );
    is(
        fresh( $poster, $collapse->ditemid )->subject_raw,
        'collapse changed',
        'same-user collapse persists personal save'
    );

    my $personal_entry = $poster->t_post_fake_entry(
        subject  => 'personal old',
        body     => 'personal body',
        security => 'private'
    );
    my $personal_path = '/editjournal?itemid=' . $personal_entry->ditemid;
    $res  = $retained_get->($personal_path);
    $form = form_from( $res->content );
    ok( $form, 'personal retained form harvests' );
    $form->action( 'http://localhost' . $personal_path );
    $form->value( subject => 'personal changed' );
    $post = clicked( $form, 'action:save' );
    $post->header( Referer => "http://localhost$personal_path" );
    $post->header( Cookie  => $cookie );
    $personal_calls = $community_calls = 0;
    @dispatch_order = ();
    $res            = $send->($post);
    is( $personal_calls,  1, 'personal save calls personal handler' );
    is( $community_calls, 0, 'personal save never calls community handler' );
    is_deeply( \@dispatch_order, ['personal'],
        'personal save stops at the defined personal response' );
    is(
        fresh( $poster, $personal_entry->ditemid )->subject_raw,
        'personal changed',
        'personal save persists through original path'
    );
};

done_testing;

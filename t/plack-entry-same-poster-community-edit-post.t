#!/usr/bin/perl
# Exercise the callable same-poster community legacy edit helper with retained forms.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use Scalar::Util qw(refaddr);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Entry::Legacy;
use DW::Request;
use DW::Routing;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;

plan skip_all => 'Community edit helper integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub retained_form {
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
            HTML::Form->parse( $_[0], 'http://localhost/editjournal' ) )[0];
}

sub native_retry_form {
    return ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $_[0], 'http://localhost' ) )[0];
}

sub fresh {
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $_[0], ditemid => $_[1] );
}

sub visible_click {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing retained $name control" unless $input;
    return $input->click($form);
}

our ( %resolved, $community );

sub same_poster_adapter {
    my $r = DW::Request->get;
    return undef unless $r && $r->did_post;
    my $post    = $r->post_args;
    my $ditemid = $r->get_args->{itemid} || $post->{itemid};
    my $entry   = $resolved{$ditemid};
    my $remote  = LJ::get_remote();
    return undef unless $entry && $remote;

    my %result = DW::Controller::Entry::legacy_owned_edit_post(
        entry                 => $entry,
        remote                => $remote,
        journal               => $community,
        session_remote        => $remote,
        same_poster_community => 1,
        post                  => $post,
        get                   => $r->get_args( preserve_case => 1 ),
        legacy_seed           => {
            mode       => 'editevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $remote->user,
            usejournal => $community->user,
            itemid     => $entry->jitemid,
            xpost      => '0',
        },
    );
    return $result{render} if exists $result{render};
    $r->status(400);
    return $r->print('same-poster community adapter fell through');
}

my $poster = temp_user();
$poster->update_self( { status => 'A' } );
$community = temp_comm();
$poster->join_community( $community, 1, 1 );
LJ::set_rel( $community->userid, $poster->userid, 'A' );
my $session = LJ::Session->create( $poster, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'samePosterCommunityEdit';

my @order;
my ( $decode_post_ref, $decoded_request_ref, $spam_request_ref, $canonical_request_ref );
my ( $decoded_post, $decoded_request, $spam_request );
my ( $crosspost_calls, $new_post_hook_calls ) = ( 0, 0 );
my $original_run_hooks          = \&LJ::Hooks::run_hooks;
my $original_save_editted_entry = \&DW::Entry::_save_editted_entry;
my $original_log_event          = \&LJ::User::log_event;

no warnings 'redefine';
local *LJ::Hooks::run_hooks = sub {
    my ( $name, @args ) = @_;
    ++$new_post_hook_calls if $name =~ /^after_entry_post_extra_/;
    if ( $name eq 'decode_entry_form' ) {
        push @order, 'decode';
        ( $decode_post_ref, $decoded_request_ref ) = map { refaddr($_) } @args;
        $decoded_post    = { %{ $args[0] } };
        $decoded_request = { %{ $args[1] } };
    }
    if ( $name eq 'spam_check' ) {
        push @order, 'spam_check';
        $spam_request_ref = refaddr( $args[1] );
        $spam_request     = { %{ $args[1] } };
    }
    return $original_run_hooks->( $name, @args );
};
local *LJ::User::log_event = sub {
    push @order, 'delete_log' if $_[1] eq 'delete_entry';
    return $original_log_event->(@_);
};
local *DW::Entry::_save_editted_entry = sub {
    push @order, 'canonical_save';
    $canonical_request_ref = refaddr( $_[1] );
    return $original_save_editted_entry->(@_);
};
local *LJ::Protocol::schedule_xposts = sub { ++$crosspost_calls; return ( [], [] ); };
local $LJ::HOOKS{entry_deleted_page_extras} =
    [ sub { return '<span id="same-poster-community-extra">local extra</span>'; } ];

my $production_route = $DW::Routing::string_choices{'app/editjournal'};
my $adapter_route    = { %$production_route, sub => \&same_poster_adapter };

{
    local $DW::Routing::string_choices{'app/editjournal'} =
        LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($adapter_route);

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };

        my $save_target = $poster->t_post_fake_comm_entry(
            $community,
            subject  => 'Community helper original subject',
            body     => 'Community helper original body',
            security => 'friends',
        );
        my $unrelated = $poster->t_post_fake_comm_entry(
            $community,
            subject  => 'Community helper unrelated subject',
            body     => 'Community helper unrelated body',
            security => 'public',
        );
        LJ::set_logprop( $community, $unrelated->jitemid, { opt_preformatted => 1 } );
        my $path =
            '/editjournal?usejournal=' . $community->user . '&itemid=' . $save_target->ditemid;
        my $res = $request->( GET $path );
        is( $res->code, 200, 'retained GET supplies same-poster community edit form' );
        my $form = retained_form( $res->content );
        ok( $form, 'actual retained form is captured before callable POST' )
            or BAIL_OUT('missing form');
        is(
            $form->value('subject'),
            'Community helper original subject',
            'retained form seeds target subject'
        );
        is(
            $form->value('event'),
            'Community helper original body',
            'retained form seeds target body'
        );
        $resolved{ $save_target->ditemid } = $save_target;
        $form->action( 'http://localhost' . $path );
        $form->value( subject => 'Community helper changed subject' );
        $form->value( event   => 'Community helper changed body' );
        @order = ();
        my $save = visible_click( $form, 'action:save' );
        $save->header( Referer => 'http://localhost' . $path );
        $res = $request->($save);
        is( $res->code, 200, 'callable same-poster community save returns native success' );
        like( $res->content, qr/(?:updated|success)/i,
            'native community save response is meaningful' );
        my $saved = fresh( $community, $save_target->ditemid );
        is(
            $saved->subject_raw,
            'Community helper changed subject',
            'canonical helper save persists subject'
        );
        is(
            $saved->event_raw,
            'Community helper changed body',
            'canonical helper save persists body'
        );
        is( $saved->security, 'usemask',
            'canonical helper save maps friends security to retained usemask' );
        is(
            fresh( $community, $unrelated->ditemid )->subject_raw,
            'Community helper unrelated subject',
            'save preserves unrelated entry'
        );
        is( fresh( $community, $unrelated->ditemid )->prop('opt_preformatted') || 0,
            1, 'save preserves unrelated property' );
        is_deeply( \@order, [qw(decode spam_check canonical_save)],
            'save preserves decode, spam check, then canonical save ordering without a delete log'
        );
        is( $decoded_post->{usejournal},
            $community->user, 'flat retained form preserves community context' );
        is( $decoded_request->{user}, $poster->user, 'canonical seed uses effective poster actor' );
        is( $decoded_request->{usejournal},
            $community->user, 'canonical seed uses community journal' );
        is( $decoded_request_ref, $spam_request_ref,
            'spam_check receives exact decoded save request reference' );
        ok( $canonical_request_ref,
            'canonical save receives the normalized request after raw spam check' );
        is( $crosspost_calls,     0, 'community save does not schedule crosspost transport' );
        is( $new_post_hook_calls, 0, 'edit save does not invoke new-post success hooks' );

        my $delete_target = $poster->t_post_fake_comm_entry(
            $community,
            subject  => 'Community helper delete subject',
            body     => 'Community helper delete body',
            security => 'public',
        );
        my $delete_path =
            '/editjournal?usejournal=' . $community->user . '&itemid=' . $delete_target->ditemid;
        $res  = $request->( GET $delete_path );
        $form = retained_form( $res->content );
        ok( $form && $form->find_input('action:delete'),
            'retained same-poster form has a visible delete control' )
            or BAIL_OUT('missing delete form');
        $resolved{ $delete_target->ditemid } = $delete_target;
        $form->action( 'http://localhost' . $delete_path );
        @order = ();
        my $delete = visible_click( $form, 'action:delete' );
        $delete->header( Referer => 'http://localhost' . $delete_path );
        $res = $request->($delete);
        is( $res->code, 200, 'callable same-poster community delete returns native success' );
        like(
            $res->content,
            qr/id="same-poster-community-extra"/,
            'delete preserves legacy deletion extras'
        );
        ok(
            !fresh( $community, $delete_target->ditemid )->valid,
            'delete removes selected same-poster entry'
        );
        ok( fresh( $community, $unrelated->ditemid )->valid, 'delete preserves unrelated entry' );
        is_deeply(
            \@order,
            [qw(decode delete_log spam_check canonical_save)],
            'delete preserves retained raw ordering before canonical save'
        );
        is( $spam_request->{event}, '', 'delete empties event before spam check' );
        is( $crosspost_calls,       0,  'community delete does not schedule crosspost transport' );
        is( $new_post_hook_calls,   0,  'community delete does not invoke new-post hooks' );

        my $invalid = $poster->t_post_fake_comm_entry(
            $community,
            subject  => 'Community helper retry subject',
            body     => 'Community helper retry body',
            security => 'private',
        );
        my $invalid_path =
            '/editjournal?usejournal=' . $community->user . '&itemid=' . $invalid->ditemid;
        $res                           = $request->( GET $invalid_path );
        $form                          = retained_form( $res->content );
        $resolved{ $invalid->ditemid } = $invalid;
        $form->action( 'http://localhost' . $invalid_path );
        $form->value( subject       => 'Community helper raw retry subject' );
        $form->value( event         => 'Community helper raw retry body' );
        $form->value( date_ymd_yyyy => 'not-a-year' );
        $form->value( date_ymd_mm   => '02' );
        $form->value( date_ymd_dd   => '03' );
        $form->value( date_diff     => 1 );
        my $bad = visible_click( $form, 'action:save' );
        $bad->header( Referer => 'http://localhost' . $invalid_path );
        $res = $request->($bad);
        is( $res->code, 200, 'failed community save remains rendered by the callable helper' );
        my $retry = native_retry_form( $res->content );
        ok( $retry, 'failed community save returns native retry form, not BML fallthrough' )
            or BAIL_OUT('missing retry');
        is( $retry->value('entrytime_date'),
            'not-a-year-02-03', 'native retry retains raw invalid community date' );
        is(
            $retry->value('subject'),
            'Community helper raw retry subject',
            'native retry retains raw subject'
        );
        is(
            $retry->value('event'),
            'Community helper raw retry body',
            'native retry retains raw body'
        );
        is(
            $retry->action,
            'http://localhost/entry/'
                . $community->user . '/'
                . $invalid->ditemid
                . '/edit?usejournal='
                . $community->user
                . '&itemid='
                . $invalid->ditemid,
            'native retry uses canonical community action while retaining raw query'
        );
        my $fresh_invalid = fresh( $community, $invalid->ditemid );
        is(
            $fresh_invalid->subject_raw,
            'Community helper retry subject',
            'failed save leaves stored subject unchanged'
        );
        is(
            $fresh_invalid->event_raw,
            'Community helper retry body',
            'failed save leaves stored body unchanged'
        );
    };
}

subtest 'community delete logs session remote but retains effective poster pipeline actor' => sub {
    my $effective      = temp_user();
    my $session_remote = temp_user();
    $effective->update_self(      { status => 'A' } );
    $session_remote->update_self( { status => 'A' } );
    my $comm  = temp_comm();
    my $entry = $effective->t_post_fake_comm_entry(
        $comm,
        subject => 'Log actor target',
        body    => 'Log actor body'
    );
    my ( $logged_remote, $spam_actor, $save_actor );
    my $original_log   = \&LJ::User::log_event;
    my $original_hooks = \&LJ::Hooks::run_hooks;
    no warnings 'redefine';
    local *LJ::User::log_event = sub {
        $logged_remote = $_[2]{remote};
        return $original_log->(@_);
    };
    local *LJ::Hooks::run_hooks = sub {
        my ( $name, @args ) = @_;
        $spam_actor = $args[0] if $name eq 'spam_check';
        return $original_hooks->(@_);
    };
    local *DW::Controller::Entry::_do_edit = sub {
        $save_actor = $_[2]{poster};
        return ( status => 'ok', render => '' );
    };

    my %args = (
        entry          => $entry,
        remote         => $effective,
        session_remote => $session_remote,
        journal        => $comm,
        post           => { 'action:delete' => 1, event => 'ignored' },
        legacy_seed    => {
            mode       => 'editevent',
            user       => $effective->user,
            usejournal => $comm->user,
            itemid     => $entry->jitemid,
            xpost      => '0',
        },
    );
    my %without_opt_in = DW::Controller::Entry::legacy_owned_edit_post(%args);
    is_deeply( \%without_opt_in, {}, 'default helper remains personal-only for community entries' );

    my %result =
        DW::Controller::Entry::legacy_owned_edit_post( %args, same_poster_community => 1, );
    is( $result{status}, 'ok', 'helper accepts the already-resolved community delete context' );
    is( $logged_remote, $session_remote, 'community delete log uses the supplied session remote' );
    is( $spam_actor,    $effective,      'spam_check retains the effective poster actor' );
    is( $save_actor,    $effective,      'canonical save retains the effective poster actor' );
};

done_testing;

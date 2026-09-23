#!/usr/bin/perl
# Exercise public property-only manager POST activation without delete/report execution.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Manager property public activation requires a development server'
    unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub fresh {
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $_[0], ditemid => $_[1] );
}

sub state {
    my ( $journal, $ditemid ) = @_;
    my $entry = fresh( $journal, $ditemid );
    return {
        subject    => $entry->subject_raw,
        body       => $entry->event_raw,
        security   => $entry->security,
        allowmask  => $entry->allowmask || 0,
        unrelated  => $entry->prop('opt_preformatted') || '',
        reason     => $entry->prop('adult_content_maintainer_reason') || '',
        adult      => $entry->prop('adult_content_maintainer') || '',
        nocomments => $entry->prop('opt_nocomments_maintainer') || '',
        valid      => $entry->valid ? 1 : 0,
    };
}

sub cookie {
    my ($user) = @_;
    my $session = LJ::Session->create( $user, nolog => 1 );
    return
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
}

sub form_from {
    my ( $content, $path ) = @_;
    return (
        grep {
                   $_->find_input('action:savemaintainer')
                && $_->find_input('action:delete')
                && $_->find_input('action:deletespam')
                && $_->find_input('lj_form_auth')
        } HTML::Form->parse( $content, 'http://localhost' . $path )
    )[0];
}

sub clicked {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing $name" unless $input;
    return $input->click($form);
}

my $manager  = temp_user();
my $poster   = temp_user();
my $outsider = temp_user();
my $comm     = temp_comm();
$_->update_self( { status => 'A' } ) for $manager, $poster, $outsider;
LJ::set_rel( $comm, $manager, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );
my $target = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Public manager target',
    body     => 'Public manager body',
    security => 'public',
);
my $unrelated = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Public manager unrelated',
    body     => 'Public unrelated body',
    security => 'public',
);
LJ::set_logprop( $comm, $target->jitemid,    { opt_preformatted => 'target-format' } );
LJ::set_logprop( $comm, $unrelated->jitemid, { opt_preformatted => 'unrelated-format' } );
my $before_target = state( $comm, $target->ditemid );
my $before_other  = state( $comm, $unrelated->ditemid );
my $manager_cookie  = cookie($manager);
my $outsider_cookie = cookie($outsider);
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'managerPropertyPublic';

my ( $personal_calls, $same_calls, $manager_calls, @order, @writes, @spam_marks );
my $personal        = \&DW::Controller::Entry::legacy_owned_edit_handler;
my $same            = \&DW::Controller::Entry::legacy_same_poster_community_edit_handler;
my $manager_handler = \&DW::Controller::Entry::legacy_manager_property_post_handler;
my $set_logprop     = \&LJ::set_logprop;
no warnings 'redefine';
local *DW::Controller::Entry::legacy_owned_edit_handler = sub {
    ++$personal_calls;
    push @order, 'personal';
    return $personal->(@_);
};
local *DW::Controller::Entry::legacy_same_poster_community_edit_handler = sub {
    ++$same_calls;
    push @order, 'same_poster';
    return $same->(@_);
};
local *DW::Controller::Entry::legacy_manager_property_post_handler = sub {
    ++$manager_calls;
    push @order, 'manager';
    return $manager_handler->(@_);
};
local *LJ::set_logprop = sub {
    push @writes, [ $_[0]->id, $_[1], { %{ $_[2] || {} } } ];
    return $set_logprop->(@_);
};
local *LJ::mark_entry_as_spam = sub { push @spam_marks, [@_]; return 0; };

test_psgi $app, sub {
    my $send    = shift;
    my $request = sub {
        my ( $req, $cookie ) = @_;
        $req->header( Cookie => $cookie || $manager_cookie );
        return $send->($req);
    };
    my $path_for = sub {
        my ($suffix) = @_;
        return
              "/editjournal$suffix?usejournal="
            . $comm->user
            . '&itemid='
            . $target->ditemid
            . '&encoded=one%2Ftwo&repeated=a&repeated=b';
    };
    my %forms;
    for my $suffix ( '', '.bml' ) {
        my $path = $path_for->($suffix);
        my $res  = $request->( GET $path );
        is( $res->code, 200, "$suffix manager GET remains retained BML" );
        unlike( $res->content, qr/entry-maintainer-form/,
            "$suffix manager GET is not native maintainer HTML" );
        my $form = form_from( $res->content, $path );
        ok( $form, "$suffix retained manager GET exposes all BML action controls" ) or next;
        for my $action (qw(savemaintainer delete deletespam)) {
            ok( $form->find_input("action:$action"), "$suffix retained GET exposes $action" );
        }
        $forms{$suffix} = $form;
    }

    for my $case ( [ '', 'direct public save', 1 ], [ '.bml', 'submit-value public save', 0 ], ) {
        my ( $suffix, $label, $click ) = @$case;
        my $path = $path_for->($suffix);
        my $form = $forms{$suffix};
        $form->action( 'http://localhost' . $path );
        $form->value( prop_adult_content_maintainer_reason => "$label reason" );
        $form->value( prop_adult_content_maintainer        => 'concepts' );
        $form->value( prop_opt_nocomments_maintainer       => 1 );
        $form->value( submit_value => 'action:savemaintainer' ) unless $click;
        my $post = $click ? clicked( $form, 'action:savemaintainer' ) : $form->make_request;
        $post->uri( 'http://localhost' . $path );
        $post->header( Referer => 'http://localhost' . $path );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $res          = $request->($post);
        is( $res->code,               302,          "$label receives manager public redirect" );
        is( $res->header('Location'), $target->url, "$label uses exact public entry destination" );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            "$label preserves resolver ordering"
        );
        is( $manager_calls, 1, "$label invokes manager resolver exactly once" );
        is( scalar @writes, $write_before + 1, "$label writes exactly once" );
        is_deeply(
            $writes[-1],
            [
                $comm->id,
                $target->jitemid,
                {
                    adult_content_maintainer_reason => "$label reason",
                    adult_content_maintainer        => 'concepts',
                    opt_nocomments_maintainer       => 1
                }
            ],
            "$label forwards only the exact three raw property values"
        );
        is_deeply(
            { map { $_ => state( $comm, $target->ditemid )->{$_} } qw(reason adult nocomments) },
            { reason => "$label reason", adult => 'concepts', nocomments => '1' },
            "$label persists all three properties force-fresh"
        );
        is_deeply( state( $comm, $unrelated->ditemid ),
            $before_other, "$label preserves unrelated entry force-fresh" );
    }

    my $clear_path = $path_for->('.bml');
    my $clear_get  = $request->( GET $clear_path );
    my $clear_form = form_from( $clear_get->content, $clear_path );
    ok( $clear_form, 'clear starts from retained manager form' ) or BAIL_OUT('no clear form');
    $clear_form->action( 'http://localhost' . $clear_path );
    $clear_form->value( prop_adult_content_maintainer_reason => '' );
    $clear_form->value( prop_adult_content_maintainer        => '' );
    $clear_form->find_input('prop_opt_nocomments_maintainer')->disabled(1);
    my $clear_post = clicked( $clear_form, 'action:savemaintainer' );
    $clear_post->header( Referer => 'http://localhost' . $clear_path );
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $writes_before_clear = scalar @writes;
    my $clear_res           = $request->($clear_post);
    is( $clear_res->code, 302, 'public clear redirects to entry' );
    is_deeply(
        \@order,
        [qw(personal same_poster manager)],
        'public clear preserves resolver ordering'
    );
    is( scalar @writes, $writes_before_clear + 1, 'public clear invokes one writer' );
    is_deeply(
        $writes[-1],
        [
            $comm->id,
            $target->jitemid,
            {
                adult_content_maintainer_reason => '',
                adult_content_maintainer        => '',
                opt_nocomments_maintainer       => undef
            }
        ],
        'public clear forwards empty and omitted raw controls exactly'
    );
    is_deeply( state( $comm, $target->ditemid ),
        $before_target, 'public clear restores the exact initial entry state force-fresh' );

    for my $case ( [ 'missing token', undef ], [ 'invalid token', 'bad-public-manager-token' ] ) {
        my ( $label, $token ) = @$case;
        my $get  = $request->( GET $path_for->('') );
        my $form = form_from( $get->content, $path_for->('') );
        $form->action( 'http://localhost' . $path_for->('') );
        $form->value( prop_adult_content_maintainer_reason => "$label mutation" );
        if   ( defined $token ) { $form->value( lj_form_auth => $token ); }
        else                    { $form->find_input('lj_form_auth')->disabled(1); }
        my $post = clicked( $form, 'action:savemaintainer' );
        $post->header( Referer => 'http://localhost' . $path_for->('') );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $res          = $request->($post);
        is( $res->code, 200, "$label manager request receives native error response" );
        like(
            $res->content,
            qr/Invalid form/,
            "$label manager request has localized invalid-form body"
        );
        ok( !defined $res->header('Location'), "$label manager request does not redirect" );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            "$label reaches manager after two declines"
        );
        is( scalar @writes, $write_before, "$label performs zero writes" );
        is_deeply( state( $comm, $target->ditemid ),
            $before_target, "$label leaves target force-fresh unchanged" );
    }

    # These invalid-token controls prove delete surfaces remain BML-owned without
    # allowing either a report marker or an entry deletion to execute.
    for my $action (qw(delete deletespam)) {
        my $get  = $request->( GET $path_for->('') );
        my $form = form_from( $get->content, $path_for->('') );
        $form->action( 'http://localhost' . $path_for->('') );
        $form->value( lj_form_auth => "invalid-$action-token" );
        my $post = clicked( $form, "action:$action" );
        $post->header( Referer => 'http://localhost' . $path_for->('') );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $res = $request->($post);
        is( $res->code, 200, "invalid $action remains retained response" );
        like( $res->content, qr/Invalid form/,
            "invalid $action retains BML invalid-form response" );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            "invalid $action reaches all property resolver positions"
        );
        is( $manager_calls, 1, "invalid $action manager resolver declines exactly once" );
        ok( fresh( $comm, $target->ditemid )->valid, "invalid $action leaves target valid" );
        is_deeply( \@spam_marks, [], "invalid $action never reaches report marker" );
    }

    my $get         = $request->( GET $path_for->('') );
    my $denied_form = form_from( $get->content, $path_for->('') );
    $denied_form->action( 'http://localhost' . $path_for->('') );
    my $denied_post = clicked( $denied_form, 'action:savemaintainer' );
    $denied_post->header( Referer => 'http://localhost' . $path_for->('') );
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $denied = $request->( $denied_post, $outsider_cookie );
    is_deeply(
        \@order,
        [qw(personal same_poster manager)],
        'nonmanager reaches manager then retained fallback'
    );
    is( $manager_calls, 1, 'nonmanager manager resolver declines exactly once' );
    unlike( $denied->content, qr/entry-maintainer-form/,
        'nonmanager remains on retained BML surface' );
    my ($denied_bml_form) = grep { ( $_->attr('id') || '' ) eq 'updateForm' }
        HTML::Form->parse( $denied->content, 'http://localhost' . $path_for->('') );
    ok( $denied_bml_form, 'nonmanager receives the retained disabled edit form' );
    ok(
        $denied_bml_form && !$denied_bml_form->find_input('action:savemaintainer'),
        'nonmanager retained form does not expose a manager property action'
    );
    ok(
        $denied_bml_form && $denied_bml_form->find_input('action:delete')->disabled,
        'nonmanager retained delete control is disabled rather than claimed natively'
    );
    is_deeply( state( $comm, $target->ditemid ),
        $before_target, 'nonmanager leaves target unchanged' );

    # Exercise the public resolver's truthy target/item precedence with a second
    # managed community.  The actual retained form supplies the token and action;
    # only the contradictory hidden values are changed here.
    my $other_comm = temp_comm();
    LJ::set_rel( $other_comm, $manager, 'A' );
    DW::Cache->request->remove( 'rel', $other_comm->userid . '-' . $manager->userid . '-A' );
    my $other_target = $poster->t_post_fake_comm_entry(
        $other_comm,
        subject  => 'Competing manager target',
        body     => 'Competing manager body',
        security => 'public',
    );
    my $other_before = state( $other_comm, $other_target->ditemid );

    # Per-journal ditemids can coincide. Create a real B entry whose composite
    # is absent from A before asserting the cross-community mismatch branch.
    my $mismatch_target;
    for ( 1 .. 12 ) {
        my $candidate = $poster->t_post_fake_comm_entry(
            $other_comm,
            subject  => "Mismatch candidate $_",
            body     => 'Mismatch body',
            security => 'public',
        );
        if ( !fresh( $comm, $candidate->ditemid )->valid ) {
            $mismatch_target = $candidate;
            last;
        }
    }
    ok( $mismatch_target, 'fixture obtains a B composite absent from A' )
        or BAIL_OUT('could not construct cross-community mismatch fixture');
    my $post_manager = sub {
        my ( $path, %values ) = @_;
        my $form_path = delete $values{form_path} || $path;
        my $get       = $request->( GET $form_path );
        my $form = form_from( $get->content, $form_path ) or die "no manager form for $form_path";
        $form->action( 'http://localhost' . $path );
        $form->value( prop_adult_content_maintainer_reason => $values{reason}
                || 'precedence reason' );
        $form->value( prop_adult_content_maintainer  => 'concepts' );
        $form->value( prop_opt_nocomments_maintainer => 1 );

        for my $name (qw(usejournal journal itemid)) {
            $form->value( $name => $values{$name} ) if exists $values{$name};
        }
        my $post = clicked( $form, 'action:savemaintainer' );
        $post->header( Referer => 'http://localhost' . $path );
        return $post;
    };
    my @precedence_cases = (
        [
            'GET usejournal beats POST usejournal',
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $target->ditemid,
            { usejournal => $other_comm->user },
            $comm,
            $target,
            $other_comm,
            $other_target
        ],
        [
            'POST usejournal beats GET journal',
            '/editjournal?journal=' . $other_comm->user . '&itemid=' . $target->ditemid,
            {
                usejournal => $comm->user,
                form_path  => '/editjournal?usejournal='
                    . $comm->user
                    . '&itemid='
                    . $target->ditemid
            },
            $comm, $target,
            $other_comm,
            $other_target
        ],
        [
            'GET itemid beats POST itemid',
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $target->ditemid,
            { itemid => $other_target->ditemid },
            $comm,
            $target,
            $other_comm,
            $other_target
        ],
        [
            'POST-only journal and item select target',
            '/editjournal',
            {
                usejournal => $other_comm->user,
                itemid     => $other_target->ditemid,
                form_path  => '/editjournal?usejournal='
                    . $other_comm->user
                    . '&itemid='
                    . $other_target->ditemid
            },
            $other_comm,
            $other_target,
            $comm, $target
        ],
    );
    for my $case (@precedence_cases) {
        my ( $label, $path, $values, $selected_journal, $selected_entry, $other_journal,
            $other_entry )
            = @$case;
        my $before_selected  = state( $selected_journal, $selected_entry->ditemid );
        my $before_competing = state( $other_journal,    $other_entry->ditemid );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $res          = $request->( $post_manager->( $path, %$values, reason => $label ) );
        is( $res->code, 302, "$label redirects through manager handler" );
        is( $res->header('Location'),
            $selected_entry->url, "$label redirects only to selected entry" );
        is_deeply( \@order, [qw(personal same_poster manager)],
            "$label keeps three-handler order" );
        is( $manager_calls, 1, "$label invokes manager once" );
        is( scalar @writes, $write_before + 1, "$label writes selected entry once" );
        is( state( $selected_journal, $selected_entry->ditemid )->{reason},
            $label, "$label changes selected entry force-fresh" );
        is_deeply( state( $other_journal, $other_entry->ditemid ),
            $before_competing, "$label preserves competing entry force-fresh" );
    }

    # Unsupported/actionless controls remain BML-owned after all three public
    # resolvers decline.  They use the other-poster manager form, so retained
    # disabled-save handling cannot mutate the entry.
    for my $action ( undef, 'action:unknown', 'action:spellcheck' ) {
        my $case_before = state( $comm, $target->ditemid );
        my $get         = $request->( GET $path_for->('') );
        my $form = form_from( $get->content, $path_for->('') ) or die 'no retained manager form';
        $form->action( 'http://localhost' . $path_for->('') );
        if ( defined $action ) { $form->value( $action => 1 ); }
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $res          = $request->( $form->make_request );
        is( $res->code, 200,
            ( defined $action ? $action : 'actionless' ) . ' remains retained BML response' );
        is_deeply( \@order, [qw(personal same_poster manager)],
            ( defined $action ? $action : 'actionless' )
                . ' reaches and declines manager resolver' );
        is( $manager_calls, 1,
            ( defined $action ? $action : 'actionless' ) . ' manager invocation is a decline' );
        is( scalar @writes,
            $write_before,
            ( defined $action ? $action : 'actionless' ) . ' causes no property write' );
        is_deeply( state( $comm, $target->ditemid ),
            $case_before, ( defined $action ? $action : 'actionless' ) . ' retains target state' );
    }

    # A real personal save request is claimed by the pre-existing owned
    # handler. A retained manager token is session-scoped and supplies the same
    # form-auth boundary without involving a manager property form submission.
    my $personal_entry = $manager->t_post_fake_entry(
        subject  => 'Personal resolver entry',
        body     => 'Personal resolver body',
        security => 'private',
    );
    my $personal_path = '/editjournal?itemid=' . $personal_entry->ditemid;
    my $personal_post = POST 'http://localhost' . $personal_path,
        [
        'action:save' => 1,
        itemid        => $personal_entry->ditemid,
        subject       => 'Personal resolver changed',
        event         => 'Personal resolver body',
        lj_form_auth  => $forms{''}->value('lj_form_auth'),
        ];
    $personal_post->header( Referer => 'http://localhost' . $personal_path );
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $personal_res = $request->($personal_post);
    isnt( $personal_res->code, 500, 'personal prior-handler save has a concrete response' );
    is_deeply( \@order, ['personal'], 'defined personal handler stops manager resolver chain' );
    is( $manager_calls, 0, 'defined personal handler never reaches manager property handler' );
    is(
        fresh( $manager, $personal_entry->ditemid )->subject_raw,
        'Personal resolver changed',
        'prior personal handler performs its ordinary save unchanged'
    );

    # Direct negative manager actions use invalid tokens only: retained BML may
    # render its error, but no report/delete/property effect can execute.
    for my $action (qw(save delete deletespam)) {
        my $path = $path_for->('');
        my $post = POST 'http://localhost' . $path,
            [
            "action:$action" => 1,
            itemid           => $target->ditemid,
            usejournal       => $comm->user,
            lj_form_auth     => "invalid-negative-$action",
            ];
        $post->header( Referer => 'http://localhost' . $path );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $spam_before  = scalar @spam_marks;
        my $res          = $request->($post);
        is( $res->code, 200, "invalid $action stays BML-owned" );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            "invalid $action reaches all resolvers"
        );
        is( $manager_calls,     1,             "invalid $action manager resolver declines" );
        is( scalar @writes,     $write_before, "invalid $action has zero property writers" );
        is( scalar @spam_marks, $spam_before,  "invalid $action has zero report markers" );
        ok( fresh( $comm, $target->ditemid )->valid, "invalid $action leaves target valid" );
    }

    # Bad authas, malformed item, personal target, and non-community target
    # must all decline before manager effects. Use invalid tokens so retained
    # BML cannot perform a fallback mutation while its response is observed.
    my $personal_target = $outsider->t_post_fake_entry(
        subject  => 'Noncommunity target',
        body     => 'Noncommunity body',
        security => 'private',
    );
    my @ineligible = (
        [
            'invalid authas',
            '/editjournal?authas=not_a_real_user&usejournal='
                . $comm->user
                . '&itemid='
                . $target->ditemid
        ],
        [ 'malformed item', '/editjournal?usejournal=' . $comm->user . '&itemid=not-a-ditemid' ],
        [
            'personal target',
            '/editjournal?usejournal=' . $manager->user . '&itemid=' . $personal_target->ditemid
        ],
        [
            'noncommunity target',
            '/editjournal?usejournal=' . $outsider->user . '&itemid=' . $personal_target->ditemid
        ],
        [
            'actor self target collapse',
            '/editjournal?usejournal=' . $manager->user . '&itemid=' . $target->ditemid
        ],
        [
            'community/item mismatch',
            '/editjournal?usejournal=' . $comm->user . '&itemid=' . $mismatch_target->ditemid
        ],
    );
    ok( !fresh( $comm, $mismatch_target->ditemid )->valid,
        'fixture precondition: mismatch composite does not resolve in selected community' );
    for my $case (@ineligible) {
        my ( $label, $path ) = @$case;
        my $managed_before = state( $comm, $target->ditemid );
        my $post           = POST 'http://localhost' . $path,
            [
            'action:savemaintainer' => 1,
            itemid                  => $target->ditemid,
            usejournal              => $comm->user,
            lj_form_auth            => 'invalid-ineligible-' . $label,
            ];
        $post->header( Referer => 'http://localhost' . $path );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        my $res          = $request->($post);
        is( $res->code,     200,           "$label remains a retained response" );
        is( $manager_calls, 1,             "$label reaches manager only to decline" );
        is( scalar @writes, $write_before, "$label has zero property writes" );
        is_deeply( state( $comm, $target->ditemid ),
            $managed_before, "$label preserves the managed target" );
    }

    # A same-poster community edit is a defined earlier handler result, so the
    # manager adapter is never called. This is a small real-save wiring check.
    my $same_target = $manager->t_post_fake_comm_entry(
        $comm,
        subject  => 'Same poster target',
        body     => 'Same poster body',
        security => 'public',
    );
    my $same_path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $same_target->ditemid;
    my $same_post = POST 'http://localhost' . $same_path,
        [
        'action:save' => 1,
        itemid        => $same_target->ditemid,
        usejournal    => $comm->user,
        subject       => 'Same poster changed',
        event         => 'Same poster body',
        lj_form_auth  => $forms{''}->value('lj_form_auth'),
        ];
    $same_post->header( Referer => 'http://localhost' . $same_path );
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $same_res = $request->($same_post);
    isnt( $same_res->code, 500, 'same-poster prior handler has a concrete response' );
    is_deeply(
        \@order,
        [qw(personal same_poster)],
        'defined same-poster handler stops manager resolver chain'
    );
    is( $manager_calls, 0, 'defined same-poster handler never reaches manager property handler' );
    is(
        fresh( $comm, $same_target->ditemid )->subject_raw,
        'Same poster changed',
        'same-poster prior handler performs its ordinary save unchanged'
    );

    # Retained editjournal permits this property-only action even when either
    # effective manager or community is readonly; preserve that behavior at the
    # public dispatcher rather than inventing a new policy.
    my $is_readonly = \&LJ::User::is_readonly;
    for my $readonly_case ( [ 'readonly manager', $manager ], [ 'readonly community', $comm ], ) {
        my ( $label, $readonly_user ) = @$readonly_case;
        my $post = $post_manager->( $path_for->(''), reason => $label );
        $personal_calls = $same_calls = $manager_calls = 0;
        @order          = ();
        my $write_before = scalar @writes;
        local *LJ::User::is_readonly = sub {
            return 1 if $_[0]->id == $readonly_user->id;
            return $is_readonly->(@_);
        };
        my $res = $request->($post);
        is( $res->code, 302, "$label manager property request preserves retained redirect" );
        is( $res->header('Location'), $target->url, "$label keeps exact entry destination" );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            "$label reaches manager after prior declines"
        );
        is( scalar @writes, $write_before + 1, "$label performs its one property write" );
        is( state( $comm, $target->ditemid )->{reason},
            $label, "$label writes force-fresh property state" );
    }

    # The manager helper declines sysbanned communities before its auth/write
    # boundary, leaving retained BML responsible for the response and state.
    my $sysban_get  = $request->( GET $path_for->('') );
    my $sysban_form = form_from( $sysban_get->content, $path_for->('') )
        or die 'no sysban manager form';
    $sysban_form->action( 'http://localhost' . $path_for->('') );
    $sysban_form->value( prop_adult_content_maintainer_reason => 'must not write under sysban' );
    my $sysban_post = clicked( $sysban_form, 'action:savemaintainer' );
    $sysban_post->header( Referer => 'http://localhost' . $path_for->('') );
    my $auth_calls      = 0;
    my $check_form_auth = \&LJ::check_form_auth;
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $sysban_before = state( $comm, $target->ditemid );
    my $sysban_writes = scalar @writes;
    {
        local *LJ::sysban_check =
            sub { return 1 if $_[0] eq 'spamreport' && $_[1] eq $comm->user; return 0; };
        local *LJ::check_form_auth = sub { ++$auth_calls; return $check_form_auth->(@_); };
        my $res = $request->($sysban_post);
        is( $res->code, 200, 'sysban keeps retained BML response' );
        is_deeply(
            \@order,
            [qw(personal same_poster manager)],
            'sysban reaches manager only to decline'
        );
        is( scalar @writes, $sysban_writes, 'sysban performs no property write' );
    }

    # BML may validate its retained form token after the adapter declines; the
    # visible response/state rather than a global auth counter proves ordering.
    is_deeply( state( $comm, $target->ditemid ),
        $sysban_before, 'sysban leaves target force-fresh unchanged' );

    # A denied request must not leak resolver state into the next valid request.
    my $valid_again = $post_manager->( $path_for->(''), reason => 'after denied request' );
    $personal_calls = $same_calls = $manager_calls = 0;
    @order          = ();
    my $after_denied = $request->($valid_again);
    is( $after_denied->code, 302, 'valid request after denied/fallback request redirects' );
    is_deeply(
        \@order,
        [qw(personal same_poster manager)],
        'valid request after denial has fresh resolver order'
    );
    is( $manager_calls, 1, 'valid request after denial invokes exactly one manager handler' );
    is(
        state( $comm, $target->ditemid )->{reason},
        'after denied request',
        'valid request after denial changes only its original target'
    );
};

done_testing;

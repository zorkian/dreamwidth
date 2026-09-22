# Characterize the read-only entry picker before separating the legacy editor.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use URI;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user temp_comm);
plan skip_all => 'Picker integration requires a development server' unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $owner    = temp_user();
my $outsider = temp_user();
$owner->update_self( { status => "A" } );
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'entryPickerBaseline';
my @entries = map {
    $owner->t_post_fake_entry(
        subject  => "Picker subject $_",
        body     => "Picker body $_",
        security => $_ == 1 ? 'private' : 'public'
    )
} 1 .. 6;
my %ids = map { $_->ditemid => 1 } @entries;

sub picker_forms {
    return HTML::Form->parse( $_[0], 'http://localhost/editjournal' );
}

sub entry_ids {
    my @ids = sort { $a <=> $b } map { $_->value('itemid') }
        grep { $_->find_input('itemid') } picker_forms( $_[0] );
    return @ids;
}
test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };
    for my $path ( '/editjournal', '/editjournal.bml' ) {
        my $res = $cb->( GET $path);
        is( $res->code, 200, "$path renders directly" );
        unlike(
            $res->content,
            qr/undef error|DieObject=|BML ERROR/,
            'picker is not an exception response'
        );
        my ($form) = grep { $_->find_input('selecttype') } picker_forms( $res->content );
        ok( $form, 'actual selector form exists' ) or next;
        is( $form->value('selecttype'), 'last', 'selector defaults to latest entry' );
        is( $form->value('howmany'),    20,     'recent selector defaults to twenty' );
        my @listed = entry_ids( $res->content );
        is( scalar @listed, 5, 'initial page lists five entries' );
        ok( !grep( { !$ids{$_} } @listed ), 'all initial forms carry real composite entry IDs' );
        $form->value( 'selecttype', 'lastn' );
        $form->value( 'howmany',    6 );
        $res = $cb->( $form->click );
        is( $res->code, 200, 'read-only selector POST renders multiple matches' );
        is_deeply(
            [ entry_ids( $res->content ) ],
            [ sort { $a <=> $b } keys %ids ],
            'recent selector returns all exact personal entry IDs, including private'
        );
        like( $res->content, qr/Picker body 1/,    'owner sees private entry summary' );
        like( $res->content, qr/Picker subject 6/, 'result retains subject' );
        $form->value( 'selecttype', 'last' );
        $res = $cb->( $form->click );
        is( $res->code, 302, 'single match redirects to editor entry point' );
        my $location = URI->new_abs( $res->header('Location') || '', 'http://localhost' );
        is( $location->path, '/editjournal', 'single match retains existing edit URL' );
        my %query = $location->query_form;
        ok( $ids{ $query{itemid} || 0 }, 'redirect retains a real composite entry ID' );
        $form->value( 'selecttype', 'day' );
        $form->value( 'year',       1970 );
        $form->value( 'month',      1 );
        $form->value( 'day',        1 );
        $res = $cb->( $form->click );
        like(
            $res->content,
            qr/No entries match the criteria/,
            'empty date has criteria-specific message'
        );
        is( scalar entry_ids( $res->content ), 0, 'empty date renders no edit forms' );
    }
    my $res = $cb->( GET '/editjournal?authas=' . $outsider->user );
    like(
        $res->content,
        qr/You couldn.t be authenticated as the specified account/,
        'unauthorized authas is denied'
    );
    is( scalar entry_ids( $res->content ), 0, 'unauthorized authas exposes no entry forms' );
    $res = $send->( GET '/editjournal' );
    is( scalar entry_ids( $res->content ), 0, 'logged-out visitor sees no entry forms' );
    unlike( $res->content, qr/Picker body/, 'logged-out visitor sees no entry summaries' );
    for my $entry (@entries) {
        my $fresh = LJ::Entry->new( $owner, ditemid => $entry->ditemid );
        ok( $fresh->valid, 'read-only selection leaves entry present' );
        is( $fresh->event_raw, $entry->event_raw, 'selection leaves persisted body unchanged' );
    }
};

test_psgi $app, sub {
    my $send  = shift;
    my $cb    = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };
    my $comm  = temp_comm();
    my $empty = temp_comm();
    LJ::set_rel( $comm,  $owner, 'A' );
    LJ::set_rel( $empty, $owner, 'A' );
    $outsider->update_self( { status => 'A' } );
    my $own_entry = $owner->t_post_fake_comm_entry( $comm, body => 'Manager community body' );
    my $other_entry =
        $outsider->t_post_fake_comm_entry( $comm, body => 'Other poster community body' );
    my @expected = sort { $a <=> $b } ( $own_entry->ditemid, $other_entry->ditemid );

    for my $key ( 'usejournal', 'journal' ) {
        my $res = $cb->( GET '/editjournal?' . $key . '=' . $comm->user );
        is_deeply( [ entry_ids( $res->content ) ],
            \@expected, "maintainer sees both posters through $key context" );
        like(
            $res->content,
            qr/Other poster community body/,
            'visible other-poster summary is retained'
        );
        for my $form ( grep { $_->find_input('itemid') } picker_forms( $res->content ) ) {
            my %query = $form->action->query_form;
            is( $query{usejournal}, $comm->user, 'entry form preserves community context' );
        }
    }
    my $res = $cb->(
        POST '/editjournal?usejournal=' . $comm->user,
        Content => [
            mode       => 'edit',
            selecttype => 'lastn',
            howmany    => 20,
            usejournal => $empty->user
        ]
    );
    is_deeply( [ entry_ids( $res->content ) ],
        \@expected, 'GET usejournal takes precedence over POST' );
    $res = $cb->(
        POST '/editjournal?journal=' . $empty->user,
        Content => [
            mode       => 'edit',
            selecttype => 'lastn',
            howmany    => 20,
            usejournal => $comm->user
        ]
    );
    is_deeply( [ entry_ids( $res->content ) ],
        \@expected, 'POST usejournal takes precedence over journal alias' );
    $res = $cb->(
        POST '/editjournal',
        Content => [
            mode       => 'edit',
            selecttype => 'lastn',
            howmany    => 20,
            usejournal => $empty->user
        ]
    );
    like(
        $res->content,
        qr/The selected journal has no entries/,
        'empty recent selection has journal-specific message'
    );
    $res = $cb->( GET '/editjournal?authas=' . $comm->user );
    is( scalar entry_ids( $res->content ),
        0, 'managed community cannot impersonate individual picker actor' );
    $comm->update_self( { statusvis => 'O' } );
    $res = $cb->(
        POST '/editjournal',
        Content => [
            mode       => 'edit',
            selecttype => 'lastn',
            howmany    => 20,
            usejournal => $comm->user
        ]
    );
    is_deeply( [ entry_ids( $res->content ) ],
        \@expected, 'read-only community remains selectable by manager' );
    $comm->update_self( { statusvis => 'V' } );
    $res =
        $cb->( GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $other_entry->ditemid );
    is( $res->code, 200, 'manager other-poster editor remains reachable without beta redirect' );
    my @forms = picker_forms( $res->content );
    ok(
        scalar( grep { $_->find_input('action:delete') } @forms ),
        'manager retains legacy delete action for another poster'
    );
    ok(
        scalar( grep { $_->find_input('action:savemaintainer') } @forms ),
        'manager retains legacy maintainer controls for another poster'
    );
};
done_testing;

#!/usr/bin/perl
# Characterize callable ordinary owned legacy edit posting without route registration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request;
use HTML::Form;
use Scalar::Util qw(refaddr);
use lib "$ENV{LJHOME}/cgi-bin";
use DW::Request::Standard;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Entry;
use LJ::Test qw(temp_user);

{

    package LegacyEditFixture::Account;
    sub acctid      { return $_[0]{acctid} }
    sub displayname { return $_[0]{name} }
}

sub fresh_entry {
    my ( $owner, $ditemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $owner, ditemid => $ditemid );
}

sub begin_request {
    my ($path) = @_;
    DW::Request->reset;
    my $request =
        DW::Request::Standard->new( HTTP::Request->new( GET => "http://localhost$path" ) );
    $request->header_in( Host => 'localhost' );
    return $request;
}

sub ordinary_post {
    my (%opts) = @_;
    return {
        'action:save'      => 1,
        subject            => $opts{subject} || 'Legacy adapter subject',
        prop_current_music => 'raw post music',
        event              => $opts{event} || 'Legacy adapter body',
        security           => 'private',
        date_ymd_yyyy      => '2020',
        date_ymd_mm        => '02',
        date_ymd_dd        => '03',
        hour               => '04',
        min                => '05',
        date_diff          => 1,
    };
}

sub owned_entry_pair {
    my $owner = temp_user();
    $owner->update_self( { status => 'A' } );
    my $entry = $owner->t_post_fake_entry( subject => 'Original subject', body => 'Original body' );
    my $other = $owner->t_post_fake_entry( subject => 'Other subject',    body => 'Other body' );
    return ( $owner, $entry, $other );
}

{
    my ( $owner, $entry, $other ) = owned_entry_pair();
    my @spam;
    my $decoded_request;
    my @saved;
    my @scheduled;
    my $account = bless { acctid => 23, name => 'Adapter account' }, 'LegacyEditFixture::Account';
    no warnings 'redefine';
    my $decode_entry_form = \&DW::Entry::Legacy::decode_entry_form;
    local *DW::Entry::Legacy::decode_entry_form = sub {
        my $decoded = $decode_entry_form->(@_);
        $decoded_request = $decoded;
        $decoded_request->{prop_current_music} = 'decoded hook music';
        return $decoded;
    };
    local *LJ::Hooks::run_hooks = sub {
        push @spam, [@_] if $_[0] eq 'spam_check';
        return;
    };
    local *DW::Entry::_save_editted_entry = sub {
        my ( $ditemid, $canonical ) = @_;
        push @saved, [ $ditemid, $canonical->{event}, $canonical->{subject} ];
        return { url => '/entry/legacy-adapter/257' };
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *LJ::Protocol::schedule_xposts         = sub {
        my ( $scheduler, $ditemid, $deleted, $callback ) = @_;
        push @scheduled, [ $scheduler->id, $ditemid, $deleted, [ $callback->($account) ] ];
        return ( [], [] );
    };

    my $request = begin_request('/editjournal?encoded=one%2Ftwo&repeat=first&repeat=second');
    my %result  = DW::Controller::Entry::legacy_owned_edit_post(
        entry          => $entry,
        remote         => $owner,
        journal        => $owner,
        session_remote => $owner,
        post           => ordinary_post(),
        get            => { prop_xpost_check => 1, prop_xpost_23 => 'selected-from-get' },
    );
    is( $result{status}, 'ok', 'callable legacy save returns the real success response' );
    is_deeply(
        \@saved,
        [ [ $entry->ditemid, 'Legacy adapter body', 'Legacy adapter subject' ] ],
        'callable legacy save uses the resolved entry and prepared canonical fields'
    );
    is_deeply(
        \@scheduled,
        [
            [
                $owner->id,
                $entry->ditemid,
                0,
                [
                    'selected-from-get',
                    { password => undef, auth_challenge => undef, auth_response => undef }
                ]
            ]
        ],
        'legacy save uses raw GET master, session remote, and callback at the scheduler boundary'
    );
    is( scalar @spam, 1,      'callable legacy save invokes spam_check exactly once' );
    is( $spam[0][1],  $owner, 'callable legacy save supplies the owner as spam actor' );
    is( $spam[0][2]{event}, 'Legacy adapter body', 'spam hook receives the decoded legacy body' );
    is(
        refaddr( $spam[0][2] ),
        refaddr($decoded_request),
        'spam hook receives the exact decoded request reference'
    );
    isnt(
        refaddr( $spam[0][2] ),
        refaddr( ordinary_post() ),
        'spam hook does not receive an unrelated raw post hash'
    );
    is(
        $spam[0][2]{prop_current_music},
        'decoded hook music',
        'spam hook sees metadata transformed by the decode hook'
    );
    like(
        $request->response_content,
        qr/Your edit was successful\./,
        'real success response is rendered from the callable save'
    );

    my $fresh_entry = fresh_entry( $owner, $entry->ditemid );
    is(
        $fresh_entry->subject_raw,
        'Original subject',
        'stubbed save leaves the owned entry unchanged'
    );
    my $fresh_other = fresh_entry( $owner, $other->ditemid );
    is( $fresh_other->event_raw, 'Other body',
        'callable save leaves unrelated persisted entries unchanged' );
    DW::Request->reset;
}

{
    my ( $owner, $entry, $other ) = owned_entry_pair();
    my @order;
    no warnings 'redefine';
    local *LJ::User::log_event = sub {
        my ( $journal, $type, $opts ) = @_;
        push @order, [ log => $type, $opts->{actiontarget} ];
        return;
    };
    local *LJ::Hooks::run_hooks = sub {
        push @order, [ spam => $_[2]{event} ] if $_[0] eq 'spam_check';
        return;
    };
    local *DW::Entry::_save_editted_entry = sub {
        my ( $ditemid, $canonical ) = @_;
        push @order, [ save => $ditemid, $canonical->{event} ];
        return { url => '/entry/legacy-adapter/257' };
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };

    my $post = ordinary_post( event => 'Must be cleared before delete' );
    $post->{'action:delete'} = 1;
    delete $post->{'action:save'};
    begin_request('/editjournal?itemid=forged');
    my %result = DW::Controller::Entry::legacy_owned_edit_post(
        entry          => $entry,
        remote         => $owner,
        journal        => $owner,
        session_remote => $owner,
        post           => $post,
        get            => {},
    );
    is( $result{status}, 'ok', 'callable legacy delete returns a real success response' );
    is_deeply(
        \@order,
        [
            [ log  => 'delete_entry',  $entry->ditemid ],
            [ spam => '' ],
            [ save => $entry->ditemid, '' ],
        ],
        'legacy delete clears flat and canonical bodies before log, spam, and save'
    );
    is(
        fresh_entry( $owner, $entry->ditemid )->event_raw,
        'Original body',
        'stubbed delete leaves the resolved entry unchanged'
    );
    is( fresh_entry( $owner, $other->ditemid )->event_raw,
        'Other body', 'stubbed delete leaves unrelated entries unchanged' );
    DW::Request->reset;
}

{
    my ( $owner, $entry ) = owned_entry_pair();
    no warnings 'redefine';
    local *DW::Entry::Legacy::prepare_entry_form =
        sub { die 'unsupported action must not prepare' };
    local *LJ::Hooks::run_hooks = sub { die 'unsupported action must not invoke spam hook' };
    my $post = ordinary_post();
    delete $post->{'action:save'};
    $post->{'action:deletespam'} = 1;
    begin_request('/editjournal');
    my @result = DW::Controller::Entry::legacy_owned_edit_post(
        entry   => $entry,
        remote  => $owner,
        journal => $owner,
        post    => $post,
    );
    is( scalar @result, 0, 'unsupported spam-delete action falls through before effects' );
    DW::Request->reset;
}

{
    my ( $owner, $entry, $other ) = owned_entry_pair();
    no warnings 'redefine';
    local *DW::Entry::_save_editted_entry =
        sub { return { errors => 'Legacy retry error marker' } };
    my $errors   = DW::FormErrors->new;
    my $warnings = DW::FormErrors->new;
    my $request  = begin_request('/editjournal?encoded=one%2Ftwo&repeat=first&repeat=second');
    my %result   = DW::Controller::Entry::legacy_owned_edit_post(
        entry          => $entry,
        remote         => $owner,
        journal        => $owner,
        session_remote => $owner,
        post           => ordinary_post( subject => 'Retry subject', event => 'Retry body' ),
        get            => {},
        errors         => $errors,
        warnings       => $warnings,
    );
    is( $result{status}, 'rerender',
        'failed callable save rerenders through the native owned-edit template' );
    my ($form) = grep { $_->find_input('subject') && $_->find_input('event') }
        HTML::Form->parse( $request->response_content, 'http://localhost' );
    ok( $form, 'failed callable save renders a native owned-edit form' )
        or BAIL_OUT('missing native rerender form');
    is(
        $form->action,
        'http://localhost/entry/'
            . $owner->user . '/'
            . $entry->ditemid
            . '/edit?encoded=one%2Ftwo&repeat=first&repeat=second',
        'failed callable save preserves query and targets the modern owned-edit action'
    );
    is( $form->value('subject'), 'Retry subject',
        'failed callable save retains submitted subject' );
    is( $form->value('event'), 'Retry body', 'failed callable save retains submitted body' );

    # Actual Foundation HTTP error visibility is covered by the retained-form
    # integration test; this direct helper fixture checks error classification.
    is_deeply(
        [ map { $_->{message} } @{ $errors->get_all } ],
        ['Legacy retry error marker'],
        'failed callable save records the backend error exactly once'
    );
    ok( !$warnings->exist, 'failed callable save does not duplicate its error as a warning' );
    is(
        fresh_entry( $owner, $entry->ditemid )->subject_raw,
        'Original subject',
        'failed callable save leaves the owned entry unchanged'
    );
    is( fresh_entry( $owner, $other->ditemid )->event_raw,
        'Other body', 'failed callable save leaves unrelated entries unchanged' );
    DW::Request->reset;
}

done_testing;

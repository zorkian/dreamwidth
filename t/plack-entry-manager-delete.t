#!/usr/bin/perl
# Characterize retained other-poster community deletion before manager migration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use Scalar::Util qw(refaddr);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Manager deletion integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub legacy_manager_form {
    my ($content) = @_;
    return (
        grep {
                   $_->find_input('action:savemaintainer')
                && $_->find_input('action:delete')
                && $_->find_input('lj_form_auth')
        } HTML::Form->parse( $content, 'http://localhost/editjournal' )
    )[0];
}

sub fresh_entry {
    my ( $journal, $ditemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $journal, ditemid => $ditemid );
}

my $manager = temp_user();
my $poster  = temp_user();
my $comm    = temp_comm();
$manager->update_self( { status => 'A' } );
$poster->update_self(  { status => 'A' } );
$manager->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $manager->userid, 'A' );

my $target = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Manager delete target subject',
    body     => 'Manager delete target body',
    security => 'public',
);
LJ::set_logprop( $comm, $target->jitemid, { opt_preformatted => 1, opt_nocomments => 1 } );
my $unrelated = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Manager delete unrelated subject',
    body     => 'Manager delete unrelated body',
    security => 'public',
);
LJ::set_logprop( $comm, $unrelated->jitemid, { opt_preformatted => 1, opt_nocomments => 1 } );

my $session = LJ::Session->create( $manager, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'managerDeleteCharacterization';

my $target_before    = fresh_entry( $comm, $target->ditemid );
my $unrelated_before = fresh_entry( $comm, $unrelated->ditemid );
my %unrelated        = (
    subject          => $unrelated_before->subject_raw,
    body             => $unrelated_before->event_raw,
    security         => $unrelated_before->security,
    opt_preformatted => $unrelated_before->prop('opt_preformatted') || 0,
    opt_nocomments   => $unrelated_before->prop('opt_nocomments') || 0,
);

my @order;
my ( $decode_post_ref, $decode_request_ref, $spam_request_ref, $protocol_request_ref );
my ( $decoded_post, $decoded_request, $spam_request );
my $crosspost_calls     = 0;
my $spam_mark_calls     = 0;
my $original_log_event  = \&LJ::User::log_event;
my $original_run_hooks  = \&LJ::Hooks::run_hooks;
my $original_do_request = \&LJ::do_request;

no warnings 'redefine';
local *LJ::User::log_event = sub {
    push @order, 'delete_log' if $_[1] eq 'delete_entry';
    return $original_log_event->(@_);
};
local *LJ::Hooks::run_hooks = sub {
    my ( $name, @args ) = @_;
    if ( $name eq 'decode_entry_form' ) {
        push @order, 'decode';
        ( $decode_post_ref, $decode_request_ref ) = map { refaddr($_) } @args;
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
local *LJ::do_request = sub {
    push @order, 'protocol' if $_[0]{mode} && $_[0]{mode} eq 'editevent';
    $protocol_request_ref = refaddr( $_[0] ) if $_[0]{mode} && $_[0]{mode} eq 'editevent';
    return $original_do_request->(@_);
};
local *LJ::Protocol::schedule_xposts = sub { ++$crosspost_calls; return ( [], [] ); };
local *LJ::mark_entry_as_spam        = sub { ++$spam_mark_calls; return 1; };
local $LJ::HOOKS{entry_deleted_page_extras} =
    [ sub { return '<span id="manager-delete-extra">local extra</span>'; } ];

test_psgi $app, sub {
    my $send    = shift;
    my $request = sub {
        my ($req) = @_;
        $req->header( Cookie => $cookie );
        return $send->($req);
    };

    my $path = '/editjournal?usejournal=' . $comm->user . '&itemid=' . $target->ditemid;
    my $res  = $request->( GET $path );
    is( $res->code, 200, 'authenticated manager receives retained editor response' );
    my $form = legacy_manager_form( $res->content );
    ok( $form, 'retained manager form has visible maintainer and delete controls' )
        or BAIL_OUT('retained manager delete form missing');
    my $delete_input = $form->find_input('action:delete');
    ok( $delete_input && $delete_input->can('click') && length( $delete_input->value || '' ),
        'delete control is a truthy clickable rendered input' );
    is(
        $form->value('subject'),
        'Manager delete target subject',
        'form carries selected target subject'
    );
    is( $form->value('event'), 'Manager delete target body', 'form carries selected target body' );
    is( $form->value('itemid'), $target->ditemid, 'form carries retained hidden selected itemid' );
    ok( fresh_entry( $comm, $target->ditemid )->valid, 'GET leaves selected target intact' );

    $form->action( 'http://localhost' . $path );
    my $delete = $form->click('action:delete');
    $delete->header( Referer => 'http://localhost' . $path );
    $res = $request->($delete);

    is( $res->code, 200, 'actual retained manager delete returns its result body' );
    like(
        $res->content,
        qr/entry.*(?:deleted|removed)|deleted/i,
        'retained manager delete returns a meaningful success response'
    );
    like( $res->content, qr/id="manager-delete-extra"/,
        'retained delete appends local deletion success extras' );
    is( $crosspost_calls, 0, 'delete fixture does not schedule external crossposts' );
    is( $spam_mark_calls, 0, 'ordinary delete does not invoke spam-report transport' );
    is_deeply(
        \@order,
        [qw(decode delete_log spam_check protocol)],
        'retained delete orders decode, log, spam check, then protocol request'
    );
    ok( $decode_post_ref, 'decode hook receives a real flat retained POST hash' );
    is( $decoded_post->{'action:delete'},
        $delete_input->value,
        'clicked delete value is present in the exact decoded flat POST seed' );
    is(
        $decoded_post->{itemid},
        $form->value('itemid'),
        'decoded flat POST retains the hidden journal itemid seed'
    );
    is( $decoded_request->{mode}, 'editevent',
        'decoded request retains the legacy edit mode seed' );
    is( $decoded_request->{user},
        $manager->user, 'decoded request retains the authenticated manager seed' );
    is( $decoded_request->{usejournal},
        $comm->user, 'decoded request retains the community journal seed' );
    is( $decoded_request->{itemid},
        $target_before->jitemid,
        'decoded request converts the hidden ditemid to the target journal itemid seed' );
    is( $spam_request->{event},
        '', 'delete empties the decoded event before spam check and protocol' );
    is( $decode_request_ref, $spam_request_ref,
        'spam_check receives the exact decoded request reference' );
    is( $spam_request_ref, $protocol_request_ref,
        'protocol receives the exact decoded request reference after spam_check' );

    my $deleted = fresh_entry( $comm, $target->ditemid );
    ok( !$deleted->valid, 'forced-fresh selected other-poster entry is deleted' );
    my $still_there = fresh_entry( $comm, $unrelated->ditemid );
    ok( $still_there->valid, 'forced-fresh unrelated other-poster entry survives' );
    is( $still_there->subject_raw, $unrelated{subject}, 'unrelated subject is preserved exactly' );
    is( $still_there->event_raw,   $unrelated{body},    'unrelated body is preserved exactly' );
    is( $still_there->security, $unrelated{security}, 'unrelated security is preserved exactly' );
    is(
        $still_there->prop('opt_preformatted') || 0,
        $unrelated{opt_preformatted},
        'unrelated formatting property is preserved exactly'
    );
    is(
        $still_there->prop('opt_nocomments') || 0,
        $unrelated{opt_nocomments},
        'unrelated comment property is preserved exactly'
    );
};

done_testing;

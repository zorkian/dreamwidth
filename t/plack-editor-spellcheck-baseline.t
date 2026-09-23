#!/usr/bin/perl
# Characterize configured legacy editor spellcheck without persistence.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use URI;
use HTML::Form;
use Plack::Test;
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::SpellCheck;
use LJ::Test qw(temp_user);
use LJ::Userpic;

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

sub edit_form {
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' && $_->find_input('itemid') }
            HTML::Form->parse( $_[0], 'http://localhost/editjournal.bml' ) )[0];
}

sub fresh_draft_properties {
    my ($user) = @_;
    my $frozen = $user->prop('draft_properties') || '';
    return {} unless length $frozen;
    return thaw($frozen);
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

local $LJ::SPELLER = 'local-stub';
my @checked;
no warnings 'redefine';
local *LJ::SpellCheck::check_html = sub {
    my ( $self, $body ) = @_;
    push @checked, $$body;
    return $$body =~ /misspell/ ? '<em>suggestion</em>' : '';
};
test_psgi $app, sub {
    my $send    = shift;
    my $request = sub { my ($req) = @_; $req->header( Cookie => $cookie ); return $send->($req); };
    {
        local $LJ::SPELLER;
        my $disabled = $request->( GET '/update.bml' );
        is( $disabled->code, 200, 'legacy update renders with spellcheck disabled' );
        my $disabled_form = update_form( $disabled->content );
        ok( $disabled_form, 'disabled legacy update form parses' );
        ok(
            !$disabled_form->find_input('action:spellcheck'),
            'disabled legacy update omits the spellcheck control'
        );
    }

    my $res = $request->( GET '/update.bml' );
    is( $res->code, 200, 'legacy update renders' );
    my $form = update_form( $res->content );
    ok( $form,                                  'legacy update form parses' );
    ok( $form->find_input('action:spellcheck'), 'configured legacy update shows spellcheck' );
    my ($before) =
        $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $owner_id );
    $form->action('http://localhost/update.bml');
    $form->value( subject               => 'Spell subject' );
    $form->value( event                 => 'misspell body' );
    $form->value( prop_taglist          => 'spell-tag-one, spell-tag-two' );
    $form->value( prop_current_location => 'Spellcheck location marker' );
    $form->value( prop_current_music    => 'Spellcheck music marker' );
    $form->value( security              => 'private' );
    $form->value( date_ymd_yyyy         => 2024 );
    $form->value( date_ymd_mm           => 2 );
    $form->value( date_ymd_dd           => 3 );
    $form->value( hour                  => '04' );
    $form->value( min                   => '05' );
    $form->value( opt_backdated         => 1 ) if $form->find_input('opt_backdated');
    $form->value( switched_rte_on       => 1 ) if $form->find_input('switched_rte_on');
    ok( $owner->set_draft_text('Spellcheck draft body'),
        'seeded draft remains outside spellcheck' );
    $owner->set_prop( 'draft_properties', nfreeze( { subject => 'Spellcheck draft subject' } ) );
    $res = $request->( $form->click('action:spellcheck') );
    is( $res->code, 200, 'spellcheck response renders' );
    like( $res->content, qr/suggestion/, 'suggestions visible' );
    is( $checked[-1], 'misspell body', 'checker receives exact body' );
    my $retained = update_form( $res->content );
    ok( $retained, 'spellcheck response rerenders the update form' );
    is( $retained->value('subject'), 'Spell subject', 'spellcheck retains submitted subject' );
    is( $retained->value('event'),   'misspell body', 'spellcheck retains submitted body' );
    is(
        $retained->value('prop_taglist'),
        'spell-tag-one, spell-tag-two',
        'spellcheck retains submitted tags'
    );
    is(
        $retained->value('prop_current_location'),
        'Spellcheck location marker',
        'spellcheck retains submitted location'
    );
    is(
        $retained->value('prop_current_music'),
        'Spellcheck music marker',
        'spellcheck retains submitted music'
    );
    is( $retained->value('security'),      'private', 'spellcheck retains submitted security' );
    is( $retained->value('opt_backdated'), 1,         'spellcheck retains submitted backdating' )
        if $retained->find_input('opt_backdated');
    is_deeply(
        [ map { $retained->value($_) } qw(date_ymd_yyyy date_ymd_mm date_ymd_dd hour min) ],
        [ 2024, '02', 3, '04', '05' ],
        'spellcheck retains submitted date and time controls'
    );
    my $fresh_owner = LJ::load_userid( $owner_id, 1 );
    is(
        $fresh_owner->draft_text,
        'Spellcheck draft body',
        'spellcheck leaves saved draft unchanged'
    );
    is_deeply(
        fresh_draft_properties($fresh_owner),
        { subject => 'Spellcheck draft subject' },
        'spellcheck leaves saved draft properties unchanged'
    );
    my ($after) =
        $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $owner_id );
    is( $after, $before, 'spellcheck does not post' );
    $res  = $request->( GET '/update.bml' );
    $form = update_form( $res->content );
    $form->action('http://localhost/update.bml');
    $form->value( event => 'clean body' );
    $res = $request->( $form->click('action:spellcheck') );
    like(
        $res->content,
        qr/no spelling errors|No spelling errors/i,
        'empty checker result is visible'
    );
    my $entry = $owner->t_post_fake_entry(
        subject  => 'Stored subject',
        body     => 'Stored body',
        security => 'private'
    );
    $entry->set_prop( 'used_rte', 1 );
    my $stored_rte = fresh_entry( $owner, $entry->jitemid );
    is( $stored_rte->prop('used_rte'), 1, 'fixture persists stored rich-text entry state' );
    my $path = '/editjournal.bml?itemid=' . $entry->ditemid;
    $res = $request->( GET $path);
    is( $res->code, 200, 'owned legacy edit renders' );
    my $edit = edit_form( $res->content );
    ok( $edit,                                  'owned legacy edit form parses' );
    ok( $edit->find_input('action:spellcheck'), 'configured legacy edit shows spellcheck' );
    {
        local $LJ::SPELLER;
        my $disabled_edit      = $request->( GET $path );
        my $disabled_edit_form = edit_form( $disabled_edit->content );
        ok( $disabled_edit_form, 'disabled legacy edit form parses' );
        ok(
            !$disabled_edit_form->find_input('action:spellcheck'),
            'disabled legacy edit omits the spellcheck control'
        );
    }
    ok( $edit->find_input('switched_rte_on'),
        'stored rich-text entry renders the legacy rich-text override control' );
    is( $edit->value('switched_rte_on'),
        0, 'legacy edit emits the unconditional hidden editor initialization value' );
    $edit->action( 'http://localhost' . $path );
    $edit->value( subject         => 'Edited spell subject' );
    $edit->value( event           => 'misspell edit body' );
    $edit->value( switched_rte_on => 0 );
    $res = $request->( $edit->click('action:spellcheck') );
    like( $res->content, qr/suggestion/, 'edit suggestions visible' );
    is( $checked[-1], 'misspell edit body', 'edit checker receives exact body' );
    my $retained_edit = edit_form( $res->content );
    ok( $retained_edit, 'spellcheck response rerenders the edit form' );
    is(
        $retained_edit->value('subject'),
        'Edited spell subject',
        'edit spellcheck retains submitted subject'
    );
    is(
        $retained_edit->value('event'),
        'misspell edit body',
        'edit spellcheck retains submitted body'
    );
    is( $retained_edit->value('switched_rte_on'),
        0, 'spellcheck retry retains the submitted hidden editor initialization value' );
    like( $res->content, qr/useRichText\(\"draft\",/,
        'stored rich-text entry spellcheck response initializes the rich-text editor' );

    my $plain_entry = $owner->t_post_fake_entry(
        subject  => 'Plain subject',
        body     => 'Plain body',
        security => 'private'
    );
    $plain_entry->set_prop( 'used_rte', 0 );
    my $plain_path = '/editjournal.bml?itemid=' . $plain_entry->ditemid;
    my $plain_res  = $request->( GET $plain_path );
    my $plain_edit = edit_form( $plain_res->content );
    ok( $plain_edit, 'non-rich legacy edit form parses' );
    $plain_edit->action( 'http://localhost' . $plain_path );
    $plain_edit->value( event => 'misspell plain edit body' );
    $plain_res = $request->( $plain_edit->click('action:spellcheck') );
    unlike( $plain_res->content, qr/useRichText\(\"draft\",/,
        'non-rich entry spellcheck response does not initialize the rich-text editor' );
    LJ::Entry::reset_singletons();
    my $fresh = LJ::Entry->new( $owner, ditemid => $entry->ditemid );
    is( $fresh->event_raw, 'Stored body', 'spellcheck leaves owned entry unchanged' );
};
done_testing;

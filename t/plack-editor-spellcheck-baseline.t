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
    my $res     = $request->( GET '/update.bml' );
    is( $res->code, 200, 'legacy update renders' );
    my $form = update_form( $res->content );
    ok( $form,                                  'legacy update form parses' );
    ok( $form->find_input('action:spellcheck'), 'configured legacy update shows spellcheck' );
    my ($before) =
        $owner->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $owner_id );
    $form->action('http://localhost/update.bml');
    $form->value( subject      => 'Spell subject' );
    $form->value( event        => 'misspell body' );
    $form->value( prop_taglist => 'spell-tag' );
    $res = $request->( $form->click('action:spellcheck') );
    is( $res->code, 200, 'spellcheck response renders' );
    like( $res->content, qr/suggestion/, 'suggestions visible' );
    is( $checked[-1], 'misspell body', 'checker receives exact body' );
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
    my $path = '/editjournal.bml?itemid=' . $entry->ditemid;
    $res = $request->( GET $path);
    is( $res->code, 200, 'owned legacy edit renders' );
    my $edit = edit_form( $res->content );
    ok( $edit,                                  'owned legacy edit form parses' );
    ok( $edit->find_input('action:spellcheck'), 'configured legacy edit shows spellcheck' );
    $edit->action( 'http://localhost' . $path );
    $edit->value( subject => 'Edited spell subject' );
    $edit->value( event   => 'misspell edit body' );
    $res = $request->( $edit->click('action:spellcheck') );
    like( $res->content, qr/suggestion/, 'edit suggestions visible' );
    is( $checked[-1], 'misspell edit body', 'edit checker receives exact body' );
    LJ::Entry::reset_singletons();
    my $fresh = LJ::Entry->new( $owner, ditemid => $entry->ditemid );
    is( $fresh->event_raw, 'Stored body', 'spellcheck leaves owned entry unchanged' );
};
done_testing;

#!/usr/bin/perl
# Characterize retained legacy owned-entry edit forms before retirement.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);
use LJ::Userpic;

plan skip_all => 'Legacy edit integration requires a development server' unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $production_editjournal_route = $DW::Routing::string_choices{'app/editjournal'};

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

sub edit_form {
    my ($content) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'updateForm'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost/editjournal' )
    )[0];
}

sub fresh_entry {
    my ( $owner, $ditemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $owner, ditemid => $ditemid );
}

sub click_visible_save {
    my ($form) = @_;
    my ($save) = grep {
               $_->can('click')
            && ( $_->name || '' ) eq 'action:save'
            && length( $_->value || '' )
    } $form->inputs;
    die 'legacy form has no visible save submit control' unless $save;
    return $save->click($form);
}

sub sorted_tags {
    my ($taglist) = @_;
    return [ sort grep { length } map { s/^\s+|\s+$//gr } split /,/, $taglist // '' ];
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $owner_id = $owner->id;
my $userpic =
    LJ::Userpic->create( $owner, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg") );
ok( $userpic, 'disposable owner userpic is created' )
    or BAIL_OUT('cannot exercise userpic control');
$userpic->set_keywords('legacy-edit-pic');

my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyEditContract';

{
    local $DW::Routing::string_choices{'app/editjournal'} =
        LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($production_editjournal_route);

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };

        for my $index ( 0, 1 ) {
            my $entry = $owner->t_post_fake_entry(
                subject  => "Legacy edit $index original subject",
                body     => "Legacy edit $index original body",
                security => 'private',
            );
            my $ditemid   = $entry->ditemid;
            my $unrelated = $owner->t_post_fake_entry(
                subject  => "Legacy edit $index unrelated subject",
                body     => "Legacy edit $index unrelated body",
                security => 'private',
            );
            my $path = $index ? "/editjournal.bml?itemid=$ditemid" : "/editjournal?itemid=$ditemid";
            my ($before_time) =
                $owner->selectrow_array(
                'SELECT eventtime FROM log2 WHERE journalid=? AND jitemid=?',
                undef, $owner_id, $entry->jitemid );

            my $res = $request->( GET $path );
            is( $res->code, 200, "$path renders owned legacy edit form" );
            my $form = edit_form( $res->content );
            ok( $form, "$path parses the actual legacy edit form" ) or next;
            for my $name (
                qw(itemid subject event security prop_taglist prop_current_location prop_current_music
                prop_picture_keyword date_ymd_mm date_ymd_dd date_ymd_yyyy hour min
                lj_form_auth action:save)
                )
            {
                ok( $form->find_input($name), "$path legacy edit form contains $name" );
            }
            is( $form->value('itemid'), $ditemid,
                "$path retains the exact ditemid query contract" );
            is( $form->value('security'), 'private', "$path renders private security selected" );
            is(
                $form->value('subject'),
                "Legacy edit $index original subject",
                "$path renders original subject"
            );
            is(
                $form->value('event'),
                "Legacy edit $index original body",
                "$path renders original body"
            );

            $form->action( 'http://localhost' . $path );
            $res = $request->( click_visible_save($form) );
            is( $res->code, 200, "$path actual no-op save returns a response" );
            like(
                $res->content,
                qr/(?:updated|saved|success)/i,
                "$path no-op save has meaningful result"
            );
            my $fresh = fresh_entry( $owner, $ditemid );
            is(
                $fresh->subject_raw,
                "Legacy edit $index original subject",
                "$path no-op preserves exact subject"
            );
            is(
                $fresh->event_raw,
                "Legacy edit $index original body",
                "$path no-op preserves exact body"
            );
            my ($after_noop_time) =
                $owner->selectrow_array(
                'SELECT eventtime FROM log2 WHERE journalid=? AND jitemid=?',
                undef, $owner_id, $entry->jitemid );
            is( $after_noop_time, $before_time, "$path no-op preserves exact event timestamp" );

            $res  = $request->( GET $path );
            $form = edit_form( $res->content );
            $form->action( 'http://localhost' . $path );
            $form->value( subject      => "Legacy edit $index changed subject" );
            $form->value( event        => "Legacy edit $index changed body" );
            $form->value( prop_taglist => "legacy-edit-$index-one, legacy-edit-$index-two" );
            $form->value( prop_current_location => "Legacy edit $index location" );
            $form->value( prop_current_music    => "Legacy edit $index music" );
            $form->value( prop_picture_keyword  => 'legacy-edit-pic' );
            $form->value( date_ymd_mm           => '02' );
            $form->value( date_ymd_dd           => '03' );
            $form->value( date_ymd_yyyy         => '2031' );
            $form->value( hour                  => '04' );
            $form->value( min                   => '05' );
            $form->value( date_diff             => '1' ) if $form->find_input('date_diff');
            $res = $request->( click_visible_save($form) );
            is( $res->code, 200, "$path actual changed save returns a response" );
            like(
                $res->content,
                qr/(?:updated|saved|success)/i,
                "$path changed save has meaningful result"
            );

            $fresh = fresh_entry( $owner, $ditemid );
            is( $fresh->security, 'private', "$path changed save retains private security" );
            is(
                $fresh->subject_raw,
                "Legacy edit $index changed subject",
                "$path persists exact changed subject"
            );
            is(
                $fresh->event_raw,
                "Legacy edit $index changed body",
                "$path persists exact changed body"
            );
            is_deeply(
                [ sort $fresh->tags ],
                [ "legacy-edit-$index-one", "legacy-edit-$index-two" ],
                "$path persists exact changed tag set"
            );
            is(
                $fresh->prop('current_location'),
                "Legacy edit $index location",
                "$path persists changed location"
            );
            is(
                $fresh->prop('current_music'),
                "Legacy edit $index music",
                "$path persists changed music"
            );
            is( $fresh->userpic_kw, 'legacy-edit-pic', "$path persists selected userpic keyword" );
            my ($changed_time) =
                $owner->selectrow_array(
                'SELECT eventtime FROM log2 WHERE journalid=? AND jitemid=?',
                undef, $owner_id, $entry->jitemid );
            is( $changed_time, '2031-02-03 04:05:00', "$path persists exact changed timestamp" );
            my $unrelated_fresh = fresh_entry( $owner, $unrelated->ditemid );
            ok( $unrelated_fresh->valid, "$path changed save leaves unrelated entry valid" );
            is(
                $unrelated_fresh->subject_raw,
                "Legacy edit $index unrelated subject",
                "$path changed save preserves unrelated subject"
            );
            is(
                $unrelated_fresh->event_raw,
                "Legacy edit $index unrelated body",
                "$path changed save preserves unrelated body"
            );

            $res  = $request->( GET $path );
            $form = edit_form( $res->content );
            is(
                $form->value('subject'),
                "Legacy edit $index changed subject",
                "$path fresh form renders changed subject"
            );
            is(
                $form->value('event'),
                "Legacy edit $index changed body",
                "$path fresh form renders changed body"
            );
            is_deeply(
                sorted_tags( $form->value('prop_taglist') ),
                [ "legacy-edit-$index-one", "legacy-edit-$index-two" ],
                "$path fresh form renders changed tags"
            );
            is(
                $form->value('prop_current_location'),
                "Legacy edit $index location",
                "$path fresh form renders changed location"
            );
            is(
                $form->value('prop_current_music'),
                "Legacy edit $index music",
                "$path fresh form renders changed music"
            );
            is( $form->value('prop_picture_keyword'),
                'legacy-edit-pic', "$path fresh form renders selected userpic" );
            is( $form->value('date_ymd_mm'),   '02',   "$path fresh form renders changed month" );
            is( $form->value('date_ymd_dd'),   '3',    "$path fresh form renders changed day" );
            is( $form->value('date_ymd_yyyy'), '2031', "$path fresh form renders changed year" );
            is( $form->value('hour'),          '04',   "$path fresh form renders changed hour" );
            is( $form->value('min'),           '05',   "$path fresh form renders changed minute" );
        }
    };
}

is( $DW::Routing::string_choices{'app/editjournal'},
    $production_editjournal_route,
    'retained GET test overlay does not leak into the routing table' );

done_testing;

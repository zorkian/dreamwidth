#!/usr/bin/perl
# Verify callable-only retained community edit GET rendering.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

local $LJ::DISABLED{tags} = 0;

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use Plack::Middleware::DW::RequestWrapper;
use LJ::Session;
use LJ::Userpic;
use LJ::Test qw(temp_user temp_comm);

my $native_app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $native_app eq 'CODE';

my $manager = temp_user();
$manager->update_self( { status => 'A' } );
$manager->set_prop( 'entry_editor', 'always_rich' );
$manager->entry_editor2('markdown0');
$manager->set_prop( 'entry_draft', '"manager draft body"' );
$manager->set_prop( 'draft_properties',
    nfreeze( { subject => 'manager draft subject', editor => 'markdown0' } ) );
my $poster = temp_user();
$poster->update_self( { status => 'A' } );
$poster->set_prop( 'entry_editor', 'always_plain' );
$poster->entry_editor2('html_raw0');
$poster->set_prop( 'entry_draft', '"poster draft body"' );
$poster->set_prop( 'draft_properties',
    nfreeze( { subject => 'poster draft subject', editor => 'html_raw0' } ) );
my $manager_id = $manager->id;
my $poster_id  = $poster->id;
my $comm       = temp_comm();
$manager->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $manager->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );
$comm->set_comm_settings( $manager, { membership => 'open', postlevel => 'members' } );
$comm->set_prop( opt_tagpermissions => 'private,private' );

my $own = $manager->t_post_fake_comm_entry(
    $comm,
    subject  => 'own subject',
    body     => 'own body',
    security => 'friends',
);
$own->set_prop( current_location => 'community native location' );
$own->set_prop( current_music    => 'community native music' );
$own->set_prop( editor           => 'html_raw0' );
ok(
    LJ::Tags::update_logtags(
        $comm, $own->jitemid, { set_string => 'community tag, second tag', remote => $manager }
    ),
    'disposable community tags are seeded'
);
my $pic = LJ::Userpic->create( $manager,
    data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
ok( $pic, 'disposable manager userpic is created' ) or BAIL_OUT('missing userpic');
$pic->set_keywords('community-native-pic');
my $pic_mapid = $manager->get_mapid_from_keyword( 'community-native-pic', create => 1 );
LJ::set_logprop( $comm, $own->jitemid, { picture_mapid => $pic_mapid } );
LJ::Entry::reset_singletons();
$own = LJ::Entry->new( $comm, ditemid => $own->ditemid );

my $other = $poster->t_post_fake_comm_entry(
    $comm,
    subject => 'other subject',
    body    => 'other body',
);
my $other_community = temp_comm();
LJ::set_rel( $other_community, $manager, 'A' );
my $other_community_entry = $manager->t_post_fake_comm_entry(
    $other_community,
    subject => 'other community subject',
    body    => 'other community body',
);
$other->set_prop( 'adult_content_maintainer',        'concepts' );
$other->set_prop( 'adult_content_maintainer_reason', 'manager reason' );
$other->set_prop( 'opt_nocomments_maintainer',       1 );

my $manager_session = LJ::Session->create( $manager, nolog => 1 );
my $poster_session  = LJ::Session->create( $poster,  nolog => 1 );
my %cookie          = (
    $manager->id => 'ljmastersession='
        . $manager_session->master_cookie_string
        . '; ljloggedin='
        . $manager_session->loggedin_cookie_string,
    $poster->id => 'ljmastersession='
        . $poster_session->master_cookie_string
        . '; ljloggedin='
        . $poster_session->loggedin_cookie_string,
);
my $in_beta = 0;
my %readonly;
my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r        = DW::Request->get;
        my $rendered = DW::Controller::Entry::legacy_community_edit_get_handler();
        if ( defined $rendered ) {
            $r->status(200) unless defined $r->status;
            return $r->res;
        }
        $r->status(299);
        $r->print('BML fallback');
        return $r->res;
    }
);

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

sub parsed_form {
    my ( $content, $input ) = @_;
    return ( grep { $_->find_input($input) } HTML::Form->parse( $content, 'http://localhost' ) )[0];
}

sub native_request {
    my ( $request, $cookie ) = @_;
    $request->header( Cookie => $cookie );
    my $response;
    test_psgi $native_app, sub { $response = shift->($request); };
    return $response;
}

{
    no warnings 'redefine';
    local *LJ::BetaFeatures::user_in_beta = sub { return $in_beta; };
    local *LJ::User::readonly             = sub { return $readonly{ $_[0]->id } || 0; };

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ( $user, $req ) = @_;
            $req->header( Cookie => $cookie{ $user->id } );
            return $send->($req);
        };

        my $manager_response = $request->(
            $manager,
            GET '/editjournal?usejournal='
                . $comm->user
                . '&itemid='
                . $other->ditemid
                . '&authas='
                . $manager->user
                . '&encoded=one%2Ftwo&repeated=a&repeated=b'
        );
        is( $manager_response->code, 200, 'manager community GET renders' );
        my $manager_form = parsed_form( $manager_response->content, 'action:savemaintainer' );
        ok( $manager_form, 'manager gets property-only form' );
        ok( !$manager_form->find_input('subject') && !$manager_form->find_input('event'),
            'manager form has no content controls' );
        is( $manager_form->value('prop_adult_content_maintainer'),
            'concepts', 'manager form selects the existing override' );
        is(
            $manager_form->value('prop_adult_content_maintainer_reason'),
            'manager reason',
            'manager form retains the existing override reason'
        );
        is(
            $manager_form->action,
            'http://localhost/entry/'
                . $comm->user . '/'
                . $other->ditemid
                . '/edit?usejournal='
                . $comm->user
                . '&itemid='
                . $other->ditemid
                . '&authas='
                . $manager->user
                . '&encoded=one%2Ftwo&repeated=a&repeated=b',
            'manager action preserves canonical raw query'
        );
        my $manager_bml = $request->(
            $manager,
            GET '/editjournal.bml?usejournal=' . $comm->user . '&itemid=' . $other->ditemid
        );
        is( $manager_bml->code, 200, 'extension alias renders the manager form' );
        ok(
            parsed_form( $manager_bml->content, 'action:savemaintainer' ),
            'extension alias retains the property-only manager form'
        );

        my $direct_request =
            HTTP::Request->new( GET => '/entry/' . $comm->user . '/' . $own->ditemid . '/edit' );
        my $direct = native_request( $direct_request, $cookie{ $manager->id } );
        is( $direct->code, 200, 'direct native same-poster edit renders' );
        my $direct_form = parsed_form( $direct->content, 'subject' );
        ok( $direct_form, 'direct native edit form parses' );

        my $same_poster = $request->(
            $manager, GET '/editjournal?journal=' . $comm->user . '&itemid=' . $own->ditemid
        );
        is( $same_poster->code, 200, 'same-poster community GET renders' );
        my $same_poster_form = parsed_form( $same_poster->content, 'subject' );
        ok( $same_poster_form, 'same-poster gets ordinary edit form' );
        is( $same_poster_form->value('subject'), 'own subject', 'ordinary form retains subject' );
        is( $same_poster_form->value('event'),   'own body',    'ordinary form retains body' );
        is( $same_poster_form->value('security'),
            'access', 'ordinary form selects nondefault community access security' );

        for my $field (
            qw(security editor current_location current_music prop_picture_keyword entrytime_date entrytime_time)
            )
        {
            is(
                $same_poster_form->value($field),
                $direct_form->value($field),
                "same-poster form matches direct native $field"
            );
        }
        is( $same_poster_form->value('prop_picture_keyword'),
            'community-native-pic', 'ordinary form retains userpic' );
        is_deeply(
            [ sort grep { length } split /,\s*/, $same_poster_form->value('taglist') ],
            [ 'community tag', 'second tag' ],
            'ordinary form retains seeded tags'
        );
        is_deeply(
            [ sort grep { length } split /,\s*/, $same_poster_form->value('taglist') ],
            [ sort grep { length } split /,\s*/, $direct_form->value('taglist') ],
            'same-poster form matches direct native tag set'
        );
        my @direct_custom_bits = map { $_->value }
            grep { ( $_->name || '' ) eq 'custom_bit' && $_->value } $direct_form->inputs;
        my @legacy_custom_bits = map { $_->value }
            grep { ( $_->name || '' ) eq 'custom_bit' && $_->value } $same_poster_form->inputs;
        is_deeply( \@legacy_custom_bits, \@direct_custom_bits,
            'community form has no personal custom bits, matching direct native form' );
        ok(
            !$same_poster_form->find_input('action:savemaintainer'),
            'ordinary edit lacks the maintainer action'
        );

        my $usejournal_wins = $request->(
            $manager,
            GET '/editjournal?usejournal='
                . $comm->user
                . '&journal='
                . $other_community->user
                . '&itemid='
                . $own->ditemid
        );
        my $usejournal_form = parsed_form( $usejournal_wins->content, 'subject' );
        is( $usejournal_wins->code, 200, 'nonempty usejournal wins over journal' );
        is( $usejournal_form->value('subject'), 'own subject', 'usejournal selects its community' );

        my $empty_usejournal_uses_journal = $request->(
            $manager,
            GET '/editjournal?usejournal=&journal='
                . $other_community->user
                . '&itemid='
                . $other_community_entry->ditemid
        );
        my $empty_usejournal_form =
            parsed_form( $empty_usejournal_uses_journal->content, 'subject' );
        is( $empty_usejournal_uses_journal->code, 200, 'empty usejournal permits journal alias' );
        is(
            $empty_usejournal_form->value('subject'),
            'other community subject',
            'journal selects its community after empty usejournal'
        );

        $in_beta = 1;
        my $beta_same_poster = $request->(
            $manager,
            GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid . '&kept=old'
        );
        is( $beta_same_poster->code, 302, 'same-poster beta request redirects' );
        is(
            $beta_same_poster->header('Location'),
            '/entry/' . $comm->user . '/' . $own->ditemid . '/edit',
            'same-poster beta redirect drops retained query'
        );
        my $beta_manager = $request->(
            $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $other->ditemid
        );
        is( $beta_manager->code, 200, 'manager branch does not beta redirect' );
        ok( parsed_form( $beta_manager->content, 'action:savemaintainer' ),
            'beta manager stays property-only' );
        $in_beta = 0;

        my $anonymous =
            $send->( GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid );
        is( $anonymous->code, 299,
            'unauthenticated request falls through between eligible renders' );
        my $after_anonymous = $request->(
            $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid
        );
        is( $after_anonymous->code, 200, 'eligible same-poster render follows anonymous fallback' );
        ok(
            parsed_form( $after_anonymous->content, 'subject' ),
            'anonymous fallback leaks no request context'
        );

        my $repeated = $request->(
            $manager,
            GET '/editjournal?usejournal='
                . $comm->user
                . '&itemid='
                . $other->ditemid
                . '&itemid='
                . $own->ditemid
        );
        is( $repeated->code, 299, 'repeated itemid falls through' );
        is(
            $request->( $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=zero' )
                ->code,
            299,
            'malformed itemid falls through'
        );
        is(
            $request->(
                $manager,
                POST '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid
            )->code,
            299,
            'non-GET request falls through'
        );
        is(
            $request->(
                $manager,
                GET '/editjournal?usejournal=' . $manager->user . '&itemid=' . $own->ditemid
            )->code,
            299,
            'personal journal collision falls through'
        );
        is(
            $request->(
                $manager, GET '/editjournal?usejournal=not-a-journal&itemid=' . $own->ditemid
            )->code,
            299,
            'invalid journal falls through'
        );
        is(
            $request->(
                $manager,
                GET '/editjournal?usejournal='
                    . $comm->user
                    . '&authas=not-the-actor&itemid='
                    . $own->ditemid
            )->code,
            299,
            'invalid authas falls through before entry rendering'
        );
        is(
            $request->(
                $manager,
                GET '/editjournal?usejournal='
                    . $comm->user
                    . '&itemid='
                    . ( $own->ditemid + 100000 )
            )->code,
            299,
            'missing item in selected community falls through'
        );

        $readonly{ $manager->id } = 1;
        is(
            $request->(
                $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid
            )->code,
            299,
            'readonly actor falls through'
        );
        delete $readonly{ $manager->id };
        $readonly{ $comm->id } = 1;
        is(
            $request->(
                $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid
            )->code,
            299,
            'readonly community same-poster falls through'
        );
        is(
            $request->(
                $manager,
                GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $other->ditemid
            )->code,
            299,
            'readonly community manager falls through'
        );
        delete $readonly{ $comm->id };

        is(
            $request->(
                $poster, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $own->ditemid
            )->code,
            299,
            'denied non-manager falls through'
        );

        my $after_fallback = $request->(
            $manager, GET '/editjournal?usejournal=' . $comm->user . '&itemid=' . $other->ditemid
        );
        is( $after_fallback->code, 200,
            'eligible manager render follows fallbacks without leaked state' );
        ok( parsed_form( $after_fallback->content, 'action:savemaintainer' ),
            'sequential manager form is still property-only' );
    };
}

LJ::Entry::reset_singletons();
my $fresh = LJ::Entry->new( $comm, ditemid => $other->ditemid );
is( $fresh->event_raw,   'other body',    'GET does not mutate other body' );
is( $fresh->subject_raw, 'other subject', 'GET does not mutate other subject' );
is( $fresh->prop('adult_content_maintainer'),
    'concepts', 'GET does not mutate maintainer override' );
is(
    $fresh->prop('adult_content_maintainer_reason'),
    'manager reason',
    'GET does not mutate maintainer override reason'
);
is( $fresh->prop('opt_nocomments_maintainer'),
    1, 'GET does not mutate maintainer comment override' );
my $fresh_own = LJ::Entry->new( $comm, ditemid => $own->ditemid );
is( $fresh_own->event_raw,   'own body',    'GET does not mutate same-poster body' );
is( $fresh_own->subject_raw, 'own subject', 'GET does not mutate same-poster subject' );
is( $fresh_own->security,    'usemask',     'GET does not mutate same-poster security' );
is( $fresh_own->allowmask,   1,             'GET does not mutate same-poster access mask' );

my $fresh_manager = LJ::load_userid( $manager_id, 1 );
is( $fresh_manager->prop('entry_editor'), 'always_rich',
    'GET preserves manager editor preference' );
is( $fresh_manager->entry_editor2, 'markdown0', 'GET preserves manager native editor preference' );
is(
    $fresh_manager->prop('entry_draft'),
    '"manager draft body"',
    'GET preserves manager draft body'
);
is_deeply(
    thaw( $fresh_manager->prop('draft_properties') ),
    { subject => 'manager draft subject', editor => 'markdown0' },
    'GET preserves manager frozen draft properties'
);
my $fresh_poster = LJ::load_userid( $poster_id, 1 );
is( $fresh_poster->prop('entry_editor'), 'always_plain', 'GET preserves poster editor preference' );
is( $fresh_poster->entry_editor2, 'html_raw0', 'GET preserves poster native editor preference' );
is( $fresh_poster->prop('entry_draft'), '"poster draft body"', 'GET preserves poster draft body' );
is_deeply(
    thaw( $fresh_poster->prop('draft_properties') ),
    { subject => 'poster draft subject', editor => 'html_raw0' },
    'GET preserves poster frozen draft properties'
);

done_testing;

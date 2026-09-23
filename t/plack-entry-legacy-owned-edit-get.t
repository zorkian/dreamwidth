#!/usr/bin/perl
# Exercise the callable personal-owned retained editjournal GET renderer.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);
use LJ::Userpic;

plan skip_all => 'Owned edit GET integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $native_app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $native_app eq 'CODE';

sub form_from {
    my ( $content, $base ) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, $base )
    )[0];
}

sub fresh {
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $_[0], ditemid => $_[1] );
}

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

my $owner   = temp_user();
my $groupid = $owner->create_trust_group( groupname => 'Callable GET custom security' );
$owner->update_self( { status => 'A' } );
my $owner_id = $owner->id;
my $entry    = $owner->t_post_fake_entry(
    subject  => 'Callable GET owned subject',
    body     => 'Callable GET owned body',
    security => 'private',
);
$entry->set_prop( current_location => 'Callable GET location' );
$entry->set_prop( current_music    => 'Callable GET music' );
$entry->set_prop( editor           => 'html_raw0' );
my $pic =
    LJ::Userpic->create( $owner, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
ok( $pic, 'disposable owner userpic is created' ) or BAIL_OUT('missing userpic');
$pic->set_keywords('callable-get-pic');
my $pic_mapid = $owner->get_mapid_from_keyword( 'callable-get-pic', create => 1 );
LJ::set_logprop( $owner, $entry->jitemid, { picture_mapid => $pic_mapid } );
LJ::Entry::reset_singletons();
my %custom_result;
LJ::do_request(
    {
        mode      => 'postevent',
        ver       => $LJ::PROTOCOL_VER,
        user      => $owner->user,
        subject   => 'Callable GET custom subject',
        event     => 'Callable GET custom body',
        year      => 2020,
        mon       => 2,
        day       => 3,
        hour      => 4,
        min       => 5,
        security  => 'usemask',
        allowmask => 1 << $groupid,
    },
    \%custom_result,
    { noauth => 1, nomod => 1 }
);
die "custom fixture post failed: $custom_result{errmsg}"
    unless $custom_result{success} eq 'OK';
my $custom_entry = LJ::Entry->new( $owner, jitemid => $custom_result{itemid} );

my $other = temp_user();
$other->update_self( { status => 'A' } );
$other->t_post_fake_entry(
    subject  => 'Foreign GET collision subject',
    body     => 'Foreign GET collision body',
    security => 'private',
);
$other->t_post_fake_entry(
    subject  => 'Foreign GET second collision subject',
    body     => 'Foreign GET second collision body',
    security => 'private',
);
my $foreign = $other->t_post_fake_entry(
    subject  => 'Foreign GET subject',
    body     => 'Foreign GET body',
    security => 'private',
);
my $community = temp_comm();
LJ::set_rel( $community, $owner, 'P' );

my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyOwnedEditGet';

# This wrapper is deliberately test-only. It calls the callable seam and makes
# an undef fallthrough observable without registering any production route.
my $adapter_app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r = DW::Request->get;
        LJ::set_remote($owner);
        my $render = DW::Controller::Entry::legacy_owned_edit_get_handler( remote => $owner );
        if ( !defined $render ) {
            $r->status(418);
            $r->print('retained BML fallback marker');
        }
        else {
            $r->status(200) unless defined $r->status;
        }
        return $r->res;
    }
);

sub request {
    my ( $app, $req ) = @_;
    $req->header( Cookie => $cookie );
    my $res;
    test_psgi $app, sub { $res = shift->($req); };
    return $res;
}

my $raw_query    = 'itemid=' . $entry->ditemid . '&encoded=a%2Fb%26c&repeated=one&repeated=two';
my $legacy_path  = '/editjournal?' . $raw_query;
my $native_path  = '/entry/' . $owner->user . '/' . $entry->ditemid . '/edit';
my $before_draft = $owner->draft_text;
my $before_props = $owner->prop('draft_properties');

my $direct = request( $native_app, GET $native_path );
is( $direct->code, 200, 'direct canonical native edit GET renders' );
my $direct_form = form_from( $direct->content, 'http://localhost' . $native_path );
ok( $direct_form, 'direct canonical native edit form parses' ) or BAIL_OUT('missing direct form');

for my $suffix ( '', '.bml' ) {
    my $path = '/editjournal' . $suffix . '?' . $raw_query;
    my $res  = request( $adapter_app, GET $path );
    is( $res->code, 200, "$path callable GET renders" );
    my $form = form_from( $res->content, 'http://localhost' . $path );
    ok( $form, "$path returns the native edit form" ) or next;
    for my $field (
        qw(subject event security current_location current_music prop_picture_keyword editor entrytime_date entrytime_time)
        )
    {
        is(
            $form->value($field),
            $direct_form->value($field),
            "$path matches direct native $field"
        );
    }
    is( $form->value('subject'),  'Callable GET owned subject', "$path retains subject" );
    is( $form->value('event'),    'Callable GET owned body',    "$path retains body" );
    is( $form->value('security'), 'private',                    "$path retains private security" );
    is( $form->value('prop_picture_keyword'), 'callable-get-pic', "$path retains userpic" );
    is( $form->value('editor'),               'html_raw0',        "$path retains selected editor" );
    like(
        $form->action,
qr{^http://localhost/entry/\Q@{[$owner->user]}\E/\Q@{[$entry->ditemid]}\E/edit\?itemid=\Q@{[$entry->ditemid]}\E&encoded=a%2Fb%26c&repeated=one&repeated=two$},
        "$path native action preserves raw encoded/repeated query"
    );
    unlike( $form->action, qr{/editjournal(?:\.bml)?},
        "$path action never targets legacy editjournal" );
}

my $custom_direct =
    request( $native_app, GET '/entry/' . $owner->user . '/' . $custom_entry->ditemid . '/edit' );
my $custom_legacy = request( $adapter_app, GET '/editjournal?itemid=' . $custom_entry->ditemid );
is( $custom_legacy->code, 200, 'custom-security callable GET renders' );
my $custom_direct_form = form_from( $custom_direct->content, 'http://localhost/entry' );
my $custom_legacy_form = form_from( $custom_legacy->content, 'http://localhost/editjournal' );
ok( $custom_direct_form && $custom_legacy_form, 'custom-security direct and callable forms parse' );
is( $custom_legacy_form->value('security'),
    'custom', 'custom-security callable form selects custom' )
    if $custom_legacy_form;
is(
    $custom_legacy_form->value('security'),
    $custom_direct_form->value('security'),
    'custom-security callable form matches direct native selection'
) if $custom_direct_form && $custom_legacy_form;
my @custom_bits =
    grep { ( $_->name || '' ) eq 'custom_bit' && defined $_->value && $_->value eq '1' }
    $custom_legacy_form->inputs
    if $custom_legacy_form;
ok( @custom_bits, 'custom-security callable form retains selected custom bit' );

is(
    fresh( $owner, $entry->ditemid )->subject_raw,
    'Callable GET owned subject',
    'GET does not mutate entry subject'
);
is(
    fresh( $owner, $entry->ditemid )->event_raw,
    'Callable GET owned body',
    'GET does not mutate entry body'
);
is( $owner->draft_text,               $before_draft, 'GET does not mutate draft body' );
is( $owner->prop('draft_properties'), $before_props, 'GET does not mutate draft properties' );

# A parsed callable form must wire to the canonical native route. Submit one
# distinct edit through that parsed action; deeper persistence combinations stay
# in the reviewed native edit suites.
my $wired      = request( $adapter_app, GET $legacy_path );
my $wired_form = form_from( $wired->content, 'http://localhost' . $legacy_path );
ok( $wired_form, 'wiring check starts with parsed callable form' )
    or BAIL_OUT('missing wiring form');
$wired_form->action( $wired_form->action );
$wired_form->value( subject => 'Callable GET wired native subject' );
$wired_form->value( event   => 'Callable GET wired native body' );
my $wired_post = $wired_form->click('action:post');
$wired_post->header( Referer => 'http://localhost' . $legacy_path );
my $wired_res = request( $native_app, $wired_post );
is( $wired_res->code, 200, 'parsed callable action reaches native edit handler' );
like( $wired_res->content, qr/successlinks/,
    'parsed callable action uses native success rendering' );
is(
    fresh( $owner, $entry->ditemid )->subject_raw,
    'Callable GET wired native subject',
    'parsed callable action persists distinct subject'
);
is(
    fresh( $owner, $entry->ditemid )->event_raw,
    'Callable GET wired native body',
    'parsed callable action persists distinct body'
);
my $custom_direct =
    request( $native_app, GET '/entry/' . $owner->user . '/' . $custom_entry->ditemid . '/edit' );
my $custom_legacy = request( $adapter_app, GET '/editjournal?itemid=' . $custom_entry->ditemid );
is( $custom_legacy->code, 200, 'custom-security callable GET renders' );
my $custom_direct_form = form_from( $custom_direct->content, 'http://localhost/entry' );
my $custom_legacy_form = form_from( $custom_legacy->content, 'http://localhost/editjournal' );
ok( $custom_direct_form && $custom_legacy_form, 'custom-security direct and callable forms parse' );
is( $custom_legacy_form->value('security'),
    'custom', 'custom-security callable form selects custom' )
    if $custom_legacy_form;
is(
    $custom_legacy_form->value('security'),
    $custom_direct_form->value('security'),
    'custom-security callable form matches direct native selection'
) if $custom_direct_form && $custom_legacy_form;
my @custom_bits =
    grep { ( $_->name || '' ) eq 'custom_bit' && defined $_->value && $_->value eq '1' }
    $custom_legacy_form->inputs
    if $custom_legacy_form;
ok( @custom_bits, 'custom-security callable form retains selected custom bit' );

# Canonicalization and ownership gates must return undef before native rendering.
for my $case (
    [ '/editjournal',            'missing itemid' ],
    [ '/editjournal?itemid=',    'empty itemid' ],
    [ '/editjournal?itemid=0',   'zero itemid' ],
    [ '/editjournal?itemid=01',  'leading-zero itemid' ],
    [ '/editjournal?itemid=-1',  'signed itemid' ],
    [ '/editjournal?itemid=abc', 'mixed itemid' ],
    [ '/editjournal?itemid=' . $entry->ditemid . '&itemid=' . $entry->ditemid, 'repeated itemid' ],
    [ '/editjournal?itemid=' . $entry->ditemid . '&authas=' . $other->user,    'distinct authas' ],
    [
        '/editjournal?itemid=' . $entry->ditemid . '&usejournal=' . $community->user,
        'community selector'
    ],
    [ '/editjournal?itemid=' . $foreign->ditemid, 'foreign poster' ],
    )
{
    my ( $path, $label ) = @$case;
    my $res = request( $adapter_app, GET $path );
    is( $res->code, 418, "$label falls through before native render" );
    like(
        $res->content,
        qr/retained BML fallback marker/,
        "$label retains callable fallback boundary"
    );
}
for my $method (qw(POST HEAD PUT DELETE)) {
    my $req = HTTP::Request->new( $method => '/editjournal?itemid=' . $entry->ditemid );
    $req->content('mode=edit') if $method eq 'POST';
    $req->header( 'Content-Type' => 'application/x-www-form-urlencoded' ) if $method eq 'POST';
    my $res = request( $adapter_app, $req );
    is( $res->code, 418, "$method remains outside GET-only callable seam" );
}

my $self_context = request( $adapter_app,
          GET '/editjournal?itemid='
        . $entry->ditemid
        . '&authas='
        . $owner->user
        . '&usejournal='
        . $owner->user
        . '&journal='
        . $owner->user );
is( $self_context->code, 200, 'explicit personal aliases collapse to the owned callable context' );

{
    no warnings 'redefine';
    local *LJ::User::readonly = sub { $_[0]->equals($owner) ? 1 : 0 };
    my $res = request( $adapter_app, GET '/editjournal?itemid=' . $entry->ditemid );
    is( $res->code, 418, 'readonly owner falls through before native rendering' );
}

# The retained beta branch is an exact canonical redirect with no old query.
{
    no warnings 'redefine';
    local *LJ::BetaFeatures::user_in_beta = sub { 1 };
    my $res = request( $adapter_app, GET $legacy_path );
    is( $res->code, 302, 'beta owner receives retained redirect status' );
    is(
        $res->header('Location'),
        '/entry/' . $owner->user . '/' . $entry->ditemid . '/edit',
        'beta redirect drops the old query exactly'
    );
}

# A following eligible request proves no resolved entry/action state leaked from
# the excluded request sequence above.
my $again = request( $adapter_app, GET '/editjournal?itemid=' . $entry->ditemid );
is( $again->code, 200, 'sequential eligible request renders after exclusions' );
my $again_form = form_from( $again->content, 'http://localhost/editjournal' );
is(
    $again_form->value('subject'),
    'Callable GET wired native subject',
    'sequential eligible request uses the updated owned entry'
) if $again_form;
unlike(
    $again_form->action,
    qr/(?:authas|usejournal|foreign)/,
    'sequential eligible action has no leaked exclusion context'
) if $again_form;

done_testing;

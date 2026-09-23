#!/usr/bin/perl
# Exercise the callable-only retained manager property POST compatibility seam.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use lib "$ENV{LJHOME}/cgi-bin";

use HTML::Form;
use HTTP::Request::Common;
use Plack::Middleware::DW::RequestWrapper;
use Plack::Test;
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_comm temp_user);

plan skip_all => 'Manager property integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

sub manager_form {
    my ( $content, $path ) = @_;
    return (
        grep {
                   $_->find_input('action:savemaintainer')
                && $_->find_input('lj_form_auth')
                && $_->find_input('itemid')
        } HTML::Form->parse( $content, 'http://localhost' . $path )
    )[0];
}

sub fresh_entry {
    my ( $journal, $ditemid ) = @_;
    LJ::Entry::reset_singletons();
    return LJ::Entry->new( $journal, ditemid => $ditemid );
}

sub entry_snapshot {
    my ( $journal, $ditemid ) = @_;
    my $entry = fresh_entry( $journal, $ditemid );
    return {
        subject     => $entry->subject_raw,
        body        => $entry->event_raw,
        security    => $entry->security,
        allowmask   => $entry->allowmask,
        unrelated   => $entry->prop('opt_preformatted') || '',
        reason      => $entry->prop('adult_content_maintainer') || '',
        reason_text => $entry->prop('adult_content_maintainer_reason') || '',
        nocomments  => $entry->prop('opt_nocomments_maintainer') || '',
    };
}

sub session_cookie {
    my ($user) = @_;
    my $session = LJ::Session->create( $user, nolog => 1 );
    return
          'ljmastersession='
        . $session->master_cookie_string
        . '; ljloggedin='
        . $session->loggedin_cookie_string;
}

my $manager  = temp_user();
my $poster   = temp_user();
my $outsider = temp_user();
my $comm     = temp_comm();
$manager->update_self(  { status => 'A' } );
$poster->update_self(   { status => 'A' } );
$outsider->update_self( { status => 'A' } );
LJ::set_rel( $comm, $manager, 'A' );
ok( $manager->can_manage($comm), 'disposable session actor manages the community' );

my $target = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Manager property target subject',
    body     => 'Manager property target body',
    security => 'public',
);
my $unrelated = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Manager property unrelated subject',
    body     => 'Manager property unrelated body',
    security => 'public',
);
LJ::set_logprop( $comm, $target->jitemid, { opt_preformatted => 1 } );
my $target_before    = entry_snapshot( $comm, $target->ditemid );
my $unrelated_before = entry_snapshot( $comm, $unrelated->ditemid );

my $manager_cookie  = session_cookie($manager);
my $outsider_cookie = session_cookie($outsider);
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyManagerProperty';

my $callable_app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r      = DW::Request->get;
        my $result = DW::Controller::Entry::legacy_manager_property_post_handler();
        if ( defined $result ) {
            $r->status(200) unless defined $r->status;
            return $r->res;
        }
        $r->status(299);
        $r->print('retained BML fallback');
        return $r->res;
    }
);

sub retained_form {
    my ( $path, $cookie ) = @_;
    my $res;
    test_psgi $app, sub {
        my $send = shift;
        my $req  = GET $path;
        $req->header( Cookie => $cookie );
        $res = $send->($req);
    };
    is( $res->code, 200, "$path renders an actual retained manager form" );
    my $form = manager_form( $res->content, $path );
    ok( $form, "$path retains the actual manager property controls" );
    return $form;
}

sub callable_request {
    my ( $request, $cookie ) = @_;
    $request->header( Cookie => $cookie );
    my $res;
    test_psgi $callable_app, sub { $res = shift->($request); };
    return $res;
}

sub submit_form {
    my ( $form, $path, $cookie, $clicked ) = @_;
    $form->action( 'http://localhost' . $path );
    my $request = $clicked ? $form->click($clicked) : $form->make_request;
    $request->uri( 'http://localhost' . $path );
    $request->header( Referer => 'http://localhost' . $path );
    return callable_request( $request, $cookie );
}

my @writes;
my @hook_names;
my @protocol_modes;
my $set_logprop = \&LJ::set_logprop;
my $run_hooks   = \&LJ::Hooks::run_hooks;
my $do_request  = \&LJ::do_request;

{
    no warnings 'redefine';
    local *LJ::set_logprop = sub {
        push @writes, [ $_[0]->id, $_[1], { %{ $_[2] || {} } } ];
        return $set_logprop->(@_);
    };
    local *LJ::Hooks::run_hooks = sub {
        push @hook_names, $_[0]
            if $_[0] =~
/^(?:decode_entry_form|spam_check|after_entry_post_extra_options|after_entry_post_extra_html)$/;
        return $run_hooks->(@_);
    };
    local *LJ::do_request = sub {
        push @protocol_modes, $_[0]{mode} if $_[0]{mode};
        return $do_request->(@_);
    };

    my $path =
          '/editjournal?usejournal='
        . $comm->user
        . '&itemid='
        . $target->ditemid
        . '&encoded=one%2Ftwo&repeated=a&repeated=b';
    my $form = retained_form( $path, $manager_cookie ) or BAIL_OUT('missing retained manager form');
    is( $form->value('itemid'),
        $target->ditemid, 'retained form supplies the exact composite item id' );

    $form->value( prop_adult_content_maintainer_reason => 'manager reason set marker' );
    $form->value( prop_adult_content_maintainer        => 'concepts' );
    $form->value( prop_opt_nocomments_maintainer       => 1 );
    my $response = submit_form( $form, $path, $manager_cookie, 'action:savemaintainer' );
    is( $response->code, 302, 'direct savemaintainer returns the retained redirect status' );
    is( $response->header('Location'),
        $target->url,
        'direct savemaintainer redirects to the public entry URL without editor query' );
    is( scalar @writes, 1, 'direct savemaintainer writes exactly once' );
    is_deeply(
        $writes[-1],
        [
            $comm->id,
            $target->jitemid,
            {
                adult_content_maintainer_reason => 'manager reason set marker',
                adult_content_maintainer        => 'concepts',
                opt_nocomments_maintainer       => 1,
            }
        ],
        'writer receives only the three raw retained manager properties'
    );
    my $saved = entry_snapshot( $comm, $target->ditemid );
    is( $saved->{reason_text}, 'manager reason set marker', 'fresh target stores exact reason' );
    is( $saved->{reason},     'concepts', 'fresh target stores exact adult override' );
    is( $saved->{nocomments}, 1,          'fresh target stores exact comments override' );
    is_deeply(
        { map { $_ => $saved->{$_} } qw(subject body security allowmask unrelated) },
        { map { $_ => $target_before->{$_} } qw(subject body security allowmask unrelated) },
        'property-only manager action preserves content, security, and unrelated properties'
    );
    is_deeply( entry_snapshot( $comm, $unrelated->ditemid ),
        $unrelated_before, 'manager action preserves an unrelated entry exactly' );
    ok( grep( $_ eq 'getevents', @protocol_modes ), 'adapter retains getevents validation' );
    is( scalar grep( $_ eq 'editevent', @protocol_modes ),
        0, 'manager action never invokes an edit protocol request' );
    is_deeply( \@hook_names, [], 'manager action invokes no decode, spam, or success hooks' );

    my $clear_path = '/editjournal.bml?usejournal=' . $comm->user . '&itemid=' . $target->ditemid;
    my $clear_form = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained manager clear form');
    $clear_form->value( prop_adult_content_maintainer_reason => '' );
    $clear_form->value( prop_adult_content_maintainer        => '' );
    $clear_form->value( prop_opt_nocomments_maintainer       => 0 );
    $clear_form->value( submit_value                         => 'action:savemaintainer' );
    $response = submit_form( $clear_form, $clear_path, $manager_cookie );
    is( $response->code, 302, 'submit_value savemaintainer returns the retained redirect status' );
    is( $response->header('Location'),
        $target->url, 'submit_value savemaintainer keeps the public entry redirect' );
    is( scalar @writes, 2, 'submit_value savemaintainer writes exactly once more' );
    my $cleared = entry_snapshot( $comm, $target->ditemid );
    is( $cleared->{reason_text}, '', 'empty retained reason clears the property' );
    is( $cleared->{reason},      '', 'empty retained adult override clears the property' );
    is( $cleared->{nocomments}, '',
        'missing/false retained comments override clears the property' );
    is_deeply(
        { map { $_ => $cleared->{$_} } qw(subject body security allowmask unrelated) },
        { map { $_ => $target_before->{$_} } qw(subject body security allowmask unrelated) },
        'clear preserves target content, security, and unrelated property exactly'
    );

    my $writes_before_failures = scalar @writes;
    for my $action (
        undef,           'action:unknown', 'action:save', 'action:spellcheck',
        'action:delete', 'action:deletespam'
        )
    {
        my $unsupported = retained_form( $clear_path, $manager_cookie )
            or BAIL_OUT('missing retained unsupported-action form');
        if ( defined $action ) {
            if ( $action eq 'action:unknown' ) {
                $unsupported->value( submit_value => $action );
            }
            else {
                $unsupported->value( $action => 1 );
            }
        }
        $response = submit_form( $unsupported, $clear_path, $manager_cookie );
        is( $response->code, 299,
            ( defined $action ? $action : 'no action' ) . ' falls through before any effect' );
        is( scalar @writes,
            $writes_before_failures,
            ( defined $action ? $action : 'no action' ) . ' produces zero property writes' );
    }
    is( scalar grep( $_ eq 'editevent', @protocol_modes ),
        0, 'unsupported actions never execute an edit protocol request' );

    my $missing = POST $clear_path,
        Content => [
        'action:savemaintainer' => 1,
        itemid                  => $target->ditemid,
        usejournal              => $comm->user,
        ];
    $response = callable_request( $missing, $manager_cookie );
    is( $response->code, 200,
        'missing token claimed manager action returns native error response' );
    like(
        $response->content,
        qr/Invalid form/,
        'missing token exposes localized invalid-form message'
    );
    ok( !defined $response->header('Location'), 'missing token does not redirect' );
    is( scalar @writes, $writes_before_failures, 'missing token writes nothing' );

    my $invalid = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained invalid-token form');
    $invalid->value( 'lj_form_auth' => 'invalid-manager-token' );
    $response = submit_form( $invalid, $clear_path, $manager_cookie, 'action:savemaintainer' );
    is( $response->code, 200,
        'invalid token claimed manager action returns native error response' );
    like(
        $response->content,
        qr/Invalid form/,
        'invalid token exposes localized invalid-form message'
    );
    ok( !defined $response->header('Location'), 'invalid token does not redirect' );
    is( scalar @writes, $writes_before_failures, 'invalid token writes nothing' );

    my $sysban = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained sysban form');
    {
        local *LJ::sysban_check = sub {
            return $_[0] eq 'spamreport' && $_[1] eq $comm->user;
        };
        $response = submit_form( $sysban, $clear_path, $manager_cookie, 'action:savemaintainer' );
        is( $response->code, 299, 'spam-report sysban preserves retained fallback' );
    }
    is( scalar @writes, $writes_before_failures, 'sysban writes nothing' );

    my $denied = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained denied-actor form');
    $response = submit_form( $denied, $clear_path, $outsider_cookie, 'action:savemaintainer' );
    is( $response->code, 299, 'nonmanager falls through before a property write' );
    is( scalar @writes, $writes_before_failures, 'nonmanager writes nothing' );

    my $invalid_authas_path = $clear_path . '&authas=' . $poster->user;
    my $invalid_authas      = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained invalid-authas form');
    $response = submit_form( $invalid_authas, $invalid_authas_path, $manager_cookie,
        'action:savemaintainer' );
    is( $response->code, 299, 'invalid authas falls through before a property write' );
    is( scalar @writes, $writes_before_failures, 'invalid authas writes nothing' );

    my $bad_item = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained bad-item form');
    $bad_item->value( itemid => $target->ditemid . '0' );
    $response = submit_form( $bad_item, '/editjournal.bml?usejournal=' . $comm->user,
        $manager_cookie, 'action:savemaintainer' );
    is( $response->code, 299, 'invalid composite item id falls through before a property write' );
    is( scalar @writes, $writes_before_failures, 'invalid composite item id writes nothing' );

    my $readonly = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained readonly form');
    $readonly->value( prop_adult_content_maintainer_reason => 'readonly manager marker' );
    {
        my $is_readonly = \&LJ::User::is_readonly;
        no warnings 'redefine';
        local *LJ::User::is_readonly = sub {
            return 1 if $_[0]->id == $manager->id || $_[0]->id == $comm->id;
            return $is_readonly->(@_);
        };
        $response = submit_form( $readonly, $clear_path, $manager_cookie, 'action:savemaintainer' );
    }
    is( $response->code, 302,
        'readonly manager/community retains the property-only redirect behavior' );
    is(
        scalar @writes,
        $writes_before_failures + 1,
        'readonly manager action performs its one retained property write'
    );
    is(
        entry_snapshot( $comm, $target->ditemid )->{reason_text},
        'readonly manager marker',
        'readonly manager action reaches the retained property writer'
    );

    # A valid request after all rejected contexts demonstrates that request-local
    # target/actor state did not leak from any preceding fallback.
    my $sequential = retained_form( $clear_path, $manager_cookie )
        or BAIL_OUT('missing retained sequential form');
    $sequential->value( prop_adult_content_maintainer_reason => 'sequential manager marker' );
    $response = submit_form( $sequential, $clear_path, $manager_cookie, 'action:savemaintainer' );
    is( $response->code, 302, 'valid manager request follows rejected contexts cleanly' );
    is(
        entry_snapshot( $comm, $target->ditemid )->{reason_text},
        'sequential manager marker',
        'sequential valid request resolves the original target exactly'
    );
};

done_testing;

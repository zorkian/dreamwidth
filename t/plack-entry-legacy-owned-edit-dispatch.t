#!/usr/bin/perl
# Exercise production retained owned-edit dispatch with real form requests.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use URI;
use Plack::Test;
use lib "$ENV{LJHOME}/t/lib";
use LJ::Test::LegacyOwnedEditRoute;
use lib "$ENV{LJHOME}/cgi-bin";
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);

plan skip_all => 'Legacy edit integration requires a development server' unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $production_editjournal_route = $DW::Routing::string_choices{'app/editjournal'};

sub form_from {
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
            HTML::Form->parse( $_[0], 'http://localhost/editjournal' ) )[0];
}
sub fresh { LJ::Entry::reset_singletons(); return LJ::Entry->new( $_[0], ditemid => $_[1] ) }

sub visible_click {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing retained $name submit" unless $input;
    return $input->click($form);
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'legacyOwnedAdapter';

my @hook_calls;
my $run_hooks = \&LJ::Hooks::run_hooks;
no warnings 'redefine';
local *LJ::Hooks::run_hooks = sub {
    push @hook_calls, $_[0] if $_[0] eq 'decode_entry_form' || $_[0] eq 'spam_check';
    return $run_hooks->(@_);
};

{
    local $DW::Routing::string_choices{'app/editjournal'} =
        LJ::Test::LegacyOwnedEditRoute::retained_bml_get_route($production_editjournal_route);

    test_psgi $app, sub {
        my $send = shift;
        for my $suffix ( '', '.bml' ) {
            my $entry = $owner->t_post_fake_entry(
                subject  => "Adapter $suffix original",
                body     => "Adapter $suffix body",
                security => 'private'
            );
            my $other = $owner->t_post_fake_entry(
                subject  => "Adapter $suffix other",
                body     => "Adapter $suffix other body",
                security => 'private'
            );
            my $path = "/editjournal$suffix?itemid=" . $entry->ditemid;
            my $get  = GET $path;
            $get->header( Cookie => $cookie );
            my $res = $send->($get);
            is( $res->code, 200, "$path renders retained owned-edit form" );
            my $form = form_from( $res->content );
            ok( $form, "$path supplies its actual retained edit form" ) or next;
            ok( $form->find_input('lj_form_auth'), "$path form supplies its CSRF token" );
            $form->action( 'http://localhost' . $path );
            $form->value( subject => "Adapter $suffix changed" );
            $form->value( event   => "Adapter $suffix changed body" );
            my $post = visible_click( $form, 'action:save' );
            is(
                $post->uri->path,
                '/editjournal' . $suffix,
                'save POST uses the exact requested legacy alias'
            );
            $post->header( Cookie         => $cookie );
            $post->header( Referer        => "http://localhost$path" );
            $post->header( 'Content-Type' => 'application/x-www-form-urlencoded' );
            my $adapter_res = $send->($post);
            my $content     = $adapter_res->content;
            my $result      = { status => $adapter_res->is_success ? 'ok' : undef };
            is( $result->{status}, 'ok',
                "$path actual retained form saves through production owned-edit dispatch" );
            like(
                $content,
                qr{href="/entry/\Q@{[$owner->user]}\E/\Q@{[$entry->ditemid]}\E/edit"},
                "$path production dispatch renders the native edit success link"
            );
            is(
                fresh( $owner, $entry->ditemid )->subject_raw,
                "Adapter $suffix changed",
                "$path persists changed subject"
            );
            is(
                fresh( $owner, $entry->ditemid )->event_raw,
                "Adapter $suffix changed body",
                "$path persists changed body"
            );
            is( fresh( $owner, $entry->ditemid )->security,
                'private', "$path save preserves the retained private security selection" );
            is(
                fresh( $owner, $other->ditemid )->subject_raw,
                "Adapter $suffix other",
                "$path preserves unrelated entry"
            );

            my $again = GET $path;
            $again->header( Cookie => $cookie );
            $res  = $send->($again);
            $form = form_from( $res->content );
            $form->action( 'http://localhost' . $path );
            my $delete = visible_click( $form, 'action:delete' );
            is(
                $delete->uri->path,
                '/editjournal' . $suffix,
                'delete POST uses the exact requested legacy alias'
            );
            $delete->header( Cookie         => $cookie );
            $delete->header( Referer        => "http://localhost$path" );
            $delete->header( 'Content-Type' => 'application/x-www-form-urlencoded' );
            $adapter_res = $send->($delete);
            $content     = $adapter_res->content;
            $result      = { status => $adapter_res->is_success ? 'ok' : undef };
            is( $result->{status}, 'ok',
                "$path actual retained delete submits through production owned-edit dispatch" );
            ok(
                !fresh( $owner, $entry->ditemid )->valid,
                "$path delete removes only the selected entry"
            );
            ok( fresh( $owner, $other->ditemid )->valid, "$path delete preserves unrelated entry" );

            my $other_path = "/editjournal$suffix?itemid=" . $other->ditemid;
            my $other_get  = GET $other_path;
            $other_get->header( Cookie => $cookie );
            my $before_subject = fresh( $owner, $other->ditemid )->subject_raw;
            my $before_body    = fresh( $owner, $other->ditemid )->event_raw;
            my $untouched      = $owner->t_post_fake_entry(
                subject  => 'Unrelated sentinel',
                body     => 'Unrelated sentinel body',
                security => 'private'
            );

            for my $case (qw(no_action unknown_action unknown_submit missing_token invalid_token)) {
                $res  = $send->($other_get);
                $form = form_from( $res->content );
                ok( $form, "$other_path $case has a real retained form" ) or next;
                $form->action( 'http://localhost' . $other_path );
                $form->value( subject => "Must not save $case" );
                $form->value( event   => "Must not save body $case" );
                my $request = visible_click( $form, 'action:save' );
                my $encoded = URI->new('http://localhost/');
                $encoded->query( $request->content );
                my @pairs = $encoded->query_form;
                my @kept;

                while (@pairs) {
                    my ( $key, $value ) = splice @pairs, 0, 2;
                    next
                        if $case =~ /^(?:no_action|unknown_action|unknown_submit)$/
                        && ( $key =~ /^action:/ || $key eq 'submit_value' );
                    next if $case =~ /token$/ && $key eq 'lj_form_auth';
                    push @kept, $key, $value;
                }
                push @kept, 'action:unknown', 1 if $case eq 'unknown_action';
                push @kept, submit_value => 'action:not-whitelisted' if $case eq 'unknown_submit';
                push @kept, lj_form_auth => 'invalid' if $case eq 'invalid_token';
                $encoded->query_form(@kept);
                $request->content( $encoded->query );
                $request->header( 'Content-Length' => length $request->content );
                $request->header( Cookie => $cookie, Referer => 'http://localhost' . $other_path );
                @hook_calls = ();
                my $denied = $send->($request);
                is( $denied->code, 200,
                    "$other_path $case keeps the retained BML rejection or fallback response" );
                like( $denied->content, qr/(?:invalid|error)/i,
                    "$other_path $case keeps a meaningful retained rejection response" )
                    if $case =~ /token$/;
                is_deeply( \@hook_calls, [], "$other_path $case invokes no decode or spam hook" );
                unlike(
                    $denied->content,
                    qr/Your edit was successful/,
                    "$other_path $case does not render native save success"
                );
                is( fresh( $owner, $other->ditemid )->subject_raw,
                    $before_subject,
                    "$other_path $case retains fresh subject despite distinct submitted value" );
                is( fresh( $owner, $other->ditemid )->event_raw,
                    $before_body, "$other_path $case retains fresh body" );
                is( fresh( $owner, $other->ditemid )->security,
                    'private', "$other_path $case retains private security" );
                is(
                    fresh( $owner, $untouched->ditemid )->event_raw,
                    'Unrelated sentinel body',
                    "$other_path $case leaves unrelated entry unchanged"
                );
            }

            $res  = $send->($other_get);
            $form = form_from( $res->content );
            ok( $form, "$other_path invalid date starts from actual retained form" ) or next;
            my $retry_query = '&encoded=one%2Ftwo&repeat=first&repeat=second';
            $form->action( 'http://localhost' . $other_path . $retry_query );
            $form->value( subject       => 'Invalid date retained subject' );
            $form->value( event         => 'Invalid date retained body' );
            $form->value( date_ymd_yyyy => 'not-a-year' );
            $form->value( date_ymd_mm   => '02' );
            $form->value( date_ymd_dd   => '03' );
            $form->value( hour          => '04' );
            $form->value( min           => '05' );
            $form->value( date_diff     => 1 );
            my $invalid_date = visible_click( $form, 'action:save' );
            $invalid_date->header( Cookie => $cookie, Referer => 'http://localhost' . $other_path );
            @hook_calls = ();
            my $retry_response = $send->($invalid_date);
            is( $retry_response->code, 200, "$other_path invalid date renders a correction form" );
            is_deeply(
                \@hook_calls,
                [qw(decode_entry_form spam_check)],
                "$other_path invalid date preserves pre-attempt edit hook ordering"
            );
            my ($retry_form) = grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
                HTML::Form->parse( $retry_response->content, 'http://localhost' );
            ok( $retry_form, "$other_path invalid date uses modern retry form" ) or next;
            is( $retry_form->value('entrytime_date'),
                'not-a-year-02-03', "$other_path retains raw invalid year" );
            is(
                $retry_form->value('subject'),
                'Invalid date retained subject',
                "$other_path retry retains subject"
            );
            is(
                $retry_form->value('event'),
                'Invalid date retained body',
                "$other_path retry retains body"
            );
            is( $retry_form->value('security'),
                'private', "$other_path retry retains private security" );
            is(
                $retry_form->action,
                'http://localhost/entry/'
                    . $owner->user . '/'
                    . $other->ditemid
                    . '/edit?itemid='
                    . $other->ditemid
                    . $retry_query,
                "$other_path retry uses modern action and exact query"
            );
            my @alerts =
                $retry_response->content =~
                m{<div[^>]*class="[^"]*alert-box[^"]*"[^>]*>(.*?)</div>}sg;
            my @errors = grep { /(?:invalid|year|date|time|range)/i && !/beta/i } @alerts;
            is( scalar @errors, 1, "$other_path invalid date has exactly one visible error alert" );
            unlike(
                $retry_response->content,
                qr/missing string|DieObject|<\?errorbar/i,
                "$other_path invalid date error has no legacy or missing-string artifacts"
            );
            is( fresh( $owner, $other->ditemid )->subject_raw,
                $before_subject, "$other_path invalid date does not save subject" );
            is( fresh( $owner, $other->ditemid )->event_raw,
                $before_body, "$other_path invalid date does not save body" );
            is( fresh( $owner, $other->ditemid )->security,
                'private', "$other_path invalid date leaves persisted security" );
            is(
                fresh( $owner, $untouched->ditemid )->event_raw,
                'Unrelated sentinel body',
                "$other_path invalid date preserves unrelated entry"
            );

        }
        my $hidden_entry = $owner->t_post_fake_entry(
            subject  => 'Hidden item original',
            body     => 'Hidden item body',
            security => 'private'
        );
        my $hidden_path = '/editjournal?itemid=' . $hidden_entry->ditemid;
        my $hidden_get  = GET $hidden_path;
        $hidden_get->header( Cookie => $cookie );
        my $hidden_form = form_from( $send->($hidden_get)->content );
        ok( $hidden_form, 'hidden-item POST starts from the retained GET form' );
        $hidden_form->action('http://localhost/editjournal');
        $hidden_form->value( subject => 'Hidden item native save' );
        my $hidden_post = visible_click( $hidden_form, 'action:save' );
        $hidden_post->header( Cookie => $cookie, Referer => 'http://localhost' . $hidden_path );
        my $hidden_adapter = \&DW::Controller::Entry::legacy_owned_edit_post;
        my $hidden_calls   = 0;
        no warnings 'redefine';
        local *DW::Controller::Entry::legacy_owned_edit_post =
            sub { $hidden_calls++; return $hidden_adapter->(@_); };
        my $hidden_res = $send->($hidden_post);
        is( $hidden_res->code, 200,
            'hidden POST itemid receives the successful production response' );
        is( $hidden_calls, 1, 'hidden POST itemid invokes the production adapter once' );
        is(
            fresh( $owner, $hidden_entry->ditemid )->subject_raw,
            'Hidden item native save',
            'hidden POST itemid persists through production dispatch without a query itemid'
        );

        my $beta_entry = $owner->t_post_fake_entry(
            subject  => 'Beta fallback original',
            body     => 'Beta fallback body',
            security => 'private'
        );
        my $beta_path     = '/editjournal?itemid=' . $beta_entry->ditemid;
        my $beta_form_get = GET $beta_path;
        $beta_form_get->header( Cookie => $cookie );
        my $beta_form = form_from( $send->($beta_form_get)->content );
        ok( $beta_form, 'beta POST starts from the retained non-beta form' );
        {
            no warnings 'redefine';
            local *LJ::BetaFeatures::user_in_beta = sub { 1 };
            my $beta_get = GET $beta_path;
            $beta_get->header( Cookie => $cookie );
            my $beta_get_res = $send->($beta_get);
            is( $beta_get_res->code, 302, 'beta GET retains the BML redirect' );

            my $form = $beta_form;
            $form->action( 'http://localhost' . $beta_path );
            $form->value( subject => 'Beta must not save' );
            my $beta_post = visible_click( $form, 'action:save' );
            $beta_post->header( Cookie => $cookie, Referer => 'http://localhost' . $beta_path );
            @hook_calls = ();
            my $beta_post_res = $send->($beta_post);
            is( $beta_post_res->code, 302, 'beta POST retains the BML redirect' );
            is_deeply( \@hook_calls, [], 'beta POST reaches no decoder or spam hook' );
        }
        is(
            fresh( $owner, $beta_entry->ditemid )->subject_raw,
            'Beta fallback original',
            'beta fallback leaves the target unchanged'
        );

        my $readonly_entry = $owner->t_post_fake_entry(
            subject  => 'Readonly fallback original',
            body     => 'Readonly fallback body',
            security => 'private'
        );
        my $readonly_path = '/editjournal?itemid=' . $readonly_entry->ditemid;
        my $readonly_get  = GET $readonly_path;
        $readonly_get->header( Cookie => $cookie );
        my $readonly_form = form_from( $send->($readonly_get)->content );
        ok( $readonly_form, 'readonly POST starts from the retained non-readonly form' );
        {
            my $is_readonly   = \&LJ::User::Account::is_readonly;
            my $adapter       = \&DW::Controller::Entry::legacy_owned_edit_post;
            my $adapter_calls = 0;
            no warnings 'redefine';
            local *LJ::User::Account::is_readonly = sub {
                return 1 if $_[0]->equals($owner);
                return $is_readonly->(@_);
            };
            local *LJ::User::is_readonly = sub { return 1 if $_[0]->equals($owner); return 0; };
            local *DW::Controller::Entry::legacy_owned_edit_post = sub {
                $adapter_calls++;
                return $adapter->(@_);
            };
            $readonly_form->action( 'http://localhost' . $readonly_path );
            $readonly_form->value( subject => 'Readonly must not save' );
            my $readonly_post = visible_click( $readonly_form, 'action:save' );
            $readonly_post->header(
                Cookie  => $cookie,
                Referer => 'http://localhost' . $readonly_path
            );
            @hook_calls = ();
            my $readonly_res = $send->($readonly_post);
            is( $readonly_res->code, 200, 'readonly POST keeps the retained BML response' );
            ok(
                grep( $_ eq 'decode_entry_form', @hook_calls ),
                'readonly POST falls through to the retained BML decoder'
            );
            is( $adapter_calls, 0,
                'readonly POST does not invoke the production owned-edit adapter' );
        }
        is(
            fresh( $owner, $readonly_entry->ditemid )->subject_raw,
            'Readonly fallback original',
            'readonly fallback leaves the target unchanged'
        );

        my $authas_entry = $owner->t_post_fake_entry(
            subject  => 'Authas fallback original',
            body     => 'Authas fallback body',
            security => 'private'
        );
        my $outsider = temp_user();
        $outsider->update_self( { status => 'A' } );
        my $authas_path =
            '/editjournal?itemid=' . $authas_entry->ditemid . '&authas=' . $outsider->user;
        my $authas_get = GET $authas_path;
        $authas_get->header( Cookie => $cookie );
        my $authas_res = $send->($authas_get);
        is( $authas_res->code, 200, 'different authas keeps the retained BML response' );
        my $authas_form_get = GET( '/editjournal?itemid=' . $authas_entry->ditemid );
        $authas_form_get->header( Cookie => $cookie );
        my $authas_form = form_from( $send->($authas_form_get)->content );
        ok( $authas_form, 'different authas POST uses a valid token from the retained owner form' );
        $authas_form->action( 'http://localhost' . $authas_path );
        $authas_form->value( subject => 'Different authas must not save' );
        my $authas_post = visible_click( $authas_form, 'action:save' );
        $authas_post->header( Cookie => $cookie, Referer => 'http://localhost' . $authas_path );
        my $authas_adapter = \&DW::Controller::Entry::legacy_owned_edit_post;
        my $authas_calls   = 0;
        no warnings 'redefine';
        local *DW::Controller::Entry::legacy_owned_edit_post =
            sub { $authas_calls++; return $authas_adapter->(@_); };
        my $authas_post_res = $send->($authas_post);
        is( $authas_post_res->code, 200,
            'different authas POST keeps the retained denial response' );
        like( $authas_post_res->content, qr/(?:invalid|error)/i,
            'different authas POST keeps meaningful denial text' );
        is( $authas_calls, 0, 'different authas POST does not invoke the production adapter' );
        is(
            fresh( $owner, $authas_entry->ditemid )->subject_raw,
            'Authas fallback original',
            'different authas POST leaves the owned entry unchanged'
        );

    };
}

is( $DW::Routing::string_choices{'app/editjournal'},
    $production_editjournal_route,
    'retained GET test overlay does not leak into the routing table' );

done_testing;

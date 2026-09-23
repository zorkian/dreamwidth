#!/usr/bin/perl
# Exercise callable anonymous retained update posting without route activation.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use lib "$ENV{LJHOME}/t/lib";
use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Entry;
use LJ::Test qw(temp_user);
use LJ::Test::LegacyOwnedEditRoute;
use Plack::Middleware::DW::RequestWrapper;

plan skip_all => 'Anonymous update adapter requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub retained_form {
    my ($content) = @_;
    return ( grep { ( $_->attr('id') || '' ) eq 'updateForm' }
            HTML::Form->parse( $content, 'http://localhost/update' ) )[0];
}

sub visible_click {
    my ( $form, $name ) = @_;
    my ($input) =
        grep { $_->can('click') && ( $_->name || '' ) eq $name && length( $_->value || '' ) }
        $form->inputs;
    die "missing retained $name submit" unless $input;
    return $input->click($form);
}

sub visible_input_values {
    my ( $form, $name ) = @_;
    return map { $_->value // '' }
        grep   { ( $_->name || '' ) eq $name && ( $_->type || '' ) !~ /hidden/i } $form->inputs;
}

sub fresh_user {
    my ($userid) = @_;
    return LJ::load_userid( $userid, 1 );
}

sub user_state {
    my ($userid) = @_;
    my $user = fresh_user($userid);
    return {
        draft            => $user->draft_text,
        draft_properties => $user->prop('draft_properties'),
        entry_editor     => $user->prop('entry_editor'),
        entry_editor2    => $user->entry_editor2,
        autoformat       => $user->prop('disable_auto_formatting') || 0,
    };
}

sub entry_count {
    my ($user) = @_;
    return $user->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $user->id );
}

my $retained_app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $retained_app eq 'CODE';

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_password('anonymous-adapter-password');
$owner->set_draft_text('anonymous draft sentinel');
$owner->set_prop(
    draft_properties => nfreeze( { subject => 'frozen draft subject', editor => 'markdown0' } ) );
$owner->set_prop( entry_editor => 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_prop( disable_auto_formatting => 0 );
my $owner_id     = $owner->id;
my $owner_before = user_state($owner_id);

my $other = temp_user();
$other->update_self( { status => 'A' } );
$other->set_password('second-anonymous-password');
$other->set_draft_text('second anonymous draft sentinel');
$other->set_prop( draft_properties => nfreeze( { subject => 'second frozen draft' } ) );
$other->set_prop( entry_editor     => 'always_plain' );
$other->entry_editor2('markdown0');
my $other_id     = $other->id;
my $other_before = user_state($other_id);

my $retained_html;
test_psgi $retained_app, sub {
    my $send = shift;
    LJ::Test::LegacyOwnedEditRoute::with_retained_bml_get_route(
        'app/update',
        sub {
            my $res = $send->( GET '/update' );
            is( $res->code, 200, 'retained anonymous update form harvests' );
            $retained_html = $res->content;
        }
    );
};
my $retained = retained_form($retained_html);
ok( $retained, 'actual retained anonymous update form is available' )
    or BAIL_OUT('retained anonymous update form missing');

sub post_from_retained {
    my (%values) = @_;
    my $form = retained_form($retained_html);
    $form->action('http://localhost/anonymous-update');
    for my $name ( keys %values ) {
        $form->value( $name => $values{$name} );
    }
    return visible_click( $form, 'action:update' );
}

sub remove_form_field {
    my ( $request, $name ) = @_;
    my @pairs = grep { $_ !~ /^\Q$name\E=/ } split /&/, $request->content;
    $request->content( join '&', @pairs );
    $request->header( 'Content-Length' => length $request->content );
    return $request;
}

my $adapter = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $render = DW::Controller::Entry::legacy_anonymous_update_handler();
        if ( defined $render ) {
            DW::Request->get->status(200);
            return DW::Request->get->res;
        }
        DW::Request->get->status(200);
        DW::Request->get->print('DECLINED');
        return DW::Request->get->res;
    }
);

my @order;
my ( $decode_post_ref, $decode_request_ref, $spam_request_ref, $success_request_ref );
my ( $decode_post,     $decoded_request,    $spam_request,     $save_request );
my @login_requests;
my $login_override;
my $scheduler_calls = 0;
my $run_hooks       = \&LJ::Hooks::run_hooks;
my $run_hook        = \&LJ::Hooks::run_hook;
my $legacy_do       = \&LJ::do_request;
my $protocol_do     = \&LJ::Protocol::do_request;

no warnings 'redefine';
local *LJ::Hooks::run_hooks = sub {
    my ( $name, @args ) = @_;
    if ( $name eq 'decode_entry_form' ) {
        push @order, 'decode';
        ( $decode_post_ref, $decode_request_ref ) = map { refaddr($_) } @args;
        $decode_post     = { %{ $args[0] } };
        $decoded_request = { %{ $args[1] } };
    }
    elsif ( $name eq 'spam_check' ) {
        push @order, 'spam';
        $spam_request_ref = refaddr( $args[1] );
        $spam_request     = { %{ $args[1] } };
    }
    elsif ( $name =~ /^after_entry_post_extra_(?:options|html)$/ ) {
        push @order, 'success';
    }
    return $run_hooks->(@_);
};
local *LJ::Hooks::run_hook = sub {
    my ( $name, @args ) = @_;
    if ( $name eq 'after_entry_post_extra_html' ) {
        push @order, 'success';
        my %args = @args;
        $success_request_ref = refaddr( $args{request} ) if $args{request};
    }
    return $run_hook->(@_);
};
local *LJ::do_request = sub {
    my ( $request, $response, $flags ) = @_;
    if ( ( $request->{mode} || '' ) eq 'login' ) {
        push @order, 'login';
        push @login_requests, { %$request, flags => {%$flags} };
        if ($login_override) {
            %$response = %$login_override;
            return 1;
        }
    }
    return $legacy_do->(@_);
};
local *LJ::Protocol::do_request = sub {
    my ( $mode, @args ) = @_;
    if ( $mode eq 'postevent' ) {
        push @order, 'save';
        $save_request = { %{ $args[0] } };
    }
    return $protocol_do->(@_);
};
local *LJ::Protocol::schedule_xposts = sub {
    ++$scheduler_calls;
    return ( [], [] );
};

test_psgi $adapter, sub {
    my $send    = shift;
    my $request = sub { $send->( $_[0] ) };

    my $success = post_from_retained(
        user                  => $owner->user,
        password              => 'anonymous-adapter-password',
        subject               => 'Anonymous adapter subject',
        event                 => 'Anonymous adapter body',
        security              => 'private',
        prop_taglist          => 'anonymous-one, anonymous-two',
        prop_current_location => 'Anonymous location',
        prop_current_music    => 'Anonymous music',
        event_format          => 1,
        editor                => 'markdown0',
    );
    @order = ();
    my $success_res = $request->($success);
    is( $success_res->code,  200, 'correct anonymous credentials render native success' );
    is( entry_count($owner), 1,   'successful anonymous owner post creates exactly one entry' );
    LJ::Entry::reset_singletons();
    my $entry = LJ::Entry->new( $owner, jitemid => 1 );
    is( $entry->subject_raw, 'Anonymous adapter subject', 'success persists exact subject' );
    is( $entry->event_raw,   'Anonymous adapter body',    'success persists exact body' );
    is( $entry->security,    'private',                   'success persists selected security' );
    is( $entry->prop('taglist'), 'anonymous-one, anonymous-two', 'success persists tags' );
    is( $entry->prop('current_location'), 'Anonymous location', 'success persists location' );
    is( $entry->prop('current_music'),    'Anonymous music',    'success persists music' );
    is_deeply(
        \@order,
        [qw(login decode save spam success success)],
        'legacy login precedes decode, save attempt, spam hook, and success hooks'
    );
    is( $login_requests[-1]{clientversion}, 'Web/2.0.0',  'login uses retained client version' );
    is( $login_requests[-1]{mode},          'login',      'login uses retained protocol mode' );
    is( $login_requests[-1]{user},          $owner->user, 'login uses submitted legacy username' );
    is( $login_requests[-1]{flags}{noauth}, 1, 'login receives authenticated legacy flags' );
    is( $decoded_request->{mode}, 'postevent',       'decoded request retains postevent seed' );
    is( $decoded_request->{ver},  $LJ::PROTOCOL_VER, 'decoded request retains protocol version' );
    is( $decoded_request->{user}, $owner->user, 'decoded request retains submitted user seed' );
    is( $decoded_request->{password},
        'anonymous-adapter-password', 'decoded request retains password seed' );
    is( $decoded_request->{usejournal}, '', 'decoded request retains empty owner usejournal seed' );
    is( $save_request->{tz},    'guess', 'save request retains guessed timezone seed' );
    is( $save_request->{xpost}, '0',     'save request retains disabled crosspost seed' );
    is( $decode_request_ref, $spam_request_ref,
        'spam hook receives the exact decoded flat request reference' );
    is( $spam_request_ref, $success_request_ref,
        'legacy success HTML hook receives the exact decoded flat request reference' );
    is( $scheduler_calls, 0, 'anonymous owner success does not schedule crossposts' );

    my $after_on = user_state($owner_id);
    is( $after_on->{autoformat}, 1, 'event_format on updates poster formatting preference' );
    is_deeply(
        { map { $_ => $after_on->{$_} } qw(draft draft_properties entry_editor entry_editor2) },
        { map { $_ => $owner_before->{$_} } qw(draft draft_properties entry_editor entry_editor2) },
        'anonymous success leaves remote-only draft and editor sentinels unchanged'
    );

    my $off = post_from_retained(
        user         => $owner->user,
        password     => 'anonymous-adapter-password',
        subject      => 'Anonymous format off',
        event        => 'Anonymous format off body',
        security     => 'private',
        event_format => 0,
    );
    my $off_res = $request->($off);
    is( $off_res->code, 200, 'format-off anonymous owner post succeeds' );
    is( user_state($owner_id)->{autoformat},
        0, 'event_format off updates poster formatting preference' );

    my $login_warning = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Anonymous login warning subject',
        event    => 'Anonymous login warning body',
        security => 'private',
    );
    $login_override = { success => 'OK', message => 'Anonymous login warning marker' };
    my $warning_res = $request->($login_warning);
    $login_override = undef;
    like(
        $warning_res->content,
        qr/Anonymous login warning marker/,
        'successful login protocol message is rendered as a native warning'
    );

    my $login_error_user = temp_user();
    $login_error_user->update_self( { status => 'A' } );
    $login_error_user->set_password('login-error-password');
    my $login_error = post_from_retained(
        user     => $login_error_user->user,
        password => 'login-error-password',
        subject  => 'Login error subject',
        event    => 'Login error body',
        security => 'private',
    );
    $login_override = { success => 'FAIL', errmsg => 'Anonymous login error marker' };
    @order          = ();
    my $login_error_res = $request->($login_error);
    $login_override = undef;
    like(
        $login_error_res->content,
        qr/Error logging in:.*Anonymous login error marker/s,
        'login protocol failure returns the retained-style native login error'
    );
    is_deeply(
        \@order,
        [qw(login decode save spam)],
        'login protocol failure still makes the retained post attempt and spam check'
    );
    is( user_state( $login_error_user->id )->{autoformat},
        0, 'login error does not run success-only anonymous housekeeping' );

    my $before_empty = entry_count($owner);
    my $empty        = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Empty body subject',
        event    => '',
        security => 'private',
    );
    @order = ();
    my $empty_res = $request->($empty);
    is( $empty_res->code,    200,           'empty body returns native retry' );
    is( entry_count($owner), $before_empty, 'empty body creates no entry' );
    like(
        $empty_res->content,
        qr/(?:Must provide entry text|body.*required|error)/i,
        'empty body exposes a useful native body error'
    );
    like( $empty_res->content, qr/Empty body subject/, 'empty retry retains subject' );
    unlike( $empty_res->content, qr/anonymous-adapter-password/, 'empty retry blanks password' );
    is_deeply(
        \@order,
        [qw(login decode save spam)],
        'empty body still performs legacy login, decode, save attempt, then spam check'
    );

    my $before_invalid = entry_count($owner);
    my $invalid        = post_from_retained(
        user          => $owner->user,
        password      => 'anonymous-adapter-password',
        subject       => 'Invalid date subject',
        event         => 'Invalid date body',
        security      => 'private',
        date_ymd_yyyy => 'not-a-year',
        date_ymd_mm   => '02',
        date_ymd_dd   => '03',
        hour          => '04',
        min           => '05',
    );
    @order = ();
    my $invalid_res = $request->($invalid);
    is( $invalid_res->code,  200,             'invalid date returns native retry' );
    is( entry_count($owner), $before_invalid, 'invalid date creates no entry' );
    like( $invalid_res->content, qr/id="js-post-entry"/, 'invalid date uses shared native retry' );
    like( $invalid_res->content, qr/not-a-year/,         'invalid date retry retains raw year' );
    my $retry = ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $invalid_res->content, 'http://localhost/entry/new' ) )[0];
    ok( $retry, 'invalid date response contains the native retry form' );
    is( $retry->value('subject'), 'Invalid date subject', 'retry retains subject in parsed form' );
    is( $retry->value('event'), 'Invalid date body', 'retry retains body in parsed form' );
    is( $retry->value('security'), 'private', 'retry retains selected security in parsed form' );
    is( $retry->value('entrytime_date'),
        'not-a-year-02-03', 'retry retains the raw invalid date in parsed native controls' );
    is_deeply(
        [ visible_input_values( $retry, 'username' ) ],
        [ $owner->user ],
        'retry retains the visible anonymous username'
    );
    is_deeply(
        [
            grep { length } map { $_->value // '' }
            grep { ( $_->name || '' ) eq 'password' } $retry->inputs
        ],
        [],
        'retry blanks every anonymous password control'
    );
    is_deeply(
        \@order,
        [qw(login decode save spam)],
        'invalid date attempts save then runs exactly one legacy spam check'
    );

    my $decline_before = entry_count($owner);
    my $decline_state  = user_state($owner_id);
    for my $case (
        [ 'empty password',         { password            => '' } ],
        [ 'wrong password',         { password            => 'wrong-password' } ],
        [ 'community target',       { usejournal          => 'not-the-owner' } ],
        [ 'preview transform',      { 'action:preview'    => 'Preview' } ],
        [ 'spellcheck transform',   { 'action:spellcheck' => 'Spellcheck' } ],
        [ 'show form',              { showform            => 1 } ],
        [ 'more options transform', { moreoptsbtn         => 1 } ],
        [ 'challenge credentials', { chal => 'challenge', response => 'response' } ],
        )
    {
        my ( $label, $changes ) = @$case;
        my $post = post_from_retained(
            user     => $owner->user,
            password => 'anonymous-adapter-password',
            subject  => "Declined $label",
            event    => 'must not persist',
            security => 'private',
            %$changes,
        );
        @order = ();
        my $res = $request->($post);
        like( $res->content, qr/DECLINED/, "$label declines before native handling" );
        is_deeply( \@order, [], "$label performs no login/decode/save/hook work" );
    }
    is( entry_count($owner), $decline_before,
        'all declined requests leave owner entries unchanged' );
    is_deeply( user_state($owner_id), $decline_state,
        'declined requests leave anonymous draft/editor and formatting state unchanged' );

    my $missing = remove_form_field(
        post_from_retained(
            user     => $owner->user,
            password => 'anonymous-adapter-password',
            subject  => 'Missing password request',
            event    => 'must not persist',
            security => 'private',
        ),
        'password',
    );
    @order = ();
    my $missing_res = $request->($missing);
    like( $missing_res->content, qr/DECLINED/, 'missing password declines before native handling' );
    is_deeply( \@order, [], 'missing password performs no login/decode/save/hook work' );

    {
        my $session_post = post_from_retained(
            user     => $owner->user,
            password => 'anonymous-adapter-password',
            subject  => 'Session remote request',
            event    => 'must not persist',
            security => 'private',
        );
        local *LJ::get_remote = sub { return $owner; };
        @order = ();
        my $session_res = $request->($session_post);
        like( $session_res->content, qr/DECLINED/,
            'session remote request declines to retained BML' );
        is_deeply( \@order, [], 'session remote request performs no adapter work' );
    }

    {
        my $readonly_post = post_from_retained(
            user     => $owner->user,
            password => 'anonymous-adapter-password',
            subject  => 'Readonly request',
            event    => 'must not persist',
            security => 'private',
        );
        my $readonly = \&LJ::User::readonly;
        local *LJ::User::readonly = sub {
            return 1 if $_[0]->id == $owner_id;
            return $readonly->(@_);
        };
        @order = ();
        my $readonly_res = $request->($readonly_post);
        like( $readonly_res->content, qr/DECLINED/, 'readonly owner declines before decoder' );
        is_deeply( \@order, [], 'readonly owner performs no login/decode/save/hook work' );
    }

    my $wrong = post_from_retained(
        user     => $other->user,
        password => 'wrong-password',
        subject  => 'Wrong user request',
        event    => 'must not persist',
        security => 'private',
    );
    @order = ();
    my $wrong_res = $request->($wrong);
    like( $wrong_res->content, qr/DECLINED/,
        'wrong password declines before decoder and rendering' );
    is_deeply( \@order, [], 'wrong password has no protocol/decode/save/hook leakage' );
    is_deeply( user_state($other_id), $other_before,
        'wrong password does not alter the second user draft/editor preferences' );

    my $second = post_from_retained(
        user     => $other->user,
        password => 'second-anonymous-password',
        subject  => 'Second anonymous owner subject',
        event    => 'Second anonymous owner body',
        security => 'private',
    );
    my $second_res = $request->($second);
    is( $second_res->code,   200, 'second user follows a wrong-password decline successfully' );
    is( entry_count($other), 1,   'second user owns exactly its one successful entry' );
    LJ::Entry::reset_singletons();
    my $second_entry = LJ::Entry->new( $other, jitemid => 1 );
    is(
        $second_entry->subject_raw,
        'Second anonymous owner subject',
        'sequential request does not leak prior anonymous username or fields'
    );

    my $no_action = remove_form_field(
        post_from_retained(
            user     => $other->user,
            password => 'second-anonymous-password',
            subject  => 'Implicit retained update subject',
            event    => 'Implicit retained update body',
            security => 'private',
        ),
        'action:update',
    );
    my $no_action_res = $request->($no_action);
    is( $no_action_res->code, 200,
        'ordinary retained post without an action:update control is accepted' );
    is( entry_count($other), 2,
        'implicit ordinary retained update posts exactly one additional entry' );
};

done_testing;

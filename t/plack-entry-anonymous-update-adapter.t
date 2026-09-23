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
use LJ::Userpic;
use LJ::Test::LegacyOwnedEditRoute;
use Plack::Middleware::DW::RequestWrapper;

plan skip_all => 'Anonymous update adapter requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

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
        displaydate      => $user->displaydate_check,
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
$owner->displaydate_check(0);
my $owner_id     = $owner->id;
my $owner_before = user_state($owner_id);
my $userpic =
    LJ::Userpic->create( $owner, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
ok( $userpic, 'disposable anonymous owner userpic is created' )
    or BAIL_OUT('cannot exercise anonymous legacy-schema userpic payload');
$userpic->set_keywords('anonymous-adapter-pic');

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
like(
    $retained_html,
    qr/var restoredSubject\s*=\s*"";/,
    'anonymous retained form initializes an absent draft subject as an empty JavaScript string'
);
unlike(
    $retained_html,
qr/var restored(?:Subject|Userpic|Taglist|MoodID|Mood|Location|Music|AdultReason|CommentSet|CommentScr|AdultCnt)\s*=\s*;/,
    'anonymous retained form emits no malformed absent draft-property JavaScript assignments'
);

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
my @continuation_sequence;
my $postevent_request_ref;
my @update_field_refs;
my @update_field_values;
my $auth_calls = 0;
my $login_override;
my $postevent_override;
my $scheduler_calls = 0;
my $run_hooks       = \&LJ::Hooks::run_hooks;
my $run_hook        = \&LJ::Hooks::run_hook;
my $legacy_do       = \&LJ::do_request;
my $protocol_do     = \&LJ::Protocol::do_request;

no warnings 'redefine';
local *LJ::Hooks::run_hooks = sub {
    my ( $name, @args ) = @_;
    if ( $name eq 'decode_entry_form' ) {
        push @order,                 'decode';
        push @continuation_sequence, 'decode';
        ( $decode_post_ref, $decode_request_ref ) = map { refaddr($_) } @args;
        $decode_post     = { %{ $args[0] } };
        $decoded_request = { %{ $args[1] } };
    }
    elsif ( $name eq 'spam_check' ) {
        push @order,                 'spam';
        push @continuation_sequence, 'spam';
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
    if ( $name eq 'update_fields' ) {
        push @continuation_sequence, 'update_fields';
        push @update_field_refs,     refaddr( $args[0] );
        push @update_field_values, { %{ $args[0] } };
    }
    elsif ( $name eq 'after_entry_post_extra_html' ) {
        push @order, 'success';
        my %args = @args;
        $success_request_ref = refaddr( $args{request} ) if $args{request};
    }
    return $run_hook->(@_);
};
local *LJ::do_request = sub {
    my ( $request, $response, $flags ) = @_;
    if ( ( $request->{mode} || '' ) eq 'login' ) {
        push @order,                 'login';
        push @continuation_sequence, 'login';
        push @login_requests, { %$request, flags => {%$flags} };
        if ($login_override) {
            %$response = %$login_override;
            return 1;
        }
    }
    if ( ( $request->{mode} || '' ) eq 'postevent' ) {
        push @order,                 'postevent';
        push @continuation_sequence, 'postevent';
        $postevent_request_ref = refaddr($request);
        if ($postevent_override) {
            %$response = %$postevent_override;
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
my $auth_okay = \&LJ::auth_okay;
local *LJ::auth_okay = sub {
    ++$auth_calls;
    push @continuation_sequence, 'auth';
    return $auth_okay->(@_);
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
        event_format          => 'preformatted',
        switched_rte_on       => '',
        date_ymd_yyyy         => '2020',
        date_ymd_mm           => '02',
        date_ymd_dd           => '03',
        hour                  => '04',
        min                   => '05',
        date_diff             => 1,
        prop_opt_backdated    => 1,
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
    is( $entry->prop('opt_preformatted'),
        1, 'actual retained preformatted control persists legacy formatting semantics' );
    is( $entry->prop('used_rte') || 0, 0,
        'preformatted retained post does not set the RTE marker' );
    is( $entry->prop('opt_backdated'),
        1, 'actual retained backdate control persists the backdated property' );
    is(
        $entry->eventtime_mysql,
        '2020-02-03 04:05:00',
        'actual retained date controls persist the submitted timestamp'
    );
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
    ok(
        defined $decoded_request->{password} && length $decoded_request->{password},
        'decoded request retains a nonempty password seed without exposing it in diagnostics'
    );
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
        {
            map { $_ => $after_on->{$_} }
                qw(draft draft_properties entry_editor entry_editor2 displaydate)
        },
        {
            map { $_ => $owner_before->{$_} }
                qw(draft draft_properties entry_editor entry_editor2 displaydate)
        },
        'anonymous success leaves remote-only draft and editor sentinels unchanged'
    );
    ok( !$retained->find_input('prop_picture_keyword'),
        'anonymous retained form has no session-only userpic picker' );

    # The retained anonymous form cannot render a picker without a session
    # remote. Preserve its accepted legacy-schema property separately rather
    # than presenting it as a rendered-control claim.
    my $schema_userpic = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Anonymous schema userpic subject',
        event    => 'Anonymous schema userpic body',
        security => 'private',
    );
    $schema_userpic->content(
        $schema_userpic->content . '&prop_picture_keyword=anonymous-adapter-pic' );
    $schema_userpic->header( 'Content-Length' => length $schema_userpic->content );
    my $schema_userpic_res = $request->($schema_userpic);
    is( $schema_userpic_res->code, 200,
        'accepted legacy-schema userpic payload renders native success' );
    LJ::Entry::reset_singletons();
    my $schema_userpic_entry = LJ::Entry->new( $owner, jitemid => 2 );
    is( $schema_userpic_entry->userpic_kw,
        'anonymous-adapter-pic',
        'force-fresh entry persists the owned legacy-schema userpic keyword' );

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

    my $before_login_failure        = entry_count($owner);
    my $login_failure_state         = user_state($owner_id);
    my $before_login_failure_xposts = $scheduler_calls;
    my $login_failure               = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Protocol login failure subject',
        event    => 'must not persist',
        security => 'private',
    );
    $login_override        = { success => 'FAIL', errmsg => 'Anonymous <login> error marker' };
    @order                 = ();
    @continuation_sequence = ();
    @update_field_refs     = ();
    @update_field_values   = ();
    $postevent_request_ref = undef;
    $auth_calls            = 0;
    my $login_failure_res = $request->($login_failure);
    $login_override = undef;
    like(
        $login_failure_res->content,
        qr/Error logging on:\s+Anonymous &lt;login&gt; error marker/,
        'protocol login failure renders the localized prefix plus escaped protocol error text'
    );
    is_deeply( \@order, [qw(login decode postevent save spam)],
'protocol login failure performs one flat decode/postevent/spam attempt without success hooks'
    );
    is(
        entry_count($owner),
        $before_login_failure + 1,
'protocol login failure may persist its retained postevent attempt without native success processing'
    );
    like(
        $login_failure_res->content,
        qr/Anonymous &lt;login&gt; error marker/,
        'protocol login failure keeps the escaped protocol error text visible'
    );
    unlike(
        $login_failure_res->content,
        qr/Anonymous <login> error marker/,
        'protocol login failure does not render protocol HTML as markup'
    );
    is( scalar @update_field_refs,
        1, 'protocol login failure invokes update_fields exactly once before authentication' );
    is( $auth_calls, 1,
        'successful first authentication is not repeated after the login protocol error' );
    is_deeply( user_state($owner_id), $login_failure_state,
        'protocol login failure skips native success housekeeping state writes' );
    is( $scheduler_calls, $before_login_failure_xposts,
        'protocol login failure schedules no crossposts' );
    is_deeply( \@continuation_sequence, [qw(update_fields auth login decode postevent spam)],
        'forced login error keeps the retained claimed-error sequence without a second auth check'
    );
    LJ::Entry::reset_singletons();
    my $login_failure_entry = LJ::Entry->new( $owner, jitemid => $before_login_failure + 1 );
    is(
        $login_failure_entry->subject_raw,
        'Protocol login failure subject',
        'forced login error preserves its flat postevent subject exactly once'
    );
    is(
        $login_failure_entry->event_raw,
        'must not persist',
        'forced login error preserves its flat postevent body exactly once'
    );
    is( $login_failure_entry->security,
        'private', 'forced login error preserves its flat postevent security exactly once' );
    is( $decode_request_ref, $postevent_request_ref,
        'forced login error sends the decoder flat request to protocol postevent' );
    is( $postevent_request_ref, $spam_request_ref,
        'forced login error sends the same flat request to spam checking' );

    my $before_postevent_error = entry_count($owner);
    my $postevent_error_state  = user_state($owner_id);
    my $postevent_error        = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Suppressed postevent error subject',
        event    => 'must not persist on protocol error',
        security => 'private',
    );
    $login_override     = { success => 'FAIL', errmsg => 'Earlier login failure' };
    $postevent_override = { success => 'FAIL', errmsg => 'Later postevent failure' };
    @order              = ();
    @continuation_sequence = ();
    $auth_calls            = 0;
    my $postevent_error_res = $request->($postevent_error);
    $login_override     = undef;
    $postevent_override = undef;
    like(
        $postevent_error_res->content,
        qr/Error logging on:\s+Earlier login failure/,
        'the earlier protocol login error remains visible when postevent also fails'
    );
    unlike(
        $postevent_error_res->content,
        qr/Later postevent failure/,
        'a later postevent error does not replace the retained login error'
    );
    is( entry_count($owner), $before_postevent_error,
        'forced postevent error after login error creates no entry' );
    is_deeply( user_state($owner_id), $postevent_error_state,
        'forced postevent error after login error writes no success housekeeping state' );
    is_deeply(
        \@continuation_sequence,
        [qw(update_fields auth login decode postevent spam)],
        'login and postevent errors still take one claimed flat attempt and spam check'
    );

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

    # A retained invalid attempt omits native update_displaydate. Seed it on
    # first so an accidental native persistence write of off cannot pass.
    $owner->displaydate_check(1);
    my $before_invalid = entry_count($owner);
    my $invalid_state  = user_state($owner_id);
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
    is_deeply( user_state($owner_id), $invalid_state,
        'callable invalid attempt preserves draft, editor, and displaydate sentinels' );
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
        @order                 = ();
        @continuation_sequence = ();
        my $res = $request->($post);
        like( $res->content, qr/DECLINED/, "$label declines before native handling" );
        is_deeply( \@order, [], "$label performs no login/decode/save/hook work" );
        is_deeply( \@continuation_sequence, [],
            "$label performs no update_fields or authentication work" );
    }
    is( entry_count($owner), $decline_before,
        'all declined requests leave owner entries unchanged' );
    is_deeply( user_state($owner_id), $decline_state,
        'declined requests leave anonymous draft/editor and formatting state unchanged' );

    my $invalid_get_target = post_from_retained(
        user     => $owner->user,
        password => 'anonymous-adapter-password',
        subject  => 'Invalid initial GET target',
        event    => 'must not persist',
        security => 'private',
    );
    $invalid_get_target->uri->query_form( usejournal => 'not-the-owner' );
    @order                 = ();
    @continuation_sequence = ();
    my $invalid_get_target_res = $request->($invalid_get_target);
    like( $invalid_get_target_res->content,
        qr/DECLINED/, 'initial GET usejournal target declines before anonymous auth' );
    is_deeply( \@order, [], 'initial GET target performs no login/decode/save/hook work' );
    is_deeply( \@continuation_sequence, [],
        'initial GET target performs no update_fields or authentication work' );

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
    @order                 = ();
    @continuation_sequence = ();
    my $missing_res = $request->($missing);
    like( $missing_res->content, qr/DECLINED/, 'missing password declines before native handling' );
    is_deeply( \@order, [], 'missing password performs no login/decode/save/hook work' );
    is_deeply( \@continuation_sequence, [],
        'missing password performs no update_fields or authentication work' );

    {
        my $session_post = post_from_retained(
            user     => $owner->user,
            password => 'anonymous-adapter-password',
            subject  => 'Session remote request',
            event    => 'must not persist',
            security => 'private',
        );
        local *LJ::get_remote = sub { return $owner; };
        @order                 = ();
        @continuation_sequence = ();
        my $session_res = $request->($session_post);
        like( $session_res->content, qr/DECLINED/,
            'session remote request declines to retained BML' );
        is_deeply( \@order, [], 'session remote request performs no adapter work' );
        is_deeply( \@continuation_sequence, [],
            'session remote request performs no update_fields or authentication work' );
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
        @order                 = ();
        @continuation_sequence = ();
        my $readonly_res = $request->($readonly_post);
        like( $readonly_res->content, qr/DECLINED/, 'readonly owner declines before decoder' );
        is_deeply( \@order, [], 'readonly owner performs no login/decode/save/hook work' );
        is_deeply( \@continuation_sequence, [],
            'readonly owner performs no update_fields or authentication work' );
    }

    my $wrong = post_from_retained(
        user     => $other->user,
        password => 'wrong-password',
        subject  => 'Wrong user request',
        event    => 'must not persist',
        security => 'private',
    );
    $wrong->uri->query('legacy_hint=one&legacy_hint=two');
    @order                 = ();
    @continuation_sequence = ();
    @update_field_refs     = ();
    @update_field_values   = ();
    $postevent_request_ref = undef;
    $auth_calls            = 0;
    my $wrong_res = $request->($wrong);
    like(
        $wrong_res->content,
        qr/Error logging on:\s+Invalid password/,
        'wrong password renders the localized prefix plus retained protocol error'
    );
    is_deeply(
        \@order,
        [qw(login decode postevent save spam)],
        'wrong password performs one login, decode, flat postevent attempt, and spam hook'
    );
    unlike( $wrong_res->content, qr/wrong-password/,
        'wrong password retry does not retain the submitted credential' );
    is( scalar @update_field_refs,
        1, 'wrong password invokes update_fields once before the password attempts' );
    is( $update_field_values[0]{legacy_hint},
        "one\0two", 'update_fields receives the original NUL-joined flat legacy GET values' );
    is( $auth_calls, 3, 'wrong password follows the retained three-authentication sequence' );
    is_deeply(
        \@continuation_sequence,
        [qw(update_fields auth login auth decode postevent auth spam)],
        'wrong password follows the complete retained cross-stage sequence'
    );
    is( $decode_request_ref, $postevent_request_ref,
        "wrong password sends the decoder's exact flat request to protocol postevent" );
    is( $postevent_request_ref, $spam_request_ref,
        'wrong password sends the same flat protocol request to spam checking' );
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

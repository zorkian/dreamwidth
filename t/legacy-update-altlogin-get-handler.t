#!/usr/bin/perl
# Test callable-only native rendering for retained authenticated /update altlogin GETs.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze thaw);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use LJ::Hooks;
use LJ::Test qw(temp_comm temp_user);
use Plack::Middleware::DW::RequestWrapper;

{

    package AltloginCrosspostFixture::Account;
    sub new { bless {}, shift }
    sub acctid         { 991 }
    sub xpostbydefault { 0 }
    sub displayname    { 'Configured crosspost fixture' }
    sub password       { 1 }
}

sub form {
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $_[0], 'http://localhost/entry/new' )
    )[0];
}

sub state {
    my ($u) = @_;
    my $fresh = LJ::load_userid( $u->id, 1 );
    my ($entries) =
        $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $fresh->id );
    return {
        entries => $entries,
        draft   => $fresh->draft_text,
        props   => $fresh->prop('draft_properties') ? thaw( $fresh->prop('draft_properties') ) : {},
        editor  => $fresh->prop('entry_editor') || '',
        editor2 => $fresh->entry_editor2,
        format  => $fresh->prop('disable_auto_formatting') || 0,
    };
}

my $a = temp_user();
$a->update_self( { status => 'A' } );
$a->set_prop( entry_editor => 'always_rich' );
$a->entry_editor2('markdown0');
$a->set_draft_text('altlogin native A draft');
$a->set_prop( draft_properties => nfreeze( { subject => 'altlogin native A draft subject' } ) );

my $b = temp_user();
$b->update_self( { status => 'A' } );
$b->set_prop( entry_editor => 'always_plain' );
$b->entry_editor2('html_raw0');
$b->set_prop( disable_auto_formatting => 0 );
$b->set_draft_text('altlogin native B draft');
$b->set_prop( draft_properties => nfreeze( { subject => 'altlogin native B draft subject' } ) );

my $comm = temp_comm();
$a->join_community( $comm, 1, 1 );
$b->join_community( $comm, 1, 1 );

my ( $hooks, @hook_refs, @repeats, @cases, $auth_calls, $account_calls );
my @configured_accounts = ( AltloginCrosspostFixture::Account->new );
my $orig_enabled        = \&LJ::is_enabled;
my $orig_identity       = \&LJ::User::identity;
my $orig_can_post       = \&LJ::User::can_post;
my $orig_readonly       = \&LJ::User::readonly;
my $orig_auth           = \&LJ::auth_okay;

my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r      = DW::Request->get;
        my $remote = ( $r->get_args->{which} || '' ) eq 'b' ? $b : $a;
        my $ret =
            $r->get_args->{ordinary}
            ? DW::Controller::Entry::legacy_update_get_render(
            remote     => $remote,
            get        => $r->get_args,
            usejournal => $remote->user,
            action_url => '/entry/new',
            )
            : DW::Controller::Entry::legacy_update_altlogin_get_handler( remote => $remote, );
        if ( defined $ret ) {
            $r->status(200);
            return $r->res;
        }
        $r->status(299);
        $r->print('retained BML fallback');
        return $r->res;
    }
);

LJ::Hooks::are_hooks('update_fields');
{
    no warnings 'redefine';
    local *LJ::is_enabled = sub {
        return 1 if $_[0] eq 'rte_support';
        return $orig_enabled->(@_);
    };
    local *LJ::User::identity = sub {
        return 1 if DW::Request->get->get_args->{identity};
        return $orig_identity->(@_);
    };
    local *LJ::User::can_post = sub {
        return 0 if DW::Request->get->get_args->{cantpost};
        return $orig_can_post->(@_);
    };
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get->get_args->{readonly};
        return $orig_readonly->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta = sub { return DW::Request->get->get_args->{beta}; };
    local *LJ::auth_okay                  = sub { ++$auth_calls; return $orig_auth->(@_); };
    local *DW::External::Account::get_external_accounts = sub {
        ++$account_calls;
        return @configured_accounts;
    };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hooks;
            push @hook_refs, $get;
            push @repeats,   $get->{repeated};
            push @cases,     $get->{case};
            $get->{user}       = 'hook <user> & "quote"';
            $get->{usejournal} = $comm->user;
            return {} unless $get->{case} eq 'override';
            return {
                subject               => 'hook subject',
                event                 => 'hook event',
                tags                  => 'hook tag',
                prop_opt_preformatted => 1,
            };
        }
    ];

    test_psgi $app, sub {
        my $send     = shift;
        my $request  = sub { $send->( GET shift ) };
        my $before_a = state($a);
        my $a_res    = $request->(
'/__test_altlogin?altlogin=1&case=snapshot&user=initial-user&password=marker%3Csecret%3E'
                . '&usejournal='
                . $a->user
                . '&subject=pre-subject&event=pre-event&prop_taglist=pre-tag'
                . '&repeated=one&repeated=two' );
        is( $a_res->code, 200, 'callable altlogin GET renders native response' );
        my $a_form = form( $a_res->content );
        ok( $a_form, 'callable altlogin renders shared native form' )
            or BAIL_OUT('native form missing');
        like(
            $a_res->content,
            qr/<title>Post an Entry<\/title>/i,
            'callable altlogin uses the retained update title'
        );
        ok( $a_form->find_input('user'), 'explicit legacy-auth presentation emits user control' );
        ok( $a_form->find_input('password'),
            'explicit legacy-auth presentation emits password control' );
        is( $a_form->value('user'), 'hook <user> & "quote"', 'post-hook username is rendered' );
        is( $a_form->value('password') // '', '', 'legacy-auth password is always blank' );
        like(
            $a_res->content,
            qr/hook\s+&lt;user&gt;\s+&amp;\s+&quot;quote&quot;/,
            'legacy-auth username is escaped in actual TT output'
        );
        unlike(
            $a_res->content,
            qr/marker(?:&lt;|<)secret(?:&gt;|>)/,
            'password-like GET text is not reflected'
        );
        unlike( $a_res->content, qr/id=["']post_as_remote["']/,
            'legacy-auth presentation hides the visible remote identity choice' );
        unlike( $a_res->content, qr/id=["']post_username["']/,
            'legacy-auth presentation does not render the normal native login control' );
        is( $a_form->value('subject'),    'pre-subject', 'snapshot keeps pre-hook subject' );
        is( $a_form->value('event'),      'pre-event',   'snapshot keeps pre-hook body' );
        is( $a_form->value('taglist'),    'pre-tag',     'snapshot keeps pre-hook tags' );
        is( $a_form->value('usejournal'), $comm->user,   'post-hook target is rendered' );
        is( $a_form->value('editor'),     'rte0',        'remote rich editor remains selected' );
        is(
            $a_form->action,
            'http://localhost/update?altlogin=1',
            'altlogin form action is normalized without raw credential-like query values'
        );
        my @updates = grep { ( $_->name || '' ) eq 'action:update' } $a_form->inputs;
        is( scalar @updates, 2, 'both visible entry submit buttons use the retained action name' );
        ok( $a_form->find_input('lj_form_auth'), 'legacy-auth form retains native CSRF control' );
        like( $a_res->content, qr/id=["']js-remote["']/,
            'legacy-auth presentation retains the authenticated remote marker' );
        unlike(
            $a_res->content,
            qr/id=["']js-post-entry-login["']/,
            'legacy-auth presentation does not render the ordinary one-time login modal'
        );
        unlike( $a_res->content, qr/name=["']username["']/,
            'legacy-auth presentation does not emit native username controls' );
        is( $hooks,              1, 'altlogin calls update_fields exactly once' );
        is( $account_calls || 0, 0, 'altlogin does not enumerate configured crosspost accounts' );
        unlike( $a_res->content, qr/crosspost-component/,
            'altlogin does not render the crosspost panel wrapper' );
        unlike(
            $a_res->content,
            qr/data-collapse=["']crosspost["']/,
            'altlogin does not retain an empty crosspost collapse component'
        );
        unlike(
            $a_res->content,
            qr/manage\/settings\/\?cat=othersites/,
            'altlogin does not render the crosspost setup link'
        );
        unlike(
            $a_res->content,
            qr/id=["']js-crosspost-entry["']/,
            'altlogin does not render configured crosspost controls'
        );
        is( $repeats[0], "one\0two", 'hook receives NUL-joined flat repeated GET values' );
        is_deeply( state($a), $before_a, 'altlogin render leaves A state unchanged' );

        my $before_b = state($b);
        my $b_res    = $request->(
                  '/__test_altlogin?altlogin=1&which=b&case=override&user=B-user&usejournal='
                . $b->user
                . '&subject=B-subject&event=B-event&prop_taglist=B-tag&repeated=three&repeated=four'
        );
        my $b_form = form( $b_res->content );
        ok( $b_form, 'second altlogin request renders shared native form' );
        is( $b_form->value('subject'),
            'hook subject', 'exists-based hook subject override is retained' );
        is( $b_form->value('event'), 'hook event', 'exists-based hook body override is retained' );
        is( $b_form->value('taglist'), 'hook tag', 'exists-based hook tag override is retained' );
        is( $b_form->value('editor'), 'html_raw0',
            'hook preformat applies to plain remote editor' );
        is( $repeats[1], "three\0four", 'second request receives its own NUL-joined values' );
        isnt(
            refaddr( $hook_refs[0] ),
            refaddr( $hook_refs[1] ),
            'sequential requests use distinct flat hashes'
        );
        is_deeply( state($b), $before_b, 'altlogin render leaves B state unchanged' );

        my $ordinary_res  = $request->('/__test_altlogin?ordinary=1&subject=ordinary');
        my $ordinary_form = form( $ordinary_res->content );
        ok( $ordinary_form, 'ordinary shared rendering parses its native form' );
        ok( $account_calls, 'ordinary shared rendering enumerates configured crosspost accounts' );
        like( $ordinary_res->content, qr/crosspost-component/,
            'ordinary shared rendering keeps the crosspost panel wrapper' );
        ok( $ordinary_form->find_input('crosspost_entry'),
            'ordinary shared rendering keeps configured crosspost controls' );
        like(
            $ordinary_res->content,
            qr/Configured crosspost fixture/,
            'ordinary shared rendering keeps configured account content'
        );

        for my $path (
            '/__test_altlogin',
            '/__test_altlogin?altlogin=1&share=example',
            '/__test_altlogin?altlogin=1&readonly=1',
            '/__test_altlogin?altlogin=1&identity=1',
            '/__test_altlogin?altlogin=1&cantpost=1',
            '/__test_altlogin?altlogin=1&beta=1',
            '/__test_altlogin?altlogin=1&usejournal=no-such-user',
            )
        {
            my $before = $hooks;
            my $res    = $request->($path);
            is( $res->code, 299,     "$path declines to retained BML before initialization" );
            is( $hooks,     $before, "$path does not invoke update_fields" );
        }
        my $head = $send->( HTTP::Request->new( 'HEAD', '/__test_altlogin?altlogin=1' ) );
        is( $head->code, 299, 'non-GET altlogin context declines before initialization' );
    };
}

is( $auth_calls || 0, 0, 'callable altlogin rendering never invokes authentication' );
done_testing;

#!/usr/bin/perl
# Verify the callable retained /update GET wrapper without registering a route.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Controller::Entry;
use DW::External::Page;
use DW::Request;
use DW::Request::Plack;
use LJ::Hooks;
use LJ::Test qw(temp_user);
use Plack::Middleware::DW::RequestWrapper;

{

    package UpdateGetFixture::Account;
    sub new { my $class = shift; bless {@_}, $class }
    sub acctid         { $_[0]{id} }
    sub displayname    { $_[0]{name} }
    sub password       { $_[0]{password} }
    sub xpostbydefault { $_[0]{default} }
}

sub entry_form {
    my ($content) = @_;
    return (
        grep {
                   ( $_->attr('id') || '' ) eq 'js-post-entry'
                && $_->find_input('subject')
                && $_->find_input('event')
        } HTML::Form->parse( $content, 'http://localhost/entry/new' )
    )[0];
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_prop( 'entry_editor', 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_prop( 'entry_draft', '"saved draft body"' );
$owner->set_prop(
    'draft_properties',
    nfreeze(
        {
            subject => 'saved draft subject',
            taglist => 'saved draft tags',
            editor  => 'markdown0',
        }
    )
);
my $owner_id = $owner->id;

my $second = temp_user();
$second->update_self( { status => 'A' } );
$second->set_prop( 'entry_editor', 'always_plain' );
$second->entry_editor2('markdown0');
$second->set_prop( 'entry_draft',      '"second draft body"' );
$second->set_prop( 'draft_properties', nfreeze( { subject => 'second draft subject' } ) );
my $second_id = $second->id;

my $target = temp_user();
$target->update_self( { status => 'A' } );

my ( $hook_calls, @hook_refs, @hook_shapes, @hook_repeated, $share_fetches, $beta_location, );
LJ::Hooks::are_hooks('update_fields');
my $original_is_enabled = \&LJ::is_enabled;
my $original_readonly   = \&LJ::User::readonly;

my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r      = DW::Request->get;
        my $result = DW::Controller::Entry::legacy_update_get_handler();
        return $result if ref $result;
        if ( defined $result ) {
            $r->status(200) unless defined $r->status && $r->status == 302;
            return $r->res;
        }

        $r->status(299);
        $r->print('retained BML fallback marker');
        return $r->res;
    }
);

{
    no warnings 'redefine';
    local *LJ::get_remote = sub {
        return undef if DW::Request->get->get_args->{anonymous};
        return ( DW::Request->get->get_args->{which} || '' ) eq 'second' ? $second : $owner;
    };
    local *LJ::is_enabled = sub {
        return 1 if $_[0] eq 'rte_support';
        return $original_is_enabled->(@_);
    };
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get->get_args->{readonly};
        return $original_readonly->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta = sub {
        return DW::Request->get->get_args->{beta} ? 1 : 0;
    };
    local *DW::External::Page::new = sub {
        ++$share_fetches;
        die 'share fetch must fall through';
    };
    my @accounts = (
        UpdateGetFixture::Account->new( id => 41, name => 'Default account', default => 1 ),
        UpdateGetFixture::Account->new( id => 42, name => 'Other account',   default => 0 ),
    );
    local *DW::External::Account::get_external_accounts = sub { return @accounts; };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs,     refaddr($get);
            push @hook_shapes,   ref($get);
            push @hook_repeated, $get->{repeated};
            if ( $get->{mutation} ) {
                $get->{subject}      = 'mutated after prefill';
                $get->{event}        = 'mutated after prefill';
                $get->{prop_taglist} = 'mutated after prefill';
                $get->{usejournal}   = $target->user;
                return {};
            }
            return {
                subject => ( $get->{which} || '' ) eq 'second' ? 'second hook subject'
                : 'hook <subject> & "quote"',
                event => ( $get->{which} || '' ) eq 'second' ? 'second hook event'
                : 'hook <event> & "quote"',
                tags => ( $get->{which} || '' ) eq 'second' ? 'second hook tags'
                : 'hook <tags> & "quote"',
                prop_opt_preformatted => 0,
            };
        }
    ];

    test_psgi $app, sub {
        my $request = shift;
        my $path =
              '/__test_update_get?subject=original&event=original&prop_taglist=original'
            . '&encoded=one%2Ftwo&repeated=first&repeated=second&authas=ignored'
            . '&prop_xpost_41=0&prop_xpost_42=1';
        my $res = $request->( GET $path );
        is( $res->code, 200, 'ordinary authenticated callable GET renders native form' );
        my $form = entry_form( $res->content );
        ok( $form, 'actual native form parses' ) or BAIL_OUT('native form missing');
        is(
            $form->value('subject'),
            'hook <subject> & "quote"',
            'hook subject is escaped and parsed'
        );
        is( $form->value('event'), 'hook <event> & "quote"', 'hook event is escaped and parsed' );
        is( $form->value('taglist'), 'hook <tags> & "quote"', 'hook tags are escaped and parsed' );
        is( $form->value('editor'), 'rte0', 'legacy rich preference maps through supported RTE' );
        like( $form->value('entrytime_date'),
            qr/^\d{4}-\d{2}-\d{2}$/, 'timezone-aware date renders' );
        like( $form->value('entrytime_time'), qr/^\d{2}:\d{2}$/, 'timezone-aware time renders' );
        is( $form->value('usejournal'),
            $owner->user, 'owner usejournal collapses to session owner' );
        is(
            $form->action,
            'http://localhost/entry/new?subject=original&event=original&prop_taglist=original'
                . '&encoded=one%2Ftwo&repeated=first&repeated=second&authas=ignored'
                . '&prop_xpost_41=0&prop_xpost_42=1',
            'native action preserves raw encoded and repeated GET query'
        );
        like( $res->content, qr/saved draft subject/, 'saved draft restore data is emitted' );
        like(
            $res->content,
            qr/<input(?=[^>]*\bname="crosspost")(?=[^>]*\bvalue="41")(?=[^>]*\bchecked)[^>]*>/,
            'default crosspost account is checked despite contradictory GET'
        );
        unlike(
            $res->content,
            qr/<input(?=[^>]*\bname="crosspost")(?=[^>]*\bvalue="42")(?=[^>]*\bchecked)[^>]*>/,
            'nondefault crosspost account remains unchecked despite contradictory GET'
        );
        my $mutation = $request->(
            GET '/__test_update_get?mutation=1&subject=before&event=before&prop_taglist=before' );
        is( $mutation->code, 200, 'hook mutation GET still renders native form' );
        my $mutation_form = entry_form( $mutation->content );
        ok( $mutation_form, 'hook mutation native form parses' );
        is( $mutation_form->value('subject'),
            'before', 'prefill subject snapshot precedes hook mutation' );
        is( $mutation_form->value('event'),
            'before', 'prefill event snapshot precedes hook mutation' );
        is( $mutation_form->value('taglist'),
            'before', 'prefill tags snapshot precedes hook mutation' );
        is( $mutation_form->value('usejournal'),
            $target->user, 'target resolution follows hook mutation' );

        my $second_res = $request->( GET '/__test_update_get?which=second' );
        is( $second_res->code, 200, 'second authenticated GET renders independently' );
        my $second_form = entry_form( $second_res->content );
        ok( $second_form, 'second native form parses' );
        is(
            $second_form->value('subject'),
            'second hook subject',
            'second hook result does not leak'
        );
        is( $second_form->value('editor'),
            'html_casual1', 'second plain preference maps independently' );
        like(
            $second_res->content,
            qr/second draft subject/,
            'second draft restore data is independent'
        );
        my $head = $request->( HTTP::Request->new( 'HEAD', '/__test_update_get' ) );
        is( $head->code, 299, 'HEAD falls through to retained BML' );
        my $put = $request->( HTTP::Request->new( 'PUT', '/__test_update_get' ) );
        is( $put->code, 299, 'PUT falls through to retained BML' );

        my $anonymous = $request->( GET '/__test_update_get?anonymous=1' );
        is( $anonymous->code, 299, 'anonymous GET falls through to retained BML' );
        my $readonly = $request->( GET '/__test_update_get?readonly=1' );
        is( $readonly->code, 299, 'readonly GET falls through to retained BML' );
        my $altlogin = $request->( GET '/__test_update_get?altlogin=1' );
        is( $altlogin->code, 299, 'altlogin falls through to retained BML' );
        my $share = $request->( GET '/__test_update_get?share=https%3A%2F%2Fexample.invalid%2F' );
        is( $share->code, 299, 'share falls through to retained BML' );
        my $invalid = $request->( GET '/__test_update_get?usejournal=not-a-real-user' );
        is( $invalid->code, 299, 'invalid usejournal falls through before hook' );
        my $beta = $request->( GET '/__test_update_get?beta=1&encoded=one%2Ftwo' );
        is( $beta->code, 302, 'beta GET keeps retained redirect status' );
        $beta_location = $beta->header('Location');
    };
}

is( $hook_calls, 3, 'each ordinary GET invokes update_fields exactly once' );
is_deeply( \@hook_shapes, [ ('HASH') x 3 ], 'update_fields receives flat legacy hashes' );
is( $hook_repeated[0], "first\0second", 'update_fields receives NUL-joined repeated values' );
ok(
    $hook_refs[0] && $hook_refs[1] && $hook_refs[2],
    'hooks receive stable original flat references'
);
is( $share_fetches || 0, 0, 'excluded share GET performs no external fetch' );
is(
    $beta_location,
    'http://localhost/entry/new?beta=1&encoded=one/two',
    'beta redirect keeps retained query behavior'
);

my $fresh = LJ::load_userid( $owner_id, 1 );
is( $fresh->prop('entry_editor'), 'always_rich',        'GET preserves legacy editor preference' );
is( $fresh->entry_editor2,        'markdown0',          'GET preserves native editor preference' );
is( $fresh->prop('entry_draft'),  '"saved draft body"', 'GET preserves entry draft body' );
is_deeply(
    Storable::thaw( $fresh->prop('draft_properties') ),
    {
        subject => 'saved draft subject',
        taglist => 'saved draft tags',
        editor  => 'markdown0',
    },
    'GET preserves frozen draft properties'
);
my $fresh_second = LJ::load_userid( $second_id, 1 );
is( $fresh_second->prop('entry_editor'),
    'always_plain', 'sequential GET preserves second editor preference' );
is(
    $fresh_second->prop('entry_draft'),
    '"second draft body"',
    'sequential GET preserves second draft body'
);
is_deeply(
    Storable::thaw( $fresh_second->prop('draft_properties') ),
    { subject => 'second draft subject' },
    'sequential GET preserves second frozen draft properties'
);

done_testing;

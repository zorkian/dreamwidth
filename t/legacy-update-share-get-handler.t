#!/usr/bin/perl
# Verify callable retained authenticated share GET rendering without route activation.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTML::Form;
use HTTP::Request::Common;
use Plack::Test;
use Scalar::Util qw(refaddr);
use Storable qw(nfreeze thaw);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::External::Page;
use DW::Request;
use DW::Request::Plack;
use LJ::Entry;
use LJ::Test qw(temp_user);
use Plack::Middleware::DW::RequestWrapper;

{

    package ShareGetFixture::Page;
    sub new { my ( $class, %args ) = @_; bless \%args, $class }
    sub title       { $_[0]{title} }
    sub url         { $_[0]{url} }
    sub description { $_[0]{description} }
}
{

    package ShareGetFixture::Account;
    sub new { my ( $class, %args ) = @_; bless \%args, $class }
    sub acctid         { $_[0]{id} }
    sub xpostbydefault { $_[0]{default} }
    sub displayname    { 'Share fixture account' }
    sub password       { '' }
}

sub form_from {
    return ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' && $_->find_input('subject') }
            HTML::Form->parse( $_[0], 'http://localhost/entry/new' ) )[0];
}

sub entry_count {
    my ($u) = @_;
    my $fresh = LJ::load_userid( $u->id, 1 );
    return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef,
        $fresh->id );
}

my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_prop( 'entry_editor', 'always_rich' );
$owner->entry_editor2('markdown0');
$owner->set_draft_text('share draft body');
$owner->set_prop( draft_properties =>
        nfreeze( { subject => 'share draft subject', taglist => 'share draft tags' } ) );
my $target = temp_user();
$target->update_self( { status => 'A' } );
my $owner_id = $owner->id;
my ( @factory_urls, $hook_calls, @hook_refs, @repeats, $accounts );
my $original_enabled  = \&LJ::is_enabled;
my $original_identity = \&LJ::User::identity;
my $original_can_post = \&LJ::User::can_post;
my $original_readonly = \&LJ::User::readonly;
my $app               = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r      = DW::Request->get;
        my $result = DW::Controller::Entry::legacy_update_share_get_handler();
        return $result if ref $result;
        if ( defined $result ) { $r->status(200) unless defined $r->status; return $r->res; }
        $r->status(299);
        $r->print('retained share fallback');
        return $r->res;
    }
);

{
    no warnings 'redefine';
    local *LJ::get_remote = sub { return $owner; };
    local *LJ::is_enabled =
        sub { return 1 if $_[0] eq 'rte_support'; return $original_enabled->(@_); };
    local *LJ::User::identity =
        sub { return 1 if DW::Request->get->get_args->{identity}; return $original_identity->(@_); };
    local *LJ::User::can_post =
        sub { return 0 if DW::Request->get->get_args->{cantpost}; return $original_can_post->(@_); };
    local *LJ::User::readonly =
        sub { return 1 if DW::Request->get->get_args->{readonly}; return $original_readonly->(@_); };
    local *LJ::BetaFeatures::user_in_beta = sub { return DW::Request->get->get_args->{beta}; };
    local *DW::External::Page::new        = sub {
        my ( $class, %args ) = @_;
        push @factory_urls, $args{url};
        return undef if $args{url} eq 'none';
        die 'stubbed share factory exception' if $args{url} eq 'explode';
        return ShareGetFixture::Page->new(
            title       => 'Shared <title> & marker',
            url         => 'https://example.invalid/share?x=1&y=2',
            description => 'Shared <description> & marker',
        );
    };
    local *DW::External::Account::get_external_accounts =
        sub { ++$accounts; return ShareGetFixture::Account->new( id => 9, default => 1 ); };
    local $LJ::HOOKS{update_fields} = [
        sub {
            my ($get) = @_;
            ++$hook_calls;
            push @hook_refs, refaddr($get);
            push @repeats,   $get->{repeated};
            if ( $get->{hook} ) {
                $get->{usejournal} = $target->user;
                return {
                    subject               => 'Hook <subject>',
                    event                 => 'Hook <event>',
                    tags                  => 'Hook <tags>',
                    prop_opt_preformatted => 1
                };
            }
            return {};
        }
    ];
    test_psgi $app, sub {
        my $request      = shift;
        my $before_count = entry_count($owner);
        my $before_draft = LJ::load_userid( $owner_id, 1 )->draft_text;
        my $before_props = thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') );
        my $path =
'/__test_share?share=https%3A%2F%2Fexample.invalid%2Fsource&prop_taglist=original-tag&encoded=a%2Fb&repeated=one&repeated=two';
        my $res = $request->( GET $path);
        diag( $res->content ) unless $res->code == 200;
        is( $res->code, 200, 'share callable renders native response' );
        my $form = form_from( $res->content );
        ok( $form, 'share native form parses' ) or BAIL_OUT('share form missing');
        like(
            $res->content,
            qr/<title>Post an Entry<\/title>/i,
            'share retains legacy update title'
        );
        like(
            $form->value('subject'),
            qr/Shared .*title/s,
            'share title reaches escaped form field'
        );
        like(
            $form->value('event'),
            qr{<a href="https://example\.invalid/share\?x=1&y=2">},
            'share event retains legacy link markup'
        );
        like( $form->value('event'), qr/Shared .*description/s, 'share description reaches event' );
        is( $form->value('taglist'), 'original-tag', 'share preserves ordinary tag prefill' );
        is( $form->value('editor'),  'rte0',         'share retains legacy rich editor default' );
        is(
            $form->action,
'http://localhost/entry/new?share=https%3A%2F%2Fexample.invalid%2Fsource&prop_taglist=original-tag&encoded=a%2Fb&repeated=one&repeated=two',
            'share native action retains raw encoded repeated query'
        );
        is_deeply(
            \@factory_urls,
            ['https://example.invalid/source'],
            'share factory receives raw URL exactly once'
        );
        is( $hook_calls,  1,          'share invokes update_fields once after factory' );
        is( $repeats[-1], "one\0two", 'share hook sees NUL-joined repeated values' );
        ok( $hook_refs[-1], 'share hook receives original flat reference' );
        ok( $accounts >= 1, 'share uses existing account enumeration without an external fetch' );
        is( entry_count($owner), $before_count, 'share GET creates no entry' );
        my $fresh = LJ::load_userid( $owner_id, 1 );
        is( $fresh->draft_text, $before_draft, 'share GET leaves draft body unchanged' );
        is_deeply( thaw( $fresh->prop('draft_properties') ),
            $before_props, 'share GET leaves draft properties unchanged' );

        my $hooked =
            $request->( GET
'/__test_share?share=https%3A%2F%2Fexample.invalid%2Fhook&hook=1&repeated=next&repeated=value'
            );
        my $hooked_form = form_from( $hooked->content );
        ok( $hooked_form, 'hooked share form parses' );
        is(
            $hooked_form->value('subject'),
            'Hook <subject>',
            'hook result overrides share subject'
        );
        is( $hooked_form->value('event'),   'Hook <event>', 'hook result overrides share event' );
        is( $hooked_form->value('taglist'), 'Hook <tags>',  'hook result overrides share tags' );
        is( $hooked_form->value('usejournal'),
            $target->user, 'post-hook target mutation selects target' );
        is( $hooked_form->value('editor'),
            'rte0', 'retained rich editor takes precedence over hook preformat' );

        my $none =
            $request->( GET
'/__test_share?share=none&subject=Original+subject&event=Original+event&prop_taglist=Original+tag'
            );
        my $none_form = form_from( $none->content );
        ok( $none_form, 'false factory share form parses' );
        is(
            $none_form->value('subject'),
            'Original subject',
            'false factory preserves GET subject'
        );
        is( $none_form->value('event'),   'Original event', 'false factory preserves GET event' );
        is( $none_form->value('taglist'), 'Original tag',   'false factory preserves GET tag' );

        my $error = $request->( GET '/__test_share?share=explode' );
        is( $error->code, 500, 'stubbed factory exception follows framework error response' );
        like(
            $error->content,
            qr/stubbed share factory exception/,
            'factory exception remains observable in error response'
        );
        for my $excluded (
            [ 'altlogin',       '/__test_share?share=none&altlogin=1' ],
            [ 'readonly',       '/__test_share?share=none&readonly=1' ],
            [ 'identity',       '/__test_share?share=none&identity=1' ],
            [ 'cannot post',    '/__test_share?share=none&cantpost=1' ],
            [ 'beta',           '/__test_share?share=none&beta=1' ],
            [ 'invalid target', '/__test_share?share=none&usejournal=does-not-exist' ],
            )
        {
            my ( $label, $path ) = @$excluded;
            my $before_factory = scalar @factory_urls;
            my $res            = $request->( GET $path);
            is( $res->code, 299, "$label share context declines callable renderer" );
            is( scalar @factory_urls,
                $before_factory, "$label share context does not construct page" );
        }

        my $next = $request->( GET '/__test_share?share=none&subject=Sequential' );
        is( form_from( $next->content )->value('subject'),
            'Sequential', 'sequential share state does not leak' );
    };
}
done_testing;

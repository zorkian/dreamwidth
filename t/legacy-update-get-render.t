#!/usr/bin/perl
# Test render-only retained update GET compatibility mapping.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Template;
use LJ::Test qw(temp_user);
my $u = temp_user();
$u->update_self( { status => 'A' } );
$u->set_prop( 'entry_editor', 'always_rich' );
$u->entry_editor2('markdown0');
$u->set_prop( 'entry_draft',      'draft sentinel' );
$u->set_prop( 'draft_properties', '' );
my @calls;
my $render = \&DW::Template::render_template;
no warnings 'redefine';
local *DW::Template::render_template =
    sub { my ( undef, $name, $vars ) = @_; push @calls, [ $name, $vars ]; return 'rendered'; };
my $get = {
    subject      => 'get subject',
    event        => 'get body',
    prop_taglist => 'get tags',
    encoded      => 'one/two'
};
my $hook = {
    subject               => 'hook subject',
    event                 => 'hook body',
    tags                  => 'hook tags',
    prop_opt_preformatted => 0
};
is(
    DW::Controller::Entry::legacy_update_get_render(
        remote        => $u,
        get           => $get,
        update_fields => $hook,
        legacy_editor => 'rich',
        rte_supported => 1,
        datetime      => '2026-09-23 04:05',
        usejournal    => undef
    ),
    'rendered',
    'callable GET renderer returns template result'
);
is( scalar @calls, 1, 'renders once' );
my $form = $calls[0][1]{formdata};
is_deeply(
    { map { $_ => $form->{$_} } qw(subject event taglist editor) },
    { subject => 'hook subject', event => 'hook body', taglist => 'hook tags', editor => 'rte0' },
    'hook overrides retained GET prefill and supported rich maps to rte0'
);
is( $u->prop('entry_editor'), 'always_rich',    'GET does not rewrite legacy editor' );
is( $u->entry_editor2,        'markdown0',      'GET does not rewrite native editor' );
is( $u->prop('entry_draft'),  'draft sentinel', 'GET does not clear draft' );
@calls = ();
DW::Controller::Entry::legacy_update_get_render(
    remote        => $u,
    get           => $get,
    legacy_editor => 'always_plain',
    rte_supported => 1,
    datetime      => '2026-09-23 04:05'
);
is( $calls[0][1]{formdata}{editor},
    'html_casual1', 'plain maps to casual regardless of entry_editor2' );
@calls = ();
DW::Controller::Entry::legacy_update_get_render(
    remote        => $u,
    get           => $get,
    legacy_editor => 'rich',
    rte_supported => 0,
    update_fields => { prop_opt_preformatted => 1 },
    datetime      => '2026-09-23 04:05'
);
is( $calls[0][1]{formdata}{editor},
    'html_raw0', 'unsupported rich with effective preformat maps to raw' );
is( $calls[0][1]{displaydate}{year}, '2026', 'caller datetime reaches native init' );
done_testing;

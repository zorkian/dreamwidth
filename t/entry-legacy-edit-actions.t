#!/usr/bin/perl
# Characterize retained editjournal action selection without dispatching actions.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use Test::More;
use Scalar::Util qw(refaddr);
use lib "$ENV{LJHOME}/cgi-bin";
use Hash::MultiValue;
use DW::Entry::Legacy;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

sub select_action {
    my ( $post, %opts ) = @_;
    return DW::Entry::Legacy::legacy_edit_action( $post, %opts );
}

subtest 'only retained direct edit actions are classified' => sub {
    is( select_action( { 'action:save'   => 1 } ), 'save',   'real save field is recognized' );
    is( select_action( { 'action:delete' => 1 } ), 'delete', 'real delete field is recognized' );
    is( select_action( { 'action:deletespam' => 1 } ),
        'deletespam', 'real spam-delete field is recognized' );
    is( select_action( { 'action:savemaintainer' => 1 }, maintainer_enabled => 1 ),
        'savemaintainer', 'real maintainer field is recognized' );
    is( select_action( { 'action:spellcheck' => 1 }, spellcheck_enabled => 1 ),
        'spellcheck', 'real configured spellcheck field is recognized' );
    is( select_action( { 'action:preview' => 1 } ),
        undef, 'direct editjournal preview field is nonmutating' );
    is( select_action( { 'action:unknown' => 1 } ), undef, 'unknown field is nonmutating' );
    is( select_action( {} ),                        undef, 'missing action is nonmutating' );
    is( select_action( { 'action:save' => '' } ),   undef, 'empty action field is nonmutating' );
};

subtest 'multiple real fields follow retained editjournal precedence' => sub {
    is(
        select_action(
            {
                'action:save'           => 1,
                'action:delete'         => 1,
                'action:deletespam'     => 1,
                'action:spellcheck'     => 1,
                'action:savemaintainer' => 1,
            },
            spellcheck_enabled => 1,
            maintainer_enabled => 1,
        ),
        'savemaintainer',
        'property-only maintainer action has first source priority'
    );
    is(
        select_action(
            { 'action:save' => 1, 'action:delete' => 1, 'action:spellcheck' => 1 },
            spellcheck_enabled => 1
        ),
        'spellcheck',
        'configured spellcheck suppresses generic mutation actions'
    );
    is(
        select_action(
            { 'action:save' => 1, 'action:delete' => 1, 'action:spellcheck' => 1 },
            spellcheck_enabled => 0
        ),
        'delete',
        'disabled spellcheck falls through to the retained generic delete action'
    );
    is( select_action( { 'action:save' => 1, 'action:delete' => 1, 'action:deletespam' => 1 } ),
        'deletespam', 'spam delete outranks delete and save in the generic branch' );
    is( select_action( { 'action:save' => 1, 'action:delete' => 1 } ),
        'delete', 'delete outranks save in the generic branch' );
};

subtest 'maintainer eligibility is supplied by the caller before source precedence' => sub {
    is(
        select_action(
            { 'action:savemaintainer' => 1, 'action:save' => 1 },
            maintainer_enabled => 0
        ),
        'save',
        'ineligible direct maintainer action falls through to save'
    );
    is(
        select_action(
            {
                'action:savemaintainer' => 1,
                'action:spellcheck'     => 1,
                'action:delete'         => 1,
            },
            spellcheck_enabled => 1,
            maintainer_enabled => 0,
        ),
        'spellcheck',
        'ineligible maintainer action falls through to configured spellcheck'
    );
    is( select_action( { 'action:savemaintainer' => 1 }, maintainer_enabled => 0 ),
        undef, 'ineligible maintainer action alone remains nonmutating' );
    is(
        select_action(
            { submit_value => 'action:savemaintainer', 'action:delete' => 1 },
            maintainer_enabled => 0
        ),
        'delete',
        'ineligible synthetic maintainer action falls through to delete'
    );
    is(
        select_action(
            { submit_value => 'action:savemaintainer', 'action:delete' => 1 },
            maintainer_enabled => 1
        ),
        'savemaintainer',
        'eligible synthetic maintainer action preserves source priority'
    );
};

subtest 'submit_value can synthesize only one exact retained action field' => sub {
    is( select_action( { submit_value => 'action:save' } ),
        'save', 'exact save submit value is synthesized' );
    is( select_action( { submit_value => 'action:deletespam' } ),
        'deletespam', 'exact spam-delete submit value is synthesized' );
    is( select_action( { 'action:save' => 1, submit_value => 'action:delete' } ),
        'delete', 'synthetic delete participates in the old generic branch precedence' );
    is(
        select_action(
            { 'action:delete' => 1, submit_value => 'action:savemaintainer' },
            maintainer_enabled => 1
        ),
        'savemaintainer',
        'synthetic maintainer action has the same old priority as its field'
    );
    is( select_action( { submit_value => 'action:preview' } ),
        undef, 'preview submit value cannot synthesize an edit action' );
    is( select_action( { submit_value => 'action:unknown' } ),
        undef, 'unknown submit value cannot synthesize an action' );
    is( select_action( { submit_value => '' } ),
        undef, 'empty submit value cannot synthesize an action' );
    is( select_action( { submit_value => "action:save\0action:delete" } ),
        undef, 'NUL-joined submit values cannot synthesize an action' );
};

subtest 'selection does not cross the decoder-hook boundary' => sub {
    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub { die 'selector must not decode' };
    is( select_action( { 'action:save' => 1 } ), 'save', 'pure selector does not invoke decoding' );
};

subtest 'multivalue input uses the retained NUL boundary without mutation' => sub {
    my $post = Hash::MultiValue->new(
        submit_value  => '',
        submit_value  => 'action:delete',
        'action:save' => 1,
    );
    is( select_action($post), 'save',
        'NUL-joined submit value is ignored while real save remains' );
    is_deeply(
        [ $post->get_all('submit_value') ],
        [ '', 'action:delete' ],
        'selector does not mutate the multivalue input'
    );

    my $plain   = { 'action:save' => 1 };
    my $address = refaddr($plain);
    is( select_action($plain), 'save',   'plain legacy hash remains supported' );
    is( refaddr($plain),       $address, 'selector does not replace or mutate the plain input' );
};

done_testing;

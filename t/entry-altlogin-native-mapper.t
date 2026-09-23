#!/usr/bin/perl
# Characterize pure native-form mapping for a future retained altlogin POST seam.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Hash::MultiValue;
use Scalar::Util qw(refaddr);
use Test::More;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Entry::Legacy;

sub native_post {
    return Hash::MultiValue->new(
        'action:update'        => 'Update',
        user                   => 'credential-actor',
        password               => 'never-rendered-fixture-password',
        subject                => 'Native subject',
        event                  => 'Native <strong>body</strong>',
        editor                 => 'markdown0',
        security               => 'custom',
        custom_bit             => 1,
        custom_bit             => 60,
        usejournal             => 'target-community',
        taglist                => 'native tag',
        prop_picture_keyword   => 'native-icon',
        current_music          => 'native music',
        current_location       => 'native location',
        entrytime_date         => '2026-09-23',
        entrytime_time         => '10:11',
        trust_datetime         => 1,
        update_displaydate     => 1,
        entrytime_outoforder   => 1,
        comment_settings       => 'nocomments',
        age_restriction        => 'restricted',
        age_restriction_reason => 'fixture reason',
        entry_slug             => 'native-slug',
        sticky_entry           => 1,
        sticky_select          => 1,
        crosspost_entry        => 1,
        crosspost              => 41,
        crosspost_password_41  => 'crosspost-password',
        crosspost_chal_41      => 'crosspost-challenge',
        crosspost_resp_41      => 'crosspost-response',
    );
}

sub request_snapshot {
    my ($post) = @_;
    return {
        action_update => [ $post->get_all('action:update') ],
        bits          => [ $post->get_all('custom_bit') ],
        crosspost     => [ $post->get_all('crosspost') ],
        subject       => $post->{subject},
        event         => $post->{event},
        editor        => $post->{editor},
    };
}

subtest 'native canonical data and retained hook snapshot are separate pure outputs' => sub {
    my $post         = native_post();
    my $before       = request_snapshot($post);
    my $decoded      = 0;
    my $hooks        = 0;
    my $auth         = 0;
    my $lookups      = 0;
    my $requests     = 0;
    my $orig_enabled = \&LJ::is_enabled;

    no warnings 'redefine';
    local *DW::Entry::Legacy::decode_entry_form = sub { ++$decoded; die 'decoder must not run'; };
    local *LJ::Hooks::run_hooks                 = sub { ++$hooks;   die 'hook must not run'; };
    local *LJ::auth_okay                        = sub { ++$auth;    die 'auth must not run'; };
    local *LJ::load_user            = sub { ++$lookups;  die 'user lookup must not run'; };
    local *LJ::Protocol::do_request = sub { ++$requests; die 'protocol must not run'; };
    local *LJ::is_enabled           = sub {
        return 1 if $_[0] eq 'adult_content';
        return $orig_enabled->(@_);
    };

    my $canonical_seed = { tz => 'guess', props => { seed_prop => 'seed value' } };
    my $prepared       = DW::Entry::Legacy::prepare_altlogin_native_form(
        $post,
        canonical_seed => $canonical_seed,
        legacy_seed    => {
            mode         => 'postevent',
            ver          => $LJ::PROTOCOL_VER,
            user         => 'credential-actor',
            password     => 'never-rendered-fixture-password',
            usejournal   => 'target-community',
            tz           => 'guess',
            xpost        => '0',
            preserved    => 'seed value',
            event_format => 'preformatted',
        },
    );

    is( $prepared->{action}, 'update', 'only the actual update action is prepared' );
    is_deeply(
        $prepared->{credential},
        { username => 'credential-actor', password => 'never-rendered-fixture-password' },
        'credential material is carried separately from the session remote'
    );
    is( refaddr( $prepared->{native_post} ), refaddr($post), 'original HMV reference is retained' );
    isnt(
        refaddr( $prepared->{canonical} ),
        refaddr( $prepared->{legacy_request} ),
        'canonical and hook snapshot are distinct references'
    );
    is_deeply( request_snapshot($post), $before, 'native HMV remains unchanged' );
    is_deeply(
        $canonical_seed,
        { tz => 'guess', props => { seed_prop => 'seed value' } },
        'canonical caller seed remains unchanged'
    );
    isnt(
        refaddr( $prepared->{canonical}{props} ),
        refaddr( $canonical_seed->{props} ),
        'canonical props do not retain the caller seed reference'
    );

    my $canonical = $prepared->{canonical};
    is_deeply(
        [ @{$canonical}{qw(subject event security allowmask year mon day hour min slug)} ],
        [
            'Native subject',
            'Native <strong>body</strong>',
            'usemask',
            ( 1 << 1 ) | ( 1 << 60 ),
            qw(2026 09 23 10 11 native-slug)
        ],
        'native parser supplies canonical subject body security custom bits date and slug'
    );
    ok( !exists $canonical->{tz}, 'trusted native date removes canonical seed timezone' );
    is( $canonical->{props}{editor}, 'markdown0', 'native editor stays canonical' );
    is( $canonical->{props}{opt_preformatted}, 0, 'native parser owns formatting semantics' );
    is_deeply(
        {
            map { $_ => $canonical->{props}{$_} }
                qw(taglist picture_keyword current_music current_location
                opt_backdated opt_nocomments adult_content adult_content_reason)
        },
        {
            taglist              => 'native tag',
            picture_keyword      => 'native-icon',
            current_music        => 'native music',
            current_location     => 'native location',
            opt_backdated        => 1,
            opt_nocomments       => 1,
            adult_content        => 'explicit',
            adult_content_reason => 'fixture reason',
        },
        'native metadata is canonicalized by the native parser'
    );
    is( $canonical->{crosspost_entry}, 0, 'altlogin mapper suppresses injected crosspost master' );
    ok( !exists $canonical->{crosspost}, 'altlogin mapper discards injected crosspost accounts' );

    my $legacy = $prepared->{legacy_request};
    is( $legacy->{mode},      'postevent',  'explicit caller seed is preserved in hook snapshot' );
    is( $legacy->{preserved}, 'seed value', 'ordinary caller seed field is preserved' );
    ok( !exists $legacy->{tz}, 'trusted date does not reintroduce seed timezone in hook snapshot' );
    is_deeply(
        {
            map { $_ => $legacy->{$_} }
                qw(subject event security allowmask year mon day hour min slug
                prop_taglist prop_picture_keyword prop_current_music prop_current_location prop_opt_backdated
                prop_opt_nocomments prop_adult_content prop_adult_content_reason update_displaydate
                sticky_entry sticky_select xpost)
        },
        {
            subject                   => 'Native subject',
            event                     => 'Native <strong>body</strong>',
            security                  => 'usemask',
            allowmask                 => ( 1 << 1 ) | ( 1 << 60 ),
            year                      => '2026',
            mon                       => '09',
            day                       => '23',
            hour                      => '10',
            min                       => '11',
            slug                      => 'native-slug',
            prop_taglist              => 'native tag',
            prop_picture_keyword      => 'native-icon',
            prop_current_music        => 'native music',
            prop_current_location     => 'native location',
            prop_opt_backdated        => 1,
            prop_opt_nocomments       => 1,
            prop_adult_content        => 'explicit',
            prop_adult_content_reason => 'fixture reason',
            update_displaydate        => 1,
            sticky_entry              => 1,
            sticky_select             => 1,
            xpost                     => 0,
        },
        'known canonical fields are flattened explicitly for the hook snapshot'
    );
    ok( !exists $legacy->{prop_editor}, 'native editor is not converted to a legacy prop' );
    ok( !exists $legacy->{prop_opt_preformatted},
        'native formatting is not converted to legacy preformat' );
    ok( !exists $legacy->{prop_used_rte}, 'native editor does not synthesize legacy RTE state' );
    ok( !exists $legacy->{event_format},  'caller legacy display flag is removed' );
    ok(
        !exists $legacy->{custom_bit_1} && !exists $legacy->{custom_bit_60},
        'numbered raw custom bits are not invented in decoded hook snapshot'
    );
    $canonical->{props}{taglist} = 'canonical mutation';
    is( $legacy->{prop_taglist}, 'native tag', 'canonical mutation cannot affect hook snapshot' );
    $legacy->{subject} = 'hook snapshot mutation';
    is(
        $canonical->{subject},
        'Native subject',
        'hook snapshot mutation cannot affect canonical data'
    );

    is( $decoded,  0, 'legacy decoder is not invoked' );
    is( $hooks,    0, 'no hook is invoked' );
    is( $auth,     0, 'no authentication is attempted' );
    is( $lookups,  0, 'no user lookup is attempted' );
    is( $requests, 0, 'no protocol request is attempted' );
};

subtest 'untrusted native dates retain only the explicit seed timezone' => sub {
    my $post = native_post();
    $post->remove('trust_datetime');
    my $prepared = DW::Entry::Legacy::prepare_altlogin_native_form( $post,
        legacy_seed => { tz => 'guess', mode => 'postevent' }, );

    is( $prepared->{canonical}{tz}, 'guess', 'untrusted date retains the explicit seed timezone' );
    is( $prepared->{legacy_request}{tz}, 'guess', 'hook snapshot retains that canonical timezone' );
};

subtest 'only an unambiguous update action enters native mapping' => sub {
    my $calls = 0;
    my $orig  = \&DW::Entry::_form_to_backend;
    no warnings 'redefine';
    local *DW::Entry::_form_to_backend = sub { ++$calls; return $orig->(@_); };

    for my $case (
        [ 'missing action', Hash::MultiValue->new( event => 'body' ) ],
        [ 'empty update action', Hash::MultiValue->new( 'action:update' => '', event => 'body' ) ],
        [
            'preview action',
            Hash::MultiValue->new(
                'action:update'  => 'Update',
                'action:preview' => 'Preview',
                event            => 'body'
            )
        ],
        [
            'spellcheck action',
            Hash::MultiValue->new(
                'action:update'     => 'Update',
                'action:spellcheck' => 'Spell Check',
                event               => 'body'
            )
        ],
        [
            'save draft action',
            Hash::MultiValue->new(
                'action:update' => 'Update',
                'action:save'   => 'Save',
                event           => 'body'
            )
        ],
        [
            'delete action',
            Hash::MultiValue->new(
                'action:update' => 'Update',
                'action:delete' => 'Delete',
                event           => 'body'
            )
        ],
        [
            'deletespam action',
            Hash::MultiValue->new(
                'action:update'     => 'Update',
                'action:deletespam' => 'Delete Spam',
                event               => 'body'
            )
        ],
        [
            'savedraft action',
            Hash::MultiValue->new(
                'action:update'    => 'Update',
                'action:savedraft' => 'Save Draft',
                event              => 'body'
            )
        ],
        [
            'unknown action',
            Hash::MultiValue->new(
                'action:update'  => 'Update',
                'action:unknown' => 'Unknown',
                event            => 'body'
            )
        ],
        [
            'repeated mixed actions',
            Hash::MultiValue->new(
                'action:update'  => 'Update',
                'action:update'  => 'Update again',
                'action:unknown' => 'Unknown',
                event            => 'body'
            )
        ],
        )
    {
        my ( $label, $post ) = @$case;
        is( DW::Entry::Legacy::prepare_altlogin_native_form($post)->{action},
            undef, "$label remains outside the save mapper" );
    }
    is( $calls, 0, 'non-update classifications never call the native parser' );
};

done_testing;

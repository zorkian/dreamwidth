#!/usr/bin/perl

# native-comments.pl
#
# Synthetic retained comment helper qualification; no database access.
#
# Authors:
#     Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin", "$ENV{LJHOME}/src/s2";
require 'ljlib.pl';
use LJ::Talk;
use LJ::S2;
use LJ::Comment;
use LJ::CleanHTML;
use JSON::PP;
{

    package SyntheticUser;
    our @ISA = ('LJ::User');
    sub count_maxcomments    { exists $_[0]{maxcomments} ? $_[0]{maxcomments} : 10000 }
    sub show_thread_expander { 1 }
    sub is_suspended         { $_[0]{statusvis} eq 'S' }
    sub is_identity          { $_[0]{identity} || 0 }
    sub trusts_or_has_member { $_[0]{trusted}  || 0 }
}
{

    package SyntheticEntry;
    our @ISA = ('LJ::Entry');
    sub prop        { $_[0]{props}{ $_[1] } }
    sub props       { $_[0]{props} }
    sub url         { 'http://app.invalid/~synthetic/10759.html' }
    sub reply_count { exists $_[0]{replycount} ? $_[0]{replycount} : 5 }
}
{

    package SyntheticComment;
    sub absorb_row      { }
    sub remote_can_edit { 0 }
}
my $u = bless { userid => 900001, clusterid => 1, user => 'synthetic', statusvis => 'V' },
    'SyntheticUser';
if ( @ARGV == 1 && $ARGV[0] eq '--threshold' ) {
    my @rows;
    for my $case ( [ 4, 5, 'Y' ], [ 5, 5, 'Y' ], [ 0, 0, 'Y' ], [ 5, 5, 'N' ] ) {
        my ( $count, $limit, $show ) = @$case;
        $u->{maxcomments}       = $limit;
        $u->{opt_showtalklinks} = $show;
        my $entry = bless { props => {}, replycount => $count }, 'SyntheticEntry';
        my $info  = $entry->comment_info( u => $u, remote => undef, style_args => '' );
        push @rows,
            {
            count         => $info->{count},
            maxcomments   => $info->{maxcomments},
            show_readlink => $info->{show_readlink}
            };
    }
    print JSON::PP->new->canonical->utf8->encode( \@rows );
    exit;
}
my %users = (
    1 => bless( { userid => 1, user => 'registered', statusvis => 'V' }, 'SyntheticUser' ),
    2 => bless( { userid => 2, user => 'suspended',  statusvis => 'S' }, 'SyntheticUser' ),
    3 => bless(
        { userid => 3, user => 'identity', statusvis => 'V', identity => 1 },
        'SyntheticUser'
    )
);
my ( %headers, @loads );
my @results;
no warnings 'redefine';
local *LJ::get_db_reader = sub { require Carp; Carp::confess('DB forbidden') };
local *LJ::get_db_writer = sub { require Carp; Carp::confess('DB forbidden') };
local *LJ::Talk::get_talk_data = sub {
    return { map { $_ => { %{ $headers{$_} } } } keys %headers };
};
local *LJ::load_userid           = sub { $users{ $_[0] } };
local *LJ::load_userids_multiple = sub {
    my @pairs = @{ $_[0] };
    while (@pairs) { my $id = shift @pairs; my $ref = shift @pairs; $$ref = $users{$id} }
};
local *LJ::get_talktext2 = sub {
    my ( $journal, @ids ) = @_;
    my $subjects = ref( $ids[0] ) ? shift(@ids) : undef;
    push @loads, { ids => [@ids], onlysubjects => $subjects ? 1 : 0 };
    return { map { $_ => [ "subject$_", "body$_" ] } @ids };
};
local *LJ::load_talk_props2       = sub { };
local *LJ::Comment::preload_props = sub { };
local *LJ::Comment::new           = sub { bless {}, 'SyntheticComment' };
local *LJ::Lang::ml               = sub { 'Image' };
local *LJ::Lang::string_exists    = sub { 1 };
local $LJ::TALK_PAGE_SIZE    = 2;
local $LJ::TALK_THREAD_POINT = 4;
local $LJ::TALK_MAX_SUBJECTS = 3;

if (@ARGV) {
    if ( @ARGV == 1 && $ARGV[0] eq '--depth' ) {
        %headers = map { $_ => header( $_, $_ == 1 ? 0 : $_ - 1, 'A', 0 ) } 1 .. 182;
        my %opts = ( up => $u );
        my @rows = LJ::Talk::load_comments( $u, undef, 'L', 42, \%opts );
        print JSON::PP->new->canonical->utf8->encode( project( \@rows ) );
        exit 0;
    }
    die "Unknown native comment probe mode\n" unless @ARGV == 1 && $ARGV[0] eq '--clean';
    my $input = do { local $/; <STDIN> };
    die "Oversized native comment input\n" if length($input) > 1048576;
    my $cases = decode_json($input);
    die "Invalid native comment cases\n" unless ref($cases) eq 'ARRAY' && @$cases <= 16;
    my @outputs;
    for my $case (@$cases) {
        die "Invalid native comment body\n"
            unless ref($case) eq 'HASH'
            && defined $case->{body}
            && !ref( $case->{body} )
            && length( $case->{body} ) <= 65536
            && ref( $case->{options} ) eq 'HASH';
        my $text = $case->{body};
        LJ::CleanHTML::clean_comment( \$text, $case->{options} );
        push @outputs, $text;
    }
    print JSON::PP->new->canonical->utf8->encode( \@outputs );
    exit 0;
}

sub header {
    my ( $id, $parent, $state, $poster ) = @_;
    return {
        talkid        => $id,
        parenttalkid  => $parent,
        state         => $state,
        posterid      => $poster,
        datepost      => '2026-09-26 00:00:00',
        datepost_unix => 1700000000 + $id
    };
}

sub project {
    my ($rows) = @_;
    return [
        map {
            my $row = $_;
            +{
                (
                    map { $_ => $row->{$_} }
                        qw(talkid parenttalkid state _show _loaded subject body showable_children)
                ),
                children => project( $row->{children} || [] )
            }
        } @$rows
    ];
}
for my $case (
    [ small => [ [ 1, 0, 'A', 1 ], [ 2, 1, 'A', 1 ], [ 3, 0, 'F', 1 ] ] ],
    [
        states => [
            [ 1, 0, 'S', 1 ],
            [ 2, 1, 'A', 1 ],
            [ 3, 0, 'D', 1 ],
            [ 4, 3, 'A', 1 ],
            [ 5, 0, 'S', 1 ],
            [ 6, 0, 'D', 1 ],
            [ 7, 0, 'A', 2 ],
            [ 8, 0, 'F', 1 ]
        ]
    ],
    [ pages => [ map { [ $_, 0, 'A', 1 ] } 1 .. 5 ] ],
    [
        collapse => [
            [ 1, 0, 'A', 1 ],
            [ 2, 1, 'A', 1 ],
            [ 3, 1, 'A', 1 ],
            [ 4, 2, 'A', 1 ],
            [ 5, 3, 'A', 1 ],
            [ 6, 0, 'A', 1 ]
        ]
    ]
    )
{
    %headers = map { $_->[0] => header(@$_) } @{ $case->[1] };
    for my $request (
        ( $case->[0] eq 'states' ? ( { thread => 5 }, { thread => 6 }, { thread => 7 } ) : () ),
        {},
        { page   => 2 },
        { page   => 99 },
        { thread => 2 },
        { thread => 999 },
        { thread => ( 2 * 256 + 7 ) >> 8, source_dtalkid => 2 * 256 + 7 },
        { thread => ( 2 * 256 + 8 ) >> 8, source_dtalkid => 2 * 256 + 8 }
        )
    {
        @loads = ();
        my %opts = ( %$request, up => $u );
        my @rows = LJ::Talk::load_comments( $u, undef, 'L', 42, \%opts );
        push @results,
            {
            case    => $case->[0],
            request => $request,
            tree    => project( \@rows ),
            loads   => [@loads],
            nav     => {
                map { $_ => $opts{$_} }
                    qw(out_error out_pages out_page out_items out_pagesize out_itemfirst out_itemlast out_has_collapsed)
            }
            };
    }
}
for my $setting (
    [ Y => 'all',     'N', 0 ],
    [ Y => 'reg',     'A', 0 ],
    [ Y => 'friends', 'R', 0 ],
    [ N => 'all',     'N', 0 ],
    [ Y => 'all',     'N', 1 ]
    )
{
    my ( $show, $reply, $screen, $disabled ) = @$setting;
    $u->{opt_showtalklinks} = $show;
    $u->{opt_whocanreply}   = $reply;
    my $entry = bless { props => { opt_nocomments => $disabled } }, 'SyntheticEntry';
    my $info  = $entry->comment_info( u => $u, remote => undef, style_args => '' );
    push @results,
        {
        case     => 'native-comment-enabled',
        show     => $show,
        reply    => $reply,
        screen   => $screen,
        disabled => $disabled,
        info     => $info
        };
}

# Execute only the exact retained state-redaction block, not a replacement model.
open my $file, '<', "$ENV{LJHOME}/cgi-bin/LJ/S2/EntryPage.pm" or die $!;
local $/;
my $source = <$file>;
close $file;
my ($redaction) = $source =~
/(            # don't show info from suspended users.*?)(?=            # Conditionally add more links)/s;
die 'source boundary missing' unless $redaction;
for my $spec ( [ S => 1, 0 ], [ D => 1, 0 ], [ F => 1, 1 ], [ A => 2, 1 ] ) {
    my ( $state, $poster, $show ) = @$spec;
    my $pu       = $users{$poster};
    my $viewsome = 0;
    my $com      = { state => $state, _show => $show };
    my $s2com    = {
        full     => 1,
        poster   => 'marker',
        userpic  => 'marker',
        subject  => 'secret',
        text     => 'secret',
        screened => 0
    };
    eval $redaction;
    die $@ if $@;
    push @results,
        { case => 'actual-source-redaction', state => $state, poster => $poster, result => $s2com };
}
for my $kind ( 'registered', 'anonymous', 'identity-untrusted', 'identity-trusted' ) {
    my $pu = $kind eq 'anonymous' ? undef : $kind =~ /identity/ ? $users{3} : $users{1};
    $u->{trusted} = $kind eq 'identity-trusted' ? 1 : 0;
    my $anon = LJ::Talk::treat_as_anon( $pu, $u );
    my $text =
'<b style="color:red">Text</b> <a href="https://example.invalid/">Link</a> <img src="https://example.invalid/p.png">';
    LJ::CleanHTML::clean_comment( \$text,
        { editor => 'html_raw0', anon_comment => $anon, nocss => $anon } );
    push @results,
        { case => 'cleaner-trust', kind => $kind, anon => $anon ? 1 : 0, output => $text };
}
{
    local *LJ::get_remote = sub { undef };
    local *S2::Builtin::LJ::get_page =
        sub { { _u => $u, entry => { poster => { user => 'registered' } } } };
    my $props = { map { $_ => $_ } qw(text_comment_expand text_comment_hide text_comment_unhide) };
    my $ctx   = [];
    $ctx->[S2::PROPS] = $props;
    for my $key (
        qw(delete_comment screen_comment freeze_thread watch_thread edit_comment expand_comments hide_comments unhide_comments)
        )
    {
        my $link = S2::Builtin::LJ::_Comment__get_link(
            $ctx,
            {
                talkid  => 519,
                full    => 0,
                poster  => { user => 'registered' },
                replies => [ { full => 0, deleted => 0 } ]
            },
            $key
        );
        push @results, { case => 'anonymous-control', key => $key, link => $link };
    }
    my @resources;
    local *LJ::need_res = sub {
        push @resources, grep { !ref $_ } @_;
    };
    LJ::Talk::init_s2journal_js( iconbrowser => 1, siteskin => 0 );
    push @results, { case => 'native-resource-helper', resources => \@resources };
}
print JSON::PP->new->canonical->utf8->encode( \@results );

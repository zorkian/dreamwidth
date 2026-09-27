#!/usr/bin/perl
# editors-native.pl
#
# Retained Entry display formats and independent metadata on fixed synthetic inputs.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#
use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin";
require 'ljlib.pl';
use LJ::Entry;
use LJ::CleanHTML;
use LJ::S2;
use JSON::PP;
use Encode qw(encode decode);
{

    package EditorFixture;
    our @ISA = ('LJ::Entry');
    sub prop                       { $_[0]{props}{ $_[1] } }
    sub event_raw                  { $_[0]{event} }
    sub logtime_mysql              { $_[0]{logtime} }
    sub should_show_suspend_msg_to { 0 }
    sub ditemid                    { 384 }
}
{

    package EditorOwner;
    sub user          { 'synthetic' }
    sub is_syndicated { 0 }
}
if ( @ARGV && $ARGV[0] eq '--request-auth' ) {
    my @scalars = (
        'see_request?id=1&auth=TOKEN&x=2',
        'SEE_REQUEST?ID=1&AUTH=A_09',
        'see_request?id=1&auth=A see_request?id=2&auth=B',
        'see_request?id=1&amp;auth=A',
        'other?id=1&auth=A',
        'see_request&auth=A',
        "see_request\n?id=1&auth=A",
        'see_request?id=1&auth=A-B',
        'see_request?id=1&auth=' . encode( 'UTF-8', chr(0xe9) ) . 'Z',
        'see_request?id=1&auth=A' . encode( 'UTF-8', chr(0xe9) ) . 'Z',
        'see_request' . encode( 'UTF-8', chr(0xa0) ) . '?id=1&auth=A',
    );
    my @rows = map {
        {
            kind   => 'scalar',
            source => decode( 'UTF-8', $_ ),
            output => decode( 'UTF-8', LJ::strip_request_auth($_) )
        }
    } @scalars;
    my $url =
      'https://example.invalid/see_request?id=1&auth=SYNTH_TOKEN&more=1';
    my $source = qq{<a href="$url">$url</a>};
    for my $mode (
        qw(raw casual subject all plain_subject plain_all metadata comment customtext second)
      )
    {
        my $value = $mode =~ /^plain/ ? $url : $source;
        if ( $mode eq 'subject' || $mode eq 'plain_subject' ) {
            LJ::CleanHTML::clean_subject( \$value );
        }
        elsif ( $mode eq 'all' || $mode eq 'plain_all' ) {
            LJ::CleanHTML::clean_subject_all( \$value );
        }
        elsif ( $mode eq 'comment' ) {
            LJ::CleanHTML::clean_comment( \$value, { editor => 'html_raw0' } );
        }
        elsif ( $mode eq 'customtext' || $mode eq 'second' ) {
            LJ::S2::escape_prop_value( $value, 'html' );
            LJ::S2::escape_prop_value( $value, 'html' ) if $mode eq 'second';
        }
        else {
            LJ::CleanHTML::clean_event(
                \$value,
                {
                    editor => $mode eq 'casual' ? 'html_casual1' : 'html_raw0',
                    textonly => $mode eq 'metadata' ? 1 : 0,
                }
            );
        }
        push @rows,
          {
            kind   => 'context',
            mode   => $mode,
            source => $source,
            url    => $url,
            output => $value
          };
    }
    print JSON::PP->new->canonical->utf8->encode( \@rows );
    exit;
}
my @cases = (
    [ 'raw',     { editor => 'html_raw0' } ],
    [ 'casual0', { editor => 'html_casual0' } ],
    [ 'casual1', { editor => 'html_casual1' } ],
    [ 'rte0',    { editor => 'rte0' } ],
    [ 'missing', {} ],
    [ 'empty',   { editor => '' } ],
    [ 'false0',  { editor => '0' } ],
    [
        'raw_wins',
        { editor => 'html_raw0', opt_preformatted => '0', import_source => 'legacy' },
        '2018-01-01 00:00:00'
    ],
    [
        'casual_wins',
        { editor => 'html_casual1', opt_preformatted => '1', import_source => '0' },
        '2018-01-01 00:00:00'
    ],
    [ 'preformatted', { opt_preformatted => '1' } ],
    [ 'import_empty', { import_source    => '' } ],
    [ 'import_zero',  { import_source    => '0' } ],
    [ 'import_undef', { import_source    => undef } ],
    [ 'old',      {}, '2019-04-30 23:59:59' ],
    [ 'boundary', {}, '2019-05-01 00:00:00' ],
    [ 'invalid_truthy',   { editor => 'bogus', opt_preformatted => '1' } ],
    [ 'rte_preformatted', { editor => 'rte0',  opt_preformatted => '1' } ],
    [
        'magic_missing', { opt_preformatted => '1', import_source => '0' },
        undef, "!markdown\n**bold**\nnext"
    ],
    [ 'magic_raw',      { editor => 'html_raw0' },    undef, "!markdown\n**bold**\nnext" ],
    [ 'markdown_alias', { editor => 'markdown' },     undef, "**bold**\nnext" ],
    [ 'crlf',           { editor => 'html_casual1' }, undef, "a\r\nb\rc\n" ],
    [ 'pre',  { editor => 'html_casual1' }, undef, "<pre>\nhttp://example.invalid/\\\@x\n</pre>" ],
    [ 'code', { editor => 'html_casual1' }, undef, "<code>a\n\\\@x</code>" ],
    [ 'textarea',     { editor => 'html_casual1' }, undef, "<textarea>\n\\\@x\n</textarea>" ],
    [ 'mentions0',    { editor => 'html_casual0' }, undef, 'x @name' ],
    [ 'mentions1',    { editor => 'html_casual1' }, undef, 'x @name' ],
    [ 'escaped',      { editor => 'html_casual1' }, undef, 'x\\@name' ],
    [ 'double_slash', { editor => 'html_casual1' }, undef, 'x\\\\@name' ],
    [ 'email',        { editor => 'html_casual1' }, undef, 'mail@example.invalid' ],
    [
        'cut', { editor => 'html_casual1' },
        undef, "a\n<lj-cut text=\"More\">hidden\n<b>x</b></lj-cut>\nafter"
    ],
    [ 'false_body', { editor => 'html_casual1' }, undef, '0' ],
);
if ( @ARGV && $ARGV[0] eq '--markdown' ) {
    @cases = (
        [ 'explicit', { editor => 'markdown0' }, undef, "**bold**\nnext" ],
        [ 'latest', { editor => 'markdown_latest' }, undef, '**bold**' ],
        [ 'magic', {}, undef, "!markdown\n**bold**\nnext" ],
        [ 'raw_magic', { editor => 'html_raw0' }, undef, "!markdown\n**bold**\nnext" ],
        [ 'list', { editor => 'markdown0' }, undef, '3. item' ],
        [ 'ordinary_list', { editor => 'markdown0' }, undef, '1. item' ],
        [ 'nested_classic', { editor => 'markdown0' }, undef, "3. outer\n    7. inner" ],
        [ 'nested_list', { editor => 'markdown0' }, undef, "3. outer\n\n    7. inner" ],
        [ 'multiline_paragraph', { editor => 'markdown0' }, undef, "ordinary paragraph\nwith `code`" ],
        [ 'multiline_code', { editor => 'markdown0' }, undef, "`line\ncode`" ],
        [ 'edge_code', { editor => 'markdown0' }, undef, "`\nedge\n`" ],
        [ 'mention', { editor => 'markdown0' }, undef, 'x @name' ],
        [ 'code_mention', { editor => 'markdown0' }, undef, '`@name`' ],
        [ 'escaped_mention', { editor => 'markdown0' }, undef, 'x\@name' ],
        [ 'escaped_space', { editor => 'markdown0' }, undef, 'x \@name' ],
        [ 'escaped_start', { editor => 'markdown0' }, undef, '\@name at start' ],
        [ 'magic_escaped_space', {}, undef, "!markdown\nx \\\@name" ],
        [ 'magic_escaped_start', {}, undef, "!markdown\n\\\@name at start" ],
        [ 'email', { editor => 'markdown0' }, undef, '<mail@example.invalid>' ],
        [ 'unsafe_link', { editor => 'markdown0' }, undef, '[label](javascript:alert(1))' ],
        [ 'block_cut', { editor => 'markdown0' }, undef, '<div class="ljcut">hidden **raw**</div>' ],
        [ 'inline_cut', { editor => 'markdown0' }, undef, 'a <lj-cut>hidden</lj-cut> after' ],
        [ 'recursive', { editor => 'markdown0' }, undef, '<div markdown="1">**inside**</div>' ],
        [ 'literal_attribute', { editor => 'markdown0' }, undef, '`<div markdown="1">`' ],
        [ 'false', { editor => 'markdown0' }, undef, '0' ],
        [ 'auth', { editor => 'markdown0' }, undef, '[help](https://example.invalid/see_request?id=1&auth=TOKEN&x=2)' ],
        [ 'preview_email', {}, undef, '!markdown' . "\n" . ('x' x 250) . ' <mail@example.invalid>' ],
    );
}
my $base     = "a\nhttp://example.invalid/?a=1&b=2\nmail\@example.invalid\n";
my $original = \&LJ::CleanHTML::formatting_args;
my @rows;
{
    no warnings 'redefine';
    local *LJ::get_db_reader          = sub { die "DB read forbidden\n" };
    local *LJ::get_db_writer          = sub { die "DB write forbidden\n" };
    local *LJ::get_cluster_def_reader = sub { die "cluster read forbidden\n" };
    local *LJ::get_cluster_master     = sub { die "cluster primary forbidden\n" };
    local *LJ::get_remote             = sub { undef };
    local *LJ::expand_embedded = sub { };    # No embeds in this finite source qualification.
    my ( @calls, @mentions );
    local *LJ::CleanHTML::formatting_args = sub { push @calls,    $_[0]; return $original->(@_) };
    local *LJ::CleanHTML::user_link_html  = sub { push @mentions, $_[0]; return '[MENTION]' };

    for my $case (@cases) {
        my ( $id, $props, $date, $body ) = @$case;
        $body = $base unless defined $body;
        my $entry = bless {
            _loaded_props => 1,
            _loaded_text  => 1,
            props         => $props,
            event         => $body,
            logtime       => $date // '2026-09-26 00:00:00',
            u             => bless( {}, 'EditorOwner' )
            },
            'EditorFixture';
        my %row = ( id => $id, props => $props, logtime => $entry->{logtime}, source => $body );
        for my $mode (qw(recent entry metadata)) {
            @calls    = ();
            @mentions = ();
            my $result = eval {
                $mode eq 'metadata' ? $entry->event_text
                    : $entry->event_html(
                    $mode eq 'recent' ? { cuturl => 'https://app.invalid/~synthetic/384.html' }
                    : {} );
            };
            my $error = $@;
            $row{$mode} = {
                output       => $result,
                format_calls => [@calls],
                mentions     => [@mentions],
                error        => $error
            };
            if ( $mode eq 'metadata' && !$error ) {
                my $og = $result;
                $og = '' unless defined $og;
                $og =~ s/\s+/ /g;
                $row{og} = LJ::ehtml( LJ::text_trim( $og, 0, 300 ) );
            }
        }
        push @rows, \%row;
    }
}
print JSON::PP->new->canonical->utf8->encode( \@rows );

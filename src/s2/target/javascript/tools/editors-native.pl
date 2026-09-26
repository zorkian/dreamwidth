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
use JSON::PP;
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

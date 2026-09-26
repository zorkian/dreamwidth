#!/usr/bin/perl
# customtext-native.pl
#
# Native compiled property literals and customtext cleaning on fixed inputs.
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
use utf8;
use lib "$ENV{LJHOME}/cgi-bin", "$ENV{LJHOME}/src/s2";
require 'ljlib.pl';
use LJ::S2;
use JSON::PP;
use Encode qw(encode);
use File::Temp qw(tempdir);
my $dir = tempdir( CLEANUP => 1 );
my $base =
qq{layerinfo "type" = "user";\nlayerinfo "name" = "Custom text";\nset module_customtext_show = true;\nset module_customtext_order = 13;\nset module_customtext_section = "one";\nset text_module_customtext = "Title";\nset text_module_customtext_url = "https://example.invalid/?x=1&y=2";\nset text_module_customtext_content = "<b>hello</b>";\n};
my %wrappers;

for my $name (qw(basic variants)) {
    my $source = $base;
    $source .=
qq{set module_customtext_show = false;\nset module_customtext_order = -2;\nset text_module_customtext = "";\n}
        if $name eq 'variants';
    if ( $name eq 'variants' ) {
        my $escaped = "quote\" slash\\ dollar\$ at\@ newline\nend";
        $source .= 'set text_module_customtext_content = '
            . LJ::S2::convert_prop_val( { type => 'string' }, $escaped ) . ";\n";
    }
    open my $file, '>', "$dir/$name.s2" or die $!;
    print {$file} $source;
    close $file;
    open my $compiler, '-|', $^X, "$ENV{LJHOME}/src/s2/s2compile.pl", '--output', 'perl',
        '--layerid', 987654,
        '--layertype', 'user', '--core', "$ENV{LJHOME}/styles/core2.s2", '--layout',
        "$ENV{LJHOME}/styles/core2base/layout.s2", '--untrusted', "$dir/$name.s2"
        or die $!;
    $wrappers{$name} = do { local $/; <$compiler> };
    close $compiler or die 'Native compile failed';
}
my @rows;
for my $source (
    'café@example.invalid', 'x\\\\@name',
    'x\\@name',              'café @name',
    'mail@example.invalid'
    )
{
    my $value = encode( 'UTF-8', $source );
    my @mentions;
    {
        no warnings 'redefine';
        local *LJ::CleanHTML::user_link_html =
            sub { push @mentions, $_[0]; return '[MENTION]'; };
        local *LJ::get_db_reader = sub { die "DB READ FORBIDDEN\n" };
        local *LJ::get_db_writer = sub { die "DB WRITE FORBIDDEN\n" };
        LJ::S2::escape_prop_value( $value, 'html' );
    }
    push @rows,
        {
        kind       => 'byte_mentions',
        source     => $source,
        mentions   => \@mentions,
        output_hex => unpack( 'H*', $value )
        };
}

{
    no warnings 'redefine';
    *S2::Builtin::Color__Color = \&S2::Builtin::LJ::Color__Color;
}
for my $definition ( [ 987650, 'core', 'core2.s2' ], [ 987651, 'layout', 'core2base/layout.s2' ] ) {
    my ( $id, $type, $file ) = @$definition;
    open my $compiler, '-|', $^X, "$ENV{LJHOME}/src/s2/s2compile.pl", '--output', 'perl',
        '--layerid', $id,
        '--layertype', $type, '--core', "$ENV{LJHOME}/styles/core2.s2", "$ENV{LJHOME}/styles/$file"
        or die $!;
    my $code = do { local $/; <$compiler> };
    close $compiler or die 'Native stock compile failed';
    S2::load_layer( $id, $code, 123 );
}
{
    no warnings 'redefine';
    local *LJ::get_db_reader = sub { die "DB READ FORBIDDEN\n" };
    local *LJ::get_db_writer = sub { die "DB WRITE FORBIDDEN\n" };
    for my $name (qw(basic variants)) {
        my $compiled = $wrappers{$name};
        S2::load_layer( 987654, $compiled, 123 );
        my %sets = map { $_ => S2::get_set( 987654, $_ ) }
            qw(module_customtext_show module_customtext_order module_customtext_section text_module_customtext text_module_customtext_url text_module_customtext_content);
        push @rows,
            {
            kind            => 'wrapper',
            name            => $name,
            compiled        => $compiled,
            sets            => \%sets,
            source_not_read => JSON::PP::true
            };
    }
    for my $source (
        "Title <b>x</b>\n&\"", '0',
        '',                    "plain\nline",
        "\ntext",              "https://example.invalid/a?x=1&y=2\nnext",
        "<pre>a\nb</pre>",     'mail@example.invalid',
        '\@name',              '@name',
        '<pre>\@x</pre>', '<code>\@x</code>', '<textarea>\@x</textarea>',
        "!markdown\n**bold**", '<b>x</b>\n'
        )
    {
        my %row = ( kind => 'pipeline', source => $source );
        for my $mode (qw(plain html)) {
            my $v  = $source;
            my $ok = eval { LJ::S2::escape_prop_value( $v, $mode ); 1 };
            $row{$mode} = $ok ? { output => $v } : { error => "$@" };
            if ( $ok && $mode eq 'html' ) {
                my $second = $v;
                my $sok    = eval { LJ::S2::escape_prop_value( $second, 'html' ); 1 };
                $row{second} = $sok ? { output => $second } : { error => "$@" };
            }
        }
        push @rows, \%row;
    }
    for my $stored ( undef, '', '0', 'Custom Text', 'Stored' ) {
        my $default = 'DEFAULT';
        push @rows,
            {
            kind    => 'fallback',
            stored  => $stored,
            content => ( $stored || $default ),
            url     => ( $stored || $default ),
            title   => ( !defined($stored) || $stored eq '' || $stored eq 'Custom Text' )
            ? $default
            : $stored
            };
    }
    for my $section (qw(one two header none unknown)) {
        for my $order ( -2, -1, 0, 13 ) {
            my $ctx   = S2::make_context( 987650, 987651 );
            my $props = $ctx->[S2::PROPS];
            for my $key ( keys %{ $props->{grouped_property_override} || {} } ) {
                my $other = $props->{grouped_property_override}{$key};
                $props->{$key} = $props->{$other} if $props->{$other};
            }
            S2::run_function( $ctx, 'prop_init()' );
            $props->{module_customtext_show}    = 1;
            $props->{module_customtext_section} = $section;
            $props->{module_customtext_order}   = $order;
            my $ok = eval { S2::run_function( $ctx, 'modules_init()' ); 1 };
            push @rows,
                {
                kind     => 'placement',
                section  => $section,
                order    => $order,
                ok       => $ok ? 1 : 0,
                error    => "$@",
                sections => $props->{module_sections}
                };
        }
    }
}
print JSON::PP->new->canonical->utf8->encode( \@rows );

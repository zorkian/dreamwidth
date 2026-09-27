#!/usr/bin/perl
# active-style-native.pl
#
# Independent fixed native active-program and style-selection expectations.
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
use FindBin;
use lib "$FindBin::Bin/../../..", "$FindBin::Bin/../../../../../cgi-bin";
use S2;
use S2::Compiler;
use S2::Checker;
use MIME::Base64 qw(encode_base64);
use JSON::PP;
require 'ljlib.pl';
require LJ::S2;
{
    no warnings qw(redefine once);
    *LJ::get_db_reader = *LJ::get_db_writer = *LJ::get_dbh = sub { die "DB forbidden\n" };
    *LJ::get_cluster_master = sub { die "DB forbidden\n" };
}
my @spec = (
    [991010, 'core', 0, 'property string value; set value="activeA"; function main() { print $*value; }'],
    [991011, 'layout', 991010, 'function main() { print "layoutA:"+$*value; }'],
    [991012, 'theme', 991011, 'set value="themeA";'],
    [991013, 'user', 991011, 'set value="userA"; function main() { print "custom:"+$*value; }'],
);
my $checker = S2::Checker->new;
my @layers;
for my $spec (@spec) {
    my ($id, $type, $parent, $body) = @$spec;
    my $source = "layerinfo type=\"$type\";\n$body\n";
    my $code = '';
    my $compiler = S2::Compiler->new({checker => $checker});
    $compiler->compile_source({type => $type, source => \$source, output => \$code,
        layerid => $id, format => 'perl', builtinPackage => 'S2::Builtin::LJ'});
    $checker = $compiler->{checker};
    S2::load_layer($id, $code, 1);
    push @layers, {id => $id, type => $type, parentId => $parent,
        sourceBase64 => encode_base64($source, ''), activeBase64 => encode_base64($code, '')};
}
my $output = '';
S2::set_output(sub { $output .= $_[0] });
S2::set_output_safe(sub {die 'Unexpected safe output'});
S2::run_code(S2::make_context(map { $_->[0] } @spec), 'main()');
my %map = (core => 991010, layout => 991011, theme => 991012, user => 991013);
my @writes;
my %native;
{
    no warnings qw(redefine once);
    local *LJ::S2::get_style_layers = sub {return {%map};};
    local *LJ::S2::get_public_layers = sub {return {core2 => {s2lid => 991010},
        'fixture/layout' => {s2lid => 991011}, 'siteviews/layout' => {s2lid => 991011},
        'siteviews/fixture_child' => {s2lid => 991012}};};
    local *LJ::statushistory_add = sub {push @writes, 'status';};
    local *LJ::S2::set_style_layers = sub {push @writes, 'remap';};
    local $LJ::DEFAULT_STYLE = {core => 'core2', layout => 'fixture/layout'};
    local %LJ::S2LID_REMAP = (991010 => 991020, 991013 => 991023);
    my $user = bless {userid => 900001}, 'LJ::User';
    $native{persisted} = {LJ::S2::get_style(44, {u => $user})};
    local *DW::SiteScheme::default = sub {'fixture_child'};
    local *DW::SiteScheme::inheritance = sub {qw(fixture_child fixture_parent global)};
    $native{siteviews} = {LJ::S2::siteviews_style()};
    local $LJ::DEFAULT_FEED_STYLE = {core => 'core2', layout => 'fixture/layout', theme => 'missing/theme'};
    $native{sitefeeds} = {LJ::S2::sitefeeds_style()};
    # Exercise the installed lexical get_styleinfo closure, not a copied branch.
    # This is trusted offline source qualification; no stored program is used.
    open my $styles_file, '<', "$FindBin::Bin/../../../../../cgi-bin/LJ/User/Styles.pm" or die $!;
    my $styles_source = do {local $/; <$styles_file>};
    close $styles_file;
    my ($closure) = $styles_source =~ /my \$get_styleinfo = (sub \{.*?\n        \});/s;
    die 'Native style closure missing' unless $closure;
    my ($geta, $opts, $remote, $view, $stylearg) = ({}, {}, undef, 'lastn', 'original');
    my $u = bless {userid => 900001, journaltype => 'Y', stylesys => 2, s2_style => 44}, 'LJ::User';
    my $get_styleinfo = eval $closure;
    die $@ unless $get_styleinfo;
    $native{feedInfo} = [$get_styleinfo->()];
    %map = ();
    $native{default} = {LJ::S2::get_style(44, {u => $user})};
    local $LJ::DEFAULT_STYLE = {core => 'missing/core', layout => 'missing/layout'};
    $native{incomplete} = {LJ::S2::get_style(44, {u => $user})};
}
my $corrupt_gzip = "\037\213broken";
LJ::text_uncompress(\$corrupt_gzip);
$native{corruptGzipAbsent} = defined $corrupt_gzip ? JSON::PP::false : JSON::PP::true;
print JSON::PP->new->canonical->encode({layers => \@layers, outputBase64 => encode_base64($output, ''),
    selection => \%native, syntheticWrites => \@writes});

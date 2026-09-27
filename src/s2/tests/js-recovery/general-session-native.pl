#!/usr/bin/perl
# general-session-native.pl
#
# Compile a fixed trusted initialization/resume fixture and execute native output.
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
use lib "$FindBin::Bin/../..";
use lib '/workspaces/dreamwidth/cgi-bin';
use MIME::Base64 qw(encode_base64);
use JSON::PP;
use S2;
use S2::Compiler;
use S2::Checker;
BEGIN {
    require DBI;
    no warnings 'redefine';
    *DBI::connect = sub {die "DB forbidden in initialization oracle"};
    *DBI::connect_cached = sub {die "DB forbidden in initialization oracle"};
}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
require LJ::S2;
open my $file, '<:raw', "$FindBin::Bin/general-session.s2" or die "Fixture unavailable";
local $/;
my $source=<$file>;
my $original=$source;
my $code='';
S2::Compiler->new({checker=>S2::Checker->new})->compile_source({type=>'core',source=>\$source,
    output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
S2::load_layer(101,$code);
my $ctx=S2::make_context(101);
$ctx->[S2::SCRATCH]={}; # LJ::S2::make_context initializes embedder scratch before init.
S2::set_output(sub {}); S2::set_output_safe(sub {});
S2::run_code($ctx,'prop_init()'); S2::run_code($ctx,'modules_init()');
# Independently exercise the exact native plain-property transform after init.
$ctx->[S2::PROPS]{label}=~s/</&lt;/g;
$ctx->[S2::PROPS]{label}=~s/>/&gt;/g;
my $output=''; S2::set_output(sub {$output.=$_[0]}); S2::set_output_safe(sub {$output.=$_[0]});
S2::run_code($ctx,'RecentPage::print()',{_type=>'RecentPage',title=>'resume'});
my $ordinary=$output;
$output='';
S2::run_code($ctx,'RecentPage::print()',{_type=>'RecentPage',title=>pack('C*',255,0,97)});
my $bytes_output=$output;
my $css_ctx=S2::make_context(101);
$css_ctx->[S2::SCRATCH]={};
$css_ctx->[S2::PROPS]{init_css}=1;
S2::set_output(sub {}); S2::set_output_safe(sub {});
S2::run_code($css_ctx,'prop_init()'); S2::run_code($css_ctx,'modules_init()');
# The actual native run rebinds the printer pair, preserving CSS scratch.
$output=''; S2::set_output(sub {$output.=$_[0]}); S2::set_output_safe(sub {$output.=$_[0]});
S2::run_code($css_ctx,'RecentPage::print()',{_type=>'RecentPage',title=>'unused'});
print JSON::PP->new->canonical->encode({source=>encode_base64($original,''),code=>encode_base64($code,''),
    output=>encode_base64($ordinary,''),bytesOutput=>encode_base64($bytes_output,''),
    cssOutput=>encode_base64($output,''),count=>0+$ctx->[S2::PROPS]{num_items_recent}});

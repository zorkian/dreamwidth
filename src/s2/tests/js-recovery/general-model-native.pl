#!/usr/bin/perl
# general-model-native.pl
#
# Execute actual native public constructors and fixed helper providers.
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
no warnings 'once';
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
{
    package FixedModelUser;
    sub user {'public_name'}
    sub display_name {'Public & Name'}
    sub allpics_base {'https://public.example.invalid/base/icons'}
}
no warnings 'redefine';
local *LJ::load_user=sub {die 'Unexpected public helper' unless $_[0] eq 'public_name';return bless {userid=>111,name=>'Public',journaltype=>'P'},'FixedModelUser';};
local *LJ::is_enabled=sub {die 'Unexpected feature' unless $_[0] eq 'tellafriend';return 0;};
open my $file,'<:raw',"$FindBin::Bin/general-model.s2" or die 'Fixture unavailable';
local $/;my $source=<$file>;my $original=$source;my $code='';
my $compiler=S2::Compiler->new({checker=>S2::Checker->new});
$compiler->compile_source({type=>'core',source=>\$source,
    output=>\$code,layerid=>101,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
S2::load_layer(101,$code);
my $layout_source='layerinfo type = layout;';my $layout_original=$layout_source;my $layout_code='';
$compiler->compile_source({type=>'layout',source=>\$layout_source,output=>\$layout_code,layerid=>102,untrusted=>0,builtinPackage=>'S2::Builtin::LJ'});
S2::load_layer(102,$layout_code);
my %outputs;
for my $kind(qw(recent entry)) {
    my $ctx=S2::make_context(101,102);$ctx->[S2::SCRATCH]={};
    S2::set_output(sub {});S2::set_output_safe(sub {});
    S2::run_code($ctx,'prop_init()');S2::run_code($ctx,'modules_init()');
    my $image=LJ::S2::Image('/declared-image',75,51,'alt');
    my $page={_type=>$kind eq 'recent'?'RecentPage':'EntryPage',title=>'selected',image=>$image,
        link=>LJ::S2::Link('/relative','caption',$image),date=>LJ::S2::Date(2026,9,27),other=>LJ::S2::Date(2026,9,28),
        user=>S2::Builtin::LJ::UserLite($ctx,'public_name')};
    my $out='';S2::set_output(sub {$out.=$_[0]});S2::set_output_safe(sub {$out.=$_[0]});
    S2::run_code($ctx,$page->{_type}.'::print()',$page);
    $outputs{$kind}={base64=>encode_base64($out,''),utf8=>utf8::is_utf8($out)?JSON::PP::true:JSON::PP::false};
}
print JSON::PP->new->canonical->encode({source=>encode_base64($original,''),code=>encode_base64($code,''),layoutSource=>encode_base64($layout_original,''),layoutCode=>encode_base64($layout_code,''),outputs=>\%outputs});

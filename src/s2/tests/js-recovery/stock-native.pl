#!/usr/bin/perl
# stock-native.pl
#
# Native raw stock registrations and actual stock/long-expression expectations.
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
use lib "$FindBin::Bin/../..", "$FindBin::Bin/../../../../cgi-bin";
use File::Find;
use Storable qw(dclone);
use MIME::Base64 qw(encode_base64);
use JSON::PP;
use S2;
use S2::Compiler;
use S2::Checker;
require 'ljlib.pl';
require LJ::S2;
{ no warnings qw(redefine once);
  *LJ::get_db_reader = *LJ::get_db_writer = *LJ::get_dbh = sub { die "DB forbidden\n" };
  *LJ::get_cluster_master = sub { die "DB forbidden\n" };
}
my $root="$FindBin::Bin/../../../..";
sub read_raw {open my $file,'<:raw',shift or die $!;local $/;return <$file>}
sub compile {
 my ($source,$type,$id,$checker)=@_;
 my $compiler=S2::Compiler->new({checker=>$checker});my $code='';
 $compiler->compile_source({source=>\$source,type=>$type,layerid=>$id,output=>\$code,
  builtinPackage=>'S2::Builtin::LJ'});
 return ($code,$compiler->{checker});
}
my $source=read_raw("$root/styles/core2.s2");
my ($core,$parent)=compile($source,'core',901,S2::Checker->new);
my @rows=({name=>'core2',id=>901,activeBase64=>encode_base64($core,'')});
my @files;find(sub {push @files,$File::Find::name if $_ eq 'layout.s2'},"$root/styles");
my $venture;
for my $file(sort @files) {
 pipe(my $reader,my $writer) or die $!;my $pid=fork();die $! unless defined $pid;
 if(!$pid) {
  close $reader;
  my ($code)=compile(read_raw($file),'layout',902,dclone($parent));
  (my $name=$file)=~s{^\Q$root/styles/\E}{};
  print {$writer} JSON::PP->new->canonical->encode({name=>$name,id=>902,activeBase64=>encode_base64($code,'')});
  close $writer or die $!;exit 0;
 }
 close $writer;my $row=JSON::PP->new->decode(do {local $/;<$reader>});close $reader;
 waitpid($pid,0);die "Stock native compiler failed\n" if $?;
 push @rows,$row;
 $venture=$row if $row->{name} eq 'venture/layout.s2';
}
# Only maintained source compiled above is loaded in this independent oracle.
S2::load_layer(901,$core,1);
S2::load_layer(902,MIME::Base64::decode_base64($venture->{activeBase64}),1);
my $ctx=S2::make_context(901,902);
my $comment={_type=>'Comment',replies=>[{_type=>'Comment',replies=>[{_type=>'Comment',replies=>[]}]},{_type=>'Comment',replies=>[]}]};
my $count=S2::run_function($ctx,'print_module_pagesummary_comment_count(Comment)',$comment);
my $font=S2::run_function($ctx,'generate_font_css(string,string,string,string,string)','Georgia','Arial','serif','12','px');
my $longSource='layerinfo type = "core"; function main() {print '.join('+',('"a"')x2000).';}';
my ($long)=compile($longSource,'core',903,S2::Checker->new);
S2::load_layer(903,$long,1);my $output='';S2::set_output(sub {$output.=$_[0]});
S2::run_code(S2::make_context(903),'main()');
print JSON::PP->new->canonical->encode({layers=>\@rows,count=>0+$count,font=>$font,
 long=>{activeBase64=>encode_base64($long,''),outputBase64=>encode_base64($output,'')}});

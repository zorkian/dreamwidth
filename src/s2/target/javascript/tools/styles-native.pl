#!/usr/bin/perl
# styles-native.pl
#
# Native stock themes, typed property literals and reached stylesheet helpers.
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
use strict; use warnings;
use lib "$ENV{LJHOME}/cgi-bin", "$ENV{LJHOME}/src/s2";
require 'ljlib.pl'; use LJ::S2; use S2::Compiler; use S2::Checker; use JSON::PP; use Digest::SHA qw(sha256_hex);
no warnings qw(redefine once);
*LJ::get_db_reader=sub{die "DB forbidden\n"}; *LJ::get_db_writer=sub{die "DB forbidden\n"}; *LJ::get_dbh=sub{die "DB forbidden\n"}; *LJ::get_cluster_master=sub{die "DB forbidden\n"};

sub readfile {open my $f,'<',$_[0] or die $!; local $/; return <$f>}
my $compiler=S2::Compiler->new({checker=>S2::Checker->new});
sub compile {my($source,$type,$id,$name)=@_;my $out='';$compiler->compile_source({source=>\$source,type=>$type,layerid=>$id,output=>\$out,format=>'perl',builtinPackage=>'S2::Builtin::LJ'});S2::load_layer($id,$out,123);return sha256_hex($out)}
compile(readfile("$ENV{LJHOME}/styles/core2.s2"),'core',980001,'core');
compile(readfile("$ENV{LJHOME}/styles/core2base/layout.s2"),'layout',980002,'layout');
my $themes=readfile("$ENV{LJHOME}/styles/core2base/themes.s2"); my @rows;
for my $case(['dazzle',980003],['kelis',980004]) {my($name,$id)=@$case;my($src)=$themes=~m{#NEWLAYER: core2base/\Q$name\E\n(.*?)(?=\n#NEWLAYER:|\z)}s;die 'theme missing' unless$src;my$hash=compile($src,'theme',$id,$name);for my $view(qw(recent entry)) {my$ctx=S2::make_context(980001,980002,$id);my$css='';S2::set_output(sub{$css.=$_[0]});S2::set_output_safe(sub{$css.=$_[0]});S2::run_code($ctx,'prop_init()');LJ::S2::escape_all_props($ctx,[980001,980002,$id]); for my$fn(qw(Page::print_contextual_stylesheet() Page::print_default_stylesheet() print_stylesheet() Page::print_theme_stylesheet())){S2::run_code($ctx,$fn,{_type=>$view eq 'entry'?'EntryPage':'RecentPage',view=>$view})}push@rows,{name=>$name,title=>S2::get_layer_info($id,'name'),view=>$view,codeSha=>$hash,cssSha=>sha256_hex($css),source=>$src,css=>$css,cssBytes=>length$css,color=>$ctx->[S2::PROPS]->{color_page_background}};}}
my$user=q{layerinfo type = "user"; set color_page_background = "#123456"; set font_base = "Georgia"; set module_tags_show = false; set module_tags_order = -1; };
my$uh=compile($user,'user',980005,'user');my$ctx=S2::make_context(980001,980002,980003,980005);push@rows,{name=>'user-after-theme',compiled=>do {my$o="";$compiler->compile_source({source=>\$user,type=>"user",layerid=>980005,output=>\$o,format=>"perl",builtinPackage=>"S2::Builtin::LJ"});$o},codeSha=>$uh,values=>{map{$_=>$ctx->[S2::PROPS]->{$_}}qw(color_page_background font_base module_tags_show module_tags_order)}};
for my$value("", "#", "abc", "#0ef", "#123456", "bad!") {push@rows,{name=>"color",input=>$value,value=>scalar S2::Builtin::LJ::Color__Color($value)};}
for my$value("15em", "1.5em", "junk15em", "0", "bad", "15bogus", "-5px", "0em") {push@rows,{name=>"multiply",input=>$value,value=>S2::Builtin::LJ::string__css_multiply_length(undef,$value,2)};}
{
 my $ctx=S2::make_context(980001,980002,980004);
 my $props=$ctx->[S2::PROPS];
 my $before=defined $props->{color_footer_background};
 my $css=S2::run_function($ctx,'generate_color_css(Color,Color,Color)',
     $props->{color_footer_background},$props->{color_footer_background},$props->{color_footer_background});
 my $empty=S2::Builtin::LJ::Color__Color('');
 push @rows,{name=>'absent-color',before=>0+$before,after=>0+(defined $props->{color_footer_background}),
     css=>$css,emptyDefined=>0+(defined $empty),emptyString=>$empty->{as_string},
     fallback=>(defined $props->{color_footer_background})?$props->{color_footer_background}:$props->{color_page_background}};
}
{
 no warnings qw(redefine once);
 local *LJ::User::journal_base=sub {'https://app.invalid/~'.$_[0]->user};
 local *LJ::Hooks::are_hooks=sub {0};
 local %LJ::CAP=();local %LJ::CAP_DEF=(staff_headicon=>0,readonly=>0,avoid_readonly=>0);
 local %LJ::READONLY_CLUSTER=();local %LJ::READONLY_CLUSTER_ADVISORY=();
 local $LJ::IMGPREFIX='/img';
 my $user;
 local *LJ::load_user=sub {$_[0] eq 'zvi'?$user:undef};
 for my $state('missing','V','S') {
  $user=$state eq 'missing'?undef:bless({userid=>900003,user=>'zvi',name=>'Public credit',clusterid=>0,
      status=>'N',statusvis=>$state,journaltype=>'P',caps=>0},'LJ::User');
  my $lite=S2::Builtin::LJ::UserLite(undef,'zvi');
  push @rows,{name=>'credit',state=>$state,defined=>0+(defined $lite),
      rendered=>defined($lite)?S2::Builtin::LJ::UserLite__ljuser(undef,$lite):'zvi'};
 }
}
{
 $compiler=S2::Compiler->new({checker=>S2::Checker->new});
 compile(readfile("$ENV{LJHOME}/styles/core2.s2"),'core',990001,'core');
 my$layout=readfile("$ENV{LJHOME}/styles/easyread/layout.s2");
 compile($layout,'layout',990002,'easyread');
 my$all=readfile("$ENV{LJHOME}/styles/easyread/themes.s2");
 my($source)=$all=~m{#NEWLAYER: easyread/aqua\n(.*?)(?=\n#NEWLAYER:|\z)}s;
 die 'Missing Aqua' unless defined$source;
 compile($source,'theme',990003,'aqua');
 for my$case(['absent',undef,undef],['present','Georgia','#123456'],['empty','','']) {
  for my$view(qw(recent entry)) {
   my($name,$font,$color)=@$case;my$ctx=S2::make_context(990001,990002,990003);
   $ctx->[S2::PROPS]->{font_base}=$font if defined$font;
   $ctx->[S2::PROPS]->{color_page_background}=S2::Builtin::LJ::Color__Color($color) if defined$color;
   S2::run_code($ctx,'prop_init()');LJ::S2::escape_all_props($ctx,[990001,990002,990003]);
   my$css='';S2::set_output(sub{$css.=($_[0]//'')});S2::set_output_safe(sub{$css.=($_[0]//'')});
   for my$fn(qw(Page::print_contextual_stylesheet() Page::print_default_stylesheet() print_stylesheet() Page::print_theme_stylesheet())) {
    S2::run_code($ctx,$fn,{_type=>$view eq'entry'?'EntryPage':'RecentPage',view=>$view});
   }
   push@rows,{name=>'easyread',control=>$name,view=>$view,css=>$css,source=>$source,layoutSource=>$layout};
  }
 }
}
{
 my @keys=map {my $module=$_;map {"module_${module}_$_"} qw(show order section)} qw(userprofile links pagesummary calendar);
 push @keys,'module_tags_section';
 my $source='layerinfo type = "user"; '.join(' ',map {'set '.$_.' = '.(/_show$/?'true':/_order$/?'8':'"two"').';'} @keys).' set module_links_order = 9;';
 my $output='';
 $compiler->compile_source({source=>\$source,type=>'user',layerid=>990004,output=>\$output,format=>'perl',builtinPackage=>'S2::Builtin::LJ'});
 S2::load_layer(990004,$output,123);
 for my $layout(qw(tabula easyread)) {
  my @layers=$layout eq 'tabula'?(980001,980002,980003,990004):(990001,990002,990003,990004);
  my $ctx=S2::make_context(@layers);
  push @rows,{name=>'module-properties',layout=>$layout,compiled=>$output,values=>{map {$_=>$ctx->[S2::PROPS]->{$_}} @keys}};
  for my $case(qw(collision none empty-negative none-negative seeded-negative credit-slot)) {
   my $ctx=S2::make_context(@layers);my $p=$ctx->[S2::PROPS];
   for my $key(keys %$p){$p->{$key}=0 if $key=~/^module_.*_show$/;}
   $p->{module_sections}={one=>[],two=>[],none=>[]};
   $p->{module_userprofile_show}=1;$p->{module_userprofile_section}=$case=~/^none/?'none':'one';
   $p->{module_userprofile_order}=$case=~/negative/?-1:2;
   if($case eq 'seeded-negative'){$p->{module_sections}{one}=[['seed'],['seed']];}
   if($case eq 'collision'){$p->{module_links_show}=1;$p->{module_links_section}='one';$p->{module_links_order}=2;}
   if($case eq 'credit-slot'){$p->{module_userprofile_show}=0;$p->{module_links_show}=1;$p->{module_links_section}=$p->{module_credit_section};$p->{module_links_order}=$p->{module_credit_order};$p->{module_credit_show}=1;}
   my $error='';eval {S2::run_code($ctx,'modules_init()');1} or $error=$@;
   push @rows,{name=>'module-placement',layout=>$layout,case=>$case,sections=>$p->{module_sections},error=>$error};
  }
 }
}
{
 my @names=qw(module_heading module_text journal_title journal_subtitle entry_title comment_title);
 my @families=('Georgia','', 'Verdana','', 'Courier New','Times New Roman');
 my @sizes=('1.25','','2','1.5','120','');my @units=('em','px','em','','%','pt');
 my $source='layerinfo type = "user";';
 for my $i(0..$#names){my $key='font_'.$names[$i];$source.=" set $key = \"$families[$i]\"; set ${key}_size = \"$sizes[$i]\"; set ${key}_units = \"$units[$i]\";";}
 my $output='';$compiler->compile_source({source=>\$source,type=>'user',layerid=>990006,output=>\$output,format=>'perl',builtinPackage=>'S2::Builtin::LJ'});
 S2::load_layer(990006,$output,123);
 for my $layout(qw(tabula easyread)) {
  my @layers=$layout eq 'tabula'?(980001,980002,980003,990006):(990001,990002,990003,990006);
  my $ctx=S2::make_context(@layers);
  push @rows,{name=>'typography',layout=>$layout,compiled=>$output,values=>{map {my $key='font_'.$_;map {my $k=$key.$_;($k=>$ctx->[S2::PROPS]->{$k})} ('','_size','_units')} @names}};
  for my $view(qw(recent entry)) {
   my $ctx=S2::make_context(@layers);S2::run_code($ctx,'prop_init()');LJ::S2::escape_all_props($ctx,\@layers);
   my $css='';S2::set_output(sub{$css.=$_[0]});S2::set_output_safe(sub{$css.=$_[0]});
   for my $fn(qw(Page::print_contextual_stylesheet() Page::print_default_stylesheet() print_stylesheet() Page::print_theme_stylesheet())){S2::run_code($ctx,$fn,{_type=>$view eq 'entry'?'EntryPage':'RecentPage',view=>$view});}
   push @rows,{name=>'typography-css',layout=>$layout,view=>$view,css=>$css};
  }
 }
 my $ctx=S2::make_context(980001,980002,980003);
 for my $case(['specific','Specific','Base','serif','1.25','em'],['inherit','','Base','serif','','em'],['fallback','','','serif','2',''],['empty','','','','',''],['not-emitted','Base','','','1px;color:red',''],['emitted-injection','Base','','','1px;color:red','px']) {
  my($name,@args)=@$case;push @rows,{name=>'typography-helper',case=>$name,args=>\@args,output=>S2::run_function($ctx,'generate_font_css(string,string,string,string,string)',@args)};
 }
}
{
 my $source='layerinfo type = "user"; set font_fallback = "serif"; set font_base_size = "1.25"; set font_base_units = "em";';
 my $output='';$compiler->compile_source({source=>\$source,type=>'user',layerid=>990007,output=>\$output,format=>'perl',builtinPackage=>'S2::Builtin::LJ'});
 S2::load_layer(990007,$output,123);
 for my $case(['family-size','serif','1.25'],['family-only','serif',''],['size-only','','1.25'],['neither','',''],['tabula-control','serif','1.25']) {
  my($name,$fallback,$size)=@$case;
  my @layers=$name eq 'tabula-control'?(980001,980002,980003,990007):(990001,990002,990003,990007);
  my $ctx=S2::make_context(@layers);my $p=$ctx->[S2::PROPS];
  $p->{font_base}='';$p->{font_fallback}=$fallback;$p->{font_base_size}=$size;
  S2::run_code($ctx,'prop_init()');LJ::S2::escape_all_props($ctx,\@layers);
  my $css='';S2::set_output(sub{$css.=$_[0]});S2::set_output_safe(sub{$css.=$_[0]});
  for my $fn(qw(Page::print_contextual_stylesheet() Page::print_default_stylesheet() print_stylesheet() Page::print_theme_stylesheet())){S2::run_code($ctx,$fn,{_type=>'RecentPage',view=>'recent'});}
  push @rows,{name=>'base-typography',case=>$name,compiled=>$output,css=>$css,
   pageFont=>S2::run_function($ctx,'generate_font_css(string,string,string,string)',map{$p->{$_}}qw(font_base font_fallback font_base_size font_base_units))};
 }
}
print JSON::PP->new->canonical->utf8->encode(\@rows);

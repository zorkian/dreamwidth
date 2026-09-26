#!/usr/bin/perl
# tags-native.pl
#
# Retained tag helpers with explicit bounded taxonomy and association inputs.
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
use lib "$ENV{LJHOME}/cgi-bin";
require 'ljlib.pl';
use LJ::Tags;
use LJ::S2;
use Encode qw(encode decode FB_CROAK);
use JSON::PP;
my $u = bless {userid=>11,clusterid=>7,user=>'ordinary_tag'}, 'LJ::User';
my @queries;
{
 package TagProbeDB;
 sub selectall_arrayref {
  my ($self,$query)=@_;
  die 'Unexpected query' unless $query =~ /^SELECT journalid, jitemid, kwid FROM logtags WHERE \(journalid = 11 AND jitemid IN \(300\)\)$/;
  push @{$self->{queries}},$query;
  return [[11,300,1],[11,300,2],[11,300,3]];
 }
 sub err {0}
}
my $taxonomy = sub {
 return {11=>{
  1=>{name=>'public',display=>1,security_level=>'public',uses=>10,security=>{public=>3,private=>7}},
  2=>{name=>'private-summary-public-association',display=>1,security_level=>'private',uses=>4,security=>{public=>0,private=>4}},
  3=>{name=>'display-off',display=>0,security_level=>'public',uses=>2,security=>{public=>2,private=>0}},
  4=>{name=>'NEVER_PROJECT_PRIVATE_TAXONOMY',display=>1,security_level=>'private',uses=>3,security=>{public=>0,private=>3}},
 }};
};
my (%result,@urls,@hooks);
{
 no warnings qw(redefine once);
 local *DBI::connect = sub {die 'Unexpected real DB connection'};
 local *LJ::want_user = sub {$u};
 local *LJ::User::journal_base = sub {'https://app.synthetic.invalid/~ordinary_tag'};
 local *LJ::is_enabled = sub {1};
 local *LJ::Tags::get_usertagsmulti = $taxonomy;
 local *LJ::MemCache::get_multi = sub {{}};
 local *LJ::MemCache::add = sub {1};
 local *LJ::get_cluster_master = sub {die 'Unexpected cluster' unless $_[0]==7; bless {queries=>\@queries},'TagProbeDB'};
 my $public = LJ::Tags::get_usertags($u,{remote=>undef});
 $result{anonymousTaxonomyIds} = [sort {$a<=>$b} keys %$public];
 $result{sidebar} = [map {LJ::S2::TagDetail($u,$_,$public->{$_},{remote=>undef})}
  grep {$public->{$_}->{display}} sort {$a<=>$b} keys %$public];
 my $selected = LJ::Tags::get_logtagsmulti({7=>[[11,300]]});
 $result{selectedAssociations} = $selected;
 local *LJ::Hooks::run_hooks = sub {push @hooks,$_[0]};
 my $list=[];
 LJ::S2::TagList($selected->{'11 300'},$u,300,{enable_tags_compatibility=>0},$list);
 $result{selectedTagObjects}=$list;
 for my $name ('a b','a/b','a\\b','a+b','&entity;',"caf\x{e9}","\x{e000}","\x{1f600}") {
  for my $representation ('native-db-bytes','unicode-scalar') {
   my $input = $representation eq 'native-db-bytes' ? encode('UTF-8',$name) : $name;
   my $tag=LJ::S2::Tag($u,9,$input);
   my $escapedBytes=utf8::is_utf8($tag->{name}) ? encode('UTF-8',$tag->{name}) : $tag->{name};
   push @urls,{input=>$name,representation=>$representation,sourceUtf8Flag=>utf8::is_utf8($input)?JSON::PP::true:JSON::PP::false,
    url=>$tag->{url},escapedNameHex=>unpack('H*',$escapedBytes)};
  }
 }
 my @names = map {LJ::S2::Tag($u,$_+1,encode('UTF-8',('z',"\x{1f600}","\x{e000}",'&')[ $_ ]))} 0..3;
 $result{byteSortedNamesHex}=[map {unpack('H*',$_->{name})} sort {$a->{name} cmp $b->{name}} @names];
 {
  local *LJ::is_enabled = sub {0};
  local *LJ::Hooks::run_hooks = sub {
   my ($hook,%args)=@_;
   push @hooks,$hook;
   push @{$args{tag_list}},{_type=>'Tag',name=>'HOOK_WHILE_DISABLED',url=>'https://app.synthetic.invalid/hook'};
  };
  my $disabled=LJ::Tags::get_logtagsmulti({7=>[[11,300]]});
  my $disabledList=[];
  my $text=LJ::S2::TagList($disabled->{'11 300'},$u,300,{enable_tags_compatibility=>0},$disabledList);
  $result{disabledTagInput}=$disabled;
  $result{disabledHookTagList}=$disabledList;
  $result{disabledCompatibilityText}=$text;
 }
}
{
 package TagMaskDB;
 sub err {0}
 sub selectall_arrayref {
  my ($self,$query)=@_;
  return [map {[11,$_,"mask$_"]} 1..5] if $query eq 'SELECT userid, kwid, keyword FROM userkeywords WHERE userid IN (11)';
  return [map {[11,$_,undef,1]} 1..5] if $query eq 'SELECT journalid, kwid, parentkwid, display FROM usertags WHERE journalid IN (11)';
  return [[11,1,9223372036854775808,0],[11,2,1,2],[11,3,2,3],[11,4,0,4],
    [11,5,9223372036854775808,5],[11,5,0,7]]
    if $query eq 'SELECT journalid, kwid, security, entryct FROM logkwsum WHERE journalid IN (11)';
  die 'Unexpected mask query';
 }
 package TagProbeCache;
 sub set {1}
}
{
 no warnings qw(redefine once);
 local *DBI::connect=sub {die 'Unexpected real DB'};
 local *LJ::get_cluster_def_reader=sub {bless {},'TagMaskDB'};
 local *LJ::MemCache::get_multi=sub {{}};
 local *LJ::MemCache::add=sub {1};
 local *DW::Cache::request=sub {bless {},'TagProbeCache'};
 $result{maskTaxonomy}=LJ::Tags::_get_usertagsmulti({},$u)->{11};
}
{
 no warnings qw(redefine once uninitialized);
 local *LJ::User::journal_base=sub {'https://app.synthetic.invalid/~ordinary_tag'};
 $result{scalars}=[map {my($kwid,$name)=@$_; {kwid=>$kwid,name=>$name,
   tag=>LJ::S2::Tag($u,$kwid,$name),
   detail=>LJ::S2::TagDetail($u,$kwid,{name=>$name,security_level=>'public',security=>{public=>0}},{remote=>undef})}}
   ([9,'0'],[0,'name'],[9,undef],[9,''])];
 local *LJ::want_user=sub {$u};local *LJ::is_enabled=sub {1};
 local *LJ::MemCache::get_multi=sub {{}};local *LJ::MemCache::add=sub {1};
 local *LJ::get_cluster_master=sub {bless {queries=>\@queries},'TagProbeDB'};
 local *LJ::Tags::get_usertagsmulti=sub {{11=>{1=>{name=>'present'},2=>{name=>undef}}}};
 $result{missingTaxonomy}=LJ::Tags::get_logtagsmulti({7=>[[11,300]]});
}
{
 no warnings qw(redefine once);
 local $LJ::S2::CURR_PAGE={_u=>$u};local *LJ::get_remote=sub {undef};
 $result{viewerCanManageTags}=S2::Builtin::LJ::viewer_can_manage_tags();
 local *LJ::User::journal_base=sub {'https://app.synthetic.invalid/~ordinary_tag'};
 $result{nativeTiedCutoff}=[map {
  my $page={_visible_tag_list=>[map {LJ::S2::TagDetail($u,$_->[0],
   {name=>$_->[1],security_level=>'public',security=>{public=>1}},{remote=>undef})} @$_]};
  [map {$_->{name}} @{S2::Builtin::LJ::Page__visible_tag_list(undef,$page,1)}]
 } ([[1,'z'],[2,'a']],[[2,'a'],[1,'z']])];
}
$result{queries}=\@queries;$result{urlRows}=\@urls;$result{hooks}=\@hooks;
print JSON::PP->new->utf8->canonical->pretty->encode(\%result);

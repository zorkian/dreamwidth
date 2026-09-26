#!/usr/bin/perl
#
# userpic-native.pl
#
# Qualify retained userpic selection and Image helper scalar behavior.
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
use JSON::PP;
require 'ljlib.pl';
require LJ::S2;
require LJ::Userpic;

# Synthetic DB rows/info at the read boundary; real retained Entry, Icons,
# Userpic.get/dimensions/labels and S2 Image helpers execute below. No writes.
my $owner = bless {userid=>900001,user=>'ordinary7',dversion=>10,defaultpicid=>11,
    status=>'A',statusvis=>'V',journaltype=>'P',clusterid=>1}, 'Slice7Owner';
my %rows = (11=>{userid=>900001,picid=>11,width=>100,height=>80,state=>'N',description=>'café & "tea"'},
    22=>{userid=>900001,picid=>22,width=>75,height=>90,state=>'N',description=>'selected'});
my $info = {pic=>{},kw=>{},mapkw=>{},map_redir=>{}};
{
    package Slice7Owner;
    our @ISA = ('LJ::User');
    sub get_userpic_info { return $info; }
    sub selectrow_hashref { return $rows{$_[-1]}; }
}
{
    package Slice7Entry;
    our @ISA = ('LJ::Entry');
    sub poster { return $owner; }
    sub prop { return $_[0]->{props}->{$_[1]}; }
}
no warnings qw(redefine once);
local *LJ::load_userid = sub { return $owner; };
local *LJ::Userpic::load_user_userpics = sub {
    return map {LJ::Userpic->new_from_row($_)} grep {$_->{state} ne 'X'} values %rows;
};
my @results;
for my $case (
    ['default',{}], ['keyword',{picture_mapid=>1}], ['missing',{picture_mapid=>9}], ['leading-map',{picture_mapid=>'01'}],
    ['redirect',{picture_mapid=>2}], ['loop',{picture_mapid=>3}],
    ['null-keyword',{picture_mapid=>5}], ['null-picture',{picture_mapid=>6}], ['pic-number',{picture_keyword=>'pic#22'},8],
    ['unknown-keyword',{picture_keyword=>'absent'},8], ['leading-pic',{picture_keyword=>'pic#022'},8], ['empty-keyword',{picture_keyword=>''},8],
    ['default-description-zero',{},10,undef,'0'], ['default-X',{},10,'X'], ['default-S',{},10,'S'], ['default-missing',{},10,'missing']) {
    LJ::Userpic->reset_singletons;
    $owner->{dversion} = $case->[2] // 10;
    $rows{11}->{state} = ($case->[3] && $case->[3] ne 'missing') ? $case->[3] : 'N';
    $rows{11}->{description} = $case->[4] // 'café & "tea"';
    my $default = delete $rows{11} if ($case->[3] // '') eq 'missing';
    $info = {pic=>{22=>$rows{22}},kw=>{chosen=>$rows{22}},
        mapkw=>{1=>'chosen',5=>'pic#22',6=>'pic#'},map_redir=>{2=>1,3=>4,4=>3}};
    my $entry = bless {props=>$case->[1]}, 'Slice7Entry';
    my ($picture,$keyword) = $entry->userpic;
    my $image = LJ::S2::Image_userpic($owner,$picture?$picture->picid:0,$keyword);
    push @results,{id=>$case->[0],picid=>$picture?$picture->picid:0,keyword=>$keyword,
        width=>$image->{width}//0,height=>$image->{height}//0,
        alt=>$image->{alttext},title=>$image->{extra}->{title},url=>$image->{url}};
    $rows{11} = $default if $default;
}
print JSON::PP->new->utf8->canonical->encode(\@results);

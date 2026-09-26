#!/usr/bin/perl
# moods-native.pl
#
# Retained mood/icon and coordinate currents on fixed synthetic native records.
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
use LJ::CleanHTML;
use DW::Mood;
use LJ::Location;
use JSON::PP;
{ package NativeFixtureDB;
sub selectall_arrayref { return $_[0]->{data} }
sub selectrow_array { return ($_[0]->{name},'', 'N',9) }
sub err {0}
}
my @rows;
no warnings qw(redefine once);
local *LJ::get_db_writer = sub { die 'No writes' };
local *LJ::MemCache::get = sub { undef };
local *LJ::MemCache::set = sub { 1 };
local $LJ::IMGPREFIX='https://app.invalid/img';
local %LJ::KNOWN_HTTPS_SITES=();
local $LJ::PROXY_URL='';
for my $case (
 ['tiepositive','0.03125,1.0',''],['tienegative','-0.03125,-1.0',''],
 ['signed', '12.34567,-45.67891',''],['hemisphere','12.34567 S,45.67891 E',''],
 ['hemispherezero','0.0 S,0.0 W',''],['hemispherezeromixed','0.0 N,0.0 W',''],
 ['zero','0.0,0.0',''],['negzero','-0.0,-0.0',''],
 ['roundednegzero','-0.00001,1.0',''],['roundedposzero','0.00001,-1.0',''],
 ['textwins','12.0,34.0','<b>Here</b>'], ['false-text','12.0,34.0','0'],
 ['malformed','bad','Here'],['range','91.0,0.0','Here'],['integer','12,34','Here'],
 ['boundary','90.0,-180.0',''],['false-coords','0','Here']) {
 my %p=(current_coords=>$case->[1],current_location=>$case->[2]);
 my %c=LJ::currents(\%p,undef);
 push @rows,{kind=>'location',id=>$case->[0],props=>\%p,currents=>\%c};
}
for my $case (
 ['direct','Happy',1,'Theme','https://img.invalid/h.png',0],
 ['custom','<b>Custom</b>',1,'Theme','https://img.invalid/h.png',0],
 ['cleanedzero','<font>0</font>',1,'Theme','https://img.invalid/h.png',0],
 ['cleanedempty','<script>x</script>',1,'Theme','https://img.invalid/h.png',0],
 ['inherited','',2,'Theme','/img/h.png',0],
 ['relative','',1,'Theme','/other/h.png',0],
 ['invalidurl','',1,'Theme','javascript:x',0],
 ['missingmood','',99,'Theme','https://img.invalid/h.png',0],
 ['missingtheme','',1,undef,'https://img.invalid/h.png',0],
 ['falsetheme','',1,'0','https://img.invalid/h.png',0],
 ['themazero','',1,'Theme','https://img.invalid/h.png',1],
 ['cycle','',3,'Theme','https://img.invalid/h.png',0]) {
 local $LJ::CACHED_MOODS=1;
 local %LJ::CACHE_MOODS=(1=>{name=>'Happy',parent=>0},2=>{name=>'Child',parent=>1},3=>{name=>'Cycle',parent=>4},4=>{name=>'Cycle2',parent=>3});
 local %LJ::CACHE_MOOD_THEME=();
 my $db=bless {name=>$case->[3],data=>[[1,$case->[4],0,16]]},'NativeFixtureDB';
 local *LJ::get_db_reader=sub {$db};
 my %p=(current_mood=>$case->[1],current_moodid=>$case->[2]);
 my $u={moodthemeid=>$case->[5]?0:7};
 my ($icon,%c,$error);
 eval { local $SIG{ALRM}=sub {die 'NATIVE_CYCLE_TIMEOUT'}; alarm 1;
 %c=LJ::currents(\%p,$u,{s2imgref=>\$icon}); alarm 0; 1 } or $error=$@;
 alarm 0;
 push @rows,{kind=>'mood',id=>$case->[0],props=>\%p,themeName=>$case->[3],currents=>\%c,icon=>$icon,error=>$error};
}
print JSON::PP->new->canonical->utf8->encode(\@rows);

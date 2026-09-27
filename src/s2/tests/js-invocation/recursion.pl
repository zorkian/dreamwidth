#!/usr/bin/perl
# recursion.pl
#
# Fixed native recursive call-site families under a controlled open liveness window.
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

use strict;use warnings;
use FindBin;use lib "$FindBin::Bin/../..";
use S2;use S2::Compiler;use S2::Checker;use JSON::PP;use MIME::Base64 qw(encode_base64);
my @cases=(
 ['simple',q{layerinfo type=core; function f(int n):int { if($n==0){return 0;} return f($n-1); } function main(){print f(100);}}],
 ['alternating',q{layerinfo type=core; function f(int n):int { if($n==0){return 0;} if($n%2==0){return f($n-1);} else {return f($n-1);} } function main(){print f(100);}}],
 ['same_line',q{layerinfo type=core; function f(int n):int { if($n==0){return 0;} return f($n-1)+f($n-1); } function main(){print f(100);}}],
 ['reentry',q{layerinfo type=core;function builtin host(int n):int;function helper(int n):int {return $n;} function main(){print host(1);print host(2);}}],
 ['super',q{layerinfo type=core; class Base { function f(int n):int; } class Child extends Base {} function Base::f(int n):int {if($n==0){return 0;}return $this->f($n-1);} function main(){var Base x=new Child;print $x->f(100);}},q{layerinfo type=layout;function Child::f(int n):int {return $super->f($n);}}],

);
{no warnings 'redefine'; *Time::HiRes::time=sub () {1000};}
my $original=\&S2::check_depth;my(@rows,@samples);my $serial=700;
{no warnings 'redefine'; *S2::check_depth=sub {my @frames;for(my $i=0;$i<200;$i++){my @f=caller($i);last unless @f;push @frames,{file=>$f[1],line=>$f[2],sub=>$f[3]};}push @samples,{counter=>$S2::sub_ctr,frames=>\@frames};$original->();};
 *S2::Builtin::LJ::host=sub{my($ctx,$n)=@_;push @samples,{beforeHost=>$S2::sub_ctr};my $v=S2::run_function($ctx,'helper(int)',$n);push @samples,{afterHost=>$S2::sub_ctr};return $v;};}
for my $case(@cases){@samples=();my($name,@sources)=@$case;my @code;my @ids;my $compiler=S2::Compiler->new({checker=>S2::Checker->new});
 for my $i(0..$#sources){my $src=$sources[$i];my $out='';my$id=++$serial;$compiler->compile_source({type=>$i?'layout':'core',source=>\$src,output=>\$out,layerid=>$id,untrusted=>$i,builtinPackage=>'S2::Builtin::LJ'});push@ids,$id;push@code,$out;S2::load_layer($id,$out);}
 my$ctx=S2::make_context(@ids);my$output='';S2::set_output(sub{$output.=$_[0]});S2::set_output_safe(sub{$output.=$_[0]});local$S2::MAX_RECURSION=8;my$ok=eval{S2::run_code($ctx,'main()');1};my$error=$@;
 push@rows,{case=>$name,sources=>[map {encode_base64($_,'')} @sources],ids=>\@ids,compiled=>[map {encode_base64($_,'')} @code],ok=>$ok?1:0,error=>$error,output=>$output,samples=>[@samples]};
}
print JSON::PP->new->canonical->pretty->encode(\@rows);

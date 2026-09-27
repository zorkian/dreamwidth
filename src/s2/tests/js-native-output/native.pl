#!/usr/bin/perl
# native.pl
#
# Independent native page output for fixed trusted bridge programs.
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
my $root="$FindBin::Bin/../../../..";
use lib "$FindBin::Bin/../..","$FindBin::Bin/../../../../cgi-bin";
use S2;
use HTMLCleaner;
use LJ::CSS::Cleaner;
use Encode qw(decode);
sub octets {use bytes;return substr($_[0],0)}
use MIME::Base64 qw(encode_base64);
use JSON::PP;
sub source {open my $f,'<:raw',shift or die;local $/;return <$f>}
my $s=source("$root/cgi-bin/LJ/S2.pm");
my ($run)=$s=~/(sub s2_run \{.*?\n\})\n\n# <LJFUNC>/s;
my ($css)=$s=~/(sub start_css \{.*?\n\})\n\nsub alternate/s;
die 'Fixed source extraction failed' unless $run && $css;
# Evaluate only fixed retained module source, never persisted generated code.
eval "package LJ::S2; $run";die $@ if $@;
eval "package S2::Builtin::LJ; $css";die $@ if $@;
my $web=source("$root/cgi-bin/LJ/Web.pm");
my ($valid)=$web=~/(sub valid_stylesheet_url \{.*?\n\})\n\n# <LJFUNC>/s;
eval "package LJ; $valid";die $@ if $@;
{no warnings 'redefine';
 *LJ::is_enabled=sub {1};
 my $textutil=source("$root/cgi-bin/LJ/TextUtil.pm");
 my ($eurl)=$textutil=~/(sub eurl \{.*?\n\})\n\n# <LJFUNC>/s;
 die 'Fixed eurl source extraction failed' unless $eurl;
 eval "package LJ; $eurl";die $@ if $@;
 *LJ::Hooks::run_hook=sub {return};

}
$LJ::DOMAIN='example.org';$LJ::DOMAIN_WEB='www.example.org';$LJ::STATPREFIX='https://static.example.org';
$LJ::TRUSTED_CSS_HOST{'trusted.test'}=1;
use S2::Compiler;
use S2::Checker;
{ no warnings 'redefine';
 *LJ::get_dbh=sub {die 'DB forbidden'};
 *LJ::get_cluster_master=sub {die 'DB forbidden'};
}
my $compiler=S2::Compiler->new({checker=>S2::Checker->new});
my (@sources,@codes);
for my $spec (['program.s2','core',101,0],['override.s2','layout',102,1]) {
 my $bytes=source("$FindBin::Bin/$spec->[0]");my $code='';my $copy=$bytes;
 $compiler->compile_source({type=>$spec->[1],source=>\$copy,output=>\$code,layerid=>$spec->[2],untrusted=>$spec->[3],builtinPackage=>'S2::Builtin'});
 push @sources,$bytes;push @codes,$code;S2::load_layer($spec->[2],$code);
}
my $ctx=S2::make_context(101,102);my $output='';local $LJ::S2::ret_ref=\$output;
my $ok=LJ::S2::s2_run(undef,$ctx,{contenttype=>'text/html'},'main()',{});
my @errors;
{ no warnings 'redefine';
 *S2::run_code=sub {my ($ctx)=@_;for my $op (@{$ctx->[S2::SCRATCH]{trace}}) {
  if($op->[0] eq 'safe'){$S2::pout_s->($op->[1])}
  elsif($op->[0] eq 'start'){S2::Builtin::LJ::start_css($ctx)}
 }die "fixed failure\n";};
}
for my $spec (['pending','text/html',[['safe','<a href="tail']]],
 ['nested','text/html',[['start'],['start'],['safe','p{color:red}']]],
 ['css','text/css',[['safe','p{color:red}']]]) {
 my ($id,$ctype,$trace)=@$spec;my $out='';local $LJ::S2::ret_ref=\$out;
 my $context=[];$context->[S2::SCRATCH]={trace=>$trace};
 my $success=LJ::S2::s2_run(undef,$context,{contenttype=>$ctype},'error',{});
 push @errors,{id=>$id,ctype=>$ctype,ok=>$success,base64=>encode_base64(octets($out),''),flag=>utf8::is_utf8($out)?1:0};
}
print JSON::PP->new->canonical->encode({sources=>[map{encode_base64($_,'')}@sources],codes=>[map{encode_base64(octets($_),'')}@codes],ok=>$ok,base64=>encode_base64(octets($output),''),flag=>utf8::is_utf8($output)?1:0,errors=>\@errors});

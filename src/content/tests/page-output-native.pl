#!/usr/bin/perl
# page-output-native.pl
#
# Independent retained-source page output traces from fixed trusted actions.
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
my $root="$FindBin::Bin/../../..";
use lib "$FindBin::Bin/../../../src/s2","$FindBin::Bin/../../../cgi-bin";
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
 *S2::run_code=sub {my ($ctx)=@_;for my $op (@{$ctx->[S2::SCRATCH]{trace}}) {
    if($op->[0] eq 'safe'){$S2::pout_s->($op->[1])}
    elsif($op->[0] eq 'raw'){S2::pout($op->[1])}
    elsif($op->[0] eq 'start'){S2::Builtin::LJ::start_css($ctx)}
    elsif($op->[0] eq 'end'){S2::Builtin::LJ::end_css($ctx)}
 }};
}
$LJ::DOMAIN='example.org';$LJ::DOMAIN_WEB='www.example.org';$LJ::STATPREFIX='https://static.example.org';
$LJ::TRUSTED_CSS_HOST{'trusted.test'}=1;
my @cases=(
 ['duplicate',['safe','<p a="first" a="last" A="upper">x</p>']],
 ['entity_edge',['safe','<a href="&amp; &#128; &notit;">x &amp; y</a>']],
 ['newline_edge',['safe',"<p a=\"a\r"],['safe',"\nb\">x\r"],['safe',"\ny</p>"]],
 ['weird_edge',['safe','<foo/bar>x</foo/bar>']],
 ['tag',['safe','<b'],['safe','>one</b>']],
 ['attr',['safe','<a href="java'],['safe','script:bad">x</a>']],
 ['entity',['safe','A &am'],['safe','p; B']],
 ['raw_between_text',['safe','first'],['raw','<hr>'],['safe','last']],
 ['raw_between_attr',['safe','<a href="https://exa'],['raw','RAW'],['safe','mple.org/">x</a>']],
 ['end_flush',['safe','<b incomplete']],
 ['eat',['safe','<scr'],['safe','ipt>bad</script><p>good</p>']],
 ['style',['safe','<style>p{col'],['safe','or:red}</style>']],
 ['links',['safe','<link rel="stylesheet" href="https://trusted.test/a.css"><link rel="stylesheet" href="https://other.test/a.css"><link rel="stylesheet" href="https://example.org/res/1/stylesheet">']],
 ['css_nested',['safe','before'],['start'],['raw','p{color:'],['start'],['safe','red}'],['end'],['raw','b{color:blue}'],['end'],['safe','after']],
 ['plain',['safe','<script>literal</script>']],
 ['css_ctype',['safe','p{color:red}']],
);
for my $tag(qw(script style xmp plaintext textarea title iframe noembed noframes listing pre comment)) {
 push @cases,["literal_$tag",['safe',"<$tag>left<b>&amp;</b>right</$tag><p>end</p>"]];
}
for my $close ('</XMP>',"</xmp >",'</xmpfoo>','</xmp junk>','</xmp/>') {
 push @cases,["close_$close",['safe',"<xmp>one$close<p>end</p>"]];
}
push @cases,['close_quoted',['safe','<xmp><a href="fake</xmp><p>end</p>']];
push @cases,['close_split',['safe','<xmp>one</xm'],['safe','p><p>end</p>']];
push @cases,['unknown_entity',['safe','<a href="javascript&colon;bad" title="&#106;avascript:bad">x</a>']];
push @cases,['generic_tags',['safe','<table id="x"><tr><td class="ordinary" style="font-family:serif">text</td></tr></table><custom data-x="value">kept</custom>']];
push @cases,['active_attrs',['safe','<input type="password" onclick="bad" datasrc="bad"><meta http-equiv="refresh" content="bad"><a href="&#106;ava&#115;cript:bad" title="safe">x</a>']];
push @cases,['doctype',['safe','<!DOCTYPE html PUBLIC "a  b">']];
push @cases,['comment_pi',['safe','before<!-- hidden --><?private x?>after']];
push @cases,['proxy_link',['safe','<link rel="stylesheet" href="http://other.test/a.css?x=a b&amp;y=2">']];
push @cases,['flagged_raw',['raw',decode('UTF-8',"\xc3\xa9")]];
push @cases,['mixed_raw',['raw',"\xe9"],['raw',decode('UTF-8',"\xc3\xa9")]];
push @cases,['flagged_css',['raw',"\xe9"],['start'],['raw',decode('UTF-8',"p{content:\"\xc3\xa9\"}")],['end']];
my @rows;
for my $case (@cases) {
 my ($id,@trace)=@$case;my $out='';local $LJ::S2::ret_ref=\$out;
 my $ctx=[];$ctx->[S2::SCRATCH]={trace=>\@trace};
 my $ctype=$id eq 'plain'?'text/plain':$id eq 'css_ctype'?'text/css':'text/html';
 local $LJ::CSSPROXY=$id eq 'proxy_link' ? 'https://css.test/proxy' : undef;
 my $ok=LJ::S2::s2_run(undef,$ctx,{contenttype=>$ctype},'trace',{});
 push @rows,{id=>$id,ctype=>$ctype,cssProxy=>$LJ::CSSPROXY,flag=>utf8::is_utf8($out)?1:0,ok=>$ok,base64=>encode_base64(octets($out),''),trace=>[map {[$_->[0],defined($_->[1])?encode_base64(octets($_->[1]),''):undef,defined($_->[1])&&utf8::is_utf8($_->[1])?1:0]} @trace]};
}
print JSON::PP->new->canonical->pretty->encode(\@rows);

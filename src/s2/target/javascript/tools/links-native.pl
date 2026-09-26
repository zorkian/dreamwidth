#!/usr/bin/perl
# links-native.pl
#
# Retained scalar streaming oracle for stock website and link module attributes.
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
use HTMLCleaner;
use LJ::S2;
use JSON::PP;
use Encode qw(encode decode FB_CROAK);
use Digest::SHA qw(sha256_hex);
my @cases = (
 [amp=>'https://target.synthetic.invalid/p?x=1&y=2','A & B'],
 [quot=>'https://target.synthetic.invalid/p?q="tea"','A "quote"'],
 [ltgt=>'https://target.synthetic.invalid/p?q=<tag>','A <tag>'],
 [apos=>"https://target.synthetic.invalid/p?q='tea'","A 'apostrophe'"],
 ['literal-amp'=>'https://target.synthetic.invalid/p?q=&amp;y=2','literal &amp;'],
 ['literal-numeric'=>'https://target.synthetic.invalid/p?q=&#39;','literal &#39;'],
 [relative=>'/relative/a?x=1&y=2','relative'],
 [query=>'?q=1&term=two','query'],
 [fragment=>'#part','fragment'],
 [javascript=>'javascript:globalThis.PROBE_ACTIVE=1','active'],
 ['spaced-script'=>" \tjava\nscript:globalThis.PROBE_ACTIVE=1",'control'],
 ['nul-script'=>"java\0script:globalThis.PROBE_ACTIVE=1",'NUL'],
 [vbscript=>'vbscript:msgbox(1)','active'],
 [about=>'about:blank','about'],
 [data=>'data:text/html,<svg onload="globalThis.PROBE_ACTIVE=1">','data'],
 ['title-scheme'=>'https://target.synthetic.invalid/p','About: JavaScript:'],
);
my @rows;
for my $case (@cases) {
 my ($id,$url,$hover)=@$case;
 my $input='<li class="module-list-item"><a href="'.LJ::ehtml($url).'" title="'.LJ::ehtml($hover).'">Link</a></li>' . "\n";
 my @parts;my $cleaner=HTMLCleaner->new(output=>sub{push @parts,$_[0]},valid_stylesheet=>sub{1});
 $cleaner->parse(encode('UTF-8',$input));
 my $before_flush=join('',@parts);
 $cleaner->parse('<!-- -->');$cleaner->eof;
 my $output=join('',@parts);
 push @rows,{id=>$id,url=>$url,hover=>$hover,input=>$input,
   beforeFlush=>decode('UTF-8',$before_flush,FB_CROAK),output=>decode('UTF-8',$output,FB_CROAK),
   inputSha256=>sha256_hex(encode('UTF-8',$input)),outputSha256=>sha256_hex(join('',@parts))};
}
my @links = (
    {ordernum=>2,title=>'second',url=>'/relative?q=1&x=2',hover=>undef},
    {ordernum=>1,title=>'heading',url=>undef,hover=>undef},
    {ordernum=>2,title=>'tie',url=>'?q=&#39;',hover=>q{A 'quote' & tea}},
    {ordernum=>3,title=>'-',url=>'0',hover=>undef},
);
my @objects = map { LJ::S2::UserLink($_) } sort {$a->{ordernum}<=>$b->{ordernum}} @links;
print JSON::PP->new->utf8->canonical->pretty->encode({schema=>1,objects=>\@objects,
 provenance=>'LJ::ehtml + HTMLCleaner utf8_mode1; parse safe chunk then native s2_run comment flush + EOF; no DB calls',rows=>\@rows});

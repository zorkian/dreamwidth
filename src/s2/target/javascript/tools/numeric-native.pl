#!/usr/bin/perl
# numeric-native.pl
#
# Raw independent native oracle for the maintained synthetic scalar source.
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
use Config;
use JSON::PP;
use B;
my @rows;
sub row {
    my ($id,$run)=@_;
    my @warnings;
    local $SIG{__WARN__}=sub {push @warnings,shift};
    my ($value,$error);
    eval {$value=$run->();1} or $error=$@;
    my $flags=defined($value) ? B::svref_2object(\$value)->FLAGS : 0;
    push @rows,{id=>$id,text=>defined($value)?"$value":undef,flags=>$flags,iok=>($flags & B::SVf_IOK)?1:0,nok=>($flags & B::SVf_NOK)?1:0,isUV=>($flags & B::SVf_IVisUV)?1:0,error=>$error,warnings=>\@warnings};
}
row('literal53',sub {9007199254740993});
row('product53',sub {94906267*94906267});
row('ivmax_add1',sub {my $x=9223372036854775807;$x+1});
row('uvmax',sub {18446744073709551615});
row('uvmax_add1',sub {my $x=18446744073709551615;$x+1});
row('uvmax_inc',sub {my $x=18446744073709551615;++$x});
row('ivmin_sub1',sub {my $x=-9223372036854775808;$x-1});
row('uvmax_mul2',sub {my $x=18446744073709551615;$x*2});
row('wide_div1',sub {my $x=9007199254740993;my $d=1;int($x/$d)});
row('wide_div3',sub {my $x=9007199254740993;my $d=3;int($x/$d)});
row('wide_div2',sub {my $x=9007199254740993;my $d=2;int($x/$d)});
row('wide_div_negative',sub {my $x=-9007199254740993;my $d=2;int($x/$d)});
row('ivmax_div3',sub {my $x=9223372036854775807;my $d=3;int($x/$d)});
row('neg_div',sub {int(-7/3)});
row('neg_mod',sub {-7%3});
row('negative_divisor_mod',sub {7%-3});
row('wide_mod',sub {9007199254740993%2});
row('wide_compare',sub {9007199254740993==9007199254740992 ? 1:0});
row('int_wide_string',sub {int('9007199254740993')});
row('int_prefix',sub {int('  -123.9tail')});
row('int_exp',sub {int('1e20')});
row('hash_wide',sub {my %h=(9007199254740993=>'a',9007199254740992=>'b');join('|',sort keys %h)});
row('array_negative',sub {my @a=('a','b');$a[-1]});
row('array_wide_read',sub {my @a=('a','b');defined($a[9007199254740993])?'defined':'undef'});

row('uv_minus_iv',sub {my $a=18446744073709551615;my $b=9223372036854775807;$a-$b});
row('iv_minus_uv',sub {my $a=9223372036854775807;my $b=18446744073709551615;$a-$b});
row('uv_cancel_negative',sub {my $a=18446744073709551615;my $b=-9223372036854775808;$a+$b});
row('ivmin_negate',sub {my $a=-9223372036854775808;-$a});
row('uv_negate',sub {my $a=18446744073709551615;-$a});
row('nv_recovered_integer',sub {my $a=9223372036854775807;my $v=$a+1.0; $v-1});
row('mod_nv_fraction',sub {my $a=7.9;my $b=3.2;$a%$b});
row('mod_nv_outside',sub {my $a=1e20;my $b=3;$a%$b});
row('int_uv_string',sub {int('18446744073709551615')});
row('int_over_uv_string',sub {int('18446744073709551616')});
row('int_hex_string',sub {int('0x10')});
row('int_no_prefix',sub {int('hello')});
row('int_small_exp',sub {int('1e3')});
row('int_inf',sub {int('Inf')});
row('int_nan',sub {int('NaN')});
row('nv_small_general',sub {my $a=1;my $b=3; $a/$b});
row('nv_fixed_boundary',sub {my $a=1e-4; $a+0.00000000000000001});
row('nv_exponent_boundary',sub {my $a=1e-5; $a+0.00000000000000001});
row('nv_negative_zero',sub {my $a=-0.0; $a});
row('mixed_uv_compare',sub {my $a=18446744073709551615;my $b=-1;$a>$b?1:0});
row('nv_wide_compare',sub {my $a=9007199254740993;my $b=9007199254740992.0;$a==$b?1:0});
row('numeric_then_original_string',sub {my $a='00123';my $b=$a+0; $a});
row('uv_array_read',sub {my @a=('a','b');defined($a[18446744073709551615])?'defined':'undef'});
row('divide_zero',sub {my $a=1;my $b=0;int($a/$b)});
row('mod_zero',sub {my $a=1;my $b=0;$a%$b});

print JSON::PP->new->canonical->pretty->encode({perl=>"$^V",ivsize=>$Config{ivsize},nvsize=>$Config{nvsize},nvtype=>$Config{nvtype},rows=>\@rows});

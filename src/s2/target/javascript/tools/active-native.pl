#!/usr/bin/perl
# active-native.pl
#
# Independent native oracle for trusted synthetic general layer fixtures.
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
use lib "$FindBin::Bin/../../..";
use S2;
use S2::Compiler;
use S2::Checker;
use Storable qw(dclone);
use MIME::Base64 qw(encode_base64);
use JSON::PP;
my %checkers;
my @layers;
my $negative = shift @ARGV // '';
die "Unknown fixture" unless $negative eq '' || $negative eq 'delete-array' || $negative eq 'delete-scalar';
for my $spec (['core',101,11,0],['layout',102,22,101],['user',103,22,102]) {
    my ($type,$id,$owner,$parent)=@$spec;
    open my $file,'<:raw',"$FindBin::Bin/../../../tests/js-replacement/$type.s2" or die $!;
    local $/;
    my $source=<$file>;
    if ($type eq 'core' && $negative) {
        $source .= $negative eq 'delete-array'
            ? 'function invalid() { var int[] data=[1]; delete $data[0]; }'
            : 'function invalid() { var string data="x"; delete $data; }';
    }
    close $file;
    my $checker=$type eq 'core'?S2::Checker->new:dclone($checkers{$parent});
    my $compiler=S2::Compiler->new({checker=>$checker});
    my $code='';
    $compiler->compile_source({type=>$type,source=>\$source,output=>\$code,layerid=>$id,
        untrusted=>$owner!=11,format=>'perl',builtinPackage=>'S2::Builtin::LJ'});
    $checkers{$id}=$checker;
    S2::load_layer($id,$code,1);
    push @layers,{id=>$id,ownerId=>$owner,parentId=>$parent,type=>$type,compiledTime=>1,
        sourceBase64=>encode_base64($source,''),activeBase64=>encode_base64($code,'')};
}
my $output='';my @safe;
S2::set_output(sub{$output.=$_[0]});
S2::set_output_safe(sub{push @safe,$_[0];$output.=$_[0]});
S2::run_code(S2::make_context(101,102,103),'main()');
my @enumerations;
for my $value ('blue','Blue','green','false','dup','empty','0','') {
    S2::register_set(103,'tone',$value);
    my $ctx=S2::make_context(101,102,103);
    push @enumerations,{input=>$value,present=>exists($ctx->[S2::PROPS]{tone})?JSON::PP::true:JSON::PP::false,
        value=>$ctx->[S2::PROPS]{tone},other=>$ctx->[S2::PROPS]{other},zero=>$ctx->[S2::PROPS]{zero}};
}
my @recursion;
for my $limit (500,50) {
    local $S2::MAX_RECURSION=$limit;
    my $value=eval {S2::run_function(S2::make_context(101,102,103),'depth(int)',120)};
    my $error=$@;
    die $error if $error && $error !~ /Excessive recursion detected and stopped/;
    push @recursion,{maxRecursion=>$limit,value=>$error?undef:$value,
        refused=>$error?JSON::PP::true:JSON::PP::false};
}
print JSON::PP->new->canonical->utf8->encode({snapshot=>{styleId=>77,systemUserId=>11,layers=>\@layers},
    output=>$output,safe=>\@safe,enumerations=>\@enumerations,recursion=>\@recursion});

#!/usr/bin/perl
# native.pl
#
# Compile fixed invocation fixtures and record actual native caller COPs.
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
use lib "$FindBin::Bin/../..";
use S2;
use S2::Compiler;
use S2::Checker;
use S2::Layer;
use S2::Tokenizer;
use S2::BackendPerl;
use S2::OutputScalar;
use Storable qw(dclone);
use JSON::PP;
use MIME::Base64 qw(encode_base64);
sub source {open my $f,'<:raw',shift or die;local $/;return <$f>}
sub octets {use bytes;return substr($_[0],0)}
my @marks;
{no warnings 'redefine';
 *S2::Builtin::LJ::mark=sub{my($ctx,$label)=@_;my@caller=caller($label =~ /^up-/ ? 1 : 0);push@marks,{label=>$label,line=>$caller[2]};return $label=~/^false/ ? 0:1;};
 *LJ::get_dbh=sub{die 'DB forbidden'};
 *LJ::get_cluster_master=sub{die 'DB forbidden'};
}
my $source=source("$FindBin::Bin/phases.s2");
my $compiler=S2::Compiler->new({checker=>S2::Checker->new});my$code='';my$copy=$source;
$compiler->compile_source({type=>'core',source=>\$copy,output=>\$code,layerid=>801,builtinPackage=>'S2::Builtin::LJ'});
my$checked=S2::Layer->new(S2::Tokenizer->new(\$source),'core');S2::Checker->new->checkLayer($checked);
my$collected='';S2::BackendPerl->new($checked,801,0)->collectNativePositions(S2::OutputScalar->new(\$collected));
# Package spelling is part of unchanged native output, including builtin calls.
my$instrumented='';my$backend=S2::BackendPerl->new($checked,801,0);$backend->setBuiltinPackage('S2::Builtin::LJ');
$backend->collectNativePositions(S2::OutputScalar->new(\$instrumented));
die 'Native byte change' unless $code eq $instrumented;
S2::load_layer(801,$code);my$ctx=S2::make_context(801);my$output='';S2::set_output(sub{$output.=$_[0]});S2::set_output_safe(sub{$output.=$_[0]});
S2::run_code($ctx,'main()');
# Trusted host reentry invokes the real native null-method semantic throw site.
my $plural = S2::get_func_num('plural()');
my $outer = S2::get_func_num('outer()');
$ctx->[S2::VTABLE]->{$plural} = sub { S2::get_object_func_num('Thing', undef, 'missing()', 801, 7, 0, $ctx) };
$ctx->[S2::VTABLE]->{$outer} = sub { S2::run_function($ctx, 'plural()') };
eval { S2::run_function($ctx, 'outer()') };
my $nested_error = $@;
print JSON::PP->new->canonical->encode({nestedError=>$nested_error,id=>801,source=>encode_base64($source,''),code=>encode_base64(octets($code),''),instrumentationUnchanged=>1,marks=>\@marks,output=>encode_base64(octets($output),'')});

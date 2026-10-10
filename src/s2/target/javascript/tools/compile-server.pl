#!/usr/bin/perl
#
# compile-server.pl
#
# Compile S2 layers to JavaScript for the journal server. Reads one JSON
# request per line on stdin and writes one JSON response per line. Checkers
# are kept so a child layer compiles against its parent without recompiling it.
#
# Request:  {"key", "parentKey", "type", "untrusted", "variable", "source"}
# Response: {"code"} or {"error"}
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../../..";
use JSON::PP;
use Storable qw(dclone);
use S2;
use S2::Checker;
use S2::Compiler;

$| = 1;

# Checkers of large layouts nest deeper than Storable's default limit.
$Storable::recursion_limit      = -1;
$Storable::recursion_limit_hash = -1;
my $json = JSON::PP->new->utf8->canonical;
my %checkers;

while ( my $line = <STDIN> ) {
    my $request = $json->decode($line);
    my $response = eval {
        my $parent =
              $request->{type} eq 'core'
            ? S2::Checker->new
            : $checkers{ $request->{parentKey} } || die "Parent layer not compiled\n";
        my $compiler = S2::Compiler->new( { checker => dclone($parent) } );
        my $code     = '';
        $compiler->compile_source(
            {
                type           => $request->{type},
                source         => \$request->{source},
                output         => \$code,
                layerid        => $request->{variable},
                untrusted      => $request->{untrusted} ? 1 : 0,
                builtinPackage => 'S2::Builtin',
                format         => 'javascript',
            }
        );
        $checkers{ $request->{key} } = $compiler->{checker};
        { code => $code };
    } || { error => "$@" };
    print $json->encode($response), "\n";
}

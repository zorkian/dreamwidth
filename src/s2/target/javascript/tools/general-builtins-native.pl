#!/usr/bin/perl
# general-builtins-native.pl
#
# Compact installed scalar host oracle with no database connection.
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
use lib '/workspaces/dreamwidth/cgi-bin', '/workspaces/dreamwidth/src/s2';
use JSON::PP;
use MIME::Base64 qw(encode_base64);
BEGIN {
    require DBI;
    no warnings 'redefine';
    *DBI::connect = sub {die "DB forbidden in scalar host oracle"};
    *DBI::connect_cached = sub {die "DB forbidden in scalar host oracle"};
}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
require S2;
require LJ::S2;
my $ctx=[];
$ctx->[S2::SCRATCH()]={};
my $input=pack('C*',255,38,34,60,62,39);
my @rows=(
    S2::Builtin::LJ::ehtml($ctx,$input),
    S2::Builtin::LJ::etags($ctx,$input),
    S2::Builtin::LJ::htmlattr($ctx,'WIDTH',$input),
    S2::Builtin::LJ::htmlattr($ctx,'width','0'),
    S2::Builtin::LJ::striphtml($ctx,"a<b>x</b><tag\nfoo>y"),
    S2::Builtin::LJ::clean_css_classname($ctx,'evaluate eval'),
    S2::Builtin::LJ::alternate($ctx,'one','two'),
    S2::Builtin::LJ::alternate($ctx,'one','two'),
);
print JSON::PP->new->canonical->encode([map {{base64=>encode_base64($_,''),utf8=>utf8::is_utf8($_)?1:0}} @rows]);

#!/usr/bin/perl
# public-translation-native.pl
#
# Exercise installed ML value precedence using fixed synthetic public providers.
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
use lib '/workspaces/dreamwidth/cgi-bin';
use JSON::PP;
use MIME::Base64 qw(decode_base64 encode_base64);
BEGIN {
    require DBI;
    no warnings 'redefine';
    *DBI::connect=sub {die "DB forbidden in native value oracle"};
    *DBI::connect_cached=sub {die "DB forbidden in native value oracle"};
}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
require LJ::Lang;
my $input;
{local $/; $input=JSON::PP->new->decode(<STDIN>);}
my @output;
for my $row (@$input) {
    local $LJ::DEFAULT_LANG='en';
    local $LJ::IS_DEV_SERVER=$row->{dev};
    my $db=decode_base64($row->{db});
    my ($reads,$writes)=(0,0);
    no warnings 'redefine';
    local *LJ::resolve_file=sub {return $row->{file}};
    local *LJ::Lang::get_dom=sub {return {dmid=>1}};
    local *LJ::Lang::get_chgtime_unix=sub {return $row->{changed}};
    local *LJ::Lang::get_text_multi=sub {$reads++; return {$row->{code}=>$db}};
    local *LJ::Lang::set_text=sub {$writes++; return 1};
    # Fixed synthetic web request context; ml/get_text themselves remain native.
    local *LJ::Lang::request_context=sub {return {lang=>$row->{lang},getter=>\&LJ::Lang::get_text}};
    my %vars=map {$_=>decode_base64($row->{vars}{$_})} keys %{$row->{vars}};
    my $text=LJ::Lang::ml($row->{code},\%vars);
    my $flag=utf8::is_utf8($text)?1:0;
    my $octets; {use bytes; $octets=substr($text,0);}
    push @output,{base64=>encode_base64($octets,''),flag=>$flag,reads=>$reads,writes=>$writes};
}
print JSON::PP->new->canonical->encode(\@output);

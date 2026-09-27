#!/usr/bin/perl
# general-diagnostics-native.pl
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
BEGIN {require DBI; no warnings 'redefine'; *DBI::connect=sub{die 'DB forbidden'}; *DBI::connect_cached=sub{die 'DB forbidden'};}
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
require S2;
require LJ::S2;
sub recur {S2::check_depth(); recur();}
my @rows;
for my $kind ('recursion','deadline') {
    for my $entry ('prop_init()','RecentPage::print()') {
        my $ctx=[];
        local $S2::MAX_RECURSION=2;
        local $S2::run_timeout=4;
        $ctx->[S2::VTABLE()]->{S2::get_func_num($entry)}=
            $kind eq 'recursion' ? sub {recur()} : sub {kill 'ALRM',$$;};
        eval {S2::run_function($ctx,$entry)};
        my $error=$@;
        die 'Native control did not fail' unless $error;
        my $html;
        if ($entry eq 'prop_init()') {$html='<b>Error preparing to run:</b> '.LJ::ehtml($error);}
        else {$html=LJ::ehtml($error); $html =~ s!\n!<br />\n!g; $html='<b>Error running style:</b> '.$html;}
        # The deadline string is trusted fixed markup in both source paths.
        if ($kind eq 'deadline') {
            $html=$error;
            $html =~ s!\n!<br />\n!g if $entry ne 'prop_init()';
            $html=($entry eq 'prop_init()'?'<b>Error preparing to run:</b> ':'<b>Error running style:</b> ').$html;
        }
        push @rows,{kind=>$kind,entry=>$entry,raw=>encode_base64($error,''),html=>encode_base64($html,'')};
    }
}
print JSON::PP->new->canonical->encode(\@rows);

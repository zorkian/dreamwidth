#!/usr/bin/perl
# selected-bytes-native.pl
#
# Read fixed isolated entry through the installed native logtext helper.
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
use DBI;
use JSON::PP;
use MIME::Base64 qw(encode_base64);
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';
my $schema = shift;
die "isolated schema required" unless defined $schema && $schema =~ /\As6_selected_[a-f0-9]{16}_seven\z/;
my $dbh = DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
    {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0});
$dbh->do('SET NAMES latin1');
$dbh->do('SET SESSION TRANSACTION READ ONLY');
$dbh->do('START TRANSACTION READ ONLY');
{
    no warnings 'redefine';
    local *LJ::get_cluster_def_reader = sub {return $dbh};
    local *LJ::MemCache::get_multi = sub {return {}};
    local *LJ::MemCache::add = sub {return 1}; # Explicit no-cache oracle, never shared writes.
    my $data = LJ::get_logtext2({userid=>900001,clusterid=>7},1)->{1};
    my @values = map {defined $_ ? {base64=>encode_base64($_,''),utf8=>utf8::is_utf8($_)?1:0} : undef} @$data;
    print JSON::PP->new->canonical->encode(\@values);
}
$dbh->do('ROLLBACK');
$dbh->disconnect;

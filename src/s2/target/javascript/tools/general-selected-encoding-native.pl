#!/usr/bin/perl
# general-selected-encoding-native.pl
#
# Read isolated native DBI/logtext/codes bytes and actual item_toutf8 result.
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
require LJ::ConvUTF8;
my ($global,$cluster)=@ARGV;
die 'Isolated schemas required' unless defined $global && defined $cluster &&
    $global =~ /\As6_selected_[a-f0-9]{16}_g\z/ && $cluster =~ /\As6_selected_[a-f0-9]{16}_seven\z/;
my @connections=map {DBI->connect("DBI:mysql:database=$_;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
    {RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0})} ($global,$cluster);
for my $dbh(@connections){$dbh->do('SET NAMES latin1');$dbh->do('SET SESSION TRANSACTION READ ONLY');$dbh->do('START TRANSACTION READ ONLY');}
my ($g,$c)=@connections;
my ($oldenc)=$g->selectrow_array('SELECT oldenc FROM user WHERE userid=900001');
{
    no warnings 'redefine';
    local *LJ::get_cluster_def_reader=sub {$c};
    local *LJ::get_db_reader=sub {$g};
    local *LJ::MemCache::get_multi=sub {return {}};
    local *LJ::MemCache::add=sub {return 1};
    %LJ::CACHE_ENCODINGS=();
    my $data=LJ::get_logtext2({userid=>900001,clusterid=>7},1)->{1};
    my %props;
    my $rows=$c->selectall_arrayref("SELECT d.name,p.value FROM logprop2 p JOIN `$global`.logproplist d ON d.propid=p.propid WHERE p.journalid=900001 AND p.jitemid=1",{Slice=>{}});
    for my $row(@$rows){$props{$row->{name}}=$row->{value};}
    LJ::item_toutf8({oldenc=>$oldenc},\$data->[0],\$data->[1],\%props) if $props{unknown8bit};
    print JSON::PP->new->canonical->encode({subject=>defined $data->[0]?{base64=>encode_base64($data->[0],''),utf8=>utf8::is_utf8($data->[0])?1:0}:undef,
        text=>defined $data->[1]?{base64=>encode_base64($data->[1],''),utf8=>utf8::is_utf8($data->[1])?1:0}:undef});
}
for my $dbh(@connections){$dbh->do('ROLLBACK');$dbh->disconnect;}

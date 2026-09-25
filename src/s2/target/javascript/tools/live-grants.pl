#!/usr/bin/perl
#
# live-grants.pl
#
# Prepare a scoped, read-only local MySQL credential for the live S2 service.
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
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DBI;
use File::Path qw(make_path);
use File::Temp qw(tempfile);
use JSON::PP;

die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $user = 's2js_slice3_ro';
my $host = '127.0.0.1';
my $dir = "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live";
my $path = "$dir/mysql-readonly.json";
make_path($dir) unless -d $dir;
my $root = DBI->connect(
    'DBI:mysql:database=mysql;mysql_socket=/var/run/mysqld/mysqld.sock',
    'root', '', { RaiseError => 1, PrintError => 0, AutoCommit => 1 },
) or die "Cannot connect to local grant administrator\n";
die "Unexpected grant administrator\n"
    unless $root->selectrow_array('SELECT CURRENT_USER()') eq 'root@localhost';
my ($present) = $root->selectrow_array(
    'SELECT COUNT(*) FROM mysql.user WHERE user=? AND host=?', undef, $user, $host,
);
my $config;
if (-e $path) {
    die "Credential path is not a regular file\n" if -l $path || !-f $path;
    die "Credential file has unsafe permissions\n" if (stat($path))[2] & 0077;
    open my $input, '<:raw', $path or die "Cannot read credential file\n";
    local $/;
    $config = JSON::PP->new->decode(<$input>);
    close $input;
    die "Credential file identity differs\n"
        unless ref $config eq 'HASH' && ($config->{host} // '') eq $host
        && ($config->{port} // 0) == 3306 && ($config->{user} // '') eq $user
        && ($config->{password} // '') =~ /^[A-Za-z0-9]{40}$/;
}
else {
    die "Refusing an unowned serving account collision\n" if $present;
    $config = {
        host => $host, port => 3306, user => $user,
        password => LJ::rand_chars(40),
    };
    my $json = JSON::PP->new->canonical->pretty->encode($config);
    my ($fh, $temporary) = tempfile('.mysql-readonly-XXXXXX', DIR => $dir, UNLINK => 0);
    chmod 0600, $temporary or die "Cannot restrict credential file\n";
    binmode $fh, ':raw';
    print {$fh} $json or die "Cannot stage credential file\n";
    close $fh or die "Cannot close credential file\n";
    rename $temporary, $path or die "Cannot publish credential file\n";
}

my @global = qw(user useridmap userprop userproplist s2styles s2layers
    s2compiled s2source_inno logproplist secrets);
my @cluster = qw(userbio userproplite2 s2stylelayers2 log2 logtext2 logprop2
    usertags userkeywords logtags logtagsrecent logkwsum links userpic2 talk2);
my @tables = (
    (map { "dw_global.$_" } @global),
    (map { "dw_cluster01.$_" } @cluster),
);
my $principal = "'$user'\@'$host'";
if (!$present) {
    eval {
        $root->do("CREATE USER $principal IDENTIFIED WITH mysql_native_password BY "
            . $root->quote($config->{password}));
    };
    die "Cannot create scoped local serving account\n" if $@;
}
my $tick = chr(96);
for my $table (@tables) {
    my ($schema, $name) = split /\./, $table;
    eval { $root->do("GRANT SELECT ON $tick$schema$tick.$tick$name$tick TO $principal"); };
    die "Cannot grant scoped SELECT\n" if $@;
}
my $privileges = $root->selectall_arrayref(
    'SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES
     WHERE GRANTEE=?', undef, $principal,
);
my %observed;
for my $row (@$privileges) {
    die "Serving account has non-SELECT table privilege\n" unless $row->[2] eq 'SELECT';
    $observed{"$row->[0].$row->[1]"}++;
}
die "Serving account table grants differ\n"
    unless keys(%observed) == @tables && !grep { ($observed{$_} // 0) != 1 } @tables;
my ($schema_privileges) = $root->selectrow_array(
    'SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=?',
    undef, $principal,
);
die "Serving account has schema privileges\n" if $schema_privileges;
my $user_privileges = $root->selectcol_arrayref(
    'SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=?',
    undef, $principal,
);
die "Serving account has global privileges\n"
    if grep { $_ ne 'USAGE' } @$user_privileges;
my ($column_privileges) = $root->selectrow_array(
    'SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=?',
    undef, $principal,
);
die "Serving account has column privileges\n" if $column_privileges;
my $reader = DBI->connect(
    'DBI:mysql:database=dw_global;host=127.0.0.1',
    $user, $config->{password},
    { RaiseError => 1, PrintError => 0, AutoCommit => 1 },
) or die "Cannot verify serving credential\n";
die "Serving account identity differs\n"
    unless $reader->selectrow_array('SELECT CURRENT_USER()') eq "$user\@$host";
my $write_allowed = eval {
    $reader->do('UPDATE dw_global.user SET userid=userid WHERE userid=-1');
    1;
};
die "Serving account unexpectedly permits UPDATE\n" if $write_allowed;
print "Scoped read-only local MySQL credential ready\n";

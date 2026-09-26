# primary-endpoint.pl
#
# Own-container native host/socket transport probe; no raw driver errors.
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
use DBI;
use JSON::PP;
die "Own container fixture required" unless ( $ENV{LJHOME} // '' ) eq '/workspaces/dreamwidth';
my $socket = "/tmp/s6-native-missing-socket-$$";
die "Unexpected fixture socket" if -e $socket;
my @results;

for my $host ( '127.0.0.1', 'localhost', 'LOCALHOST' ) {
    my $dbh = DBI->connect(
        "DBI:mysql:database=mysql;host=$host;mysql_socket=$socket",
        's6_nonexistent_transport_probe',
        '', { PrintError => 0, RaiseError => 0 }
    );
    die "Unexpected probe account" if $dbh;
    my $error = $DBI::errstr // '';
    push @results,
        {
        host           => $host,
        socket         => index( $error, $socket ) >= 0 ? JSON::PP::true : JSON::PP::false,
        authentication => $error =~ /Access denied/ ? JSON::PP::true : JSON::PP::false
        };
}
print encode_json( \@results );

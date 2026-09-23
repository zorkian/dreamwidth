#!/usr/bin/perl
# Disposable account for legacy update adapter browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.

use strict;
use warnings;

use JSON qw(encode_json decode_json);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Test qw(temp_user);
use LJ::Userpic;

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "open $path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    return \$contents;
}

my $user = temp_user();
$user->update_self( { status => 'A' } );
$user->set_password( my $password = 'legacy-update-browser-' . LJ::rand_chars(12) );
$user->set_prop( 'entry_editor', 'rich' );
my $userpic =
    LJ::Userpic->create( $user, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
die 'cannot create browser fixture userpic' unless $userpic;
$userpic->set_keywords('legacy-update-browser-pic');

sub state {
    LJ::Entry::reset_singletons();
    my ($count) =
        $user->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $user->id );
    my ($jitemid) = $user->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $user->id );
    return { count => $count || 0 } unless $jitemid;

    my $entry = LJ::Entry->new( $user, jitemid => $jitemid );
    return {
        count    => $count || 0,
        subject  => $entry->subject_raw,
        body     => $entry->event_raw,
        security => $entry->security,
        date     => $entry->eventtime_mysql,
        used_rte => $entry->prop('used_rte') ? JSON::true : JSON::false,
    };
}

$| = 1;
print encode_json( { user => $user->user, password => $password, state => state() } ) . "\n";

while (<STDIN>) {
    my $command = decode_json($_);
    print encode_json( state() ) . "\n" if $command->{state};
}

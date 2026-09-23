#!/usr/bin/perl
# Disposable fixture for same-poster community legacy edit browser coverage.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use JSON qw(encode_json decode_json);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Entry;
use LJ::Test qw(temp_comm temp_user);

my $poster = temp_user();
$poster->update_self( { status => 'A' } );
$poster->set_password( my $password = 'same-poster-' . LJ::rand_chars(12) );
my $manager = temp_user();
$manager->update_self( { status => 'A' } );
$manager->set_password( my $manager_password = 'same-manager-' . LJ::rand_chars(12) );
my $other_poster = temp_user();
$other_poster->update_self( { status => 'A' } );
my $comm = temp_comm();
$poster->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $poster->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $poster->userid . '-A' );
$manager->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $manager->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );

my $target = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Same poster browser subject',
    body     => 'Same poster browser body',
    security => 'friends'
);
my $retry = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Same poster retry subject',
    body     => 'Same poster retry body',
    security => 'friends'
);
my $unrelated = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Same poster unrelated subject',
    body     => 'Same poster unrelated body',
    security => 'public'
);
my $other = $other_poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Manager retained subject',
    body     => 'Manager retained body',
    security => 'public'
);
$other->set_prop( 'adult_content_maintainer',  'concepts' );
$other->set_prop( 'opt_nocomments_maintainer', 1 );

sub entry_state {
    my ($id) = @_;
    LJ::Entry::reset_singletons();
    my $entry = LJ::Entry->new( $comm, ditemid => $id );
    return {
        valid     => $entry && $entry->valid ? JSON::true          : JSON::false,
        subject   => $entry && $entry->valid ? $entry->subject_raw : undef,
        body      => $entry && $entry->valid ? $entry->event_raw   : undef,
        security  => $entry && $entry->valid ? $entry->security    : undef,
        allowmask => $entry && $entry->valid ? $entry->allowmask   : undef,
    };
}

sub state {
    return {
        target    => entry_state( $target->ditemid ),
        retry     => entry_state( $retry->ditemid ),
        unrelated => entry_state( $unrelated->ditemid ),
        other     => entry_state( $other->ditemid ),
    };
}

$| = 1;
print encode_json(
    {
        user             => $poster->user,
        password         => $password,
        manager          => $manager->user,
        manager_password => $manager_password,
        community        => $comm->user,
        target_id        => $target->ditemid,
        retry_id         => $retry->ditemid,
        unrelated_id     => $unrelated->ditemid,
        other_id         => $other->ditemid,
        state            => state(),
    }
) . "\n";
while (<STDIN>) {
    my $command = decode_json($_);
    print encode_json( state() ) . "\n" if $command->{state};
}

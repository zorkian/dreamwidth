#!/usr/bin/perl
# Disposable fixture for callable manager-property browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use JSON qw(encode_json decode_json);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Entry;
use LJ::Test qw(temp_comm temp_user);

exit 0 if $ENV{MANAGER_PROPERTY_FIXTURE_EARLY_EXIT};

my $manager = temp_user();
my $poster  = temp_user();
my $comm    = temp_comm();
$_->update_self( { status => 'A' } ) for $manager, $poster;
$manager->set_password( my $password = 'manager-property-' . LJ::rand_chars(12) );
LJ::set_rel( $comm, $manager, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );

my $target = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Browser manager target subject',
    body     => 'Browser manager target body',
    security => 'public',
);
my $unrelated = $poster->t_post_fake_comm_entry(
    $comm,
    subject  => 'Browser manager unrelated subject',
    body     => 'Browser manager unrelated body',
    security => 'public',
);
$target->set_prop( 'opt_preformatted', '1' );
$unrelated->set_prop( 'opt_preformatted', 'unrelated preformatted sentinel' );

sub entry_state {
    my ($ditemid) = @_;
    LJ::Entry::reset_singletons();
    my $entry = LJ::Entry->new( $comm, ditemid => $ditemid );
    return {
        subject      => $entry->subject_raw,
        body         => $entry->event_raw,
        security     => $entry->security,
        allowmask    => $entry->allowmask || 0,
        preformatted => $entry->prop('opt_preformatted') || '',
        reason       => $entry->prop('adult_content_maintainer_reason') || '',
        adult        => $entry->prop('adult_content_maintainer') || '',
        nocomments   => $entry->prop('opt_nocomments_maintainer') || '',
    };
}

sub state {
    return {
        target    => entry_state( $target->ditemid ),
        unrelated => entry_state( $unrelated->ditemid ),
    };
}

$| = 1;
print encode_json(
    {
        user       => $manager->user,
        password   => $password,
        community  => $comm->user,
        ditemid    => $target->ditemid,
        target_url => $target->url,
        state      => state(),
    }
) . "\n";
while (<STDIN>) {
    my $command = decode_json($_);
    print encode_json( state() ) . "\n" if $command->{state};
}

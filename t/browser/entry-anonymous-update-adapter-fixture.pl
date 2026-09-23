#!/usr/bin/perl
# Disposable state fixture for callable anonymous retained update browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Entry;
use LJ::Test qw(temp_user);

exit 0 if $ENV{ANONYMOUS_UPDATE_FIXTURE_EARLY_EXIT};

my $user = temp_user();
$user->update_self( { status => 'A' } );
$user->set_password( my $password = 'anonymous-browser-' . LJ::rand_chars(12) );
$user->set_draft_text('anonymous browser draft sentinel');
$user->set_prop( draft_properties => nfreeze( { subject => 'anonymous browser frozen subject' } ) );
$user->set_prop( entry_editor     => 'always_rich' );
$user->entry_editor2('markdown0');
$user->displaydate_check(1);

sub persisted_prop {
    my ( $u, $name ) = @_;
    $u->uncache_prop($name);
    return $u->prop($name);
}

sub state {
    my (%opts) = @_;
    my $fresh = LJ::load_userid( $user->id, 1 );
    LJ::Entry::reset_singletons();
    my $draft             = persisted_prop( $fresh, 'entry_draft' );
    my $frozen_properties = persisted_prop( $fresh, 'draft_properties' );
    my $displaydate       = persisted_prop( $fresh, 'displaydate_check' );
    my ($count) =
        $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $fresh->id );
    my ($jitemid) = $fresh->selectrow_array(
        'SELECT jitemid FROM log2 WHERE journalid=? ORDER BY jitemid DESC LIMIT 1',
        undef, $fresh->id );
    my $entry = $jitemid ? LJ::Entry->new( $fresh, jitemid => $jitemid ) : undef;
    return {
        user => $fresh->user,
        ( $opts{startup} ? ( password => $password ) : () ),
        count => $count || 0,
        draft => $draft || '',
        draft_properties => $frozen_properties ? thaw($frozen_properties) : {},
        legacy_editor    => $fresh->prop('entry_editor'),
        editor           => $fresh->entry_editor2,
        displaydate      => $displaydate ? 1 : 0,
        subject          => $entry ? $entry->subject_raw : undef,
        body             => $entry ? $entry->event_raw : undef,
        security         => $entry ? $entry->security : undef,
    };
}

$| = 1;
print encode_json( state( startup => 1 ) ) . "\n";
while (<STDIN>) {
    my $command = decode_json($_);
    print encode_json( state() ) . "\n" if $command->{state};
}

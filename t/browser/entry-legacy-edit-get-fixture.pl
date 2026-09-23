#!/usr/bin/perl
# Disposable fixture for callable retained owned-entry edit GET browser coverage.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Entry;
use LJ::Test qw(temp_user);

my $user = temp_user();
$user->update_self( { status => 'A' } );
$user->set_password( my $password = 'entry-get-' . LJ::rand_chars(12) );
$user->set_draft_text('Callable GET draft sentinel');
$user->set_prop( draft_properties =>
        nfreeze( { subject => 'Callable GET draft subject', taglist => 'callable-get-tag' } ) );
my $target = $user->t_post_fake_entry(
    subject  => 'Browser callable GET subject',
    body     => "Browser callable GET body\nwith raw line two",
    security => 'private',
);
$target->set_prop( editor           => 'html_raw0' );
$target->set_prop( current_location => 'Browser callable GET location' );
$target->set_prop( current_music    => 'Browser callable GET music' );
my $other = $user->t_post_fake_entry(
    subject  => 'Browser callable GET unrelated subject',
    body     => 'Browser callable GET unrelated body',
    security => 'private',
);

sub state {
    LJ::Entry::reset_singletons();
    my $fresh_user = LJ::load_userid( $user->id, 1 );
    my $target_fresh = LJ::Entry->new( $fresh_user, ditemid => $target->ditemid );
    my $other_fresh  = LJ::Entry->new( $fresh_user, ditemid => $other->ditemid );
    my $draft_props  = $fresh_user->prop('draft_properties');
    return {
        target_subject  => $target_fresh->subject_raw,
        target_body     => $target_fresh->event_raw,
        target_security => $target_fresh->security,
        target_editor   => $target_fresh->prop('editor') || '',
        other_subject   => $other_fresh->subject_raw,
        draft_body      => $user->draft_text,
        draft_props     => $user->prop('draft_properties'),
    };
}

$| = 1;
print encode_json(
    {
        user     => $user->user,
        password => $password,
        id       => $target->ditemid,
        state    => state(),
    }
) . "\n";
while (<STDIN>) {
    my $command = decode_json($_);
    print encode_json( state() ) . "\n" if $command->{state};
}

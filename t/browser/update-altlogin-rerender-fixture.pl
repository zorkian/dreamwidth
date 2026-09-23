#!/usr/bin/perl
# Disposable fixture for callable alternate-login rerender browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
exit 0 if $ENV{UPDATE_ALTLOGIN_RERENDER_FIXTURE_EARLY_EOF};
my $session = temp_user();
my $poster  = temp_user();
$_->update_self( { status => 'A' } ) for $session, $poster;
$session->set_password( my $password = 'altlogin-rerender-' . LJ::rand_chars(12) );

sub seed_draft_state {
    for my $pair ( [ $session, 'A' ], [ $poster, 'B' ] ) {
        my ( $user, $label ) = @$pair;
        $user->set_prop( entry_draft => qq{"$label draft"} );
        $user->set_prop(
            draft_properties => nfreeze( { subject => "$label subject", editor => 'markdown0' } ) );
        $user->set_prop( entry_editor => 'always_plain' );
        $user->entry_editor2('markdown0');
    }
}

sub state_for {
    my ($user) = @_;
    my $fresh  = LJ::load_userid( $user->id, 1 );
    my $frozen = $fresh->prop('draft_properties');
    return {
        draft   => $fresh->prop('entry_draft'),
        props   => $frozen ? thaw($frozen) : {},
        editor  => $fresh->prop('entry_editor'),
        editor2 => $fresh->entry_editor2
    };
}
sub state { return { session => state_for($session), poster => state_for($poster) }; }
$| = 1;
print encode_json(
    { user => $session->user, password => $password, poster => $poster->user, state => state() } )
    . "\n";
while (<STDIN>) {
    my $q = decode_json($_);
    seed_draft_state() if $q->{seed_draft};
    print encode_json( state() ) . "\n" if $q->{state} || $q->{seed_draft};
}

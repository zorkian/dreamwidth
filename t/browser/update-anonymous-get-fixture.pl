#!/usr/bin/perl
# Disposable state fixture for anonymous retained update GET browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Test qw(temp_user);

die "intentional anonymous update fixture startup failure\n"
    if $ENV{ANONYMOUS_UPDATE_FIXTURE_EARLY_FAIL};

my $u = temp_user();
$u->update_self( { status => 'A' } );
$u->set_draft_text('anonymous renderer browser draft');
$u->set_prop( draft_properties =>
        nfreeze( { subject => 'anonymous browser subject', taglist => 'anonymous-browser' } ) );
$u->set_prop( 'entry_editor', 'always_rich' );
$u->entry_editor2('markdown0');

sub state {
    my $fresh = LJ::load_userid( $u->id, 1 );
    return {
        draft         => $fresh->draft_text,
        props         => thaw( $fresh->prop('draft_properties') ),
        legacy_editor => $fresh->prop('entry_editor'),
        editor        => $fresh->entry_editor2,
    };
}

$| = 1;
sub response { return { target => $u->user, state => state() }; }

print encode_json( response() ) . "\n";
while (<STDIN>) {
    my $query = decode_json($_);
    print encode_json( response() ) . "\n" if $query->{state};
}

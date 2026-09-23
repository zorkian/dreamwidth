#!/usr/bin/perl
# Disposable fixture for callable retained update GET browser acceptance.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
die "intentional alternate-login fixture startup failure\n"
    if $ENV{UPDATE_ALTLOGIN_FIXTURE_EARLY_FAIL};
my $u = temp_user();
$u->update_self( { status => 'A' } );
$u->set_password( my $p = 'update-get-' . LJ::rand_chars(12) );
$u->set_prop( 'entry_editor', 'always_rich' );
$u->entry_editor2('markdown0');

sub state {
    my $f = LJ::load_userid( $u->id, 1 );
    return {
        draft         => $f->prop('entry_draft'),
        props         => thaw( $f->prop('draft_properties') ),
        legacy_editor => $f->prop('entry_editor'),
        editor        => $f->entry_editor2
    };
}
$| = 1;
print encode_json( { user => $u->user, password => $p, state => state() } ) . "\n";
while (<STDIN>) {
    my $q = decode_json($_);
    if ( $q->{seed_draft} ) {
        $u->set_prop( 'entry_draft', '"update GET draft"' );
        $u->set_prop(
            'draft_properties',
            nfreeze(
                {
                    subject => 'update GET draft subject',
                    taglist => 'update-get-draft-tag',
                    editor  => 'markdown0',
                }
            )
        );
    }
    print encode_json( state() ) . "\n" if $q->{state} || $q->{seed_draft};
}

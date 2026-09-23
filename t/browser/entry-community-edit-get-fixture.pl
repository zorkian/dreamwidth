#!/usr/bin/perl
# Disposable fixture for callable retained community edit GET browser coverage.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use JSON qw(encode_json decode_json);
use Storable qw(nfreeze thaw);
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Entry;
use LJ::Test qw(temp_comm temp_user);

my $manager = temp_user();
$manager->update_self( { status => 'A' } );
$manager->set_password( my $password = 'community-get-' . LJ::rand_chars(12) );
$manager->set_prop( 'entry_editor', 'always_rich' );
$manager->entry_editor2('markdown0');
$manager->set_draft_text('Community browser draft sentinel');
$manager->set_prop(
    draft_properties => nfreeze( { subject => 'Community draft subject', editor => 'markdown0' } )
);
my $poster = temp_user();
$poster->update_self( { status => 'A' } );
my $comm = temp_comm();
$manager->join_community( $comm, 1, 1 );
LJ::set_rel( $comm->userid, $manager->userid, 'A' );
DW::Cache->request->remove( 'rel', $comm->userid . '-' . $manager->userid . '-A' );
my $own = $manager->t_post_fake_comm_entry(
    $comm,
    subject  => 'Browser community own subject',
    body     => 'Browser community own body',
    security => 'friends'
);
my $other = $poster->t_post_fake_comm_entry(
    $comm,
    subject => 'Browser community manager subject',
    body    => 'Browser community manager body'
);
$other->set_prop( 'adult_content_maintainer_reason', 'Browser manager reason' );
$other->set_prop( 'adult_content_maintainer',        'concepts' );
$other->set_prop( 'opt_nocomments_maintainer',       1 );

sub state {
    LJ::Entry::reset_singletons();
    my $fresh_own   = LJ::Entry->new( $comm, ditemid => $own->ditemid );
    my $fresh_other = LJ::Entry->new( $comm, ditemid => $other->ditemid );
    my $fresh_manager = LJ::load_userid( $manager->id, 1 );
    return {
        manager_draft       => $fresh_manager->draft_text,
        manager_draft_props => thaw( $fresh_manager->prop('draft_properties') ),
        manager_editor      => $fresh_manager->prop('entry_editor'),
        manager_editor2     => $fresh_manager->entry_editor2,
        own_allowmask       => $fresh_own->allowmask,
        other_override      => $fresh_other->prop('adult_content_maintainer') || '',
        other_comments      => $fresh_other->prop('opt_nocomments_maintainer') || 0,
        own_subject         => $fresh_own->subject_raw,
        own_body            => $fresh_own->event_raw,
        own_security        => $fresh_own->security,
        other_subject       => $fresh_other->subject_raw,
        other_body          => $fresh_other->event_raw,
        other_reason        => $fresh_other->prop('adult_content_maintainer_reason') || ''
    };
}
$| = 1;
print encode_json(
    {
        user      => $manager->user,
        password  => $password,
        community => $comm->user,
        own_id    => $own->ditemid,
        other_id  => $other->ditemid,
        state     => state()
    }
) . "\n";
while (<STDIN>) { my $c = decode_json($_); print encode_json( state() ) . "\n" if $c->{state}; }

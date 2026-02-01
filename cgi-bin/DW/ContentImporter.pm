#!/usr/bin/perl
#
# DW::ContentImporter
#
# Web backend functions for Content Importing
#
# Authors:
#      Andrea Nall <anall@andreanall.com>
#
# Copyright (c) 2009-2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::ContentImporter;

=head1 NAME

DW::ContentImporter - Web backend functions for Content Importing

=cut

use strict;
use Carp qw/ croak /;
use DW::XML::Parser;
use DW::Task::ContentImporter;
use DW::TaskQueue::Dedup;

=head1 API

=head2 C<< $class->queue_import( $user, $importer, $data ); >>

This function sets up an import for the specified user if one is currently
not in progress.  The contents of data are importer specific, and $importer
is specified as a string version of the full class name.

This returns undef if there is currently a import job queued/running for
the user, otherwise returns the new job handle.

=cut

sub queue_import {
    my ( $class, $u, $importer, $data ) = @_;
    $u = LJ::want_user($u)
        or croak 'invalid user object passed to queue_import';

    # job is already in progress
    return undef
        if $class->current_job($u);

    my $uniqkey = "import-" . $u->id;
    my $rv      = DW::TaskQueue->dispatch(
        DW::Task::ContentImporter->new(
            {
                _worker_class => $importer,
                %$data,
                target => $u->id,
            },
            uniqkey   => $uniqkey,
            dedup_ttl => 86400,
        )
    );

    croak 'unable to dispatch importer task' unless $rv;

    $u->set_prop( import_job => $uniqkey );
    return $rv;
}

=head2 C<< $class->current_job( $user ); >>

This function returns whether an import job is currently pending for the user.

=cut

sub current_job {
    my ( $class, $u ) = @_;
    $u = LJ::want_user($u)
        or croak 'invalid user object passed to current_job';

    my $jobid = $u->prop('import_job')
        or return undef;

    # Check if the dedup key exists (meaning a job is still pending/running)
    if ( DW::TaskQueue::Dedup->is_pending( 'DW::Task::ContentImporter', $jobid ) ) {
        return 1;
    }

    # Job seems to not exist
    $u->set_prop( import_job => '' );
    return undef;
}

1;

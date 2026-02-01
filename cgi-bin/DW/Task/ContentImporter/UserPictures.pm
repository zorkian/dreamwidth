#!/usr/bin/perl
#
# DW::Task::ContentImporter::UserPictures
#
# Worker for importing user pictures/icons.
#
# Authors:
#     Andrea Nall <anall@andreanall.com>
#
# Copyright (c) 2009-2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::Task::ContentImporter::UserPictures;

use strict;
use v5.10;
use Log::Log4perl;
my $log = Log::Log4perl->get_logger(__PACKAGE__);

use Storable qw(thaw);

use DW::BlobStore;
use DW::Worker::ContentImporter;

use base 'DW::Task';

sub work {
    my ( $self, $handle ) = @_;

    my $opts = { %{ $self->args->[0] } };
    my $u;

    $opts->{'_rl_requests'} = 3;
    $opts->{'_rl_seconds'}  = 1;
    $opts->{errors}         = [] unless defined $opts->{errors};

    $u = LJ::load_userid( $opts->{target} );
    unless ($u) {
        $log->error("No Such User");
        return DW::Task::COMPLETED;
    }

    my $raw_data = DW::BlobStore->retrieve( temp => "import_upi:$u->{userid}" );
    unless ($raw_data) {
        $log->error("Data missing");
        return DW::Task::COMPLETED;
    }

    my $data = thaw $$raw_data;

    foreach my $upi ( @{ $data->{pics} } ) {
        next unless $opts->{selected}->{ $upi->{id} };
        DW::Worker::ContentImporter->ratelimit_request($opts);
        DW::Worker::ContentImporter->import_userpic( $u, $opts, $upi );
    }

    DW::BlobStore->delete( temp => "import_upi:$u->{userid}" );
    my $email = <<EOF;
Dear $u->{user},

Your user pictures have been imported.

EOF
    if ( scalar @{ $opts->{errors} } ) {
        $email .=
"\n\nHowever, we were unfortunately unable to import the following items, and you will have to do them manually:\n";
        foreach my $item ( @{ $opts->{errors} } ) {
            $email .= " * $item\n";
        }
    }
    $email .= <<EOF;

Regards,
The $LJ::SITENAME Team
EOF
    LJ::send_mail(
        {
            to   => $u->email_raw,
            from => $LJ::BOGUS_EMAIL,
            body => $email
        }
    );
    $u->set_prop( "import_job", '' );

    return DW::Task::COMPLETED;
}

1;

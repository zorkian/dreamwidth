#!/usr/bin/perl
#
# update-workflows.pl
#
# Update the worker workflow files. This file also contains information about
# the workers that run in ECS... that should really be somewhere else, but we
# have it here for now.
#
# Authors:
#     Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2022 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use v5.10;

use lib "$ENV{LJHOME}/extlib/lib/perl5";

use Template;

my %workers = (

    # Name                    MinCt, MaxCt, Memory, MilliCpu, TgtCpu

    # SQS based workers
    'dw-esn-cluster-subs' => [ 1, 50, 512, 256, 50, ],
    'dw-esn-filter-subs'  => [ 1, 50, 512, 256, 50, ],
    'dw-esn-fired-event'  => [ 1, 50, 512, 256, 50, ],
    'dw-esn-process-sub'  => [ 1, 50, 512, 256, 50, ],
    'dw-latest-feed'      => [ 1, 1,  512, 256, 50, ],
    'dw-lazy-cleanup'     => [ 1, 1,  512, 256, 50, ],
    'dw-mass-privacy'     => [ 1, 1,  512, 256, 50, ],
    'dw-change-poster-id'   => [ 1, 1,  512, 256, 50, ],
    'dw-content-importer'   => [ 2, 2,  2048, 256, 50, ],
    'dw-distribute-invites' => [ 1, 1,  512, 256, 50, ],
    'dw-embed-worker'       => [ 1, 15, 512, 256, 50, ],
    'dw-import-eraser'      => [ 1, 1,  512, 256, 50, ],
    'dw-incoming-email'     => [ 1, 1,  512, 256, 50, ],
    'dw-sphinx-copier'      => [ 1, 50, 512, 256, 50, ],
    'dw-support-notify'     => [ 1, 1,  512, 256, 50, ],
    'dw-synsuck'            => [ 1, 20, 512, 256, 50, ],
    'dw-xpost'              => [ 1, 1,  512, 256, 50, ],

    # Other workers
    'birthday-notify'  => [ 1, 1,  512, 256, 50, ],
    'directory-meta'   => [ 1, 1,  512, 256, 50, ],
    'dw-send-email'    => [ 1, 50, 512, 256, 50, ],
    'resolve-extacct'  => [ 1, 1,  512, 256, 50, ],
    'spellcheck-gm'    => [ 1, 1,  512, 256, 50, ],
    'sphinx-search-gm' => [ 1, 1,  512, 256, 50, ],

    # Workers to replace admin/angel configs
    'paidstatus'             => [ 1, 1, 512, 256, 50, ],
    'import-scheduler'       => [ 1, 1, 512, 256, 50, ],
    'schedule-synsuck'       => [ 1, 1, 512, 256, 50, ],
    # 'search-updater'         => [ 1, 1, 512, 256, 50, ],
    'expunge-users'          => [ 1, 1, 512, 256, 50, ],
    'shop-creditcard-charge' => [ 1, 1, 512, 256, 50, ],
    # 'search-constraints'     => [ 1, 1, 512, 256, 50, ],
    # 'search-lookup'          => [ 1, 1, 512, 256, 50, ],

    # Misc site utilities
    'codebuild-notifier' => [ 1, 1, 512, 256, 50, ],
);

# Generate deployment workflow
my $tt = Template->new() or die;
$tt->process( 'worker-deploy.tt', { workers => \%workers }, 'worker-deploy.yml' )
    or die $tt->error;

# Generate task JSONs
foreach my $worker ( keys %workers ) {
    $tt->process(
        'tasks/worker-service.tt',
        {
            name   => $worker,
            cpu    => $workers{$worker}->[3],
            memory => $workers{$worker}->[2],
        },
        "tasks/worker-$worker-service.json"
    ) or die $tt->error;
}

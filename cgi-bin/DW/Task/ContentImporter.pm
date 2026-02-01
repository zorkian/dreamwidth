#!/usr/bin/perl
#
# DW::Task::ContentImporter
#
# Base task class for content importer workers. This wraps the existing
# DW::Worker::ContentImporter subclass workers, translating between the
# DW::Task interface and the legacy job interface they expect.
#
# Authors:
#     Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2009-2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::Task::ContentImporter;

use strict;
use v5.10;
use Log::Log4perl;
my $log = Log::Log4perl->get_logger(__PACKAGE__);

use base 'DW::Task';

# This task wraps the legacy content importer workers. The actual worker class
# name is stored in the task args as _worker_class. When work() is called, we
# create a shim job object that mimics the legacy job interface for the existing
# workers to function.

sub work {
    my ( $self, $handle ) = @_;

    my $args         = $self->args->[0];
    my $worker_class = $args->{_worker_class};

    unless ($worker_class) {
        $log->error("No _worker_class specified in ContentImporter task");
        return DW::Task::COMPLETED;
    }

    # Load the worker class
    eval "use $worker_class;";
    if ($@) {
        $log->error("Failed to load worker class $worker_class: $@");
        return DW::Task::COMPLETED;
    }

    # Build a shim job object that provides the legacy job interface
    # that the importer workers expect
    my $shim = DW::Task::ContentImporter::JobShim->new(
        arg          => { %$args },
        worker_class => $worker_class,
    );

    # Call the worker's work method
    eval { $worker_class->work($shim); };
    if ($@) {
        $log->error("ContentImporter worker $worker_class died: $@");
        return DW::Task::FAILED;
    }

    # Check the shim's result
    return $shim->result;
}

# Shim that mimics the legacy job interface for the content importer workers
package DW::Task::ContentImporter::JobShim;

use Log::Log4perl;
my $shim_log = Log::Log4perl->get_logger(__PACKAGE__);

sub new {
    my ( $class, %opts ) = @_;
    return bless {
        arg          => $opts{arg},
        worker_class => $opts{worker_class},
        result       => DW::Task::COMPLETED,
        failures     => 0,
    }, $class;
}

sub arg      { return $_[0]->{arg} }
sub funcname { return $_[0]->{worker_class} }
sub failures { return $_[0]->{failures} }
sub result   { return $_[0]->{result} }

sub completed {
    my ($self) = @_;
    $self->{result} = DW::Task::COMPLETED;
}

sub permanent_failure {
    my ( $self, $msg ) = @_;
    $shim_log->error("Permanent failure: $msg");
    $self->{result} = DW::Task::COMPLETED;    # Don't retry permanent failures
}

sub failed {
    my ( $self, $msg ) = @_;
    $shim_log->warn("Temporary failure: $msg");
    $self->{result} = DW::Task::FAILED;
}

# decline is not directly supported in SQS; treat as temporary failure with delay
sub declined {
    my ( $self, $val ) = @_;
    $self->{_declined} = $val;
}

sub run_after {
    my ( $self, $time ) = @_;

    # Not directly supported in SQS, but the task will be retried
}

sub save {
    my ($self) = @_;
    if ( $self->{_declined} ) {
        $self->{result} = DW::Task::FAILED;
    }
}

# Provide a stub handle for $job->handle->client pattern
sub handle {
    return DW::Task::ContentImporter::HandleShim->new;
}

sub debug {
    my ( $self, $msg ) = @_;
    $shim_log->debug($msg);
}

package DW::Task::ContentImporter::HandleShim;

sub new    { return bless {}, $_[0] }
sub client { return undef }

1;

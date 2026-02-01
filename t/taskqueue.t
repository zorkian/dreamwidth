# t/taskqueue.t
#
# Test DW::TaskQueue machinery using the LocalDisk backend.
# Requires memcached to be running for dedup tests.
#
# Authors:
#      Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use warnings;

use Test::More;
use File::Temp qw/ tempdir /;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use DW::Task;
use DW::TaskQueue;
use DW::TaskQueue::LocalDisk;
use DW::TaskQueue::Dedup;

# Point LocalDisk at a temporary directory that gets cleaned up automatically.
my $tmpdir = tempdir( CLEANUP => 1 );
my $queue  = DW::TaskQueue::LocalDisk->init( path => $tmpdir );
isa_ok( $queue, 'DW::TaskQueue::LocalDisk', 'got LocalDisk backend' );

# A minimal test task subclass
{

    package DW::Task::Test;
    use base 'DW::Task';

    sub work {
        my ( $self, $handle ) = @_;
        my $args = $self->args->[0];

        # Simulate failure if requested
        return DW::Task::FAILED if $args->{fail};
        return DW::Task::COMPLETED;
    }
}

# ============================================================
# Basic DW::Task construction
# ============================================================

subtest 'DW::Task construction' => sub {
    my $task = DW::Task::Test->new( { foo => 'bar' } );
    isa_ok( $task, 'DW::Task' );
    is_deeply( $task->args->[0], { foo => 'bar' }, 'args preserved' );
    is( $task->uniqkey,   undef, 'no uniqkey by default' );
    is( $task->dedup_ttl, undef, 'no dedup_ttl by default' );
};

subtest 'DW::Task construction with dedup opts' => sub {
    my $task = DW::Task::Test->new(
        { foo => 'bar' },
        uniqkey   => 'test:1',
        dedup_ttl => 600,
    );
    is_deeply( $task->args->[0], { foo => 'bar' }, 'args preserved with opts' );
    is( $task->uniqkey,   'test:1', 'uniqkey set' );
    is( $task->dedup_ttl, 600,      'dedup_ttl set' );
};

# ============================================================
# LocalDisk send/receive/completed round-trip
# ============================================================

subtest 'send and receive round-trip' => sub {
    my $task = DW::Task::Test->new( { value => 42 } );
    my $rv   = $queue->send($task);
    ok( $rv, 'send returned true' );

    my $messages = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$messages, 1, 'received 1 message' );

    my ( $handle, $message ) = @{ $messages->[0] };
    ok( defined $handle, 'handle is defined' );
    isa_ok( $message, 'DW::Task::Test' );
    is( $message->args->[0]->{value}, 42, 'args survived serialization' );

    # Complete it and verify it's gone
    $queue->completed( 'DW::Task::Test', $handle );
    my $empty = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$empty, 0, 'queue empty after completion' );
};

subtest 'multiple tasks' => sub {
    my @tasks = map { DW::Task::Test->new( { n => $_ } ) } 1 .. 5;
    $queue->send(@tasks);

    my $messages = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$messages, 5, 'received all 5 messages' );

    my @handles = map { $_->[0] } @$messages;
    $queue->completed( 'DW::Task::Test', @handles );

    my $empty = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$empty, 0, 'queue empty after completing all' );
};

# ============================================================
# Task work() return values
# ============================================================

subtest 'task work returns COMPLETED' => sub {
    my $task = DW::Task::Test->new( { fail => 0 } );
    my $res  = $task->work('fake-handle');
    is( $res, DW::Task::COMPLETED, 'work returned COMPLETED' );
};

subtest 'task work returns FAILED' => sub {
    my $task = DW::Task::Test->new( { fail => 1 } );
    my $res  = $task->work('fake-handle');
    is( $res, DW::Task::FAILED, 'work returned FAILED' );
};

# ============================================================
# Dedup (requires memcached)
# ============================================================

subtest 'dedup claim and release' => sub {
    my $queue_name = 'DW::Task::Test';
    my $key        = 'dedup-test-' . $$;

    # Clean up any leftover key
    DW::TaskQueue::Dedup->release_unique( $queue_name, $key );

    # First claim should succeed
    ok( DW::TaskQueue::Dedup->claim_unique( $queue_name, $key, 60 ), 'first claim succeeds' );

    # Second claim should fail (duplicate)
    ok( !DW::TaskQueue::Dedup->claim_unique( $queue_name, $key, 60 ),
        'second claim fails (duplicate)' );

    # is_pending should return true
    ok( DW::TaskQueue::Dedup->is_pending( $queue_name, $key ), 'is_pending returns true' );

    # Release and re-claim should succeed
    DW::TaskQueue::Dedup->release_unique( $queue_name, $key );
    ok( !DW::TaskQueue::Dedup->is_pending( $queue_name, $key ),
        'is_pending returns false after release' );
    ok( DW::TaskQueue::Dedup->claim_unique( $queue_name, $key, 60 ),
        'claim succeeds after release' );

    # Clean up
    DW::TaskQueue::Dedup->release_unique( $queue_name, $key );
};

# ============================================================
# Dispatch with dedup integration
# ============================================================

subtest 'dispatch skips duplicate tasks' => sub {
    my $key = 'dispatch-dedup-' . $$;

    # Clean up
    DW::TaskQueue::Dedup->release_unique( 'DW::Task::Test', $key );

    # First dispatch should enqueue
    my $task1 = DW::Task::Test->new(
        { n => 1 },
        uniqkey   => $key,
        dedup_ttl => 60,
    );
    my $rv1 = DW::TaskQueue::dispatch( $queue, $task1 );
    ok( $rv1, 'first dispatch succeeded' );

    # Second dispatch with same key should be skipped
    my $task2 = DW::Task::Test->new(
        { n => 2 },
        uniqkey   => $key,
        dedup_ttl => 60,
    );
    my $rv2 = DW::TaskQueue::dispatch( $queue, $task2 );
    is( $rv2, 1, 'second dispatch returns 1 (skipped, no error)' );

    # Only one message should be in the queue
    my $messages = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$messages,                   1, 'only one task enqueued despite two dispatches' );
    is( $messages->[0]->[1]->args->[0]->{n}, 1, 'it is the first task' );

    # Clean up
    $queue->completed( 'DW::Task::Test', $messages->[0]->[0] );
    DW::TaskQueue::Dedup->release_unique( 'DW::Task::Test', $key );
};

subtest 'dispatch without dedup enqueues all' => sub {
    my @tasks = map { DW::Task::Test->new( { n => $_ } ) } 1 .. 3;
    DW::TaskQueue::dispatch( $queue, @tasks );

    my $messages = $queue->receive( 'DW::Task::Test', 10 );
    is( scalar @$messages, 3, 'all 3 tasks enqueued without dedup' );

    my @handles = map { $_->[0] } @$messages;
    $queue->completed( 'DW::Task::Test', @handles );
};

done_testing;

1;

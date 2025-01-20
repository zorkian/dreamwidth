#!/usr/bin/perl
#
# DW::Counter
#
# Modern counter management. Used to replace AUTO_INCREMENT so that we can use
# SQLite locally, but also generally just to simplify the database logic.
#
# Authors:
#      Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2024 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::Counter;

use strict;
use v5.10;
use Log::Log4perl;
my $log = Log::Log4perl->get_logger(__PACKAGE__);

sub alloc_counter {

}

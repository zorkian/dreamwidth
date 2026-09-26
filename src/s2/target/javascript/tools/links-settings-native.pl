#!/usr/bin/perl
# links-settings-native.pl
#
# Fixed-stock anonymous no-effect owner-setting request qualification.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#
use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin";
our $COMPARISON_CLOCK_ACTIVE;
BEGIN {
    *CORE::GLOBAL::time = sub () { $main::COMPARISON_CLOCK_ACTIVE ? 1790294400 : CORE::time() };
    require "$ENV{LJHOME}/cgi-bin/ljlib.pl";
}
my $setting = shift @ARGV;
my %values = (timezone => 'Pacific/Auckland', opt_no_quickreply => 'Y',
    use_journalstyle_icons_page => 'Y');
die "Invalid setting qualification\n" unless defined $setting && ($setting eq 'baseline' || exists $values{$setting});
my $original = LJ::User->can('prop');
die "Missing native property helper\n" unless $original;
{
    no warnings 'redefine';
    local *LJ::User::prop = sub {
        my ($u,$name,@rest) = @_;
        return $values{$setting} if !@rest && $setting ne 'baseline' &&
            $u->user eq 's2js_slice3' && $name eq $setting;
        return $original->(@_);
    };
    # Same retained request/oracle with only the selected owner getter supplied
    # differently. No account mutation; anonymous remote remains absent.
    my $result = do "$ENV{LJHOME}/src/s2/target/javascript/tools/live-oracle.pl";
    die $@ if $@;
    die "Oracle failed: $!\n" unless defined $result;
}

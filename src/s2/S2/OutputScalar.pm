#!/usr/bin/perl
#

package S2::OutputScalar;

use strict;

sub new {
    my ($class, $scalar) = @_;
    my $initial = $$scalar;
    my $ref = [ $scalar, 1 + ($initial =~ tr/\n/\n/) ];
    bless $ref, $class;
}

sub write {
    ${$_[0]->[0]} .= $_[1];
    my $text = $_[1];
    $_[0]->[1] += ($text =~ tr/\n/\n/);
}

sub writeln {
    ${$_[0]->[0]} .= $_[1] . "\n";
    my $text = $_[1];
    $_[0]->[1] += 1 + ($text =~ tr/\n/\n/);
}

sub newline {
    ${$_[0]->[0]} .= "\n";
    $_[0]->[1]++;
}

sub lineNumber { $_[0]->[1] }

sub flush { }


1;

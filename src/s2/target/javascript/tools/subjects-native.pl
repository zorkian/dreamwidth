#!/usr/bin/perl
# subjects-native.pl
#
# Retained subject contexts, stock wrappers and textual currents on fixed inputs.
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
use utf8;
use lib "$ENV{LJHOME}/cgi-bin";
require 'ljlib.pl';
use LJ::CleanHTML;
use LJ::S2;
use JSON::PP;
local $/;
my $inputs = JSON::PP->new->utf8->decode(<STDIN>);
die 'Bounded input required' unless ref $inputs eq 'ARRAY' && @$inputs <= 40;
my @rows;
{
    no warnings 'redefine';
    local *LJ::get_db_reader = sub { die "Native fixture forbids DB reads\n" };
    local *LJ::get_db_writer = sub { die "Native fixture forbids DB writes\n" };
    for my $input (@$inputs) {
        die 'Bounded scalar required' if ref $input || length($input) > 1024;
        my ( $subject, $all ) = ($input) x 2;
        LJ::CleanHTML::clean_subject(\$subject);
        LJ::CleanHTML::clean_subject_all(\$all);
        my @ctx;
        $ctx[S2::PROPS] = { text_nosubject => 'NO SUBJECT', all_entrysubjects => 1,
            text_nosubject_screenreader => 'HIDDEN' };
        my %row = ( source => $input, subject => $subject, all => $all,
            og => LJ::ehtml( $all || '(no subject)' ) );
        for my $view (qw(recent entry)) {
            local $LJ::S2::CURR_PAGE = {view => $view};
            $row{$view} = S2::Builtin::LJ::EntryLite__formatted_subject( \@ctx,
                { _type => 'Entry', subject => $subject, full => $view eq 'entry',
                    permalink_url => 'https://journal.invalid/384.html' }, {} );
        }
        # Each textual current calls the same retained subject context. No mood
        # ID or coords: those still reach separately deferred native helpers.
        my %currents = LJ::currents({current_mood=>$input,current_music=>$input,
            current_location=>$input}, undef);
        $row{currents} = \%currents;
        push @rows, \%row;
    }
}
print JSON::PP->new->canonical->utf8->encode(\@rows);

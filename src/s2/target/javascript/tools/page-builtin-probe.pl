#!/usr/bin/perl
#
# page-builtin-probe.pl
#
# Probe retained Perl ehtml and formatted-subject edge behavior.
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
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use JSON::PP;
use LJ::S2;

my $ctx = [];
$ctx->[S2::PROPS] = {
    text_nosubject => '(no subject)',
    text_nosubject_screenreader => 'No subject',
    all_entrysubjects => 0,
};
local $LJ::S2::CURR_PAGE = { view => 'recent' };
my @subjects = ('Sample 1 & text', '', q{Mark's & text}, '<a href="/x">linked</a>');
my @formatted;
for my $subject (@subjects) {
    my %options;
    my $html = S2::Builtin::LJ::EntryLite__formatted_subject(
        $ctx,
        { _type => 'Entry', subject => $subject,
            permalink_url => 'https://example.invalid/entry' },
        \%options,
    );
    push @formatted, { subject => $subject, html => $html };
}
my @escaped = map { { input => $_, output => LJ::ehtml($_) } }
    ('Sample & text', q{Mark's <b>}, '"quoted"');
binmode STDOUT, ':raw';
print JSON::PP->new->canonical->utf8->encode({ ehtml => \@escaped, subjects => \@formatted });

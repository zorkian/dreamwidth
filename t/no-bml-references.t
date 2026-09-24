#!/usr/bin/perl
# No shipped file may reference the deleted BML engine's package or globals:
# a reintroduced `use DW::BML`/`BML::something` call compiles cleanly (the
# engine's own modules are gone, so this would actually fail to compile) but
# a bare `BML::foo(...)`/`$BML::something` call against a stub or typo'd
# package survives 00-compile.t and only dies at runtime.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use File::Find;

my @offenders;
File::Find::find(
    {
        wanted => sub {
            return unless -f $_ && /\.(?:pm|pl|t|tt)$/;
            open my $fh, '<', $_ or return;
            local $/;
            my $content = <$fh>;
            push @offenders, $File::Find::name
                if $content =~ /(?<!\w)(?:\$)?BML::/;
        },
        no_chdir => 1,
    },
    "$ENV{LJHOME}/cgi-bin",
    "$ENV{LJHOME}/views",
    "$ENV{LJHOME}/bin",
    "$ENV{LJHOME}/ext",
);

is_deeply( \@offenders, [], 'no file references the deleted BML:: package or $BML:: globals' );

done_testing;

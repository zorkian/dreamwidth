# source-url-facts.pl
#
# Offline retained URL-map case semantics; no proxy configuration.
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
use LJ::CleanHTML;
use HTML::Parser;
use JSON::PP;

die "Own proxy-absent fixture required" if $LJ::PROXY_URL || $LJ::PROXY_SALT_FILE;
my $raw = do { local $/; <STDIN> };
die "Oversized fixture" if length($raw) > 65536;
my $cases = decode_json($raw);
die "Invalid fixture" unless ref($cases) eq 'ARRAY' && @$cases <= 128;
my @result;
for my $case (@$cases) {
    local $LJ::DOMAIN             = $case->{siteDomain};
    local %LJ::KNOWN_HTTPS_SITES  = map { $_ => 1 } @{ $case->{known} };
    local %LJ::FORM_DOMAIN_BANNED = map { $_ => 1 } @{ $case->{banned} };
    my $image = LJ::CleanHTML::https_url( $case->{url} );
    my $body  = '<form action="' . $case->{url} . '"><p>form</p></form>';
    LJ::CleanHTML::clean_event( \$body, { editor => 'html_raw0' } );
    my $action;
    my $parser = HTML::Parser->new(
        api_version => 3,
        start_h     => [ sub { $action = $_[1]{action} if $_[0] eq 'form' }, 'tagname,attr' ]
    );
    $parser->parse($body);
    $parser->eof;
    push @result, { image => $image, action => $action };
}
print encode_json( \@result );

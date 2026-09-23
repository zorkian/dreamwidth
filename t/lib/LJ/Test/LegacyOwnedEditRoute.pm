#
# LJ::Test::LegacyOwnedEditRoute
#
# Test-only composition for retained owned-edit form fixtures.
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
# This program is free software; you may redistribute it and/or modify it
# under the same terms as Perl itself.  For a copy of the license, please
# reference 'perldoc perlartistic' or 'perldoc perlgpl'.
#
package LJ::Test::LegacyOwnedEditRoute;
use strict;
use warnings;
use lib "$ENV{LJHOME}/cgi-bin";

use DW::BML;
use DW::Request;

# Return a routing definition that deliberately keeps old BML only as a form
# source.  POST and every non-GET method still invoke the caller's captured
# production handler, so old-schema requests exercise the real dispatch.
sub retained_bml_get_route {
    my ($original) = @_;
    die 'missing original editjournal route' unless $original && $original->{sub};

    my $original_sub = $original->{sub};
    return {
        %$original,
        sub => sub {
            my ( $callinfo, @args ) = @_;
            my $r = DW::Request->get;
            return $original_sub->( $callinfo, @args ) unless $r && $r->method eq 'GET';

            my ( $redirect, $resolved_uri, $file ) = DW::BML->resolve_path( $r->path );
            return $r->redirect($redirect) if defined $redirect;
            return $original_sub->( $callinfo, @args ) unless $file;
            DW::BML->render( $file, $resolved_uri );
            return $r->OK;
        },
    };
}

# Temporarily compose one application route so fixtures can obtain a retained
# BML form without making their subsequent POST exercise a test-only handler.
# The dynamic scope is deliberately callback-only: callers retain parsed
# controls and submit after it returns.
sub with_retained_bml_get_route {
    my ( $route, $callback ) = @_;
    die 'missing route name' unless defined $route && length $route;
    die 'missing retained BML callback' unless ref $callback eq 'CODE';

    my $original = $DW::Routing::string_choices{$route};
    die "missing $route route" unless $original && $original->{sub};

    local $DW::Routing::string_choices{$route} = retained_bml_get_route($original);
    return $callback->($original);
}

1;

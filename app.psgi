#!/usr/bin/perl
#
# app.psgi
#
# Dreamwidth entrypoint for Plack.
#
# Authors:
#      Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2021 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use v5.10;
use Log::Log4perl;
my $log = Log::Log4perl->get_logger(__PACKAGE__);

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use Plack::Builder;

use DW::Request::Plack;
use DW::Routing;

# Initial configuration that happens on server startup goes here, these things don't
# change from request to request, so only put things here that never change
BEGIN {
    # If we're a DEV server, do some configuration
    $LJ::IS_DEV_SERVER = 1 if $ENV{LJ_IS_DEV_SERVER};
    $^W                = 1 if $LJ::IS_DEV_SERVER;

    # Configure S2
    S2::set_domain('LJ');

    # Configure language library
    # TODO: Why is this commented out here?
    # my $lang = $LJ::DEFAULT_LANG || $LJ::LANGS[0];
    # BML::set_language( $lang, \&LJ::Lang::get_text );

    # Initialize random
    # TODO: Make sure this is fired once per child if we're in preforking mode?
    srand( LJ::urandom_int() );
}

my $app = sub {
    my $r = DW::Request->get( plack_env => $_[0] );

    # Main request dispatch; this will determine what kind of request we're getting
    # and then pass it to the appropriate handler. In the future, this should just
    # be a call to DW::Routing and let it sort it out with all the controllers and
    # such, but until then, we're having to dispatch between various generations
    # of systems ourselves.
    my $uri = $r->path;
    $log->debug( 'Routing for URI: ', $uri );
    if ( $uri =~ qr!^/api/v\d+/! ) {
        DW::Routing->call( uri => $uri );
    }

    return $r->res;
};

# Apply the middleware. Ordering is important!
builder {
    # Handle OPTIONs requests and otherwise only allow the methods that we expect
    # to be allowed; this will abort any calls that are methods that not accepted
    enable 'Options', allowed => [qw /DELETE GET HEAD POST PUT/];

    # Manages start/end request and things we might want to do around the entire
    # request lifecycle such as logging, resource checking, etc
    enable 'DW::RequestWrapper';

    # Middleware for doing domain redirect management, i.e., we want to ensure that the
    # user has ended up on the right domain (www.dreamwidth.org instead of dreamwidth.co.uk
    # and the like), is also responsible for managing redirect.dat etc
    # TODO: still need to implement redirect.dat
    enable 'DW::Redirects';

    if ($LJ::IS_DEV_SERVER) {
        enable 'DW::Dev';
    }

    # Ensure that we get the real user's IP address instead of a proxy
    enable 'DW::XForwardedFor';

    # Middleware for doing static content (concat res)
    # ...

    # Middleware for ensuring we have the Unique Cookie set up
    # LJ::UniqCookie->ensure_cookie_value;
    # ...

    # Middleware for doing user authentication (get remote)
    #   NOTE: must support 'as=' parameter in dev servers, this is not done in the core auth
    #   flows in the Apache path
    # ...

    # Middleware for doing sysban blocking
    # ...

    # Middleware for bailing out to handle embedded journal content
    # return DW::Routing->call( uri => '/journal/embedcontent' );
    # ...

    $app;
};

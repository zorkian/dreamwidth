#!/usr/bin/perl
# Verify classified terminal legacy /update responses without route registration.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Request;
use DW::Request::Plack;
use Plack::Middleware::DW::RequestWrapper;

my @seen;
my $getter = sub {
    my ( $lang, $key, undef, $args ) = @_;
    return LJ::Lang::get_text( $lang, $key, undef, $args )
        unless $key =~ m!^(?:Sorry|/update\.bml\.error\.(?:nonusercantpost|cantpost(?:\.title)?))$!;
    push @seen, $key;
    return
          $key eq 'Sorry'                             ? 'Marker Sorry'
        : $key eq '/update.bml.error.nonusercantpost' ? "Identity for $args->{sitename}"
        : $key eq '/update.bml.error.cantpost.title'  ? 'Marker Cannot Post'
        :                                               'Marker cannot post body';
};
my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $r       = DW::Request->get;
        my $variant = $r->get_args->{variant};
        LJ::Lang::set_request_context( getter => $getter );
        DW::Controller::Entry::legacy_update_terminal_response($variant);
        $r->status(200);
        return $r->res;
    }
);

{
    local $LJ::SITENAME = 'Site <name>';
    test_psgi $app, sub {
        my $send     = shift;
        my $identity = $send->( GET '/__terminal?variant=identity' );
        is( $identity->code, 200, 'identity terminal response is HTTP 200' );
        like( $identity->content, qr/Marker Sorry/, 'identity retains localized Sorry title' );
        like(
            $identity->content,
            qr/Identity for Site <name>/,
            'identity substitutes and escapes sitename'
        );
        unlike( $identity->content, qr/js-post-entry|updateForm/,
            'identity terminal response has no form' );
        unlike( $identity->content, qr/missing string/, 'identity has no missing translation' );

        local $LJ::MSG_NO_POST = q{Configured <a href="/no-post">cannot post</a>};
        my $configured = $send->( GET '/__terminal?variant=cantpost' );
        is( $configured->code, 200, 'configured cannot-post response is HTTP 200' );
        like( $configured->content, qr/Marker Cannot Post/, 'cannot-post retains legacy title' );
        like(
            $configured->content,
            qr{Configured <a href="/no-post">cannot post</a>},
            'configured cannot-post message preserves retained trusted HTML'
        );
        unlike(
            $configured->content,
            qr/Marker cannot post body/,
            'configured message suppresses fallback'
        );

        local $LJ::MSG_NO_POST = '';
        my $fallback = $send->( GET '/__terminal?variant=cantpost' );
        like(
            $fallback->content,
            qr/Marker cannot post body/,
            'empty configured message uses translated fallback'
        );
        unlike( $fallback->content, qr/js-post-entry|updateForm/,
            'cannot-post terminal response has no form' );
    };
}
is_deeply(
    \@seen,
    [
        'Sorry',                            '/update.bml.error.nonusercantpost',
        '/update.bml.error.cantpost.title', '/update.bml.error.cantpost.title',
        '/update.bml.error.cantpost'
    ],
    'sequential classified variants use only their absolute legacy translation keys'
);
done_testing;

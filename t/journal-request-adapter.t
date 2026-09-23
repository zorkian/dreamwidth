#!/usr/bin/perl
# Characterizes exactly which methods LJ::make_journal, the data_handler:*
# hook invocation, and the s2_head_content_extra hook call on the
# DW::BML::RequestAdapter that DW::Controller::Journal.pm and LJ::S2.pm
# construct and thread through journal rendering. Test-only: no production
# code is changed here. See doc/BML-JOURNAL-ADAPTER.md for the resulting
# method table and native-replacement proposal.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common qw(GET);
use Plack::Test;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
use DW::Controller::Journal;
use DW::Request::Plack;
use DW::BML;

# --- Recording proxy: wraps any DW::BML::RequestAdapter (or object it
# returns, e.g. ::Connection/::HeadersIn) and logs every method called on
# it -- name, arg count/types, and return shape -- without changing its
# behavior. Installed by overriding DW::BML::RequestAdapter::new, so every
# construction site in production code (DW/Controller/Journal.pm:285,317)
# is captured transparently. ---
package RecordingAdapterProxy;

our @LOG;

sub _describe {
    my ($val) = @_;
    return 'undef' unless defined $val;
    return ref($val) if ref($val);
    return $val =~ /^-?\d+(?:\.\d+)?$/ ? 'number' : 'string';
}

sub wrap {
    my ( $real, $label ) = @_;
    return $real unless ref $real;
    return bless { real => $real, label => $label || ref($real) }, __PACKAGE__;
}

our $AUTOLOAD;

sub AUTOLOAD {
    my $self   = shift;
    my $method = $AUTOLOAD;
    $method =~ s/.*:://;
    return if $method eq 'DESTROY';

    my $real = $self->{real};
    my $ctx  = wantarray;
    my @ret  = $ctx ? $real->$method(@_) : ( scalar $real->$method(@_) );

    push @LOG,
        {
        on      => $self->{label},
        method  => $method,
        argc    => scalar(@_),
        argtype => [ map { _describe($_) } @_ ],
        rettype => [ map { _describe($_) } @ret ],
        };

    # Recursively wrap nested method-based adapter objects (Connection, Pool,
    # ErrHeadersOut) so calls made *on those* are captured too. HeadersIn/
    # HeadersOut/Notes overload %{} for tied ->{key} access instead of plain
    # method calls -- wrapping those in a plain-hashref proxy would break
    # that overload, so they're left unwrapped; their accessor call
    # (headers_out, notes, etc.) is still recorded above.
    my %safe_to_wrap = map { $_ => 1 } qw(
        DW::BML::RequestAdapter::Connection
        DW::BML::RequestAdapter::Pool
        DW::BML::RequestAdapter::ErrHeadersOut
    );
    @ret = map { $safe_to_wrap{ ref($_) // '' } ? wrap($_) : $_ } @ret;

    return $ctx ? @ret : $ret[0];
}

package main;

no warnings 'redefine';
local *DW::BML::RequestAdapter::new = sub {
    my ( $class, $r ) = @_;
    return RecordingAdapterProxy::wrap( bless( { r => $r }, 'DW::BML::RequestAdapter' ),
        'DW::BML::RequestAdapter' );
};

# Same harness as t/plack-journal-feeds.t: an HTTP-level controller harness
# that supplies a normal Plack request while bypassing vhost policy and
# DW::Routing, which are outside journal-rendering adapter usage.
sub journal_app {
    my ($user) = @_;
    return sub {
        my ($env) = @_;
        DW::Request->reset;
        my $r = DW::Request::Plack->new($env);
        $r->status(200);
        my $ret = DW::Controller::Journal->render(
            user => $user,
            uri  => $r->uri,
            args => $r->query_string,
        );
        $r->status($ret) if defined $ret && !ref $ret && $ret > 0;
        return $ret if ref $ret;
        return $r->res;
    };
}

my $u = temp_user();
$u->update_self( { status => 'A' } );
my $entry = $u->t_post_fake_entry(
    subject => 'Adapter characterization subject',
    event   => 'Adapter characterization body',
);

local *DW::Routing::call = sub { return undef };
local *LJ::get_cap       = sub { return $_[1] eq 'userdomain' ? 1 : 0 };

subtest 'S2 HTML journal page render (LJ::make_journal main adapter)' => sub {

    # This devcontainer's test DB has no S2 style layers installed (same
    # constraint noted in t/plack-adult-content.t), so LJ::make_journal hits
    # an S2 compile error ("Undefined function modules_init()") before it can
    # produce real page content. That error path still exercises the adapter
    # (LJ::S2.pm:80 calls $apache_r->OK on this exact branch), which is
    # enough to confirm real production code reaches it; the full method set
    # below is cross-checked against a direct read of every $opts->{r}/
    # $apache_r use in LJ::S2.pm (see doc/BML-JOURNAL-ADAPTER.md).
    @RecordingAdapterProxy::LOG = ();
    test_psgi journal_app( $u->user ), sub {
        my $cb  = shift;
        my $res = $cb->( GET 'http://localhost/' );
        is( $res->code, 200,
            'journal recent page responds (S2 error page, not real content, here)' );
    };
    my @methods = do {
        my %seen;
        grep { !$seen{$_}++ } map { $_->{method} } @RecordingAdapterProxy::LOG;
    };
    ok( ( grep { $_ eq 'OK' } @methods ),
        'error path calls the adapter\'s OK method (LJ::S2.pm:80)' );
    diag( 'HTML journal page adapter methods (this environment\'s S2-error path): '
            . join( ', ', @methods ) );
};

subtest 'RSS feed render (does not touch the adapter at all)' => sub {
    @RecordingAdapterProxy::LOG = ();
    test_psgi journal_app( $u->user ), sub {
        my $cb  = shift;
        my $res = $cb->( GET 'http://localhost/data/rss' );
        is( $res->code, 200, 'RSS feed renders' );
        like( $res->content, qr/<rss\b/i, 'RSS root element present' );
    };

    # Important negative result: RSS/Atom do NOT go through data_handler:*
    # (no in-tree "data_handler:rss" registration exists) *and* never call
    # anything on the main adapter either -- grep -n '\$opts->{.r.}|apache_r'
    # cgi-bin/LJ/Feed.pm has zero matches. LJ::make_journal still constructs
    # and receives the adapter (DW/Controller/Journal.pm:317 always builds
    # one), it just never gets used for feed rendering, which flows through
    # the returned $html string and the $opts hash's own status/contenttype
    # fields instead (applied to the real DW::Request by Journal.pm itself).
    is( scalar(@RecordingAdapterProxy::LOG),
        0, 'RSS render calls zero methods on the adapter it is nonetheless given' );
};

subtest 'FOAF request via a locally-registered data_handler:foaf hook' => sub {

    # Unlike rss/atom, FOAF has no built-in handler anywhere in this tree
    # (grep -rn foaf cgi-bin/LJ/S2.pm cgi-bin/LJ/Feed.pm: no matches) -- it is
    # exactly the kind of request the data_handler:* extension point exists
    # for. Register a disposable hook to exercise Journal.pm's OWN adapter
    # construction (DW/Controller/Journal.pm:285), separate from the one
    # LJ::make_journal receives.
    local $LJ::HOOKS{'data_handler:foaf'};
    my @handler_args;
    LJ::Hooks::register_hook(
        'data_handler:foaf',
        sub {
            my ( $user, $data_path ) = @_;
            push @handler_args, { user => $user, data_path => $data_path };
            return sub {
                my ($adapter) = @_;
                $adapter->content_type('application/rdf+xml');
                $adapter->print('<rdf:RDF></rdf:RDF>');
                return;
            };
        }
    );

    @RecordingAdapterProxy::LOG = ();
    test_psgi journal_app( $u->user ), sub {
        my $cb  = shift;
        my $res = $cb->( GET 'http://localhost/data/foaf' );
        is( $res->code, 200, 'FOAF request handled by the registered data_handler:foaf hook' );
        like( $res->content, qr/<rdf:RDF>/, 'FOAF hook output reaches the response body' );
    };
    is( scalar(@handler_args),    1,        'data_handler:foaf hook fired exactly once' );
    is( $handler_args[0]->{user}, $u->user, 'hook received the journal username' );
    ok( scalar(@RecordingAdapterProxy::LOG) > 0,
        'data_handler hook path called at least one adapter method' );
    diag(
        'data_handler:foaf adapter methods: ' . join(
            ', ',
            do {
                my %seen;
                grep { !$seen{$_}++ } map { $_->{method} } @RecordingAdapterProxy::LOG;
            }
        )
    );
};

subtest 'Locally-registered s2_head_content_extra hook' => sub {

    # LJ::S2.pm:2467-2468 only reaches this hook deep inside a *successful*
    # S2 page render (building $p->{head_content}), which this environment's
    # missing S2 style layers prevent (see the HTML subtest above). Exercise
    # the hook's exact call convention directly instead -- same hook name,
    # same two positional args (remote, $opts->{r}) -- against a real
    # recording-wrapped adapter built the same way Journal.pm builds one, to
    # characterize what the hook receives and can do with it.
    local $LJ::HOOKS{'s2_head_content_extra'};
    my @hook_args;
    LJ::Hooks::register_hook(
        's2_head_content_extra',
        sub {
            my ( $remote, $r ) = @_;
            push @hook_args, { remote => $remote, r => $r };
            $r->connection->client_ip;    # prove it can call methods on the adapter
            return '<!-- extra head content -->';
        }
    );

    DW::Request->reset;
    my $plack_r = DW::Request::Plack->new(
        { REQUEST_METHOD => 'GET', PATH_INFO => '/', 'psgi.url_scheme' => 'http' } );
    @RecordingAdapterProxy::LOG = ();
    my $adapter = DW::BML::RequestAdapter->new($plack_r);
    my $extra   = LJ::Hooks::run_hook( 's2_head_content_extra', $u, $adapter );

    is( scalar(@hook_args), 1, 's2_head_content_extra hook fired exactly once' );
    isa_ok( $hook_args[0]->{r}, 'RecordingAdapterProxy',
        'hook receives the same kind of recording-wrapped adapter LJ::make_journal threads through'
    );
    is(
        $extra,
        '<!-- extra head content -->',
        'hook return value is used as head_content, unmodified'
    );
    ok(
        ( grep { $_->{method} eq 'connection' } @RecordingAdapterProxy::LOG ),
        'hook was able to call connection on the adapter it received'
    );
    ok(
        ( grep { $_->{on} eq 'DW::BML::RequestAdapter::Connection' } @RecordingAdapterProxy::LOG ),
        'and call client_ip on the connection object it got back'
    );
};

done_testing;

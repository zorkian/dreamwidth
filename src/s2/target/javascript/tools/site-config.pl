#!/usr/bin/perl
#
# site-config.pl
#
# Export a narrow private configuration snapshot for standalone journal startup.
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
no warnings 'once';
use DBI;
our $blocked_connections;

BEGIN {
    # Trusted executable config and hook imports can call DBI. The sticky count
    # also catches a config file which swallows the exception itself.
    no warnings 'redefine';
    *DBI::connect        = sub { $blocked_connections++; die "Database connection forbidden\n"; };
    *DBI::connect_cached = sub { $blocked_connections++; die "Database connection forbidden\n"; };
}
use LJ::Config;
use LJ::Hooks;
use File::Basename qw(dirname);
use File::Spec;
use File::Temp qw(tempfile);
use Getopt::Long qw(GetOptions);
use JSON::PP;
use Scalar::Util qw(looks_like_number);
use URI;

sub fail { die bless { message => $_[0] }, 'SiteConfigError'; }

sub string {
    my ( $value, $limit ) = @_;
    $limit ||= 4096;
    fail('Invalid source configuration')
        if !defined $value || ref $value || length($value) > $limit || $value =~ /\0/;
    return "$value";
}

sub number {
    my ($value) = @_;
    fail('Invalid numeric source configuration')
        unless defined $value
        && !ref $value
        && looks_like_number($value)
        && $value == $value
        && abs($value) <= 9007199254740991;
    return 0 + $value;
}

sub origin {
    my ($value) = @_;
    my $u = URI->new( string($value) )->canonical;
    fail('Provide an explicit HTTP(S) app/listen origin without path or credentials')
        unless $u->scheme
        && $u->scheme =~ /\Ahttps?\z/
        && $u->host
        && !defined $u->userinfo
        && !$u->query
        && !$u->fragment
        && ( $u->path eq '' || $u->path eq '/' );
    $u->path('');
    return $u->as_string;
}
sub truth { return $_[0] ? JSON::PP::true : JSON::PP::false; }

sub scalar_map {
    my ( $source, $numeric ) = @_;
    fail('Invalid source map') unless ref $source eq 'HASH';
    my %result;
    for my $key ( keys %$source ) {
        string( $key, 256 );
        $result{$key} = $numeric ? number( $source->{$key} ) : string( $source->{$key} );
    }
    return \%result;
}

sub export_config {
    my %opts;
    GetOptions( \%opts, 'output=s', 'artifact=s', 'app-origin=s', 'listen-origin=s',
        'listen-host=s', 'listen-port=i', 'local-socket=s' )
        or fail('Invalid exporter arguments');
    fail(     'Usage: site-config.pl --output PRIVATE_JSON --app-origin URL --listen-origin URL '
            . '[--artifact PATH --listen-host HOST --listen-port PORT --local-socket ABSOLUTE_PATH]'
    ) if @ARGV || !$opts{output};

    # Use exactly Config.pm's ordinary resolved order. Detect do() errors instead
    # of allowing a broken private file to fall through silently to defaults.
    for my $file (@LJ::CONFIG_FILES) {
        next unless defined $file && -e $file;
        local $@;
        local $!;
        my $result = do $file;
        fail('Cannot load ordinary site configuration') if $@ || ( !defined $result && $! );
    }
    $LJ::CONFIG_LOADED = 1;
    fail('Configuration attempted a database connection') if $blocked_connections;

    # Image/local image modules depend on completed site configuration, as in
    # ljlib's Config BEGIN before Global::Img. Avoid the broad ljlib bootstrap.
    require LJ::Global::Img;
    my $app_origin =
        origin($opts{'app-origin'}
            || $LJ::SITEROOT
            || fail('Missing app origin; provide --app-origin for a request-host-based site') );
    my $listen_origin = origin( $opts{'listen-origin'}
            || fail('Missing listener origin; provide --listen-origin') );
    my $listen_uri = URI->new($listen_origin);
    my $host       = string( $opts{'listen-host'} // '127.0.0.1', 253 );
    my $port       = $opts{'listen-port'} // $listen_uri->port;
    fail('Invalid listener host or port')
        if !$host
        || $host =~ /[\s\/\\?#\@]/
        || $port < 1
        || $port > 65535;

    my $local_socket = $opts{'local-socket'};
    fail('Invalid --local-socket; provide an absolute socket path')
        if defined $local_socket
        && ( !length($local_socket)
        || !File::Spec->file_name_is_absolute($local_socket)
        || $local_socket =~ /[\x00-\x1f\x7f]/ );

    # Presence detection must include installed site hooks, not just config's
    # initial HOOKS hash. Module imports stay under the no-connect tripwire.
    my $entry_hook   = LJ::Hooks::are_hooks('check_cap_s2viewentry');
    my $journal_hook = LJ::Hooks::are_hooks('journal_base');
    my $userpic_hook = LJ::Hooks::are_hooks('construct_userpic_url');
    my $tag_hook = LJ::Hooks::are_hooks('augment_s2_tag_list');
    my $tags_disabled = $LJ::DISABLED{tags};
    $tags_disabled = $tags_disabled->() if ref $tags_disabled eq 'CODE';
    fail('Hook discovery attempted a database connection') if $blocked_connections;
    my ( @sources, %pairs, %rules, @bits );
    for my $id ( sort keys %LJ::DBINFO ) {
        next if $id =~ /^_/;
        my $s = $LJ::DBINFO{$id};
        fail('Invalid configured database source') unless ref $s eq 'HASH';
        my $source_host = $s->{host} ? string( $s->{host}, 253 ) : undef;
        my $socket      = $s->{sock} ? string( $s->{sock} )      : undef;

        # Native libmysql uses a socket only for absent/empty host or exact
        # lowercase localhost. Other hosts use TCP even when sock is present.
        if ( !defined $source_host || $source_host eq 'localhost' ) {
            $socket //= $local_socket;
            fail('Local database endpoint needs explicit sock or --local-socket ABSOLUTE_PATH')
                unless defined $socket;
            fail('Invalid local database socket path')
                unless File::Spec->file_name_is_absolute($socket)
                && $socket !~ /[\x00-\x1f\x7f]/;
            $source_host = undef;
        }
        else {
            $socket = undef;
        }
        push @sources,
            {
            id         => string( $id, 256 ),
            host       => $source_host,
            port       => $s->{port} ? number( $s->{port} ) : undef,
            socketPath => $socket,
            database   => string( $s->{dbname} || 'livejournal', 256 ),
            user       => string( $s->{user} // '', 256 ),
            password   => string( $s->{pass} // '' ),
            roles      => scalar_map( $s->{role} || {}, 1 ),
            };
    }
    for my $id ( keys %LJ::CLUSTER_PAIR_ACTIVE ) {
        next unless $LJ::CLUSTER_PAIR_ACTIVE{$id};
        my $value = lc string( $LJ::CLUSTER_PAIR_ACTIVE{$id} );
        fail('Invalid active cluster pair') unless $value eq 'a' || $value eq 'b';
        $pairs{ string( $id, 256 ) } = $value;
    }
    fail('Invalid journal URL rules') unless ref $LJ::SUBDOMAIN_RULES eq 'HASH';
    for my $type ( keys %{$LJ::SUBDOMAIN_RULES} ) {
        my $rule = $LJ::SUBDOMAIN_RULES->{$type};
        fail('Invalid journal URL rule') unless ref $rule eq 'ARRAY' && @$rule == 2;
        $rules{ string( $type, 256 ) } = [ truth( $rule->[0] ), string( $rule->[1] // '' ) ];
    }
    my $move_mask = 0;
    for my $bit ( sort { $a <=> $b } keys %LJ::CAP ) {
        fail('Invalid capability bit') unless $bit =~ /\A\d+\z/ && $bit <= 31;
        my $c = $LJ::CAP{$bit};
        fail('Invalid capability definition') unless ref $c eq 'HASH';
        $move_mask += 2**$bit
            if ( $c->{_name} // '' ) eq '_moveinprogress'
            && defined $c->{readonly}
            && $c->{readonly} == 1;
        push @bits, { bit => 0 + $bit, value => number( $c->{s2viewentry} ) }
            if defined $c->{s2viewentry};
    }
    my $image = $LJ::Img::img{placeholder};
    fail('Invalid placeholder configuration') unless ref $image eq 'HASH';
    my @language_files = grep { defined $_ } map { LJ::resolve_file($_) }
        ( "bin/upgrading/$LJ::DEFAULT_LANG.dat", 'bin/upgrading/en.dat' );
    my $config = {
        schema       => 1,
        listener     => { host => $host, port => 0 + $port },
        artifactPath => File::Spec->rel2abs(
            $opts{artifact} // "$ENV{LJHOME}/src/s2/target/javascript/artifacts/live/stock.json"
        ),
        app => {
            canonicalAppOrigin => $app_origin,
            listenOrigin       => $listen_origin,
            siteRoot           => string( $LJ::SITEROOT // '' ),
            statPrefix         => string( $LJ::STATPREFIX // '' ),
            jsPrefix           => string( $LJ::JSPREFIX // '' ),
            userDomain         => string( $LJ::USER_DOMAIN // '' ),
            journalUrls        => {
                protocol       => string($LJ::PROTOCOL),
                domain         => string( $LJ::DOMAIN // '' ),
                isDevServer    => truth($LJ::IS_DEV_SERVER),
                subdomainRules => \%rules,
                hookConfigured => truth($journal_hook)
            },
            usernameMaxLength   => number($LJ::USERNAME_MAXLENGTH),
            maxScrollback       => number($LJ::MAX_SCROLLBACK_LASTN),
            imgPrefix           => string( $LJ::IMGPREFIX // '' ),
            palImgRoot          => string( $LJ::PALIMGROOT // '' ),
            userpicRoot         => string( $LJ::USERPIC_ROOT // '' ),
            userpicUrlHookConfigured => truth($userpic_hook),
            tagsEnabled => truth(!$tags_disabled),
            tagListHookConfigured => truth($tag_hook),
            siteName            => string( $LJ::SITENAME // '' ),
            siteNameShort       => string( $LJ::SITENAMESHORT // '' ),
            siteNameAbbrev      => string( $LJ::SITENAMEABBREV // '' ),
            appleTouchIcon      => string( $LJ::APPLE_TOUCH_ICON // '' ),
            facebookPreviewIcon => string( $LJ::FACEBOOK_PREVIEW_ICON // '' ),
            entryContent        => {
                urls => {
                    siteDomain => string( $LJ::DOMAIN // '' ),
                    knownHttpsSites =>
                        [ sort grep { $LJ::KNOWN_HTTPS_SITES{$_} } keys %LJ::KNOWN_HTTPS_SITES ],
                    formDomainBanned =>
                        [ sort grep { $LJ::FORM_DOMAIN_BANNED{$_} } keys %LJ::FORM_DOMAIN_BANNED ],
                    imageProxy => 'not-configured'
                }
            },
        },
        placeholder => {
            descriptor => {
                src    => string( ( $LJ::IMGPREFIX // '' ) . $image->{src} ),
                width  => number( $image->{width} ),
                height => number( $image->{height} ),
                altKey => string( $image->{alt} )
            },
            defaultLang   => string($LJ::DEFAULT_LANG),
            isDevServer   => truth($LJ::IS_DEV_SERVER),
            languageFiles => \@language_files
        },
        database => {
            defaultDatabase   => 'livejournal',
            sources           => \@sources,
            clusters          => [ map { number($_) } @LJ::CLUSTERS ],
            clusterPairActive => \%pairs
        },
        capabilities => {
            moveInProgressMask => $move_mask,
            s2ViewEntry        => {
                defaultValue => defined $LJ::CAP_DEF{s2viewentry}
                ? number( $LJ::CAP_DEF{s2viewentry} )
                : undef,
                byBit          => \@bits,
                hookConfigured => truth($entry_hook)
            }
        },
        styles => {
            defaultStyle => scalar_map( $LJ::DEFAULT_STYLE, 0 ),
            layerRemap   => scalar_map( \%LJ::S2LID_REMAP,  1 )
        },
    };
    fail('Configuration attempted a database connection') if $blocked_connections;
    my $json = JSON::PP->new->canonical->pretty->utf8->encode($config);
    fail('Configuration snapshot exceeds 64KiB') if length($json) > 65536;
    my $output = File::Spec->rel2abs( $opts{output} );
    fail('Refusing existing output; choose a fresh private configuration path')
        if -e $output || -l $output;
    my ( $fh, $temp ) = tempfile( '.site-config-XXXXXX', DIR => dirname($output), UNLINK => 0 );
    my $ok = eval {
        chmod 0600, $temp or fail('Cannot protect configuration snapshot');
        binmode $fh;
        print {$fh} $json or fail('Cannot write configuration snapshot');
        close $fh or fail('Cannot close configuration snapshot');

        # link is an atomic no-clobber publication, even if another writer races.
        link $temp, $output or fail('Cannot publish configuration snapshot');
        1;
    };
    my $error = $@;
    unlink $temp;
    die $error unless $ok;
}

# Config can contain secrets in warnings/exceptions. Capture those streams and
# expose only our bounded fixed diagnostics. Never forward native error strings.
my ( $ok, $error );
{
    open my $quiet, '>', File::Spec->devnull or die "Cannot isolate configuration diagnostics\n";
    local *STDERR = $quiet;
    local *STDOUT = $quiet;
    $ok    = eval { export_config(); 1 };
    $error = $@;
}
unless ($ok) {
    my $message =
        ref $error eq 'SiteConfigError'
        ? $error->{message}
        : 'Cannot export site configuration; check ordinary config and hook imports';
    print STDERR "$message\n";
    exit 1;
}
print "Private startup configuration exported; re-export and restart after config changes\n";

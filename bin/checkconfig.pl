#!/usr/bin/perl
#
# This code was forked from the LiveJournal project owned and operated
# by Live Journal, Inc. The code has been modified and expanded by
# Dreamwidth Studios, LLC. These files were originally licensed under
# the terms of the license supplied by Live Journal, Inc, which can
# currently be found at:
#
# http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
#
# In accordance with the original license, this code and all its
# modifications are provided under the GNU General Public License.
# A copy of that license can be found in the LICENSE file included as
# part of this distribution.


use strict;
use lib "$ENV{LJHOME}/extlib/lib/perl5";
use Getopt::Long;

my $show_packages = 0;
my $show_modules = 0;
my ($only_check, $no_check);

my %dochecks;   # these are the ones we'll actually do
my @checks = (  # put these in the order they should be checked in
    "timezone",
    "packages",
    "modules",
    "env",
    "database",
    "secrets",
);
foreach my $check (@checks) { $dochecks{$check} = 1; }

sub usage {
    die "Usage: checkconfig.pl

checkconfig.pl --show-packages
checkconfig.pl --show-modules
checkconfig.pl --only=<check> | --no=<check>

Checks are:
 " . join(', ', @checks);
}

usage() unless GetOptions(
    'show-packages' => \$show_packages,
    'show-modules'  => \$show_modules,
    'only=s'        => \$only_check,
    'no=s'          => \$no_check,
);
usage() if $only_check && $no_check;

my %modules = load_modules();
my $skip_output = $show_packages || $show_modules;

my @errors;
my $err = sub {
    return unless @_;
    die "\nProblem:\n" . join('', map { "  * $_\n" } @_);
};

if ( $show_modules ) {
    check_modules();
} elsif ( $show_packages ) {
    check_packages();
} else {
    %dochecks = ( $only_check => 1)
        if $only_check;

    $dochecks{$no_check} = 0
        if $no_check;

    foreach my $check (@checks) {
        next unless $dochecks{$check};
        my $cn = "check_" . $check;
        no strict 'refs';
        &$cn;
    }

    unless ( $skip_output ) {
        print "All good.\n";
        print "NOTE: checkconfig.pl doesn't check everything yet\n";
    }
}

###############################################################################
## helper functions that do checks below
##

sub load_modules {
    my %modules;

    open FILE, "<bin/install/MODULES"
        or die "checkconfig.pl must be run from LJHOME.\n";
    foreach my $module ( <FILE> ) {
        chomp $module;
        if ( $module =~ /^(.+)>=(.+)$/ ) {
            $modules{$1} = { ver => $2, opt => 0 };
        } else {
            $modules{$module} = { opt => 0 };
        }
    }
    close FILE;

    open FILE, "<bin/install/PACKAGES"
        or die "checkconfig.pl could not find PACKAGES!\n";
    foreach my $package ( <FILE> ) {
        chomp $package;
        $modules{$package} = { system => 1, deb => $package };
    }
    close FILE;

    return %modules;
}

sub check_packages {
    print "[Checking for Debian Packages...]\n"
        unless $skip_output;

    my @debs;
    foreach my $mod ( sort keys %modules ) {
        my $dt = $modules{$mod};
        push @debs, $dt->{deb} if $dt->{deb};
    }

    if ( $show_packages ) {
        print join( ' ', @debs );
    } elsif ( @debs ) {
        print STDERR "\n# apt-get install ", join( ' ', @debs ), "\n\n";
    }

    $err->(@errors);
}

sub check_modules {
    print "[Checking for Perl Modules....]\n"
        unless $skip_output;

    my (@debs, @mods);

    foreach my $mod (sort keys %modules) {
        my $dt = $modules{$mod};
        next if $dt->{deb};

        # If we're in show mode, don't check if we need to upgrade or anything
        if ( $show_modules ) {
            push @mods, $mod;
            next;
        }

        my $rv = eval "use $mod ();";
        if ($@) {
            unless ( $skip_output ) {
                push @errors, "Missing perl module: $mod";
            }
            push @mods, $mod;
            next;
        }

        my $ver_want = $dt->{ver};
        my $ver_got = $mod->VERSION;

        # handle version strings with multiple decimal points
        # assumes there will never be a version part prepended
        # only appended
        if ( $ver_want && $ver_got ) {
            my @parts_want = split( /\./, $ver_want );
            my @parts_got  = split( /\./, $ver_got  );
            my $invalid = 0;

            while ( scalar @parts_want ) {
                my $want_part = shift @parts_want || 0;
                my $got_part = shift @parts_got || 0;

                # If want_part is greater then got_part, older
                # If got_part is greater then want_part, newer
                # If they are the same, look at the next part pair
                if ( $want_part != $got_part ) {
                    $invalid = $want_part > $got_part ? 1 : 0;
                    last;
                }
            }
            if ( $invalid ) {
                push @errors, "Out of date module: $mod (need $ver_want, $ver_got installed)";
            }
        }
    }

    if ( $show_modules ) {
        print join( ' ', @mods );
    } elsif ( @mods ) {
        print "\n# curl -L http://cpanmin.us | sudo perl - --self-upgrade\n";
        print "# cpanm -L \$LJHOME/extlib/ " . join( ' ', @mods ) . "\n\n";
    }

    $err->(@errors);
}

sub check_env {
    print "[Checking LJ Environment...]\n"
        unless $skip_output;

    $err->("\$LJHOME environment variable not set.")
        unless $ENV{'LJHOME'};
    $err->("\$LJHOME directory doesn't exist ($ENV{'LJHOME'})")
        unless -d $ENV{'LJHOME'};

    eval { require "$ENV{'LJHOME'}/cgi-bin/ljlib.pl"; };
    $err->("Failed to load ljlib.pl: $@") if $@;

    $err->("No config-local.pl file found at etc/config-local.pl")
        unless LJ::resolve_file( 'etc/config-local.pl' );

}

sub check_database {
    require "$ENV{'LJHOME'}/cgi-bin/ljlib.pl";
    my $dbh = LJ::get_dbh("master");
    unless ($dbh) {
        $err->("Couldn't get master database handle.");
    }
    foreach my $c (@LJ::CLUSTERS) {
        my $dbc = LJ::get_cluster_master($c);
        next if $dbc;
        $err->("Couldn't get db handle for cluster \#$c");
    }
}

sub check_timezone {
    print "[Checking Timezone...]\n"
        unless $skip_output;

    my $rv = eval "use DateTime::TimeZone;";
    if ($@) {
        $err->( "Missing required perl module: DateTime::TimeZone" );
    }

    my $timezone = DateTime::TimeZone->new( name => 'local' );

    $err->( "Timezone must be UTC." ) unless $timezone->is_utc;
}

sub check_secrets {
    print "[Checking Secrets...]\n"
        unless $skip_output;

    foreach my $secret ( keys %LJ::Secrets::secret ) {
        my $def = $LJ::Secrets::secret{$secret};
        my $req_len = exists $def->{len} || exists $def->{min_len} || exists $def->{max_len};
        my $rec_len = exists $def->{rec_len} || exists $def->{rec_min_len} || exists $def->{rec_max_len};

        my $req_min = $def->{len} || $def->{min_len} || 0;
        my $req_max = $def->{len} || $def->{max_len} || 0;

        my $rec_min = $def->{rec_len} || $def->{rec_min_len} || 0;
        my $rec_max = $def->{rec_len} || $def->{rec_max_len} || 0;
        my $val = $LJ::SECRETS{$secret} || '';
        my $len = length( $val );

        if ( ! defined( $LJ::SECRETS{$secret} ) || ! $LJ::SECRETS{$secret} ) {
            if ( $def->{required} ) {
                $err->( "Missing requred secret '$secret': $def->{desc}" );
            } else {
                print STDERR "Missing optional secret '$secret': $def->{desc}\n";
            }
        } elsif ( $req_len && ( $len < $req_min || $len > $req_max ) ) {
            if ( $req_min == $req_max ) {
                $err->( "Secret '$secret' not of required length: is $len, must be $req_min" );
            } else {
                $err->( "Secret '$secret' not of required length: is $len, must be between $req_min and $req_max" );
            }
        } elsif ( $rec_len && ( $len < $rec_min || $len > $rec_max ) ) {
            if ( $rec_min == $rec_max ) {
                print STDERR "Secret '$secret' not of recommended length: is $len, should be $rec_min\n";
            } else {
                print STDERR "Secret '$secret' not of recommended length: is $len, should be between $rec_min and $rec_max\n";
            }
        }
    }
}

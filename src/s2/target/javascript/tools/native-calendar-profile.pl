#!/usr/bin/perl
# native-calendar-profile.pl
#
# Trusted installed calendar, timezone and interpreter dependency extraction.
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
# Rolling-century arithmetic derives from Time::Local 1.30, copyright (c)
# 1997-2020 Graham Barr & Dave Rolsky, under the same terms as Perl 5.
#
use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../../../../../cgi-bin";
use DBI ();
our $database_attempted;
BEGIN {
    no warnings 'redefine';
    *DBI::connect = sub { $database_attempted = 1; die "Calendar database access forbidden\n" };
    *DBI::connect_cached = sub { $database_attempted = 1; die "Calendar database access forbidden\n" };
}
our $module_year;
BEGIN {
    die "Calendar module was preloaded before issuance\n" if exists $INC{'Time/Local.pm'};
    $module_year = (localtime)[5];
    require Time::Local;
    die "Calendar year changed while loading module\n" unless (localtime)[5] == $module_year;
}
use Config;
use Cwd qw(abs_path);
use Digest::SHA qw(sha256_hex);
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use POSIX ();

my %files;
sub bytes {
    my ($path) = @_;
    $path = abs_path($path) // die "Calendar dependency missing\n";
    open my $in, '<:raw', $path or die "Calendar dependency unavailable\n";
    local $/;
    my $value = <$in>;
    close $in;
    $files{$path} = sha256_hex($value);
    return $value;
}
die "Calendar interpreter profile unsupported\n"
    unless $] == 5.034 && $Time::Local::VERSION eq '1.30' && $^O eq 'linux' &&
        $Config{ivsize} == 8 && $Config{uvsize} == 8 && $Config{nvsize} == 8 &&
        $Config{nvtype} eq 'double' && $Config{nv_preserves_uv_bits} == 53;
my $time_module = abs_path("$FindBin::Bin/../../../../../cgi-bin/LJ/Time.pm");
require $time_module;
my $config = bytes("$Config{archlib}/CORE/config.h");
my %limits;
for my $name (qw(LOCALTIME_MIN LOCALTIME_MAX)) {
    $config =~ /^#define\s+$name\s+(-?\d+)/m or die "Calendar native limit missing\n";
    $limits{$name} = $1;
}
# Loading Time::Local above latches this process's local year. No calendar call
# is made before recording it; a year rollover during setup fails closed.
my $year = $module_year;
my $breakpoint = ($year + 50) % 100;
my $next = $year - $year % 100;
$next += 100 if $breakpoint < 50;
my $tz = $ENV{TZ};
my $directory = $ENV{TZDIR};
$directory = '/usr/share/zoneinfo' unless defined($directory) && length($directory);
my $name = defined $tz ? ($tz eq '' ? 'Universal' : $tz) : '/etc/localtime';
$name =~ s/^://;
my $path = $name =~ m{^/} ? $name : "$directory/$name";
my $zone;
if (-f $path && substr(bytes($path), 0, 4) eq 'TZif') {
    $zone = { kind => 'tzif', path => abs_path($path), base64 => encode_base64(bytes($path), ''),
        fallbackHex => unpack('H*', $name) };
} else {
    # libc tries a file first, then interprets the original spelling as POSIX.
    # An omitted-rule DST specification can additionally load posixrules.
    $zone = { kind => 'posix', textHex => unpack('H*', $name) };
}
my $rules = "$directory/posixrules";
if (-f $rules) {
    $zone->{defaultRules} = encode_base64(bytes($rules), '');
    $zone->{defaultRulesPath} = abs_path($rules);
}
my @latch_checks = map {
    {year => $_, epoch => '' . Time::Local::timegm(0, 0, 0, 1, 0, $_)}
} ($breakpoint, $breakpoint + 1);
die "Calendar epoch differs\n" unless Time::Local::timegm(0, 0, 0, 1, 0, 1970) == 0;
my @epoch_parts = gmtime(0);
die "Calendar native epoch differs\n" unless join(',', @epoch_parts[0 .. 5]) eq '0,0,0,1,0,70';
LJ::day_of_week(2026, 1, 0);
my $error = $@;
my $prefix = "Day '0' out of range 1..31";
die "Calendar native croak shape differs\n" unless index($error, $prefix) == 0;
my $error_suffix = substr($error, length($prefix));
LJ::day_of_week(2200000000, 1, 1);
my $range_error = $@;
my ($max_day) = $range_error =~ /^Day too big - [^\n]+ > (\d+)\n/;
die "Calendar native maximum differs\n" unless defined($max_day) && $max_day == 365 * 2**31;
my %epochs = map { $_ => 1 } (0, -62167219201, -62167219200, -62167219199,
    67723044323328000 - 86400, 67723044323328000 + 86400);
# Decode only the fixed TZif table framing to select independent checks. The
# serving parser/model itself is in general-native-calendar.ts, not this tool.
sub transitions {
    my ($raw) = @_;
    return unless length($raw) >= 44 && substr($raw, 0, 4) eq 'TZif';
    my @counts = unpack('N6', substr($raw, 20, 24));
    my $cursor = 44;
    my $width = 4;
    if (substr($raw, 4, 1) ne "\0") {
        $cursor += $counts[3] * 5 + $counts[4] * 6 + $counts[5] + $counts[2] * 8 + $counts[0] + $counts[1];
        return unless $cursor + 44 <= length($raw) && substr($raw, $cursor, 4) eq 'TZif';
        @counts = unpack('N6', substr($raw, $cursor + 20, 24));
        $cursor += 44;
        $width = 8;
    }
    return unless $cursor + $counts[3] * ($width + 1) + $counts[4] * 6 + $counts[5] +
        $counts[2] * ($width + 4) + $counts[0] + $counts[1] <= length($raw);
    for (1 .. $counts[3]) {
        my $time = unpack($width == 8 ? 'q>' : 'l>', substr($raw, $cursor, $width));
        $cursor += $width;
        # Perl's pp_sys bounds are not a timezone restriction; values outside
        # the native localtime result domain cannot be model-check tuples.
        next if abs($time) >= 67723044323328000;
        $epochs{$time + $_} = 1 for (-1, 0, 1);
    }
    $cursor += $counts[3] + $counts[4] * 6 + $counts[5];
    for (1 .. $counts[2]) {
        my $time = unpack($width == 8 ? 'q>' : 'l>', substr($raw, $cursor, $width));
        $cursor += $width + 4;
        next if abs($time) >= 67723044323328000;
        $epochs{$time + $_} = 1 for (-1, 0, 1);
    }
}
if ($zone->{kind} eq 'tzif') { transitions(MIME::Base64::decode_base64($zone->{base64})); }
elsif ($zone->{defaultRules}) { transitions(MIME::Base64::decode_base64($zone->{defaultRules})); }
for my $y (2038, 2100, 2400) {
    # Independent recurrence checks around the year's quarters, not a date
    # catalog used to answer serving requests.
    $epochs{Time::Local::timegm(0, 0, 0, 1, $_, $y)} = 1 for (0, 3, 6, 9);
}
my @local_checks;
for my $epoch (sort { $a <=> $b } keys %epochs) {
    my @parts = localtime($epoch);
    die "Calendar localtime range invariant failed\n" unless @parts == 9;
    push @local_checks, {epoch => "$epoch", parts => \@parts};
}
bytes(__FILE__);
bytes("$FindBin::Bin/../live/domain/general-native-calendar.ts");
bytes($^X);
bytes($time_module);
for my $module (sort keys %INC) { bytes($INC{$module}) if -f $INC{$module}; }
for my $file (@DynaLoader::dl_shared_objects) { bytes($file) if -f $file; }
# Bind the actually loaded libc rather than guessing an architecture pathname.
open my $maps, '<', '/proc/self/maps' or die "Calendar libc identity missing\n";
my %libc;
while (<$maps>) { $libc{$1} = 1 if m{(/[^\n ]*/libc(?:-[^/ ]+)?\.so(?:\.\d+)*)\s*$}; }
close $maps;
die "Calendar libc identity ambiguous\n" unless keys(%libc) == 1;
my ($libc_version) = bytes((keys %libc)[0]) =~ /release version ([0-9.]+)\./;
die "Calendar libc profile unsupported\n" unless defined($libc_version) && $libc_version eq '2.35';
die "Calendar year changed during setup\n" unless (localtime)[5] == $year;
die "Calendar database access attempted\n" if $database_attempted;
binmode STDOUT, ':raw';
print JSON::PP->new->canonical->utf8->encode({
    schema => 1, perl => "$]", timeLocal => "$Time::Local::VERSION",
    libcVersion => $libc_version,
    archname => $Config{archname}, ivsize => "$Config{ivsize}", nvsize => "$Config{nvsize}",
    year => $year, breakpoint => $breakpoint, century => $next - 100, nextCentury => $next,
    epoc => 719469, maxDay => 365 * 2**31, secOff => 0,
    latchChecks => \@latch_checks, localChecks => \@local_checks,
    limits => \%limits, timezone => $zone,
    environment => {tzHex => defined($tz) ? unpack('H*', $tz) : undef,
        tzdirHex => exists($ENV{TZDIR}) ? unpack('H*', $ENV{TZDIR}) : undef},
    errorSuffixHex => unpack('H*', $error_suffix),
    sources => [map { {path => $_, sha256 => $files{$_}} } sort keys %files]
});

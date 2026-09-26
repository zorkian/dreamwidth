#!/usr/bin/perl
#
# page-fixture.pl
#
# Seed and export one real, stock S2 recent page from the local dev application.
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
use utf8;
our $FIXTURE_CLOCK_ACTIVE;
BEGIN {
    # Compile app calls through a switch so seed writes keep the real clock.
    *CORE::GLOBAL::time = sub () { $main::FIXTURE_CLOCK_ACTIVE ? 1790294400 : CORE::time() };
    require "$ENV{LJHOME}/cgi-bin/ljlib.pl";
}
use Digest::SHA qw(sha256_hex);
use Encode ();
use JSON::PP;
use Scalar::Util qw(blessed refaddr);
use LJ::Entry;
use LJ::Protocol;
use LJ::S2;
use Plack::Test;
use HTTP::Request::Common;

binmode STDOUT, ':encoding(UTF-8)';
binmode STDERR, ':encoding(UTF-8)';

my $outdir = shift @ARGV // die "Expected one output directory\n";
my $variant = @ARGV && $ARGV[0] eq '--variant-read' ? shift @ARGV : '';
die "Expected one output directory and optional --variant-read\n" if @ARGV || !-d $outdir;
die "Fixed Perl hash seed required\n"
    unless ($ENV{PERL_HASH_SEED} // '') eq '0'
    && ($ENV{PERL_PERTURB_KEYS} // '') eq '0';
die "Local devcontainer required\n" unless $LJ::IS_DEV_SERVER && $LJ::IS_DEV_CONTAINER;
my $db = LJ::get_db_writer() or die "No local database writer\n";
my $dbname = $db->selectrow_array('SELECT DATABASE()');
die "Unexpected database scope\n" unless $dbname eq 'dw_global';

my $username = 's2js_slice2';
my $display  = 'S2 slice 2 fixture';
my $marker   = 's2-js-slice2 fixture v1';
my $u = LJ::load_user($username);
if ($u) {
    die "Refusing unmarked account collision\n" unless ($u->bio(1) // '') eq $marker;
    $u->update_self( { name => $display } ) unless ($u->{name} // '') eq $display;
}
else {
    $u = LJ::User->create_personal(
        user => $username, email => 's2js-slice2@example.invalid',
        password => 'S2-local-fixture-only', name => $display,
    ) or die "Cannot create dedicated fixture account\n";
    $u->update_self( { status => 'A', statusvis => 'V', name => $display } );
    $u->set_bio($marker);
}
die "Fixture marker or display name missing\n"
    unless ($u->bio(1) // '') eq $marker && ($u->{name} // '') eq $display;

my $public = LJ::S2::get_public_layers();
my @names = ('core2', 'core2base/layout');
my @files = ('styles/core2.s2', 'styles/core2base/layout.s2');
my @hashes = (
    '8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6',
    'c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411',
);
my @layer_ids;
for my $i (0 .. $#names) {
    my $id = $public->{ $names[$i] }{s2lid} or die "Missing stock layer $names[$i]\n";
    my $source = LJ::S2::load_layer_source($id);
    die "Installed stock layer source mismatch: $names[$i]\n"
        unless defined $source && sha256_hex($source) eq $hashes[$i];
    my $file = "$ENV{LJHOME}/$files[$i]";
    open my $fh, '<:raw', $file or die "Cannot read $file: $!\n";
    local $/;
    my $local_source = <$fh>;
    die "Checkout stock layer source mismatch: $files[$i]\n"
        unless sha256_hex($local_source) eq $hashes[$i];
    push @layer_ids, $id;
}

my $styleid = $u->prop('s2_style');
my $style = $styleid ? LJ::S2::load_style($styleid) : undef;
if ($style && ($style->{name} // '') eq $marker) {
    my $parts = LJ::S2::get_style_layers($u, $styleid, 1);
    die "Owned style has unexpected layer stack\n"
        unless $parts->{core} == $layer_ids[0] && $parts->{layout} == $layer_ids[1]
        && !grep { $_ ne 'core' && $_ ne 'layout' && $parts->{$_} } keys %$parts;
}
else {
    $styleid = LJ::S2::create_style($u, $marker) or die "Cannot create fixture style\n";
    LJ::S2::set_style_layers($u, $styleid,
        core => $layer_ids[0], layout => $layer_ids[1]) or die "Cannot set stock layers\n";
    $u->set_prop(stylesys => 2);
    $u->set_prop(s2_style => $styleid);
}

my @rows = LJ::get_log2_recent_user({
    userid => $u->userid, clusterid => $u->{clusterid}, itemshow => 20,
});
my %found;
for my $row (@rows) {
    my $entry = LJ::Entry->new($u, jitemid => $row->{jitemid});
    next unless $entry && $entry->valid;
    my $subject = Encode::decode_utf8($entry->subject_raw // '');
    if ($subject =~ /^Sample ([12]) & text$/) {
        my $n = $1;
        die "Duplicate owned sample $n\n" if $found{$n}++;
        my $body = Encode::decode_utf8($entry->event_raw // '');
        my $expected_body = $variant && $n == 1
            ? '<p>Fixture 1 variant: café &amp; tea 😀</p>'
            : "<p>Fixture $n: café &amp; tea 😀</p>";
        die "Owned sample $n content differs\n"
            unless $body eq $expected_body
                && $entry->security eq 'public'
                && $entry->eventtime_mysql eq sprintf('2026-09-24 %02d:00:00', 10 + $n);
    }
    else {
        die "Unexpected entry in dedicated fixture account\n";
    }
}
for my $n (1 .. 2) {
    next if $found{$n};
    my %request = (
        mode => 'postevent', ver => $LJ::PROTOCOL_VER, user => $username,
        event => "<p>Fixture $n: café &amp; tea 😀</p>",
        subject => "Sample $n & text", security => 'public',
        year => 2026, mon => 9, day => 24, hour => 10 + $n, min => 0,
    );
    my %response;
    LJ::do_request(\%request, \%response, { noauth => 1, nomod => 1 });
    die "Cannot post owned sample $n: " . ($response{errmsg} // '') . "\n"
        unless ($response{success} // '') eq 'OK';
}

my $page;
my $props;
my %seen;
my %nodes;
my $next_id = 0;
my ($root, $property_root);
my %host = (
    viewer => 'anonymous', script_tags_html => '',
    footer_hook_body => '', footer_hook_journal => '',
    owner_user => $username, owner_userid => $u->userid,
);
my $original = \&LJ::S2::s2_run;
my $app = do "$ENV{LJHOME}/app.psgi";
die "Cannot load real Plack app: $@\n" unless ref $app eq 'CODE';
my $form_auth = \&LJ::form_auth;
my $control_strip = \&LJ::control_strip;
my $create_qr_div = \&LJ::create_qr_div;
my $get_script_tags = \&LJ::S2::get_script_tags;
my $run_hooks = \&LJ::Hooks::run_hooks;
my $render_pagestats = \&LJ::PageStats::render;
my $response;
{
    no warnings 'redefine';
    local $FIXTURE_CLOCK_ACTIVE = 1;
    local *LJ::form_auth = sub {
        die "Expected anonymous fixture GET\n" if LJ::get_remote();
        # LJ::form_auth still formats the field via LJ::html_hidden; only its
        # request cache receives an inert local value instead of a real token.
        local $LJ::REQ_GLOBAL{form_auth_chal} = 'invalid-s2-js-slice2-fixture';
        return $form_auth->(@_);
    };
    local *LJ::control_strip = sub {
        my $html = $control_strip->(@_);
        $host{control_strip_html} = $html // '';
        return $html;
    };
    local *LJ::create_qr_div = sub {
        my $html = $create_qr_div->(@_);
        $host{quickreply_div} = $html // '';
        return $html;
    };
    local *LJ::S2::get_script_tags = sub {
        my $html = $get_script_tags->(@_);
        $host{script_tags_html} = $html // '';
        return $html;
    };
    local *LJ::Hooks::run_hooks = sub {
        my ($name, $buffer) = @_;
        my $field = $name eq 'insert_html_before_body_close' ? 'footer_hook_body'
            : $name eq 'insert_html_before_journalctx_body_close' ? 'footer_hook_journal' : '';
        my $before = $field && ref $buffer eq 'SCALAR' ? length($$buffer) : 0;
        if (wantarray) {
            my @result = $run_hooks->(@_);
            $host{$field} = substr($$buffer, $before) if $field;
            return @result;
        }
        my $result = $run_hooks->(@_);
        $host{$field} = substr($$buffer, $before) if $field;
        return $result;
    };
    local *LJ::PageStats::render = sub {
        my $html = $render_pagestats->(@_);
        $host{footer_pagestats_html} = $html // '';
        return $html;
    };
    local *LJ::S2::s2_run = sub {
        my ($r, $ctx, $opts, $entry, $prepared) = @_;
        die "Unexpected S2 entry point\n" unless $entry eq 'RecentPage::print()';
        die "Unexpected prepared page class\n" unless $prepared->{_type} eq 'RecentPage';
        $page = $prepared;
        $props = $ctx->[S2::PROPS];
        $host{siteroot} = $LJ::SITEROOT // '';
        my $stylesheet = $page->{stylesheet_url} // '';
        my ($css_host, $css_path) = $stylesheet =~ m!^https?://([^/]+)(/.*)$!;
        die "Missing absolute stock stylesheet URL\n" unless $css_host && $css_path;
        my $css_decision = LJ::valid_stylesheet_url($stylesheet, $css_host, $css_path);
        die "Stock stylesheet did not receive an allow decision\n"
            unless defined $css_decision && $css_decision =~ /^1$/;
        $host{stylesheet_validation} = {
            href => $stylesheet, decision => 0 + $css_decision,
            helper => 'LJ::valid_stylesheet_url',
        };
        $host{viewer_sees_control_strip} =
            S2::Builtin::LJ::viewer_sees_control_strip($ctx) ? JSON::PP::true : JSON::PP::false;
        $host{has_quickreply} = LJ::S2::has_quickreply($page)
            ? JSON::PP::true : JSON::PP::false;
        $host{s2quickreply} = LJ::is_enabled('s2quickreply')
            ? JSON::PP::true : JSON::PP::false;
        $host{comments_need_access} = $page->{_u}->does_not_allow_comments_from_non_access(undef)
            ? JSON::PP::true : JSON::PP::false;
        my $bar = $page->{_u}->user_link_bar(undef);
        my %links;
        for my $pair (
            [ manage_membership => 'manage_membership' ], [ trust => 'trust' ],
            [ watch => 'watch' ], [ post_entry => 'post' ], [ track => 'track' ],
            [ message => 'message' ], [ tell_friend => 'tellafriend' ],
        ) {
            my ($key, $method) = @$pair;
            my $link = $bar->$method;
            next unless $link;
            $links{$key} = {
                map { $_ => $link->{$_} }
                    grep { exists $link->{$_} } qw(url title text image width height)
            };
        }
        $host{user_links} = \%links;
        $host{ljuser_html} = LJ::ljuser($page->{_u});
        my $tags = LJ::Tags::get_usertags($page->{_u}, { remote => undef });
        $host{visible_tag_count} = scalar keys %{ $tags || {} };
        $host{memories_enabled} = LJ::is_enabled('memories')
            ? JSON::PP::true : JSON::PP::false;
        $host{tellafriend_enabled} = LJ::is_enabled('tellafriend')
            ? JSON::PP::true : JSON::PP::false;
        my %tell_friend;
        for my $entry (@{ $page->{entries} }) {
            my $stored = LJ::Entry->new($u, ditemid => $entry->{itemid});
            $tell_friend{ $entry->{itemid} } = $stored->can_tellafriend(undef)
                ? JSON::PP::true : JSON::PP::false;
        }
        $host{entry_can_tell_friend} = \%tell_friend;
        {
            local $LJ::S2::CURR_CTX = $ctx;
            local $LJ::S2::RES_MADE = 0;
            $host{admin_post_image_ref} = freeze_value(LJ::S2::Image_std('admin-post'));
            $host{memadd_image_ref} = freeze_value(LJ::S2::Image_std('memadd'));
            $host{tellfriend_image_ref} = freeze_value(LJ::S2::Image_std('tellfriend'));
        }
        my $counts = LJ::S2::get_journal_day_counts($page);
        my @years = grep { $_ <= 2026 } sort { $a <=> $b } keys %$counts;
        my $year = @years ? $years[-1] : 2026;
        my @months = grep { $year < 2026 || $_ <= 9 }
            sort { $a <=> $b } keys %{ $counts->{$year} || {} };
        my $month = @months ? $months[-1] : 9;
        $host{calendar_month_ref} = freeze_value(LJ::S2::YearMonth(
            $page, { year => $year, month => $month },
            S2::get_property_value($ctx, 'reg_firstdayofweek') eq 'monday' ? 1 : 0,
        ));
        $root = freeze_value($page);
        $property_root = freeze_value($props);
        my $result = $original->(@_);
        die "Real S2 render failed\n" unless $result;
        return $result;
    };
    test_psgi $app, sub {
        my $callback = shift;
        $response = $callback->(GET 'http://localhost/users/s2js_slice2/');
    };
}
die "Real HTTP route did not render\n" unless $response && $response->code == 200;
die "Unexpected custom journal footer hook output\n"
    if $host{footer_hook_body} ne '' || $host{footer_hook_journal} ne '';
die "Missing app PageStats footer\n" unless defined $host{footer_pagestats_html};
my $html = $response->content;
die "Unexpected fallback/error or sample content\n"
    if $html =~ /Error (?:running style|preparing to run)/
    || $html !~ /Sample 1/ || $html !~ /Sample 2/ || $html !~ /Fixture 1/
    || $html !~ /Fixture 2/;
die "Expected variant body in real HTTP oracle\n" if $variant && $html !~ /Fixture 1 variant/;
die "Prepared entry count differs\n" unless @{$page->{entries} || []} == 2;

sub freeze_value {
    my ($value) = @_;
    if (!ref $value) {
        return $value unless defined $value && $value =~ /[\x80-\xff]/ && !Encode::is_utf8($value);
        return Encode::decode('UTF-8', $value, Encode::FB_CROAK());
    }
    my $kind = ref $value;
    if (blessed($value)) {
        die "Unexpected live object $kind in S2 data\n" unless $value->isa('LJ::User');
        return { '$host_user' => { id => $value->userid, user => $value->user } };
    }
    die "Unexpected executable S2 render data\n" if $kind eq 'CODE';
    die "Unexpected S2 render reference $kind\n" unless $kind eq 'HASH' || $kind eq 'ARRAY';
    my $address = refaddr($value);
    my $id = $seen{$address} //= '' . ++$next_id;
    return { '$ref' => $id } if exists $nodes{$id};
    $nodes{$id} = { kind => $kind, value => $kind eq 'HASH' ? {} : [] };
    if ($kind eq 'HASH') {
        for my $key (sort keys %$value) {
            if ($key eq '_u') {
                my $user = $value->{$key};
                $nodes{$id}{value}{host_userid} = $user->userid if blessed($user)
                    && $user->isa('LJ::User');
                next;
            }
            next if $key eq '_url_of';
            $nodes{$id}{value}{$key} = freeze_value($value->{$key});
        }
    }
    else {
        push @{$nodes{$id}{value}}, map { freeze_value($_) } @$value;
    }
    return { '$ref' => $id };
}

my $fixture = {
    provenance => {
        schema => 1, abi => 1,
        base => 'aa0f7f1fc3a1cbb897e5f62954d78c3930c35313',
        source_sha256 => \@hashes, source_files => \@files,
        layer_names => \@names, layer_ids => \@layer_ids,
        request => { method => 'GET', path => '/users/s2js_slice2/', host => 'localhost' },
        fixed_clock => '2026-09-25T00:00:00Z', seed_version => 1,
        input_freeze => {
            perl_hash_seed => '0', perl_perturb_keys => '0',
            form_auth_chal => 'invalid-s2-js-slice2-fixture',
            form_auth_scope => 'anonymous GET /users/s2js_slice2/',
        },
        content_variant => $variant ? 'owned-body-1' : 'baseline',
    },
    graph => { root => $root, properties => $property_root, nodes => \%nodes },
    host => \%host,
};

my $json = JSON::PP->new->canonical->utf8->encode($fixture);
for my $item (
    [ "$outdir/page-input.json", $json ],
    [ "$outdir/page-oracle.html", $html ],
) {
    open my $fh, '>:raw', $item->[0] or die "Cannot write $item->[0]: $!\n";
    print {$fh} $item->[1];
    close $fh or die "Cannot close $item->[0]: $!\n";
}
print "HTTP 200; ", length($html), " bytes; two entries; stock layer IDs @layer_ids\n";

#!/usr/bin/perl
#
# seed-fixtures.pl
#
# Create the devcontainer journals that page comparisons render. Steps that
# already ran are skipped. Strings stay UTF-8 bytes, as LJ expects.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

use strict;
use warnings;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Comment;
use LJ::Customize;
use LJ::Protocol;
use LJ::S2;
use LJ::S2Theme;
use LJ::Talk;
use LJ::Userpic;
use Compress::Zlib qw( compress crc32 );

die "Devcontainer only\n" unless $LJ::IS_DEV_SERVER;

my $USER_LAYER = <<'S2';
layerinfo "type" = "user";
layerinfo "name" = "Fixture customizations";

set text_post_comment = "Say something";
set color_page_background = "#eeeeff";

function Page::print_custom_head() {
    """<style type="text/css">.fixture-user-layer { color: red; }</style>""";
}

function Page::print_default_stylesheet() {
    print safe """<p class="fixture-user-layer">$*text_post_comment <script>alert(1)</script></p>""";
}
S2

my $commenter = journal('s2fix_reader');

# Site default style: no s2_style of its own.
my $default = journal('s2fix_default');
$default->set_prop( s2_style => '' );
entries( $default, 3 ) unless entry_count($default);

# A system layout and theme, as set by the theme picker.
my $themed = journal('s2fix_theme');
LJ::Customize->apply_theme( $themed, LJ::S2Theme->load_by_uniq('blanket/forest') )
    if new_journal($themed);
comments( $themed, $commenter, entries( $themed, 25 ) );

# A theme plus a hand-written user layer that overrides functions.
my $custom = journal('s2fix_custom');
LJ::Customize->apply_theme( $custom, LJ::S2Theme->load_by_uniq('practicality/alittlefire') )
    if new_journal($custom);
user_layer( $custom, $USER_LAYER );
comments( $custom, $commenter, entries( $custom, 4 ) );

# Entries spread over years and months, for the archive views.
my $archive = journal('s2fix_archive');
LJ::Customize->apply_theme( $archive, LJ::S2Theme->load_by_uniq('abstractia/aurora') )
    if new_journal($archive);
unless ( entry_count($archive) ) {
    my $n = 0;
    for my $date ( [ 2024, 11, 5 ], [ 2025, 3, 10 ], [ 2025, 3, 10 ], [ 2025, 12, 20 ], [ 2026, 2, 14 ] ) {
        $n++;
        post( $archive, $n, subject => "Dated entry $n", event => body($n), security => 'public',
            year => $date->[0], mon => $date->[1], day => $date->[2], hour => 8 + $n );
    }
}

# Embedded media and a poll, which are stored apart from the entry text.
unless ( entry_count($archive) > 5 ) {

    # Only paid accounts may create polls; paid journals also show active
    # entries, which fail on MySQL 8, so the journal stays free.
    $archive->modify_caps( [3], [] );
    post(
        $archive, 6,
        subject => 'Embeds and a poll',
        event   => <<'HTML',
<p>A video:</p>
<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>
<p>A poll:</p>
<poll name="Fixture poll" whovote="all" whoview="all">
<poll-question type="radio">Pick one<poll-item>First</poll-item><poll-item>Second</poll-item></poll-question>
<poll-question type="text" size="20" maxlength="40">Say something</poll-question>
</poll>
HTML
        security => 'public', year => 2025, mon => 6, day => 1,
    );
    $archive->modify_caps( [], [3] );
}

# Icons, shown on the journal's own icons page and on its entries.
unless ( LJ::Userpic->load_user_userpics($archive) ) {
    my $first = userpic( $archive, 100, 100, [ 200, 40, 40 ], 'first, <b>bold</b> keyword',
        'An <i>icon</i> comment', 'A description' );
    $first->make_default;
    userpic( $archive, 60, 80, [ 40, 200, 40 ], 'second, Another', '', '' );
    userpic( $archive, 50, 50, [ 40, 40, 200 ], 'third', '', 'Third icon' );
}
$archive->set_prop( use_journalstyle_icons_page => 1 );
unless ( LJ::Userpic->load_user_userpics($commenter) ) {
    userpic( $commenter, 90, 90, [ 90, 90, 0 ], 'reader', '', '' )->make_default;
}

# Reading pages: the reader watches three journals, and the themed journal
# watches the reader, so its network page reaches the other two.
$commenter->add_edge( $_, watch => { fgcolor => 0x112233, bgcolor => 0xeeddcc, nonotify => 1 } )
    for $themed, $custom, $archive;
$themed->add_edge( $commenter, watch => { nonotify => 1 } );

# A community run by the reader, with posts by its members.
my $community = LJ::load_user('s2fix_comm');
unless ($community) {
    $community = LJ::User->create_community(
        user                   => 's2fix_comm',
        name                   => 'Fixture community',
        admin_userid           => $commenter->userid,
        membership             => 'open',
        postlevel              => 'members',
        nonmember_posting      => 0,
        moderated              => 0,
        journal_adult_settings => 'none',
    ) or die "Cannot create s2fix_comm\n";
    $themed->join_community( $community, 1, 1 );
    my $n = 0;
    for my $poster ( $commenter, $themed, $commenter ) {
        $n++;
        post( $community, $n, user => $poster->user, usejournal => $community->user,
            subject => "Community post $n", event => body($n), security => 'public' );
    }
}
$commenter->add_edge( $community, watch => { nonotify => 1 } );

# A user layer that never finishes printing, for render time limits.
my $loop = journal('s2fix_loop');
entries( $loop, 1 );
user_layer( $loop, <<'LOOP' );
layerinfo "type" = "user";
function Page::print() {
    foreach var int i (1..100000) { foreach var int j (1..100000) { } }
}
LOOP

# A suspended journal, which anonymous visitors cannot see at all.
my $suspended = journal('s2fix_suspended');
entries( $suspended, 1 );
$suspended->update_self( { statusvis => 'S' } ) unless $suspended->is_suspended;

# Reading pages show entries logged in the last two weeks; move old fixtures
# forward, keeping their order.
for my $u ( $default, $themed, $custom, $archive, $community ) {
    my $dbh = LJ::get_cluster_master($u);
    my $age = $dbh->selectrow_array(
        'SELECT UNIX_TIMESTAMP() - UNIX_TIMESTAMP(MAX(logtime)) FROM log2 WHERE journalid = ?',
        undef, $u->userid );
    next unless $age && $age > 7 * 86400;
    $dbh->do(
        'UPDATE log2 SET logtime = logtime + INTERVAL ? SECOND, rlogtime = rlogtime - ? WHERE journalid = ?',
        undef, $age, $age, $u->userid );
    LJ::get_db_writer()->do( 'UPDATE userusage SET timeupdate = NOW() WHERE userid = ?', undef, $u->userid );
    LJ::MemCache::delete( [ $u->userid, "log2lt:" . $u->userid ] );
    LJ::MemCache::delete( [ $u->userid, "tu:" . $u->userid ] );
}

print "Fixture journals ready\n";

sub journal {
    my ($name) = @_;
    my $u = LJ::load_user($name);
    return $u if $u;
    $u = LJ::User->create_personal(
        user     => $name,
        email    => "$name\@example.invalid",
        password => 'fixture-only',
        name     => "Fixture $name",
    ) or die "Cannot create $name\n";
    $u->update_self( { status => 'A', statusvis => 'V' } );
    $u->{_fixture_new} = 1;
    return $u;
}

sub new_journal { return $_[0]->{_fixture_new} }

# Give the journal's style a user layer with this source, once.
sub user_layer {
    my ( $u, $source ) = @_;
    my %style = LJ::S2::get_style( $u, 'verify' );
    return if $style{user} && LJ::S2::load_layer_source( $style{user} );
    my $styleid = $u->prop('s2_style');
    unless ($styleid) {
        $styleid = LJ::S2::create_style( $u, 'fixture' ) or die "Cannot create style\n";
        LJ::S2::set_style_layers( $u, $styleid, core => $style{core}, layout => $style{layout},
            theme => $style{theme} );
        $u->set_prop( s2_style => $styleid );
    }
    my $lid = $style{user} || LJ::S2::create_layer( $u->userid, $style{layout}, 'user' )
        or die "Cannot create user layer\n";
    my $error;
    LJ::S2::layer_compile( LJ::S2::load_layer($lid), \$error, { s2ref => \$source } )
        or die "User layer: $error\n";
    LJ::S2::set_style_layers( $u, $styleid, user => $lid );
}

sub userpic {
    my ( $u, $w, $h, $rgb, $keywords, $comment, $description ) = @_;
    my $pic = LJ::Userpic->create( $u, data => \png( $w, $h, $rgb ) );
    $pic->set_keywords($keywords);
    $pic->set_comment($comment)         if $comment;
    $pic->set_description($description) if $description;
    return $pic;
}

# A solid-colour PNG.
sub png {
    my ( $w, $h, $rgb ) = @_;
    my $chunk = sub {
        my ( $type, $data ) = @_;
        return pack( 'N', length $data ) . $type . $data . pack( 'N', crc32( $type . $data ) );
    };
    my $rows = join '', map { "\0" . pack( 'C*', @$rgb ) x $w } 1 .. $h;
    return "\x89PNG\r\n\x1a\n"
        . $chunk->( 'IHDR', pack( 'NNCCCCC', $w, $h, 8, 2, 0, 0, 0 ) )
        . $chunk->( 'IDAT', compress($rows) )
        . $chunk->( 'IEND', '' );
}

sub entry_count {
    my ($u) = @_;
    return LJ::get_cluster_reader($u)
        ->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $u->userid );
}

# Returns the ditemid of the newest public entry.
sub entries {
    my ( $u, $count ) = @_;
    return latest_public($u) if entry_count($u);
    my @ditemids;
    for my $n ( 1 .. $count ) {
        my %post = (
            subject      => "Entry $n: café <b>bold</b>",
            event        => body($n),
            security     => 'public',
            prop_taglist => "fixture, number $n",
        );
        $post{prop_current_mood}  = 'happy'          if $n % 3 == 0;
        $post{prop_current_music} = 'Song & "quote"' if $n % 4 == 0;
        push @ditemids, post( $u, $n, %post );
    }

    # Visible only to their audiences; anonymous pages must omit them.
    post( $u, $count + 1, subject => 'Locked entry', event => 'secret', security => 'usemask',
        allowmask => 1 );
    post( $u, $count + 2, subject => 'Private entry', event => 'secret', security => 'private' );
    return $ditemids[-1];
}

sub latest_public {
    my ($u) = @_;
    my ( $jitemid, $anum ) = LJ::get_cluster_reader($u)->selectrow_array(
        "SELECT jitemid, anum FROM log2 WHERE journalid=? AND security='public' "
            . 'ORDER BY eventtime DESC LIMIT 1',
        undef, $u->userid
    );
    return $jitemid * 256 + $anum;
}

sub body {
    my ($n) = @_;
    return <<"HTML";
<p>Paragraph with <a href="https://example.com/$n">a link</a>, <i>italics</i>
and <user name="s2fix_reader"> mentioned. Unicode: 😀 ñ.</p>
<cut text="Read more">
<table border="1"><tr><td>cell $n</td></tr></table>
<pre>  preformatted
    text</pre>
</cut>
<p>After the cut.<script>alert(1)</script></p>
HTML
}

sub post {
    my ( $u, $n, %fields ) = @_;
    my %request = (
        mode        => 'postevent',
        ver         => $LJ::PROTOCOL_VER,
        user        => $u->user,
        prop_editor => 'html_raw0',
        year        => 2026,
        mon         => 1 + int( $n / 28 ),
        day         => 1 + $n % 28,
        hour        => 12,
        min         => 0,
        %fields,
    );
    my %response;
    LJ::do_request( \%request, \%response, { noauth => 1, nomod => 1 } );
    die "Cannot post $n for " . $u->user . ": $response{errmsg}\n"
        unless ( $response{success} // '' ) eq 'OK';
    return $response{itemid} * 256 + $response{anum};
}

sub comments {
    my ( $u, $poster, $ditemid ) = @_;
    return if LJ::Entry->new( $u, ditemid => $ditemid )->reply_count;
    my $err;
    my $make = sub {
        my (%opts) = @_;
        my $c = LJ::Comment->create(
            journal => $u,
            ditemid => $ditemid,
            poster  => $poster,
            err_ref => \$err,
            %opts
        ) or die "Cannot comment: $err->{msg}\n";
        return $c;
    };
    my $top = $make->( subject => 'Top comment', body => 'First <b>comment</b> 😀' );
    my $reply =
        $make->( subject => 'Re: top', body => 'A reply', parenttalkid => $top->jtalkid );
    $make->( body => 'A nested reply', parenttalkid => $reply->jtalkid );
    $make->( subject => 'Second thread', body => 'Another top-level comment' );
    my $screened = $make->( body => 'Screened comment' );
    LJ::Talk::screen_comment( $u, $ditemid >> 8, $screened->jtalkid );
}

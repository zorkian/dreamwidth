#!/usr/bin/perl
# Legacy preview schema compatibility through the native shared renderer.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user temp_comm);
use LJ::Session;
use DW::Request;
use DW::Request::Plack;
use LJ::Lang;
use LJ::Customize;
use LJ::Userpic;
plan skip_all => 'Preview integration requires a development server' unless $LJ::IS_DEV_SERVER;

sub file_contents {
    my ($path) = @_;
    open my $fh, '<', $path or die "$path: $!";
    binmode $fh;
    local $/;
    my $contents = <$fh>;
    close $fh or die "$path: $!";
    return \$contents;
}

sub decoder_request {
    DW::Request->reset;
    open my $input, '<', \( my $body = '' ) or die $!;
    return DW::Request->get(
        plack_env => {
            REQUEST_METHOD    => 'POST',
            PATH_INFO         => '/preview/entry',
            SERVER_NAME       => 'localhost',
            SERVER_PORT       => 80,
            HTTP_HOST         => 'localhost',
            'psgi.version'    => [ 1, 1 ],
            'psgi.url_scheme' => 'http',
            'psgi.input'      => $input,
            'psgi.errors'     => do { open my $fh, '>', \( my $err = '' ); $fh },
        },
    );
}

subtest 'legacy decoder uses native request language for the global subject placeholder' => sub {
    decoder_request();
    LJ::Lang::set_request_context(
        lang   => 'marker',
        getter => sub {
            my ( $lang, $key ) = @_;
            return 'LEGACY-PLACEHOLDER-MARKER' if $key eq 'entryform.subject.hint2';
            return "unexpected:$key";
        },
    );
    my %decoded;
    no warnings 'redefine';
    local *BML::ml = sub { die 'entry_form_decode must not use BML::ml' };
    LJ::entry_form_decode(
        \%decoded,
        {
            subject       => 'LEGACY-PLACEHOLDER-MARKER',
            event         => 'body',
            security      => 'public',
            date_ymd_mm   => '01',
            date_ymd_dd   => '02',
            date_ymd_yyyy => '2020',
            hour          => 3,
            min           => 4,
            date_diff     => 1,
        }
    );
    is( $decoded{subject}, '', 'custom request getter placeholder is cleared without BML' );
    $decoded{subject} = undef;
    LJ::entry_form_decode(
        \%decoded,
        {
            subject       => 'Ordinary legacy subject',
            event         => 'body',
            security      => 'public',
            date_ymd_mm   => '01',
            date_ymd_dd   => '02',
            date_ymd_yyyy => '2020',
            hour          => 3,
            min           => 4,
            date_diff     => 1,
        }
    );
    is( $decoded{subject}, 'Ordinary legacy subject', 'ordinary subject is retained' );
    DW::Request->reset;
};

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $u = temp_user();
$u->update_self( { status => 'A' } );
my $userpic =
    LJ::Userpic->create( $u, data => file_contents("$ENV{LJHOME}/t/data/userpics/good.jpg"), );
ok( $userpic, 'disposable preview userpic is created' )
    or BAIL_OUT('cannot create preview userpic');
$userpic->set_keywords('legacy-preview-pic');
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
my ($before) = $u->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $u->id );
test_psgi $app, sub {
    my $send = shift;
    for my $path ( '/preview/entry', '/preview/entry.bml' ) {
        my $res = $send->(
            POST 'http://localhost' . $path,
            [
                username             => $u->user,
                usejournal           => $u->user,
                security             => 'private',
                subject              => 'Legacy preview subject',
                event                => 'Legacy preview body',
                date_ymd_mm          => '01',
                date_ymd_dd          => '02',
                date_ymd_yyyy        => '2020',
                date_ymd_hh          => 3,
                date_ymd_nn          => 4,
                hour                 => 3,
                min                  => 4,
                date_diff            => 1,
                prop_taglist         => 'legacy-preview-tag',
                prop_current_music   => 'Legacy music',
                prop_picture_keyword => 'legacy-preview-pic',
                prop_adult_content   => 'concepts',
            ],
            Cookie => $cookie
        );
        is( $res->code, 200, "$path renders through native wrapper" );
        like( $res->content, qr/Legacy preview subject/, "$path preserves legacy subject" );
        like( $res->content, qr/This is a preview only/, "$path renders preview warning" );
        like( $res->content, qr/03:04/,                  "$path preserves legacy timestamp" );
        like( $res->content, qr/legacy-preview-tag/,     "$path renders legacy tag metadata" );
        like( $res->content, qr/Legacy music/,           "$path renders legacy current music" );
        like(
            $res->content,
            qr/\Q@{[ $userpic->url ]}\E/,
            "$path renders the selected legacy userpic URL"
        );
    }
};
subtest 'legacy security and altlogin contexts survive schema decoding' => sub {
    my $comm = temp_comm();
    LJ::set_rel( $comm, $u, 'A' );
    $u->set_prop( stylesys => 1 );
    test_psgi $app, sub {
        my $send = shift;
        my $request =
            sub { my ($req) = @_; $req->header( Cookie => $cookie ); return $send->($req); };
        my $base = sub {
            my (%extra) = @_;
            return [
                username      => $u->user,
                usejournal    => $u->user,
                subject       => 'Legacy security subject',
                event         => 'Legacy security body',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1,
                %extra
            ];
        };
        my %markers = (
            private => 'entry/private.png',
            friends => 'entry/locked.png',
            custom  => 'entry/filtered.png'
        );
        for my $security (qw(private friends custom)) {
            my %extra = ( security => $security );
            $extra{custom_bit_1} = 1 if $security eq 'custom';
            my $res = $request->( POST 'http://localhost/preview/entry', $base->(%extra) );
            is( $res->code, 200, "legacy $security preview renders" );
            like( $res->content, qr/\Q$markers{$security}\E/,
                "legacy $security preview renders its exact access marker" );
        }
        my $alt = $request->(
            POST 'http://localhost/preview/entry',
            $base->( post_as_other => 1, postas_usejournal => $comm->user, security => 'private' )
        );
        is( $alt->code, 200, 'legacy post-as-other preview renders' );
        like( $alt->content, qr/\Q@{[ $u->user ]}\E/, 'legacy altlogin retains posting identity' );
        like(
            $alt->content,
            qr/\Q@{[ $comm->user ]}\E/,
            'legacy altlogin retains community journal'
        );
    };
};

subtest 'legacy preview does not invoke the native-only spam hook' => sub {
    my $calls = 0;
    local $LJ::HOOKS{spam_check} = [ sub { ++$calls; } ];
    test_psgi $app, sub {
        my $send = shift;
        my $request =
            sub { my ($req) = @_; $req->header( Cookie => $cookie ); return $send->($req); };
        my $legacy = $request->(
            POST 'http://localhost/preview/entry',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'hook legacy',
                event         => 'body',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1
            ]
        );
        is( $legacy->code, 200, 'legacy hook fixture renders' );
        is( $calls,        0,   'legacy preview preserves its no-spam-check hook contract' );
        my $native = $request->(
            POST 'http://localhost/entry/preview',
            [
                usejournal     => $u->user,
                security       => 'public',
                subject        => 'hook native',
                event          => 'body',
                editor         => 'html_raw0',
                entrytime_date => '2020-01-02',
                entrytime_time => '03:04',
                trust_datetime => 1
            ]
        );
        is( $native->code, 200, 'native hook fixture renders' );
        is( $calls,        1,   'native preview still invokes spam_check exactly once' );
    };
};

subtest 'legacy and native previews retain distinct request translation scopes' => sub {
    LJ::Customize->verify_and_load_style($u);
    my $s2_style = $u->prop('s2_style');
    ok( $s2_style, 'fixture has an existing nonzero S2 style for the legacy style test' )
        or BAIL_OUT('temporary preview user has no S2 style');
    $u->set_prop( stylesys                    => 1 );
    $u->set_prop( use_journalstyle_entry_page => 'Y' );

    no warnings 'redefine';
    local *LJ::Lang::get_text = sub {
        my ( $lang, $key ) = @_;
        return 'LEGACY-SUBJECT-PLACEHOLDER' if $key eq 'entryform.subject.hint2';
        return "preview-key:$key";
    };
    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };
        my $legacy = $request->(
            POST 'http://localhost/preview/entry',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'LEGACY-SUBJECT-PLACEHOLDER',
                event         => 'legacy translation body',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1,
            ]
        );
        is( $legacy->code, 200, 'legacy wrapper renders with a custom request getter' );
        like(
            $legacy->content,
            qr/preview-key:\/preview\/entry\.bml\.title/,
            'legacy site preview title resolves through the retained BML page key'
        );
        like(
            $legacy->content,
            qr/preview-key:\/preview\/entry\.bml\.entry\.preview_warn_text/,
            'legacy site preview warning resolves through the retained BML page key'
        );
        unlike(
            $legacy->content,
            qr/LEGACY-SUBJECT-PLACEHOLDER/,
            'legacy wrapper clears the global translated subject placeholder through the decoder'
        );

        # Native previews retain their independent journal-style setting. Force
        # its site template path so the title and warning filters both run.
        $u->set_prop( use_journalstyle_entry_page => 'N' );
        my $native = $request->(
            POST 'http://localhost/entry/preview',
            [
                usejournal     => $u->user,
                security       => 'public',
                subject        => 'Native translation subject',
                event          => 'native translation body',
                editor         => 'html_casual1',
                entrytime_date => '2020-01-02',
                entrytime_time => '03:04',
                trust_datetime => 1,
            ]
        );
        is( $native->code, 200, 'native preview renders with the same custom request getter' );
        like(
            $native->content,
            qr/preview-key:\/entry\/preview\.tt\.title/,
            'native preview title retains its TT key'
        );
        like(
            $native->content,
            qr/preview-key:\/entry\/preview\.tt\.entry\.preview_warn_text/,
            'native preview warning retains its TT key'
        );
        unlike(
            $native->content,
            qr/preview-key:\/preview\/entry\.bml/,
            'native preview never borrows legacy preview translation keys'
        );

        # Legacy stylesys=2 selects the S2 renderer when journal styling is
        # enabled, and S2 receives the legacy warning string explicitly.
        $u->set_prop( stylesys                    => 2 );
        $u->set_prop( use_journalstyle_entry_page => 'Y' );
        my $legacy_s2 = $request->(
            POST 'http://localhost/preview/entry.bml',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'Legacy S2 translation subject',
                event         => 'legacy S2 translation body',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1,
            ]
        );
        is( $legacy_s2->code, 200, 'legacy stylesys=2 preview renders' );
        like(
            $legacy_s2->content,
            qr/preview-key:\/preview\/entry\.bml\.entry\.preview_warn_text/,
            'legacy S2 preview receives the retained BML warning key'
        );
        like( $legacy_s2->content, qr/id=["']canvas["']/,
            'legacy stylesys=2 uses the S2 page renderer' );
        local $LJ::HOOKS{force_s1} = [ sub { ${ $_[1] } = 1; } ];
        my $forced = $request->(
            POST 'http://localhost/preview/entry',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'forced S1',
                event         => 'forced S1 body',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1
            ]
        );
        is( $forced->code, 200, 'legacy force_s1 preview renders' );
        like( $forced->content, qr/entry-wrapper/, 'legacy force_s1 uses the site-skin renderer' );
    };
};

subtest
    'legacy and native preview content pipelines preserve formatting, ordered polls, and embeds' =>
    sub {
    local $LJ::T_HAS_ALL_CAPS      = 1;
    local $LJ::EMBED_MODULE_DOMAIN = 'embed.localhost';
    $u->set_prop( stylesys                    => 1 );
    $u->set_prop( use_journalstyle_entry_page => 'N' );

    my ($polls_before) =
        $u->selectrow_array( 'SELECT COUNT(*) FROM poll2 WHERE journalid=?', undef, $u->id );
    my ($embeds_before) =
        $u->selectrow_array( 'SELECT COUNT(*) FROM embedcontent WHERE userid=?', undef, $u->id );

    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };

        my $legacy_preformatted = $request->(
            POST 'http://localhost/preview/entry',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'Legacy preformatted subject',
                event         => "Legacy preformatted line one\nLegacy preformatted line two",
                event_format  => 'preformatted',
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1,
            ]
        );
        is( $legacy_preformatted->code, 200, 'legacy preformatted preview renders' );
        like(
            $legacy_preformatted->content,
            qr/Legacy preformatted line one/,
            'legacy preformatted preview retains its first line'
        );
        like(
            $legacy_preformatted->content,
            qr/Legacy preformatted line one\nLegacy preformatted line two/,
            'legacy preformatted preview preserves its literal newline without an inserted break'
        );
        unlike(
            $legacy_preformatted->content,
            qr/Legacy preformatted line one<br \/?>\s*Legacy preformatted line two/,
            'legacy preformatted preview does not turn its newline into a break tag'
        );

        # Site-skin preview has no adult-content renderer; the retained legacy
        # BML path likewise only passed the prop into formatting, not markup.
        pass('adult metadata has no legacy site-skin marker to preserve');

        my $legacy_rte = $request->(
            POST 'http://localhost/preview/entry',
            [
                username   => $u->user,
                usejournal => $u->user,
                security   => 'public',
                subject    => 'Legacy RTE subject',
                event =>
'<lj-cut class="ljcut">Legacy RTE cut</lj-cut><lj-raw class="ljraw">Legacy RTE raw</lj-raw>',
                switched_rte_on => 1,
                date_ymd_mm     => '01',
                date_ymd_dd     => '02',
                date_ymd_yyyy   => '2020',
                hour            => 3,
                min             => 4,
                date_diff       => 1,
            ]
        );
        is( $legacy_rte->code, 200, 'legacy RTE preview renders' );
        like( $legacy_rte->content, qr/Legacy RTE cut/, 'legacy RTE preview retains cut content' );
        like( $legacy_rte->content, qr/Legacy RTE raw/, 'legacy RTE preview retains raw content' );
        unlike(
            $legacy_rte->content,
            qr/class=["']lj(?:cut|raw)["']/,
            'legacy RTE preview normalizes old RTE tag classes before rendering'
        );

        for my $native_case (
            [ 'raw HTML', 'html_raw0', "<strong>Native raw HTML preview</strong>\nRAW-LINE-TWO" ],
            [
                'casual HTML', 'html_casual1',
                "<strong>Native casual HTML preview</strong>\nCASUAL-LINE-TWO"
            ],
            )
        {
            my ( $name, $editor, $event ) = @$native_case;
            my $res = $request->(
                POST 'http://localhost/entry/preview',
                [
                    usejournal     => $u->user,
                    security       => 'public',
                    subject        => "Native $name subject",
                    event          => $event,
                    editor         => $editor,
                    entrytime_date => '2020-01-02',
                    entrytime_time => '03:04',
                    trust_datetime => 1,
                ]
            );
            is( $res->code, 200, "native $name preview renders" );
            like(
                $res->content,
                qr/Native \Q$name\E preview/,
                "native $name preview preserves submitted markup"
            );
            my $line    = $editor eq 'html_raw0' ? 'RAW-LINE-TWO' : 'CASUAL-LINE-TWO';
            my $newline = $editor eq 'html_raw0' ? qr/\n/         : qr/<br \/?>/;
            like(
                $res->content,
                qr/<strong>Native \Q$name\E preview<\/strong>$newline\Q$line\E/,
                "native $name preview preserves markup with its mode-specific newline rendering"
            );
        }

        my $pipeline_event = join '',
            'ORDER-before-',
'<poll name="First preview poll" isanon="no" whovote="all" whoview="all"><poll-question type="radio">First preview question',
            '<poll-item>First option</poll-item></poll-question></poll>',
            '-ORDER-middle-',
'<poll name="Second preview poll" isanon="no" whovote="all" whoview="all"><poll-question type="radio">Second preview question',
            '<poll-item>Second option</poll-item></poll-question></poll>',
            '-ORDER-embed-',
            '<iframe src="http://www.youtube.com/embed/ABC123abc_-"></iframe>',
            '-ORDER-after';
        my $pipeline = $request->(
            POST 'http://localhost/preview/entry.bml',
            [
                username      => $u->user,
                usejournal    => $u->user,
                security      => 'public',
                subject       => 'Legacy pipeline subject',
                event         => $pipeline_event,
                date_ymd_mm   => '01',
                date_ymd_dd   => '02',
                date_ymd_yyyy => '2020',
                hour          => 3,
                min           => 4,
                date_diff     => 1,
            ]
        );
        is( $pipeline->code, 200, 'legacy two-poll/embed preview renders' );
        my $content         = $pipeline->content;
        my @ordered_markers = (
            'ORDER-before-', 'First preview question',
            'ORDER-middle-', 'Second preview question',
            'ORDER-embed-',  'ORDER-after',
        );
        for my $marker (@ordered_markers) {
            like( $content, qr/\Q$marker\E/, "pipeline renders $marker" );
        }
        my @positions = map { index $content, $_ } @ordered_markers;
        ok(
            !grep( { $_ < 0 } @positions )
                && join( ',', @positions ) eq join( ',', sort { $a <=> $b } @positions ),
            'two polls and embed retain submitted order through the preview pipeline'
        );
        like( $content, qr/lj_embedcontent-wrapper/,
            'trusted embed expands through preview rendering' );
        unlike( $content, qr/<poll-placeholder>/, 'preview leaves no raw poll placeholder' );
        unlike( $content, qr/<(?:lj-)?poll\b/i,   'preview leaves no raw poll markup' );
        my @legacy_poll_controls = $content =~ /<input type=["']radio["']/g;
        is( scalar @legacy_poll_controls, 2, 'legacy preview renders both poll radio controls' );

        my $native_pipeline = $request->(
            POST 'http://localhost/entry/preview',
            [
                usejournal     => $u->user,
                security       => 'public',
                subject        => 'Native pipeline subject',
                event          => $pipeline_event,
                editor         => 'html_raw0',
                entrytime_date => '2020-01-02',
                entrytime_time => '03:04',
                trust_datetime => 1
            ]
        );
        is( $native_pipeline->code, 200, 'native two-poll/embed preview renders' );
        my $native_content = $native_pipeline->content;

        for my $marker (@ordered_markers) {
            like( $native_content, qr/\Q$marker\E/, "native pipeline renders $marker" );
        }
        my @native_positions = map { index $native_content, $_ } @ordered_markers;
        ok(
            !grep( { $_ < 0 } @native_positions )
                && join( ',', @native_positions ) eq
                join( ',', sort { $a <=> $b } @native_positions ),
            'native two polls and embed retain submitted order'
        );
        like( $native_content, qr/lj_embedcontent-wrapper/, 'native trusted embed expands' );
        my @native_poll_controls = $native_content =~ /<input type=["']radio["']/g;
        is( scalar @native_poll_controls, 2, 'native preview renders both poll radio controls' );
        unlike(
            $native_content,
            qr/<poll-placeholder>|<(?:lj-)?poll\b/i,
            'native preview leaves no raw poll markup or placeholder'
        );
    };

    my ($polls_after) =
        $u->selectrow_array( 'SELECT COUNT(*) FROM poll2 WHERE journalid=?', undef, $u->id );
    my ($embeds_after) =
        $u->selectrow_array( 'SELECT COUNT(*) FROM embedcontent WHERE userid=?', undef, $u->id );
    is( $polls_after, $polls_before, 'preview does not persist either new poll' );
    is( $embeds_after, $embeds_before,
        'preview does not persist the embed outside preview storage' );
    };

my ($entries_after_all) =
    $u->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?', undef, $u->id );
is( $entries_after_all, $before, 'all previews leave the entry count unchanged' );

done_testing;

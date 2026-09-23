#!/usr/bin/perl
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

{

    package UpdateTerminal::SharePage;
    sub new { my ( $class, %args ) = @_; return bless \%args, $class; }
    sub title       { return $_[0]->{title}; }
    sub url         { return $_[0]->{url}; }
    sub description { return $_[0]->{description}; }
}
use DW::External::Page;
use DW::Request;
use LJ::Entry;
use LJ::Session;
use LJ::Test qw(temp_user);
use Storable qw(nfreeze thaw);
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $u = temp_user();
$u->update_self( { status => 'A' } );
my $owner_id = $u->id;
$u->set_draft_text('terminal activation draft body');
$u->set_prop( draft_properties =>
        nfreeze( { subject => 'terminal draft subject', taglist => 'terminal-tag' } ) );
my $session = LJ::Session->create( $u, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
my $orig_identity          = \&LJ::User::identity;
my $orig_can_post          = \&LJ::User::can_post;
my $orig_readonly          = \&LJ::User::readonly;
my $orig_run_hook          = \&LJ::Hooks::run_hook;
my $orig_accounts          = \&DW::External::Account::get_external_accounts;
my $update_fields          = 0;
my $account_lookups        = 0;
my $share_constructions    = 0;
my $terminal_share_request = 0;
{
    no warnings 'redefine';
    local *LJ::User::identity =
        sub { return 1 if DW::Request->get->get_args->{identity}; return $orig_identity->(@_) };
    local *LJ::User::can_post =
        sub { return 0 if DW::Request->get->get_args->{cantpost}; return $orig_can_post->(@_) };
    local *LJ::User::readonly = sub {
        return 1 if DW::Request->get && DW::Request->get->get_args->{readonly};
        return $orig_readonly->(@_);
    };
    local *LJ::BetaFeatures::user_in_beta =
        sub { return DW::Request->get && DW::Request->get->get_args->{beta}; };
    local *LJ::Hooks::run_hook = sub {
        ++$update_fields if $_[0] eq 'update_fields';
        return $orig_run_hook->(@_);
    };
    local *DW::External::Account::get_external_accounts = sub {
        ++$account_lookups;
        return $orig_accounts->(@_);
    };
    local *DW::External::Page::new = sub {
        ++$share_constructions;
        die 'terminal response must not construct a shared page' if $terminal_share_request;
        return UpdateTerminal::SharePage->new(
            title       => 'Retained share title',
            url         => 'https://example.invalid/shared',
            description => 'Retained share description',
        );
    };
    local $LJ::MSG_NO_POST = q{Configured <a href="/no-post">cannot post</a>};
    test_psgi $app, sub {
        my $send    = shift;
        my $request = sub {
            my ($req) = @_;
            $req->header( Cookie => $cookie );
            return $send->($req);
        };
        my $entry_count = sub {
            my $fresh = LJ::load_userid( $owner_id, 1 );
            return $fresh->selectrow_array( 'SELECT COUNT(*) FROM log2 WHERE journalid=?',
                undef, $fresh->id );
        };
        my $before_count = $entry_count->();
        my $before_draft = LJ::load_userid( $owner_id, 1 )->draft_text;
        my $before_props = thaw( LJ::load_userid( $owner_id, 1 )->prop('draft_properties') );
        for my $path (
            '/update?identity=1', '/update.bml?identity=1',
            '/update?cantpost=1', '/update.bml?cantpost=1'
            )
        {
            my $res = $request->( GET $path);
            is( $res->code, 200, "$path terminal status" );
            unlike(
                $res->content,
                qr{id=['"](?:updateForm|js-post-entry)['"]},
                "$path has no form"
            );
            is( $res->header('Location'), undef, "$path terminal response does not redirect" );
            if ( $path =~ /identity/ ) {
                like( $res->content, qr/<title>Sorry<\/title>/i, "$path identity title" );
                like(
                    $res->content,
                    qr/Non-\Q$LJ::SITENAME\E users can't post entries/,
                    "$path identity message substitutes the site name"
                );
            }
            else {
                like( $res->content, qr/<title>Can't Post<\/title>/i, "$path cannot-post title" );
                like(
                    $res->content,
                    qr{Configured <a href="/no-post">cannot post</a>},
                    "$path configured message"
                );
            }
        }
        for my $case (
            [ 'identity', 'Sorry',       qr/Non-\Q$LJ::SITENAME\E users can't post entries/ ],
            [ 'cantpost', q{Can't Post}, qr{Configured <a href="/no-post">cannot post</a>} ],
            )
        {
            my ( $variant, $title, $message ) = @$case;
            for my $excluded (qw(altlogin share)) {
                my $value = $excluded eq 'share' ? 'https://example.invalid/shared' : 1;
                $terminal_share_request = $excluded eq 'share';
                my $res = $request->( GET "/update?$variant=1&$excluded=$value" );
                $terminal_share_request = 0;
                is( $res->code, 200, "$variant precedes $excluded with terminal status" );
                like(
                    $res->content,
                    qr/<title>\Q$title\E<\/title>/i,
                    "$variant precedes $excluded with terminal title"
                );
                like( $res->content, $message,
                    "$variant precedes $excluded with terminal message" );
                unlike(
                    $res->content,
                    qr/id=['"](?:updateForm|js-post-entry)['"]/,
                    "$variant plus $excluded has no form"
                );
            }
        }
        is( $share_constructions, 0,
            'terminal identity/cannot-post responses do not construct shared pages' );

        for my $variant (qw(identity cantpost)) {
            my $invalid = $request->( GET "/update?$variant=1&usejournal=does-not-exist" );
            like(
                $invalid->content,
                qr/Invalid usejournal argument\./,
                "invalid target precedes $variant terminal response"
            );
            unlike( $invalid->content, qr/id=['"]js-post-entry['"]/,
                "invalid target does not initialize native form for $variant" );
        }
        {
            local $LJ::MSG_NO_POST = '';
            my $fallback = $request->( GET '/update?cantpost=1' );
            like(
                $fallback->content,
                qr/<title>Can't Post<\/title>/i,
                'empty configured message retains the legacy title'
            );
            like(
                $fallback->content,
                qr/Sorry: you can't post at this time\./,
                'empty configured message uses the legacy translated fallback'
            );
        }
        for my $variant (qw(identity cantpost)) {
            my $beta = $request->( GET "/update?$variant=1&beta=1" );
            is( $beta->code, 302, "beta redirect precedes $variant terminal response" );
        }
        is( $update_fields,   0, 'terminal requests do not invoke update_fields' );
        is( $account_lookups, 0, 'terminal requests do not enumerate external accounts' );
        is( $entry_count->(), $before_count, 'terminal requests create no entries' );
        my $fresh = LJ::load_userid( $owner_id, 1 );
        is( $fresh->draft_text, $before_draft, 'terminal requests leave draft body unchanged' );
        is_deeply( thaw( $fresh->prop('draft_properties') ),
            $before_props, 'terminal requests leave draft properties unchanged' );
        my $ordinary = $request->( GET '/update?subject=ordinary' );
        like( $ordinary->content, qr/id=["']js-post-entry["']/,
            'ordinary eligible GET remains native after terminals' );
        my $anonymous = $send->( GET '/update' );
        like( $anonymous->content, qr/id=['"]updateForm['"]/,
            'anonymous GET remains the retained credential form' );
        like( $anonymous->content, qr/name=['"]user['"]/,
            'anonymous retained form has user control' );
        like( $anonymous->content, qr/name=['"]password['"]/,
            'anonymous retained form has password control' );

        my $readonly = $request->( GET '/update?readonly=1' );
        like( $readonly->content, qr/id=['"]js-post-entry['"]/,
            'readonly GET uses the native correction form' );
        like(
            $readonly->content,
            qr/read-only mode/i,
            'readonly GET retains the legacy visible warning'
        );

        my $altlogin = $request->( GET '/update?altlogin=1' );
        like( $altlogin->content, qr/id=["']updateForm["']/,
            'alternate-login remains the retained BML form' );

        my $before_share_hooks    = $update_fields;
        my $before_share_accounts = $account_lookups;
        my $share                 = $request->( GET '/update?share=not-a-url' );
        like( $share->content, qr/id=["']js-post-entry["']/,
            'share now uses the native compatibility form' );
        like(
            $share->content,
            qr/Retained share title/,
            'share native form uses the inert local page title'
        );
        is( $share_constructions, 1, 'ordinary share constructs the local page exactly once' );
        is(
            $update_fields,
            $before_share_hooks + 1,
            'ordinary share invokes update_fields exactly once'
        );
        is(
            $account_lookups,
            $before_share_accounts + 2,
            'ordinary share retains its handler and native-form account lookups'
        );
    };
}
done_testing;

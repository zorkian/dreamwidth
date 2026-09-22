# Authenticated compose rejection regressions; delivery is always replaced locally.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $sender    = temp_user();
my $recipient = temp_user();
$sender->update_self(    { status => 'A' } );
$recipient->update_self( { status => 'A' } );
my $session = LJ::Session->create( $sender, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

sub form_token {
    my ($content) = @_;
    return $1 if $content =~ /name=['"]lj_form_auth['"][^>]*value=['"]([^'"]+)/;
    return;
}

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'inboxComposeErrors';
test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub { my $req = shift; $req->header( Cookie => $cookie ); return $send->($req); };
    my $get  = $cb->( GET '/inbox/new/compose' );
    is( $get->code, 200, 'authenticated compose form renders' );
    my $token = form_token( $get->content );
    ok( $token, 'rendered compose form supplies CSRF token' );
    my @base = (
        mode        => 'send',
        msg_to      => $recipient->user,
        msg_subject => 'Subject retained marker',
        msg_body    => 'Body retained marker',
    );

    $recipient->set_prop( 'opt_usermsg', 'N' );
    my $res = $cb->( POST '/inbox/new/compose', Content => [ @base, lj_form_auth => $token ] );
    is( $res->code, 200, 'recipient denial rerenders compose instead of failing' );
    like( $res->content, qr/Subject retained marker/, 'recipient denial retains subject' );
    like( $res->content, qr/Body retained marker/,    'recipient denial retains body' );
    like(
        $res->content,
        qr/chosen not to receive messages/i,
        'recipient denial renders useful error'
    );
    ok( !$res->header('Location'), 'recipient denial has no success redirect' );

    $recipient->set_prop( 'opt_usermsg', 'Y' );
    {
        no warnings 'redefine';
        local *LJ::Message::can_send =
            sub { push @{ $_[1] }, 'Forced can_send failure'; return 0; };
        local *LJ::Message::send = sub { die 'send must not run after can_send failure' };
        $res = $cb->( POST '/inbox/new/compose', Content => [ @base, lj_form_auth => $token ] );
        is( $res->code, 200, 'can_send failure rerenders compose' );
        like(
            $res->content,
            qr/Forced can_send failure/,
            'can_send errors retain their actual sentence'
        );
        unlike(
            $res->content,
            qr/missing string/i,
            'can_send sentence is not treated as an ML key'
        );
        like( $res->content, qr/Subject retained marker/, 'can_send failure retains subject' );
        like( $res->content, qr/Body retained marker/,    'can_send failure retains body' );
        ok( !$res->header('Location'), 'can_send failure has no success redirect' );
    }
    {
        no warnings 'redefine';
        local *LJ::Message::can_send = sub { 1 };
        local *LJ::Message::send     = sub { push @{ $_[1] }, 'Forced send failure'; return 0; };
        $res = $cb->( POST '/inbox/new/compose', Content => [ @base, lj_form_auth => $token ] );
        is( $res->code, 200, 'send failure rerenders compose' );
        like( $res->content, qr/Forced send failure/, 'send errors retain their actual sentence' );
        unlike( $res->content, qr/missing string/i, 'send sentence is not treated as an ML key' );
        like( $res->content, qr/Subject retained marker/, 'send failure retains subject' );
        like( $res->content, qr/Body retained marker/,    'send failure retains body' );
        ok( !$res->header('Location'), 'send failure has no success redirect' );
    }
    for my $bad ( undef, 'invalid' ) {
        my @payload = @base;
        push @payload, lj_form_auth => $bad if defined $bad;
        my $called = 0;
        no warnings 'redefine';
        local *LJ::Message::send = sub { $called++; die 'delivery must not run for bad CSRF' };
        $res = $cb->( POST '/inbox/new/compose', Content => \@payload );
        unlike( $res->content, qr/Message Sent/i, 'bad CSRF does not report success' );
        is( $called, 0, 'bad CSRF has no delivery effect' );
    }
};
done_testing;

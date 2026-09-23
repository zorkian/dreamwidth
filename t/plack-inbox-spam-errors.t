# Modern inbox spam-report error and mutation contracts.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;

use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;

BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
use LJ::Message;

my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';

my $owner   = temp_user();
my $foreign = temp_user();
$_->update_self( { status => 'A' } ) for $owner, $foreign;
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;

local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'inboxSpamErrors';

sub make_message {
    my ( $from, $to ) = @_;
    my $msg = LJ::Message->new(
        {
            journalid => $from->id,
            otherid   => $to->id,
            msgid     => LJ::alloc_global_counter('M'),
            timesent  => time(),
            subject   => 'spam fixture',
            body      => 'body',
        }
    );
    $msg->save_to_db or die 'Unable to save inbox spam fixture message';
    return $msg;
}

sub markspam_form {
    my ( $content, $url ) = @_;
    return ( grep { defined $_->value('msgid') } HTML::Form->parse( $content, $url ) )[0];
}

sub fresh_message {
    my ($msg) = @_;
    return LJ::Message->load( { msgid => $msg->msgid, journalid => $owner->id } );
}

test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub {
        my $request = shift;
        $request->header( Cookie => $cookie );
        return $send->($request);
    };

    for my $case ( [ 'neither', 0, 0 ], [ 'spam', 1, 0 ], [ 'ban', 0, 1 ], [ 'both', 1, 1 ], ) {
        my ( $name, $spam, $ban ) = @$case;
        my $sender = temp_user();
        $sender->update_self( { status => 'A' } );
        my $msg = make_message( $sender, $owner );
        my $url = 'http://localhost/inbox/markspam?msgid=' . $msg->msgid;

        my $get = $cb->( GET $url );
        is( $get->code, 200, "$name renders the actual confirmation form" );
        my $form = markspam_form( $get->content, $url );
        ok( $form, "$name finds the rendered confirmation form" ) or next;
        $form->value( spam => $spam ? 1 : undef );
        $form->value( ban  => $ban  ? 1 : undef );
        my $request = $form->click('confirm');
        $request->uri($url);

        my $report_calls = 0;
        my $response;
        {
            no warnings 'redefine';
            local *LJ::Message::mark_as_spam = sub { ++$report_calls; return 1; };
            $response = $cb->($request);
        }

        if ( $name eq 'neither' ) {
            is( $response->code, 200, 'neither action re-renders the form' );
            like( $response->content, qr/No action selected/,
                'neither action has a visible error' );
            unlike(
                $response->content,
                qr/(?:missing|string).*No action selected|No action selected.*(?:missing|string)/i,
                'literal error is not rendered as a missing translation key'
            );
            ok( !$response->header('Location'), 'neither action does not redirect away its error' );
            is( $report_calls, 0, 'neither action does not report spam' );
            is( LJ::check_rel( $owner, $sender, 'B' ) || 0, 0, 'neither action does not ban' );
        }
        else {
            is( $response->code, 303,   "$name selected action redirects to inbox" );
            is( $report_calls,   $spam, "$name calls reporting exactly when spam is selected" );
            is( LJ::check_rel( $owner, $sender, 'B' ) || 0,
                $ban, "$name persists only its ban choice" );
        }
        ok( fresh_message($msg)->valid, "$name leaves the original message available" );
    }

    for my $token ( undef, 'invalid' ) {
        my $sender = temp_user();
        $sender->update_self( { status => 'A' } );
        my $msg     = make_message( $sender, $owner );
        my @payload = ( confirm => 1, msgid => $msg->msgid, spam => 1 );
        push @payload, lj_form_auth => $token if defined $token;
        my $response = $cb->( POST '/inbox/markspam', Content => \@payload );
        unlike( $response->content, qr/Message marked as spam/, 'bad CSRF has no success message' );
        ok( fresh_message($msg)->valid, 'bad CSRF leaves the persisted message available' );
        is( LJ::check_rel( $owner, $sender, 'B' ) || 0, 0, 'bad CSRF cannot ban the sender' );
    }

    my $foreign_sender = temp_user();
    $foreign_sender->update_self( { status => 'A' } );
    my $foreign_msg = make_message( $foreign_sender, $foreign );
    my $foreign_response =
        $cb->( GET 'http://localhost/inbox/markspam?msgid=' . $foreign_msg->msgid );
    is( $foreign_response->code, 303, 'foreign message ID is rejected before a form renders' );
    is( LJ::check_rel( $owner, $foreign_sender, 'B' ) || 0, 0,
        'foreign ID cannot alter relations' );

    my $outgoing_recipient = temp_user();
    $outgoing_recipient->update_self( { status => 'A' } );
    my $outgoing_msg = make_message( $owner, $outgoing_recipient );
    my $outgoing_response =
        $cb->( GET 'http://localhost/inbox/markspam?msgid=' . $outgoing_msg->msgid );
    is( $outgoing_response->code, 303, 'outgoing message is rejected before a form renders' );
    is( LJ::check_rel( $owner, $outgoing_recipient, 'B' ) || 0,
        0, 'outgoing message guard cannot create a ban' );

    my $missing_response = $cb->( GET 'http://localhost/inbox/markspam?msgid=999999999' );
    is( $missing_response->code, 303, 'missing message ID is rejected before a form renders' );

    my $sysban_sender = temp_user();
    $sysban_sender->update_self( { status => 'A' } );
    my $sysban_msg = make_message( $sysban_sender, $owner );
    my $sysban_response;
    {
        no warnings 'redefine';
        local *LJ::sysban_check = sub { return 1; };
        $sysban_response =
            $cb->( GET 'http://localhost/inbox/markspam?msgid=' . $sysban_msg->msgid );
    }
    is( $sysban_response->code, 403, 'sysban guard rejects the confirmation form' );
    is( LJ::check_rel( $owner, $sysban_sender, 'B' ) || 0, 0, 'sysban guard cannot create a ban' );
};

done_testing;

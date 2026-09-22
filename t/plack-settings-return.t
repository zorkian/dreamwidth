# Characterize notification return URLs used by the modern tracking form.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use LJ::Test qw(temp_user);
use LJ::Subscription::Pending;
plan skip_all => 'Settings integration requires a development server'
    unless $LJ::IS_DEV_SERVER;
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
my $owner   = temp_user();
my $journal = temp_user();
my $session = LJ::Session->create( $owner, nolog => 1 );
my $cookie =
      'ljmastersession='
    . $session->master_cookie_string
    . '; ljloggedin='
    . $session->loggedin_cookie_string;
local $LJ::_T_UNIQCOOKIE_CURRENT_UNIQ = 'settingsReturnProbe';

# Isolate notification delivery to the local Inbox; dev mail is not configured.
local @LJ::NOTIFY_TYPES = ('LJ::NotificationMethod::Inbox');
my $pending = LJ::Subscription::Pending->new(
    $owner,
    journal => $journal,
    event   => 'JournalNewEntry',
    method  => 'Inbox',
    flags   => LJ::Subscription::TRACKING
);
my $field = $pending->freeze;

sub persisted {
    my $fresh = LJ::load_userid( $owner->id, 1 );
    return [
        $fresh->find_subscriptions(
            event   => 'JournalNewEntry',
            journal => $journal,
            method  => 'Inbox',
            arg1    => 0,
            arg2    => 0
        )
    ];
}
test_psgi $app, sub {
    my $send = shift;
    my $cb   = sub {
        my $request = shift;
        $request->header( Cookie => $cookie );
        return $send->($request);
    };
    my $res = $cb->(
        GET '/manage/tracking/user?journal=' . $journal->user,
        Referer => 'http://localhost/manage/profile'
    );
    is( $res->code, 200, 'modern tracking form renders' );
    my ($form) = grep { defined $_->find_input('post_to_settings_page') }
        HTML::Form->parse( $res->content, 'http://localhost/manage/tracking/user' );
    ok( $form, 'tracking form targets settings hub' ) or return;
    is(
        $form->value('ret_url'),
        'http://localhost/manage/profile',
        'validated return URL is carried in real form'
    );
    ok( $form->find_input($field), 'actual form contains requested Inbox subscription' ) or return;

    for my $input ( $form->inputs ) {
        $input->value(undef) if $input->type eq 'checkbox';
    }
    $form->value( $field, 1 );
    my $token = $form->value('lj_form_auth');
    is( scalar @{ persisted() }, 0, 'subscription starts absent' );
    $form->value( 'lj_form_auth', 'invalid' );
    $res = $cb->( $form->click );
    ok( !$res->header('Location'), 'invalid token cannot use the return redirect' );
    like( $res->content, qr/Invalid form/i, 'invalid tracking token has meaningful error' );
    is( scalar @{ persisted() }, 0, 'invalid token leaves subscription absent' );
    $form->value( 'lj_form_auth', $token );
    {
        no warnings 'redefine';
        local *LJ::User::max_subscriptions = sub { 0 };
        $res = $cb->( $form->click );
    }
    ok( !$res->header('Location'), 'notification validation failure stays on settings' );
    like(
        $res->content,
        qr/reached your limit of .* active notifications/s,
        'notification quota failure is visible instead of a redirect'
    );
    unlike(
        $res->content,
        qr/undef error|DieObject=|BML ERROR/,
        'validation response is not an exception banner'
    );
    is( scalar @{ persisted() }, 0, 'failed notification save leaves subscription absent' );
    $res = $cb->( $form->click );
    is( $res->code, 302, 'successful tracking save retains legacy redirect status' );
    is(
        $res->header('Location'),
        'http://localhost/manage/profile',
        'successful save returns to originating page'
    );
    my $saved = persisted();
    is( scalar @$saved, 1, 'successful tracking POST persists exactly one intended subscription' );
    ok( @$saved && $saved->[0]->active, 'saved subscription is active on fresh load' );
};
done_testing;

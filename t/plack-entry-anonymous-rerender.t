#!/usr/bin/perl
# Verify anonymous legacy retry rendering retains safe submitted form state.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Controller::Entry;
use DW::Entry::Legacy;
use DW::FormErrors;
use DW::Request;
use DW::Request::Plack;
use Plack::Middleware::DW::RequestWrapper;
use Storable qw(nfreeze thaw);
use LJ::Test qw(temp_user);

plan skip_all => 'Anonymous rerender integration requires a development server'
    unless $LJ::IS_DEV_SERVER;

sub form_from {
    return ( grep { ( $_->attr('id') || '' ) eq 'js-post-entry' }
            HTML::Form->parse( $_[0], 'http://localhost/entry/new' ) )[0];
}
my $owner = temp_user();
$owner->update_self( { status => 'A' } );
$owner->set_draft_text('anonymous draft sentinel');
$owner->set_prop(
    draft_properties => nfreeze( { subject => 'anonymous draft subject', editor => 'markdown0' } )
);
$owner->set_prop( entry_editor => 'always_rich' );
$owner->entry_editor2('markdown0');
my $owner_id = $owner->id;
my @calls;
my $app = Plack::Middleware::DW::RequestWrapper->wrap(
    sub {
        my $post     = DW::Request->get->post_args;
        my $prepared = DW::Entry::Legacy::prepare_entry_form( { tz => 'guess' }, $post );
        my $errors   = DW::FormErrors->new;
        $errors->add_string( undef, 'anonymous retry marker' );
        my $hooks = \&LJ::Hooks::run_hooks;
        no warnings 'redefine';
        local *LJ::Hooks::run_hooks = sub {
            push @calls, $_[0] if $_[0] =~ /^(?:decode_entry_form|spam_check|after_entry_post)/;
            return $hooks->(@_);
        };
        DW::Controller::Entry::legacy_new_rerender(
            $prepared,
            remote             => undef,
            anonymous_username => $post->{user},
            errors             => $errors
        );
        DW::Request->get->status(200);
        return DW::Request->get->res;
    }
);
test_psgi $app, sub {
    my $send = shift;
    my $res  = $send->(
        POST '/anonymous-rerender',
        [
            user                  => $owner->user,
            password              => 'secret-not-retained',
            subject               => 'Anonymous retry subject',
            event                 => 'Anonymous retry body',
            security              => 'private',
            prop_taglist          => 'one, two',
            prop_current_location => 'Retry location',
            prop_current_music    => 'Retry music',
            date_ymd_yyyy         => 'not-a-year',
            date_ymd_mm           => '02',
            date_ymd_dd           => '03',
            hour                  => '04',
            min                   => '05',
            editor                => 'markdown0',
        ]
    );
    is( $res->code, 200, 'anonymous retry renders' );
    my $form = form_from( $res->content );
    ok( $form, 'native retry form parses' ) or BAIL_OUT('missing native form');
    my @usernames = grep { ( $_->name || '' ) eq 'username' } $form->inputs;
    my ($visible_username) = grep { $_->type ne 'hidden' } @usernames;
    is( $visible_username->value, $owner->user, 'visible username is retained' );
    is( scalar @usernames, 2, 'native form retains its hidden and visible username controls' );
    is_deeply(
        [ map { $_->value } grep { ( $_->name || '' ) eq 'password' } $form->inputs ],
        [ '', '' ],
        'every native password control is blanked'
    );
    unlike( $res->content, qr/secret-not-retained/, 'raw submitted password is absent' );
    is( $form->value('subject'),          'Anonymous retry subject', 'subject retained' );
    is( $form->value('event'),            'Anonymous retry body',    'body retained' );
    is( $form->value('security'),         'private',                 'security retained' );
    is( $form->value('taglist'),          'one, two',                'tags retained' );
    is( $form->value('current_location'), 'Retry location',          'location retained' );
    is( $form->value('current_music'),    'Retry music',             'music retained' );
    is( $form->value('entrytime_date'),   'not-a-year-02-03',        'raw invalid date retained' );
    is_deeply( \@calls, [], 'render-only helper invokes no hooks after preparation' );
    my $fresh = LJ::load_userid( $owner_id, 1 );
    is( $fresh->draft_text, 'anonymous draft sentinel', 'draft remains unchanged' );
    is_deeply(
        thaw( $fresh->prop('draft_properties') ),
        { subject => 'anonymous draft subject', editor => 'markdown0' },
        'draft properties remain unchanged'
    );
    is( $fresh->prop('entry_editor'), 'always_rich', 'legacy editor preference remains unchanged' );
    is( $fresh->entry_editor2,        'markdown0',   'native editor preference remains unchanged' );
};
done_testing;

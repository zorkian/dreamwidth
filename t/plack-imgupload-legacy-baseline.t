#!/usr/bin/perl
# Characterize retained legacy image URL insertion callbacks without uploads.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
use HTML::Form;
use Plack::Test;
BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
my $app = do "$ENV{LJHOME}/app.psgi";
die $@ unless ref $app eq 'CODE';
local $LJ::IS_DEV_SERVER = 1;

sub insert_form {
    return ( grep { ( $_->attr('id') || '' ) eq 'insobjform' }
            HTML::Form->parse( $_[0], 'http://localhost/imgupload' ) )[0];
}
test_psgi $app, sub {
    my $cb = shift;
    for my $path ( '/imgupload', '/imgupload.bml' ) {
        my $res = $cb->( GET $path );
        is( $res->code, 200, "$path renders the retained URL insertion dialog" );
        my $form = insert_form( $res->content );
        ok( $form, "$path URL insertion form parses" );
        for my $name (qw(method url alt btn:next)) {
            ok( $form->find_input($name), "$path retains $name control" );
        }
        is( $form->value('method'), 'url', "$path selects URL insertion by default" );
        like( $res->content, qr/writing good descriptions/i,
            "$path renders the alt-text FAQ hook" );
        $res = $cb->(
            POST $path,
            [
                method     => 'url',
                url        => 'https://example.invalid/inserted.png',
                alt        => 'Inserted alt marker',
                'btn:next' => 'Insert',
            ]
        );
        is( $res->code, 200, "$path URL insertion callback renders" );
        like(
            $res->content,
qr/InOb\.onInsURL\("https:\/\/example\.invalid\/inserted\.png", 0, 0, "Inserted alt marker"\)/,
            "$path callback retains exact URL and alt text"
        );
        like( $res->content, qr/InOb\.onClosePopup\(\)/, "$path callback closes the popup" );
    }
    my $res =
        $cb->( GET
'/imgupload?upload_count=2&su_1=first&pp_1=thumb&sw_1=12.9&sh_1=7.1&su_2=second&pp_2=full&sw_2=32&sh_2=24'
        );
    is( $res->code, 200, 'numbered upload callback renders' );
    my $body = $res->content;
    my $one  = index $body, 'InOb.onUpload("first", "thumb", 12, 7)';
    my $two  = index $body, 'InOb.onUpload("second", "full", 32, 24)';
    ok( $one >= 0 && $two > $one, 'numbered upload callbacks retain order and integer dimensions' );
    like( $body, qr/InOb\.onClosePopup\(\)/, 'numbered upload callback closes the popup' );
};
done_testing;

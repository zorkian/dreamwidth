# t/customtext-module.t
#
# Tests for the Custom Text module heading, in particular the difference
# between a heading that has never been customized (which falls back to the
# style's default heading) and one that was deliberately saved blank (which
# must stay blank).
#
# Authors:
#      Dreamwidth Studios, LLC
#
# Copyright (c) 2025 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

use strict;
use warnings;

use Test::More;

BEGIN { $LJ::_T_CONFIG = 1; require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }

use LJ::Test qw(temp_user);
use LJ::S2                       ();
use LJ::Widget::CustomTextModule ();
use DW::Template                 ();

my $STYLE_HEADING = 'Style Default Heading';

# a minimal fake S2 context carrying the style's default custom text heading
sub fake_ctx {
    my $ctx = [];
    $ctx->[S2::PROPS] = { text_module_customtext => $STYLE_HEADING };
    return $ctx;
}

my $u = temp_user();

# pretend to be a logged-in web request so the widget can find its user
$ENV{MOD_PERL} = 1;
LJ::set_remote($u);
$BMLCodeBlock::GET{authas} = $u->user;

sub save_form {
    my (%fields) = @_;
    LJ::Widget::CustomTextModule->handle_post(
        {
            module_customtext_title   => $fields{title},
            module_customtext_url     => $fields{url} // '',
            module_customtext_content => $fields{content} // '',
        }
    );
}

sub reset_form {
    local %BMLCodeBlock::POST = ( 'Widget[CustomizeTheme]_reset' => 1 );
    LJ::Widget::CustomTextModule->handle_post( {} );
}

# render the customization widget and capture the vars passed to the template
sub rendered_vars {
    my $vars;
    {
        no warnings 'redefine';
        local *DW::Template::template_string = sub {
            my ( $class, $filename, $v ) = @_;
            $vars = $v;
            return '';
        };
        LJ::Widget::CustomTextModule->render_body( count => 1 );
    }
    return $vars;
}

subtest 'saving a non-empty heading' => sub {
    plan tests => 2;
    save_form( title => 'My Heading', content => 'Some content' );

    is( $u->prop('customtext_title'), 'My Heading', 'heading is saved' );
    ok( !$u->prop('customtext_title_blank'), 'blank flag is not set' );
};

subtest 'saving a blank heading' => sub {
    plan tests => 2;
    save_form( title => '', content => 'Some content' );

    ok( !$u->prop('customtext_title'), 'previous heading is cleared' );
    is( $u->prop('customtext_title_blank'), 1, 'blank flag is set' );
};

subtest 'saving a non-empty heading after a blank one' => sub {
    plan tests => 2;
    save_form( title => 'My Heading', content => 'Some content' );

    is( $u->prop('customtext_title'), 'My Heading', 'heading is saved' );
    ok( !$u->prop('customtext_title_blank'), 'blank flag is cleared' );
};

subtest 'resetting customization' => sub {
    plan tests => 2;
    save_form( title => '', content => 'Some content' );
    reset_form();

    is( $u->prop('customtext_title'), undef, 'heading is cleared' );
    ok( !$u->prop('customtext_title_blank'), 'blank flag is cleared' );
};

# the widget only consults S2 theme data for users on S2, which needs a full
# style setup; the heading logic under test is independent of that fallback
$u->set_prop( stylesys => 1 );

subtest 'redisplaying a saved blank heading' => sub {
    plan tests => 1;
    save_form( title => '', content => 'Some content' );

    my $vars = rendered_vars();
    is( $vars->{custom_text_title}, '', 'heading field stays blank' );
};

subtest 'redisplaying a saved non-empty heading' => sub {
    plan tests => 1;
    save_form( title => 'My Heading', content => 'Some content' );

    my $vars = rendered_vars();
    is( $vars->{custom_text_title}, 'My Heading', 'heading field shows the saved heading' );
};

subtest 'redisplaying a heading that was never customized' => sub {
    plan tests => 1;
    $u->clear_prop('customtext_title');
    $u->clear_prop('customtext_title_blank');

    my $vars = rendered_vars();
    is( $vars->{custom_text_title}, 'Custom Text', 'heading field shows the default text' );
};

subtest 'page building resolves the heading' => sub {
    plan tests => 6;

    $u->clear_prop('customtext_title');
    $u->clear_prop('customtext_title_blank');

    my $title = LJ::S2::resolve_customtext_title( $u, fake_ctx() );
    is( $title, $STYLE_HEADING, 'unset heading falls back to the style default' );

    my $persisted = $u->prop('customtext_title');
    is( $persisted, $STYLE_HEADING, 'style default is persisted' );

    $u->set_prop( customtext_title => 'Custom Text' );
    $title = LJ::S2::resolve_customtext_title( $u, fake_ctx() );
    is( $title, $STYLE_HEADING, 'legacy "Custom Text" heading falls back to the style default' );

    $u->clear_prop('customtext_title');
    $u->set_prop( customtext_title_blank => 1 );
    $title = LJ::S2::resolve_customtext_title( $u, fake_ctx() );
    is( $title, '', 'deliberately blank heading stays blank' );

    ok( !$u->prop('customtext_title'), 'blank heading is not overwritten' );

    $u->set_prop( customtext_title => 'My Heading' );
    $u->clear_prop('customtext_title_blank');
    $title = LJ::S2::resolve_customtext_title( $u, fake_ctx() );
    is( $title, 'My Heading', 'non-empty heading is unchanged' );
};

subtest 'S2 rendering of the custom text module' => sub {
    plan tests => 6;

    # compile the real core2 layer in memory, the same way update-db.pl does
    open( my $fh, '<', "$ENV{LJHOME}/styles/core2.s2" ) or die "open core2.s2: $!";
    my $source = do { local $/; <$fh> };
    close($fh);

    my $compiled;
    my $cplr = S2::Compiler->new( { checker => S2::Checker->new } );
    $cplr->compile_source(
        {
            type           => 'core',
            source         => \$source,
            output         => \$compiled,
            layerid        => 990001,
            untrusted      => 0,
            builtinPackage => 'S2::Builtin::LJ',
        }
    );

    S2::set_domain('customtext-test');
    eval $compiled;
    die "compiling core2.s2 failed: $@" if $@;

    my $ctx = S2::make_context( [990001] );
    my $out = '';

    S2::set_output( sub      { $out .= $_[0] } );
    S2::set_output_safe( sub { $out .= $_[0] } );

    my $open_module = 'open_module(string,string,string,bool)';
    my $header_re   = qr{<h2 class="module-header">My Heading</h2>};

    $out = '';
    S2::run_function( $ctx, $open_module, 'customtext', 'My Heading', '', 0 );
    like( $out, $header_re, 'non-empty title prints the module heading' );

    $out = '';
    S2::run_function( $ctx, $open_module, 'customtext', '', '', 0 );
    like( $out, qr{<div class="module-customtext module">}, 'module wrapper is still printed' );
    unlike( $out, qr{<h2}, 'blank title prints no heading element' );
    like( $out, qr{<div class="module-content">}, 'module content wrapper is still printed' );

    no warnings 'once';
    local $LJ::S2::CURR_PAGE = {
        '_type'              => 'Page',
        'customtext_title'   => '',
        'customtext_url'     => '',
        'customtext_content' => 'Some custom content',
    };

    $out = '';
    S2::run_function( $ctx, 'print_module_customtext()' );
    unlike( $out, qr{<h2}, 'module prints no heading when the title is blank' );
    like( $out, qr{Some custom content}, 'module content is still printed' );
};

done_testing();

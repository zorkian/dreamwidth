#!/usr/bin/perl
# Characterize opt-in legacy entry success rendering hooks without external code.
# Copyright (c) 2026 by Dreamwidth Studios, LLC. Same terms as Perl itself.
use strict;
use warnings;
use Test::More;
use HTTP::Request::Common;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use DW::Request::Standard;
use Scalar::Util qw(refaddr);
use DW::Controller::Entry;
use LJ::Test qw(temp_user);

sub form_request {
    return {
        security        => 'public',
        props           => { editor => 'html_raw0' },
        crosspost_entry => 0,
        crosspost       => {},
    };
}

{
    my $user         = temp_user();
    my $flat_request = { subject => 'Legacy subject', prop_current_location => 'Legacy location' };
    my ( @events, @options_args, @html_args, $template_vars );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        return { itemid => 1, anum => 1, url => '/entry/legacy/257.html' };
    };
    local *DW::Controller::Entry::_queue_crosspost = sub {
        push @events, 'crosspost';
        return ();
    };
    local *DW::Controller::Entry::_get_extradata = sub { return {} };
    local *LJ::Hooks::run_hooks                  = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'after_entry_post_extra_options' ) {
            push @events, 'options';
            push @options_args, {@args};
            return ( [ '<li>Legacy option one</li>', 'ignored option value' ],
                ['<li>Legacy option two</li>'] );
        }
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'after_entry_post_extra_html' ) {
            push @events, 'html';
            push @html_args, {@args};
            return '<p>Legacy HTML marker</p>';
        }
        return;
    };
    local *DW::Template::render_template = sub {
        my ( $class, $name, $vars ) = @_;
        push @events, 'render';
        $template_vars = $vars;
        return '<ul class="successlinks">' . ( $vars->{legacy_extra_options} || '' ) . '</ul>'
            . ( $vars->{legacy_extra_html} || '' );
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $user, journal => $user },
        legacy_success => { poster => $user, remote => $user, request => $flat_request },
    );

    is( $result{status}, 'ok', 'opt-in ordinary legacy pipeline succeeds' );
    is_deeply(
        \@events,
        [qw(crosspost options html render)],
        'ordinary legacy options and HTML run after crosspost before success rendering'
    );
    is( $options_args[0]{user}->id, $user->id, 'ordinary options hook receives target journal' );
    is( $html_args[0]{user}->id,    $user->id, 'ordinary HTML hook receives target journal' );
    is( $options_args[0]{itemlink},
        '/entry/legacy/257.html', 'ordinary options hook receives published entry URL' );
    is(
        $html_args[0]{itemlink},
        $options_args[0]{itemlink},
        'ordinary hooks receive the exact same published entry URL'
    );
    is( refaddr( $html_args[0]{request} ),
        refaddr($flat_request),
        'ordinary HTML hook receives the explicit original flat request reference' );
    is(
        $html_args[0]{request}{prop_current_location},
        'Legacy location',
        'ordinary HTML hook retains flat legacy properties'
    );
    is(
        $template_vars->{legacy_extra_options},
        '<li>Legacy option one</li><li>Legacy option two</li>',
        'ordinary success links use only each hook result first element in order'
    );
    like(
        $result{render},
        qr/<li>Legacy option one<\/li><li>Legacy option two<\/li>/,
        'ordinary hook options are visible inside the success link area'
    );
    like(
        $result{render},
        qr/<p>Legacy HTML marker<\/p>\z/,
        'ordinary hook HTML is visible after the success rendering'
    );
}

{
    my $user = temp_user();
    my $flat_request =
        { subject => 'Moderated subject', prop_current_location => 'Moderated location' };
    my ( @events, @html_args, $template_vars );

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub { return { message => 'Queued for moderation' } };
    local *DW::Controller::Entry::_queue_crosspost = sub {
        push @events, 'crosspost';
        return ();
    };
    local *LJ::Hooks::run_hooks = sub {
        my ($name) = @_;
        push @events, 'options' if $name eq 'after_entry_post_extra_options';
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        my ( $name, @args ) = @_;
        if ( $name eq 'after_entry_post_extra_html' ) {
            push @events, 'html';
            push @html_args, {@args};
            return '<p>Moderated HTML marker</p>';
        }
        return;
    };
    local *DW::Template::render_template = sub {
        my ( $class, $name, $vars ) = @_;
        push @events, 'render';
        $template_vars = $vars;
        return '<div>moderated success</div>' . ( $vars->{legacy_extra_html} || '' );
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $user, journal => $user },
        legacy_success => { poster => $user, remote => $user, request => $flat_request },
    );

    is( $result{status}, 'ok', 'opt-in moderated legacy pipeline succeeds' );
    is_deeply( \@events, [qw(html render)],
        'moderated legacy result skips crosspost/options and runs HTML before rendering' );
    ok( $template_vars->{moderated_message}, 'moderated success template receives its message' );
    is( $html_args[0]{user},     undef, 'moderated HTML hook keeps unset legacy journal' );
    is( $html_args[0]{itemlink}, undef, 'moderated HTML hook keeps unset legacy item link' );
    is( refaddr( $html_args[0]{request} ),
        refaddr($flat_request),
        'moderated HTML hook receives the explicit original flat request reference' );
    is(
        $html_args[0]{request}{prop_current_location},
        'Moderated location',
        'moderated HTML hook retains flat legacy properties'
    );
    like(
        $result{render},
        qr/<p>Moderated HTML marker<\/p>\z/,
        'moderated hook HTML is visible after the success rendering'
    );
}

{
    DW::Request->reset;
    my $request      = DW::Request::Standard->new( GET 'http://localhost/entry/new' );
    my $user         = temp_user();
    my $flat_request = { prop_current_location => 'Real template location' };

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        return { itemid => 1, anum => 1, url => '/entry/real-template/257.html' };
    };
    local *DW::Controller::Entry::_queue_crosspost = sub { return () };
    local *DW::Controller::Entry::_get_extradata   = sub {
        return {
            security_ml => '.security.public',
            filters     => '',
            subject     => 'Real template subject'
        };
    };
    local *LJ::Hooks::run_hooks = sub {
        return ['<li>Real template option marker</li>']
            if $_[0] eq 'after_entry_post_extra_options';
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        return '<p>Real template HTML marker</p>' if $_[0] eq 'after_entry_post_extra_html';
        return;
    };
    my $real_render_template = \&DW::Template::render_template;
    local *DW::Template::render_template = sub {
        my ( $class, $template, $vars ) = @_;
        return $real_render_template->( $class, $template, $vars, { no_sitescheme => 1 } );
    };

    my %result = DW::Controller::Entry::_do_post(
        form_request(), {},
        { poster => $user, journal => $user },
        legacy_success => { poster => $user, remote => $user, request => $flat_request },
    );
    is( $result{status}, 'ok',
        'real Template Toolkit legacy success render returns canonical status' );
    is( $result{render}, $request->OK,
        'real Template Toolkit render result remains request status' );
    like(
        $request->response_content,
        qr/Real template option marker/,
        'real Template Toolkit response includes legacy option hook output'
    );
    like(
        $request->response_content,
        qr/Real template HTML marker/,
        'real Template Toolkit response includes legacy HTML hook output'
    );
    like(
        $request->response_content,
        qr/Real template option marker.*Real template HTML marker/s,
        'real Template Toolkit response preserves option-before-HTML output order'
    );
    DW::Request->reset;
}

{
    my $user = temp_user();
    my @hooks;

    no warnings 'redefine';
    local *DW::Entry::_save_new_entry = sub {
        return { itemid => 1, anum => 1, url => '/entry/native/257.html' };
    };
    local *DW::Controller::Entry::_queue_crosspost = sub { return () };
    local *DW::Controller::Entry::_get_extradata   = sub { return {} };
    local *LJ::Hooks::run_hooks                    = sub {
        my $name = shift;
        push @hooks, $name if $name =~ /^after_entry_post_extra_/;
        return ();
    };
    local *LJ::Hooks::run_hook = sub {
        my $name = shift;
        push @hooks, $name if $name =~ /^after_entry_post_extra_/;
        return;
    };
    local *DW::Template::render_template = sub { return 'native success'; };

    my %result = DW::Controller::Entry::_do_post( form_request(), {},
        { poster => $user, journal => $user } );
    is( $result{status}, 'ok', 'native pipeline succeeds without legacy context' );
    is_deeply( \@hooks, [], 'native pipeline invokes neither legacy success hook' );
    is( $result{render}, 'native success', 'native response has no legacy hook output' );
}

done_testing;

#!/usr/bin/perl
#
# DW::Controller::Entry
#
# This controller is for creating and managing entries
#
# Authors:
#      Afuna <coder.dw@afunamatata.com>
#
# Copyright (c) 2011-2014 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::Controller::Entry;

use strict;
use Storable;

use LJ::Global::Constants;

use DW::Controller;
use DW::Routing;
use DW::Template;
use DW::FormErrors;
use DW::Formats;
use DW::Entry;
use DW::Entry::Legacy;

use Hash::MultiValue;
use HTTP::Status qw( :constants );
use LJ::JSON;
use LJ::SpellCheck;

use DW::External::Account;
use DW::External::Page;
use DW::External::Site;

my @modules = qw(
    tags displaydate slug
    currents comments age_restriction
    icons crosspost sticky
);

my @sites = DW::External::Site->get_sites;
my @sitevalues;
foreach my $site ( sort { $a->{sitename} cmp $b->{sitename} } @sites ) {
    push @sitevalues, { domain => $site->{domain}, sitename => $site->{sitename} };
}

=head1 NAME

DW::Controller::Entry - Controller which handles posting and editing entries

=head1 Controller API

Handlers for creating and editing entries

=cut

DW::Routing->register_string( '/entry/new', \&new_handler, app => 1 );
DW::Routing->register_regex( '^/entry/([^/]+)/new$', \&new_handler, app => 1 );

DW::Routing->register_string(
    '/entry/preview', \&preview_handler,
    app     => 1,
    methods => { POST => 1 }
);
DW::Routing->register_string(
    '/preview/entry', \&legacy_preview_handler,
    app     => 1,
    methods => { GET => 1, HEAD => 1, POST => 1 }
);

DW::Routing->register_string( '/__rpc_draft', \&draft_rpc_handler, app => 1, format => 'json' );

DW::Routing->register_string( '/entry/options',      \&options_handler,     app => 1 );
DW::Routing->register_string( '/__rpc_entryoptions', \&options_rpc_handler, app => 1 );
DW::Routing->register_string(
    '/__rpc_entryformcollapse', \&collapse_rpc_handler,
    app     => 1,
    methods => { GET => 1 },
    format  => 'json'
);

# /entry/username/ditemid/edit
DW::Routing->register_regex( '^/entry/(?:(.+)/)?(\d+)/edit$', \&edit_handler, app => 1 );

DW::Routing->register_string( '/entry/new', \&_new_handler_userspace, user => 1 );

# The retired posting page is fully graduated: every GET canonicalizes to the
# native form, and any POST is necessarily a stale tab submitting the old
# schema. DW::Routing strips the legacy .bml suffix before lookup, covering
# both URLs.
DW::Routing->register_string(
    '/update',
    sub {
        my $r   = DW::Request->get;
        my $get = $r->get_args;

        if ( $r->method eq 'GET' ) {
            my $usejournal = LJ::canonical_username( $get->{usejournal} );
            my $path       = length $usejournal ? "/entry/$usejournal/new" : '/entry/new';

            my %args;
            for my $name (qw(subject event share)) {
                $args{$name} = $get->{$name} if defined $get->{$name} && length $get->{$name};
            }
            $args{tags} = $get->{prop_taglist}
                if defined $get->{prop_taglist} && length $get->{prop_taglist};

            $r->status(302);
            $r->header_out( Location => LJ::create_url( $path, args => \%args ) );
            return $r->OK;
        }

        # A POST here is old-schema content from a stale tab: it must never be
        # saved and never be silently discarded. Decode once and hand the
        # submitted content to the native form for the poster to review and
        # resubmit; this applies uniformly regardless of which old submit
        # button (post, preview, spellcheck, a transform) was clicked.
        my $post     = $r->post_args;
        my $prepared = DW::Entry::Legacy::prepare_entry_form( { tz => 'guess' }, $post );
        my $warnings = DW::FormErrors->new;
        $warnings->add( undef, '.notice.legacy_carryover' );
        my $remote = LJ::get_remote();

        return legacy_new_rerender(
            $prepared,
            remote     => $remote,
            get        => $get,
            warnings   => $warnings,
            action_url => '/entry/new',
            ( LJ::isu($remote) ? () : ( anonymous_username => $post->{user} // '' ) ),
        );
    },
    app => 1,
);

# redirect to app-space
sub _user_to_app_role {
    my ($path) = @_;
    return DW::Request->get->redirect( LJ::create_url( $path, host => $LJ::DOMAIN_WEB ) );
}

sub _new_handler_userspace { return _user_to_app_role("/entry/$_[0]->{username}/new") }

=head2 C<< DW::Controller::Entry::new_handler( ) >>

Handles posting a new entry

=cut

sub new_handler {
    my ( $call_opts, $usejournal ) = @_;

    my ( $ok, $rv ) = controller( anonymous => 1 );
    return $rv unless $ok;

    my $r      = DW::Request->get;
    my $remote = $rv->{remote};

    # these kinds of errors prevent us from initializing the form at all
    # so abort and return it without the form
    if ($remote) {
        return error_ml( "/entry/form.tt.error.nonusercantpost", { sitename => $LJ::SITENAME } )
            if $remote->is_identity;

        return error_ml("/entry/form.tt.error.cantpost")
            unless $remote->can_post;
    }

    my $errors   = DW::FormErrors->new;
    my $warnings = DW::FormErrors->new;
    my $post     = $r->did_post ? $r->post_args : undef;

    # figure out times
    my $datetime;
    my $trust_datetime_value = 0;

    if ( $post && $post->{entrytime_date} && $post->{entrytime_time} ) {
        $datetime             = "$post->{entrytime_date} $post->{entrytime_time}";
        $trust_datetime_value = 1;
    }
    else {
        my $now = DateTime->now;

        # if user has timezone, use it!
        if ( $remote && $remote->prop("timezone") ) {
            my $tz = $remote->prop("timezone");
            $tz  = $tz ? eval { DateTime::TimeZone->new( name => $tz ); } : undef;
            $now = eval { DateTime->from_epoch( epoch => time(), time_zone => $tz ); }
                if $tz;
        }

        $datetime = $now->strftime("%F %R"),
            $trust_datetime_value = 0;    # may want to override with client-side JS
    }

    # crosspost account selected?
    my %crosspost;
    if ( !$r->did_post && $remote ) {
        %crosspost = map { $_->acctid => $_->xpostbydefault }
            DW::External::Account->get_external_accounts($remote);
    }

    my $get = $r->get_args;

    # A spellcheck transform must use the posted journal selection, just as a
    # real save would, rather than falling back to the route or prior GET. An
    # empty submitted value deliberately selects the owner journal.
    my $spellcheck_has_posted_usejournal =
        $post && $post->{"action:spellcheck"} && exists $post->{usejournal};
    if ($spellcheck_has_posted_usejournal) {
        $usejournal = $post->{usejournal};
    }
    $usejournal ||= $get->{usejournal} unless $spellcheck_has_posted_usejournal;
    my $vars = _init(
        {
            usejournal => $usejournal,
            remote     => $remote,

            datetime             => $datetime || "",
            trust_datetime_value => $trust_datetime_value,

            crosspost => \%crosspost,
        },
        @_
    );

    # now look for errors that we still want to recover from
    $errors->add( undef, ".error.invalidusejournal" )
        if defined $usejournal && !$vars->{usejournal};

    my $spellcheck_requested;
    if ( $r->did_post ) {
        $spellcheck_requested = $post->{"action:spellcheck"} ? 1 : 0;
        my $mode_preview  = $post->{"action:preview"} ? 1 : 0;
        my $okay_formauth = !$remote || LJ::check_form_auth( $post->{lj_form_auth} );

        # Spellcheck is a form transform: validate its existing CSRF token, then
        # return the submitted form before body validation, auth, or persistence.
        if ($spellcheck_requested) {
            $errors->add( undef, "error.invalidform" ) unless $okay_formauth;
            $spellcheck_requested = 0 unless $okay_formauth;
        }
        else {
            $errors->add( undef, 'bml.badinput.body1' )
                unless LJ::text_in($post);

            $errors->add( undef, "error.invalidform" )
                unless $okay_formauth;

            if ($mode_preview) {

                # do nothing
            }
            elsif ( $okay_formauth && $post->{showform} )
            {    # some other form posted content to us, which the user will want to edit further

            }
            elsif ($okay_formauth) {
                my $flags = {};

                my %auth = _auth( $flags, $post, $remote );

                my $uj = $auth{journal};
                $errors->add_string( undef, $LJ::MSG_READONLY_USER )
                    if $uj && $uj->readonly;

                # do a login action to check if we can authenticate as unverified_username
                # and to display any important messages connected to your account
                {
                    # build a clientversion string
                    my $clientversion = "Web/3.0.0";

                    # build a request object
                    my %login_req = (
                        ver           => $LJ::PROTOCOL_VER,
                        clientversion => $clientversion,
                        username      => $auth{unverified_username},
                    );

                    my $err;
                    my $login_res = LJ::Protocol::do_request( "login", \%login_req, \$err, $flags );

                    unless ($login_res) {
                        $errors->add( undef, ".error.login",
                            { error => LJ::Protocol::error_message($err) } );
                    }

                    # e.g. not validated
                    $warnings->add_string( undef,
                        LJ::auto_linkify( LJ::ehtml( $login_res->{message} ) ) )
                        if $login_res->{message};
                }

                my $form_req = {};
                DW::Entry::_form_to_backend( 0, $form_req, $post, errors => $errors );

                # check for spam domains
                LJ::Hooks::run_hooks( 'spam_check', $auth{poster}, $form_req, 'entry' );

                # if we didn't have any errors with decoding the form, proceed to post
                unless ( $errors->exist ) {
                    my %post_res = _do_post( $form_req, $flags, \%auth, warnings => $warnings );
                    return $post_res{render} if $post_res{status} eq "ok";

                    # oops errors when posting: show error, fall through to show form
                    $errors->add_string( undef, $post_res{errors} ) if $post_res{errors};
                }
            }
        }
    }

    return _render_new_form( $vars, $post, $get, $remote, $errors, $warnings,
        $spellcheck_requested );
}

# Render the narrow ordinary-owned GET subset of retained editjournal. This is
# intentionally callable only: the picker route keeps public GET fallthrough in
# BML until this composition has its own review. The item is resolved solely
# from one canonical GET value, never a hidden POST control or a decoded last
# value of a repeated query key.
sub legacy_owned_edit_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';

    my $get     = $r->get_args;
    my @itemids = $get->get_all('itemid');
    return undef unless @itemids == 1;
    my $ditemid = $itemids[0];
    return undef unless defined $ditemid && $ditemid =~ /\A[1-9][0-9]*\z/;

    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($remote) && $remote->is_individual && !$remote->readonly;

    # This slice owns only the remote's personal journal. Explicit self aliases
    # collapse to it; all community and auth-as contexts retain BML behavior.
    for my $name (qw(authas usejournal journal)) {
        next unless defined $get->{$name} && length $get->{$name};
        return undef unless LJ::canonical_username( $get->{$name} ) eq $remote->user;
    }

    my $entry = LJ::Entry->new( $remote, ditemid => $ditemid );
    return undef unless $entry && $entry->valid && $entry->visible_to($remote);
    return undef unless $entry->editable_by($remote) && $entry->poster->equals($remote);
    return undef unless $entry->ditemid == $ditemid;

    # Match retained editjournal's pre-render beta redirect exactly. Its query
    # dropping is intentional legacy behavior, unlike the native form action.
    if ( LJ::BetaFeatures->user_in_beta( $remote => 'updatepage' ) ) {
        $r->status(302);
        $r->header_out( Location => '/entry/' . $remote->user . '/' . $ditemid . '/edit' );
        return $r->OK;
    }

    my %crosspost;
    if ( my $xpost = $entry->prop('xpostdetail') ) {
        my $xposthash = DW::External::Account->xpost_string_to_hash($xpost);
        %crosspost = map { $_ => 1 } keys %{ $xposthash || {} };
    }

    my $vars = _init(
        {
            usejournal           => $remote->username,
            remote               => $remote,
            datetime             => $entry->eventtime_mysql,
            trust_datetime_value => 1,
            crosspost            => \%crosspost,
            sticky_entry         => $remote->sticky_entries_lookup->{ $entry->ditemid },
        },
        undef
    );
    my $action_path = '/entry/' . $remote->user . '/' . $ditemid . '/edit';
    return _render_edit_form(
        $r, $vars,
        DW::FormErrors->new,
        DW::FormErrors->new,
        undef, $entry, $remote, $remote, 0,
        action => {
            edit => 1,
            url  => LJ::create_url( $action_path, keep_query_string => 1 ),
        },
    );
}

# Callable-only community item-bearing retained edit GET composition. Public
# editjournal routing remains BML-owned until this seam's route parity is reviewed.
sub legacy_community_edit_get_handler {
    my (%opts) = @_;
    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';
    my $get     = $r->get_args;
    my @itemids = $get->get_all('itemid');
    return undef unless @itemids == 1 && $itemids[0] =~ /\A[1-9][0-9]*\z/;
    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($remote);
    my $authas = $get->{authas} || $remote->user;
    my $actor  = LJ::get_authas_user($authas);
    return undef unless LJ::isu($actor) && $actor->is_individual && !$actor->readonly;
    my $name = $get->{usejournal} || $get->{journal};
    return undef unless $name;
    my $journal = LJ::load_user($name);
    return undef unless LJ::isu($journal) && $journal->is_comm && !$journal->readonly;
    my $ditemid = $itemids[0];
    my $entry   = LJ::Entry->new( $journal, ditemid => $ditemid );
    return undef unless $entry && $entry->valid && $entry->ditemid == $ditemid;
    return undef unless $entry->visible_to($actor) && $entry->editable_by($actor);
    return undef if $opts{same_poster_only} && !$entry->poster->equals($actor);
    my $path   = '/entry/' . $journal->user . '/' . $ditemid . '/edit';
    my $action = LJ::create_url( $path, keep_query_string => 1 );

    if ( $entry->poster->equals($actor) ) {
        if ( LJ::BetaFeatures->user_in_beta( $actor => 'updatepage' ) ) {
            $r->status(302);
            $r->header_out( Location => $path );
            return $r->OK;
        }
        my %crosspost;
        if ( my $xpost = $entry->prop('xpostdetail') ) {
            my $detail = DW::External::Account->xpost_string_to_hash($xpost);
            %crosspost = map { $_ => 1 } keys %{ $detail || {} };
        }
        my $vars = _init(
            {
                usejournal           => $journal->username,
                remote               => $actor,
                datetime             => $entry->eventtime_mysql,
                trust_datetime_value => 1,
                crosspost            => \%crosspost,
                sticky_entry         => $journal->sticky_entries_lookup->{$ditemid}
            },
            undef
        );
        return _render_edit_form( $r, $vars, DW::FormErrors->new, DW::FormErrors->new, undef,
            $entry, $actor, $journal, 0, action => { edit => 1, url => $action } );
    }
    return undef unless $actor->can_manage($journal);
    return _render_maintainer_form( $entry, $journal, $actor, action => $action );
}

# Dispatch the narrow ordinary-owned retained edit subset after the route
# composition has preserved picker and BML fallthroughs.  The retained resolver
# decides the item from GET first and then the hidden POST field; only a
# same-session, personal-journal owner can cross this boundary.
sub legacy_owned_edit_handler {
    my $r = DW::Request->get or return undef;
    return undef unless $r->did_post;

    my $get     = $r->get_args;
    my $post    = $r->post_args;
    my $ditemid = $get->{itemid} || $post->{itemid};
    return undef unless $ditemid;

    my $remote = LJ::get_remote();
    return undef unless LJ::isu($remote);

    my $authas = $get->{authas} || $remote->user;
    my $u      = LJ::get_authas_user($authas);
    return undef unless LJ::isu($u) && $u->is_individual && $u->equals($remote);

    # Keep retained GET-first, then POST, then journal usejournal selection and
    # its same-user collapse.
    # Any remaining target belongs to the community/maintainer BML path.
    my $usejournal = $get->{usejournal} || $post->{usejournal} || $get->{journal};
    undef $usejournal if defined $usejournal && $usejournal eq $u->user;
    return undef if $usejournal;

    my $entry = LJ::Entry->new( $u, ditemid => $ditemid );
    return undef unless $entry && $entry->valid && $entry->visible_to($remote);
    return undef unless $entry->poster->equals($remote);

    # Retained editjournal redirects beta owners before action dispatch, and
    # preserves its read-only rejection and non-owner paths in BML.
    return undef if LJ::BetaFeatures->user_in_beta( $remote => 'updatepage' );
    return undef if $u->is_readonly;

    my $action = DW::Entry::Legacy::legacy_edit_action($post);
    return undef unless $action && ( $action eq 'save' || $action eq 'delete' );

    # Form/referer guards intentionally precede the hook-bearing decoder used
    # by legacy_owned_edit_post.  Let BML retain its native rejection response.
    return undef unless LJ::check_form_auth( $post->{lj_form_auth} );
    return undef unless LJ::check_referer();

    my %result = legacy_owned_edit_post(
        entry          => $entry,
        remote         => $remote,
        journal        => $u,
        session_remote => $remote,
        post           => $post,
        get            => $r->get_args( preserve_case => 1 ),
        legacy_seed    => {
            mode       => 'editevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $u->user,
            usejournal => undef,
            itemid     => $entry->jitemid,
            xpost      => '0',
        },
    );
    return $result{render} if exists $result{render};
    return undef;
}

# Callable-only retained editjournal POST resolver for a same-poster community
# entry. It has no route registration: the picker may call it only after the
# personal resolver declines. Every unsupported context returns undef before the
# decoder, while an accepted save/delete always returns the helper's native
# success or retry render.
sub legacy_same_poster_community_edit_handler {
    my $r = DW::Request->get or return undef;
    return undef unless $r->did_post;

    my $get          = $r->get_args;
    my $post         = $r->post_args;
    my @get_itemids  = $get->get_all('itemid');
    my @post_itemids = $post->get_all('itemid');
    my @itemids      = @get_itemids ? @get_itemids : @post_itemids;
    return undef unless @itemids == 1 && $itemids[0] =~ /\A[1-9][0-9]*\z/;
    my $ditemid = $itemids[0];

    my $session_remote = LJ::get_remote();
    return undef unless LJ::isu($session_remote);
    my $authas = $get->{authas} || $session_remote->user;
    my $actor  = LJ::get_authas_user($authas);
    return undef unless LJ::isu($actor) && $actor->is_individual;

    # Retained BML uses truthy GET, POST, then journal context and collapses a
    # same-user target before the personal resolver handles it.
    my $usejournal = $get->{usejournal} || $post->{usejournal} || $get->{journal};
    return undef unless $usejournal;
    return undef if $usejournal eq $actor->user;
    my $journal = LJ::load_user($usejournal);
    return undef unless LJ::isu($journal) && $journal->is_comm;

    my $entry = LJ::Entry->new( $journal, ditemid => $ditemid );
    return undef unless $entry && $entry->valid && $entry->ditemid == $ditemid;
    return undef unless $entry->visible_to($actor) && $entry->poster->equals($actor);

    # Match retained editjournal: readonly and beta remain BML-owned before
    # action classification or the hook-bearing decoder.
    return undef if $actor->is_readonly || $journal->is_readonly;
    return undef if LJ::BetaFeatures->user_in_beta( $session_remote => 'updatepage' );

    my $action = DW::Entry::Legacy::legacy_edit_action($post);
    return undef unless $action && ( $action eq 'save' || $action eq 'delete' );
    return undef unless LJ::check_form_auth( $post->{lj_form_auth} ) && LJ::check_referer();

    my %result = legacy_owned_edit_post(
        entry                 => $entry,
        remote                => $actor,
        session_remote        => $session_remote,
        journal               => $journal,
        same_poster_community => 1,
        post                  => $post,
        get                   => $r->get_args( preserve_case => 1 ),
        legacy_seed           => {
            mode       => 'editevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $actor->user,
            usejournal => $journal->user,
            itemid     => $entry->jitemid,
            xpost      => '0',
        },
    );
    return $result{render} if exists $result{render};

    # Reaching here after an accepted mutation would otherwise make the picker
    # fall through to BML and risk a second attempt.
    return error_ml('error.invalidform');
}

# Callable-only compatibility seam for retained editjournal's other-poster
# community manager properties. It intentionally owns no public route: all
# contexts other than the exact savemaintainer action fall through to BML.
sub legacy_manager_property_post_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->did_post && $r->method eq 'POST';

    my $post        = $r->post_args;
    my $legacy_post = DW::Entry::Legacy::legacy_post_hash($post);
    my $action = DW::Entry::Legacy::legacy_edit_action( $legacy_post, maintainer_enabled => 1, );
    return undef unless $action && $action eq 'savemaintainer';

    my $get        = $r->get_args;
    my $legacy_get = DW::Entry::Legacy::legacy_post_hash($get);
    my $ditemid    = $legacy_get->{itemid} || $legacy_post->{itemid};
    return undef unless defined $ditemid && $ditemid =~ /\A[1-9][0-9]*\z/;

    # Retained editjournal distinguishes the session identity used for entry
    # visibility/form auth from the effective authas actor used for management.
    my $session_remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($session_remote);
    my $authas = $legacy_get->{authas} || $session_remote->user;
    my $actor  = LJ::get_authas_user($authas);
    return undef unless LJ::isu($actor) && $actor->is_individual;

    # Preserve retained truthy GET, POST, then journal precedence. A target
    # equal to the effective actor is personal context and belongs to BML.
    my $usejournal =
           $legacy_get->{usejournal}
        || $legacy_post->{usejournal}
        || $legacy_get->{journal};
    return undef unless $usejournal;
    return undef if $usejournal eq $actor->user;
    my $journal = LJ::load_user($usejournal);
    return undef unless LJ::isu($journal) && $journal->is_comm;

    my $anum   = $ditemid % 256;
    my $itemid = $ditemid >> 8;
    my $entry  = LJ::Entry->new( $journal, ditemid => $ditemid );
    return undef unless $entry && $entry->valid && $entry->ditemid == $ditemid;
    return undef unless $entry->visible_to($session_remote);

    my %events;
    LJ::do_request(
        {
            mode       => 'getevents',
            selecttype => 'one',
            ver        => $LJ::PROTOCOL_VER,
            user       => $actor->user,
            usejournal => $journal->user,
            itemid     => $itemid,
        },
        \%events,
        {
            noauth       => 1,
            u            => $actor,
            ignorecanuse => 1,
        }
    );
    return undef unless ( $events{success} || '' ) eq 'OK';
    return undef unless $events{events_count} && $events{events_1_anum} == $anum;

    # This is property-only management of somebody else's community entry.
    return undef if $entry->poster->equals($actor);
    return undef unless $actor->can_manage($journal);

    # Retained disabled_spamdelete gates savemaintainer. In particular, a
    # spam-report sysban declines before the token check or any property write.
    return undef if LJ::sysban_check( 'spamreport', $journal->user );

    # Do not add a readonly check here: retained editjournal has already
    # disabled ordinary save for this context, so its readonly block is skipped
    # before this action. Tightening that behavior is a separate policy change.
    return error_ml('error.invalidform') unless LJ::check_form_auth( $legacy_post->{lj_form_auth} );

    my %props;
    for my $name (
        qw(adult_content_maintainer_reason adult_content_maintainer opt_nocomments_maintainer))
    {
        next unless LJ::get_prop( 'log', $name );
        $props{$name} = $legacy_post->{"prop_$name"};
    }
    LJ::set_logprop( $journal, $itemid, \%props );

    $r->status(302);
    $r->header_out( Location => $entry->url );
    return $r->OK;
}

# Callable compatibility seam for retained /update POSTs. Alternate login and
# every action outside the classified retained subset remain in BML.
sub legacy_update_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->did_post;

    my $post        = $r->post_args;
    my $get         = $r->get_args;
    my $legacy_post = DW::Entry::Legacy::legacy_post_hash($post);
    my $legacy_get  = DW::Entry::Legacy::legacy_post_hash($get);
    my $remote      = $opts{remote} || LJ::get_remote();

    # Keep retained update's pre-decode guards in front of the hook-bearing
    # decoder. A non-text POST, invalid requested journal, or non-posting
    # identity must retain its BML response and cannot enter this subset.
    return undef unless LJ::text_in($legacy_post);
    return undef if $legacy_get->{usejournal} && !LJ::load_user( $legacy_get->{usejournal} );

    # This adapter only covers an authenticated retained post. Everything else
    # must continue to the retained BML implementation.
    return undef unless LJ::isu($remote);
    return undef if $remote->identity || !$remote->can_post;
    return undef if $legacy_get->{altlogin};
    return undef
        if $legacy_post->{user}
        && LJ::canonical_username( $legacy_post->{user} ) ne $remote->user;

    # These retained controls are form transforms, not save attempts. Capture
    # their classification before a transform hook can mutate the flat request.
    my $transform = $legacy_post->{transform};
    my $rerender =
           $transform
        || $legacy_post->{showform}
        || $legacy_post->{moreoptsbtn}
        || $legacy_post->{'action:preview'}
        || $legacy_post->{'action:spellcheck'};
    if ($rerender) {
        return undef unless $opts{include_transforms};
        LJ::Hooks::run_hooks( "transform_update_$transform", $legacy_get, $legacy_post )
            if $transform;
        if ( $legacy_post->{'action:spellcheck'}
            && !( LJ::check_form_auth( $legacy_post->{lj_form_auth} ) && LJ::check_referer() ) )
        {
            my $errors = DW::FormErrors->new;
            $errors->add( undef, 'error.invalidform' );
            return _legacy_update_rerender( $legacy_post, $legacy_get, $remote, errors => $errors );
        }
        return _legacy_update_rerender(
            $legacy_post,
            $legacy_get,
            $remote,
            spellcheck_requested => $legacy_post->{'action:spellcheck'} ? 1 : 0,
            transform => $transform ? 1 : 0,
        );
    }

    # The retained route rejects token/referer and readonly failures before
    # decode_entry_form.  The decoder is hook-bearing, so this guard must remain
    # ahead of preparation rather than using it merely to build a retry form.
    return undef
        unless LJ::check_form_auth( $legacy_post->{lj_form_auth} ) && LJ::check_referer();
    return undef if $remote->readonly;

    # Retained update reads the target solely from its submitted form. In
    # particular, an explicit empty usejournal means the owner even when the
    # URL still names a community. A bad named target must not become an owner
    # post merely because the callable seam cannot handle it.
    my $journal = $remote;
    if ( defined $legacy_post->{usejournal} && length $legacy_post->{usejournal} ) {
        $journal = LJ::load_user( $legacy_post->{usejournal} );
        return undef unless LJ::isu($journal);
        return undef if $journal->readonly || !$remote->can_post_to($journal);
    }

    my $prepared = DW::Entry::Legacy::prepare_entry_form(
        {
            mode       => 'postevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $remote->user,
            password   => $legacy_post->{password},
            usejournal => $legacy_post->{usejournal},
            tz         => 'guess',
            xpost      => '0',
        },
        $post
    );
    my $warnings = DW::FormErrors->new;

    # Do not reject an empty canonical body here.  The old route still makes a
    # protocol post attempt and then runs its post-attempt spam hook; _do_post
    # preserves that timing and returns its native retry error.
    # _do_post owns the retained post-attempt and successful extension hooks.
    # Pass the exact flat decoder request there; canonical props are not a
    # replacement for hook-visible legacy fields.
    my %post_res = _do_post(
        $prepared->{canonical},
        { noauth => 1,       u       => $remote },
        { poster => $remote, journal => $journal },
        warnings       => $warnings,
        legacy_success => {
            request          => $prepared->{request},
            poster           => $remote,
            remote           => $remote,
            event_format     => $legacy_post->{event_format},
            switched_rte_on  => $legacy_post->{switched_rte_on},
            crosspost_master => _legacy_crosspost_master( $legacy_post, $legacy_get ),
        },
        legacy_crosspost_callback => _legacy_crosspost_callback( $legacy_post, $legacy_get ),
    );
    return $post_res{render} if ( $post_res{status} || '' ) eq 'ok';

    my $errors = DW::FormErrors->new;
    $errors->add_string( undef, $post_res{errors} ) if $post_res{errors};
    return legacy_new_rerender(
        $prepared,
        remote   => $remote,
        errors   => $errors,
        warnings => $warnings,
    );
}

# Anonymous retained /update owner-post subset. Public composition claims every
# attempted password outcome; only structural pre-auth declines remain BML-owned.
sub legacy_anonymous_update_handler {
    my (%opts) = @_;
    my $r = DW::Request->get or return undef;
    return undef unless $r->did_post;
    return undef if LJ::get_remote();

    my $post        = $r->post_args;
    my $get         = $r->get_args;
    my $legacy_post = DW::Entry::Legacy::legacy_post_hash($post);
    my $legacy_get  = DW::Entry::Legacy::legacy_post_hash($get);
    return undef unless LJ::text_in($legacy_post);

    # Retained ordinary update does not require an action:update control, but
    # named transforms remain BML-owned until their own native composition.
    return undef if grep { /^action:(?!update$)/ && $legacy_post->{$_} } keys %$legacy_post;
    return undef unless defined $legacy_post->{user}     && length $legacy_post->{user};
    return undef unless defined $legacy_post->{password} && length $legacy_post->{password};
    return undef if $legacy_post->{usejournal} || $legacy_get->{usejournal};
    return undef if $legacy_get->{altlogin} || $legacy_post->{chal} || $legacy_post->{response};
    return undef
        if $legacy_post->{transform} || $legacy_post->{showform} || $legacy_post->{moreoptsbtn};
    return undef if $legacy_post->{'action:preview'} || $legacy_post->{'action:spellcheck'};

    # Finish structural ownership before the first password check: every
    # post-auth outcome below is native-owned and must not fall through to BML.
    my $candidate = LJ::load_user( $legacy_post->{user} );
    return undef
        unless $candidate
        && $candidate->is_individual
        && $candidate->can_post
        && !$candidate->readonly;

    # Retained update exposes this exact flat GET reference before auth.
    LJ::Hooks::run_hook( 'update_fields', $legacy_get );

    my %auth_post = ( %$legacy_post, username => $legacy_post->{user} );
    my %flags;
    my %auth = _auth( \%flags, \%auth_post, undef );

    my %login_req = (
        mode          => 'login',
        ver           => $LJ::PROTOCOL_VER,
        clientversion => 'Web/2.0.0',
        user          => $legacy_post->{user},
    );
    my %login_res;
    LJ::do_request( \%login_req, \%login_res, \%flags );

    my $warnings = DW::FormErrors->new;
    if ( $login_res{message} ) {
        $warnings->add_string( undef, LJ::auto_linkify( LJ::ehtml( $login_res{message} ) ), );
    }

    my $prepared = DW::Entry::Legacy::prepare_entry_form(
        {
            mode       => 'postevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $legacy_post->{user},
            password   => $legacy_post->{password},
            usejournal => '',
            tz         => 'guess',
            xpost      => '0'
        },
        $post
    );

    if ( $auth{poster} && ( $login_res{success} || '' ) eq 'OK' ) {
        my %post_res = _do_post(
            $prepared->{canonical},
            \%flags,
            { poster => $auth{poster}, journal => $auth{journal} },
            warnings       => $warnings,
            legacy_success => {
                request          => $prepared->{request},
                poster           => $auth{poster},
                remote           => undef,
                event_format     => $legacy_post->{event_format},
                switched_rte_on  => $legacy_post->{switched_rte_on},
                crosspost_master => 0
            },
        );
        return $post_res{render} if ( $post_res{status} || '' ) eq 'ok';
        my $errors = DW::FormErrors->new;
        $errors->add_string( undef, $post_res{errors} ) if $post_res{errors};
        return legacy_new_rerender(
            $prepared,
            remote             => undef,
            anonymous_username => $legacy_post->{user},
            errors             => $errors,
            warnings           => $warnings,
        );
    }

    # Retained wrong-password and protocol-login-error paths still perform one
    # flat postevent attempt and one spam hook, but never run success handling.
    _legacy_flat_post_attempt( $prepared->{request}, \%flags, $candidate );
    my $errors = DW::FormErrors->new;
    $errors->add_string( undef,
        LJ::Lang::ml('/update.bml.error.login') . ' ' . LJ::ehtml( $login_res{errmsg} || '' ) );
    return legacy_new_rerender(
        $prepared,
        remote             => undef,
        anonymous_username => $legacy_post->{user},
        errors             => $errors,
        warnings           => $warnings,
    );
}

# Prepare retained nonpersisting actions for the shared native form. The
# transform hook mutates flat request hashes, while the original request still
# supplies the encoded/repeated query string for the retry action URL.
sub _legacy_update_rerender {
    my ( $post, $get, $remote, %opts ) = @_;

    my %render;
    if ( $opts{transform} ) {
        for my $name (qw(subject event prop_taglist usejournal)) {
            $render{$name} = $post->{$name} || $get->{$name};
        }
        for my $name ( grep { /^prop_xpost_/ } keys %$get, keys %$post ) {
            $render{$name} = $post->{$name} || $get->{$name};
        }
        for my $name (qw(event_format richtext_default)) {
            $render{$name} = $post->{$name} if defined $post->{$name};
        }
    }
    else {
        # Retained ordinary rerenders default only these values from GET, then
        # overlay every present POST control (including explicit empties).
        $render{$_} = $get->{$_}  for qw(subject event prop_taglist usejournal);
        $render{$_} = $get->{$_}  for grep { /^prop_xpost_/ } keys %$get;
        $render{$_} = $post->{$_} for keys %$post;
    }

    my $prepared = DW::Entry::Legacy::prepare_rerender_entry_form(
        {
            mode       => 'postevent',
            ver        => $LJ::PROTOCOL_VER,
            user       => $remote->user,
            password   => $render{password},
            usejournal => $render{usejournal},
            tz         => 'guess',
            xpost      => '0',
        },
        \%render
    );

    return legacy_new_rerender(
        $prepared,
        remote               => $remote,
        get                  => DW::Request->get->get_args,
        errors               => $opts{errors},
        spellcheck_requested => $opts{spellcheck_requested},
    );
}

sub _render_new_form {
    my ( $vars, $post, $get, $remote, $errors, $warnings, $spellcheck_requested, $render_opts ) =
        @_;
    $render_opts ||= {};

# this is an error in the user-submitted data, so regenerate the form with the error message and previous values
    $vars->{errors}   = $errors;
    $vars->{warnings} = $warnings;

    # prepopulate if we haven't been through this form already
    $vars->{formdata} = $post || _prepopulate($get);

    # Had to wait for formdata before figuring out the editors list -- if we
    # have a WIP form submission with errors, we want to reuse what the user
    # already chose.
    $vars->{editors} = DW::Formats::select_items(
        current   => $vars->{formdata}->{editor},
        preferred => $remote ? $remote->prop('entry_editor2') : '',
    );
    $vars->{formdata}->{editor} = $vars->{editors}->{selected};

    $vars->{spellcheck_enabled} = _spellcheck_enabled( $remote, $vars->{journalu} );
    if ($spellcheck_requested) {
        $vars->{spellcheck} =
            $vars->{spellcheck_enabled}
            ? _spellcheck_result($post)
            : _spellcheck_unavailable();
    }

    # Set up info for the icon select/preview/browse components
    $vars->{current_icon_kw} = $vars->{formdata}->{prop_picture_keyword};
    $vars->{current_icon}    = LJ::Userpic->new_from_keyword( $remote, $vars->{current_icon_kw} );

    $vars->{editable} = { map { $_ => 1 } @modules };

    $vars->{action} =
        { url => $render_opts->{action_url} // LJ::create_url( undef, keep_args => 1 ), };
    $vars->{title_override} = $render_opts->{title_override}
        if exists $render_opts->{title_override};
    $vars->{legacy_altlogin} = $render_opts->{legacy_altlogin}
        if $render_opts->{legacy_altlogin};
    $vars->{submit_action_name} =
        $render_opts->{legacy_altlogin}
        && ( $render_opts->{submit_action_name} || '' ) eq 'action:update'
        ? 'action:update'
        : 'action:post';

    $vars->{js_for_rte} = LJ::rte_js_vars($remote);
    $vars->{sitevalues} = to_json( \@sitevalues );

    # Set up vars for drafts

    my $draft = '""';
    my %draft_properties;
    my $draft_subject_raw = "";
    if ($remote) {

        # Here we get the value of the userprop 'draft_properties', containing
        # a frozen Storable string, which we then thaw into a hash by the same
        # name.
        $draft = $remote->prop('entry_draft');
        %draft_properties =
            $remote->prop('draft_properties')
            ? %{ Storable::thaw( $remote->prop('draft_properties') ) }
            : ();

        # store raw for later use; will be escaped later
        $draft_subject_raw = $draft_properties{subject};
    }
    my $initDraft = 'null';
    if ( $remote && LJ::is_enabled('update_draft') ) {

        # While transforms aren't considered posts, we don't want to
        # prompt the user to restore from a draft on a transform
        if ( !LJ::did_post() ) {
            $initDraft = 'true';
        }
        else {
            $initDraft = 'false';
        }
    }

    $vars->{init_draft}        = $initDraft;
    $vars->{draft}             = $draft;
    $vars->{draft_properties}  = \%draft_properties;
    $vars->{draft_subject_raw} = $draft_subject_raw;
    $vars->{autosave_interval} = $LJ::AUTOSAVE_DRAFT_INTERVAL;

    return DW::Template->render_template( 'entry/form.tt', $vars );
}

# Render-only compatibility seam for an already-authorized retained /update GET.
# The caller retains routing, beta, external fetches, and update_fields ABI.
sub legacy_update_get_render {
    my (%opts) = @_;
    my $remote = $opts{remote};
    my $get           = $opts{get}           || {};
    my $hook          = $opts{update_fields} || {};
    my $legacy_editor = $opts{legacy_editor} || '';
    my $rich         = $opts{rte_supported} && $legacy_editor eq 'rich';
    my $preformatted = ( $remote && $remote->prop('disable_auto_formatting') )
        || $hook->{prop_opt_preformatted};
    my $formdata = {
        subject => exists $hook->{subject} ? $hook->{subject} : $get->{subject},
        event   => exists $hook->{event}   ? $hook->{event}   : $get->{event},
        taglist => exists $hook->{tags}    ? $hook->{tags}    : $get->{prop_taglist},
        username => $opts{username},
        editor   => $rich ? 'rte0' : $preformatted ? 'html_raw0' : 'html_casual1',
    };
    my $vars = _init(
        {
            usejournal           => $opts{usejournal},
            remote               => $remote,
            datetime             => $opts{datetime} || '',
            trust_datetime_value => 0,
            crosspost            => $opts{crosspost} || {},
            suppress_crosspost   => $opts{suppress_crosspost},
        }
    );
    return _render_new_form(
        $vars,
        $formdata,
        $get, $remote,
        $opts{errors}   || DW::FormErrors->new,
        $opts{warnings} || DW::FormErrors->new,
        undef,
        {
            action_url         => $opts{action_url} || '/entry/new',
            title_override     => $opts{title_override},
            legacy_altlogin    => $opts{legacy_altlogin},
            submit_action_name => $opts{submit_action_name},
        }
    );
}

# Callable-only authenticated retained /update alternate-login GET seam.  It
# renders the legacy credential presentation through the native form, but does
# not register a route or interpret a credential submission.
sub legacy_update_altlogin_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';

    # The retained page's flat GET ABI is preserved exactly once for the
    # update_fields hook.  Every excluded context remains BML-owned.
    my $get = $opts{get} || DW::Entry::Legacy::legacy_post_hash( $r->get_args );
    return undef unless $get->{altlogin};
    return undef if $get->{share};
    return undef if $get->{usejournal} && !LJ::load_user( $get->{usejournal} );

    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($remote);
    return undef if LJ::BetaFeatures->user_in_beta( $remote => 'updatepage' );
    return undef if $remote->identity || !$remote->can_post || $remote->readonly;

    # Retained update captures these three before update_fields, while user
    # and target deliberately remain mutable afterwards.
    my $prefill    = { map { $_ => $get->{$_} } qw(subject event prop_taglist) };
    my $hook       = LJ::Hooks::run_hook( 'update_fields', $get ) || {};
    my $usejournal = LJ::canonical_username( $get->{usejournal} || '' );
    my $now        = DateTime->now;
    if ( my $timezone = $remote->prop('timezone') ) {
        my $tz = eval { DateTime::TimeZone->new( name => $timezone ) };
        $now = eval { DateTime->from_epoch( epoch => time(), time_zone => $tz ) } if $tz;
    }

    return legacy_update_get_render(
        remote             => $remote,
        get                => $prefill,
        update_fields      => $hook,
        legacy_editor      => $remote->new_entry_editor,
        rte_supported      => LJ::is_enabled( 'rte_support', $r->header_in('User-Agent') ),
        datetime           => $now->strftime('%F %R'),
        usejournal         => $usejournal,
        suppress_crosspost => 1,
        action_url         => '/update?altlogin=1',
        title_override     => LJ::Lang::ml('/update.bml.title2'),
        legacy_altlogin    => { username => $get->{user} // '' },
        submit_action_name => 'action:update',
    );
}

# Callable-only authenticated retained /update share GET seam. It deliberately
# has no route registration: callers retain legacy guard ordering and any later
# public action/schema decision. The factory is only called after the excluded
# contexts decline, and update_fields receives the original flat GET reference.
sub legacy_update_share_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';

    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($remote);

    my $get = $opts{get} || DW::Entry::Legacy::legacy_post_hash( $r->get_args );
    return undef unless $get->{share};
    return undef if $get->{altlogin};
    return undef if $get->{usejournal} && !LJ::load_user( $get->{usejournal} );
    return undef if LJ::BetaFeatures->user_in_beta( $remote => 'updatepage' );
    return undef if $remote->identity || !$remote->can_post || $remote->readonly;

    # Retained update creates the page before update_fields. Subject/event/tag
    # are ordinary GET defaults until a returned page replaces the first two.
    my %prefill = map { $_ => $get->{$_} } qw(subject event prop_taglist);
    if ( my $page = DW::External::Page->new( url => $get->{share} ) ) {
        $prefill{subject} = LJ::ehtml( $page->title );
        $prefill{event} =
              '<a href="'
            . $page->url . '">'
            . ( LJ::ehtml( $page->description ) || $prefill{subject} || $page->url )
            . "</a>\n\n";
    }

    my $hook       = LJ::Hooks::run_hook( 'update_fields', $get ) || {};
    my $usejournal = LJ::canonical_username( $get->{usejournal} || '' );
    my %crosspost  = map { $_->acctid => $_->xpostbydefault }
        DW::External::Account->get_external_accounts($remote);

    my $now = DateTime->now;
    if ( my $timezone = $remote->prop('timezone') ) {
        my $tz = eval { DateTime::TimeZone->new( name => $timezone ) };
        $now = eval { DateTime->from_epoch( epoch => time(), time_zone => $tz ) } if $tz;
    }

    return legacy_update_get_render(
        remote         => $remote,
        get            => \%prefill,
        update_fields  => $hook,
        legacy_editor  => $remote->new_entry_editor,
        rte_supported  => LJ::is_enabled( 'rte_support', $r->header_in('User-Agent') ),
        datetime       => $now->strftime('%F %R'),
        usejournal     => $usejournal,
        crosspost      => \%crosspost,
        action_url     => LJ::create_url( '/entry/new', keep_query_string => 1 ),
        title_override => LJ::Lang::ml('/update.bml.title2'),
    );
}

# Render retained terminal update responses after a caller has already applied
# legacy request ordering. This intentionally does not inspect a request or
# initialize entry-form state.
sub legacy_update_terminal_response {
    my ($variant) = @_;
    die 'missing legacy update terminal variant' unless defined $variant;

    my ( $title, $message );
    if ( $variant eq 'invalidusejournal' ) {
        $title   = LJ::Lang::ml('/update.bml.title2');
        $message = LJ::Lang::ml('/update.bml.error.invalidusejournal');
    }
    elsif ( $variant eq 'identity' ) {
        $title = LJ::Lang::ml('Sorry');
        $message =
            LJ::Lang::ml( '/update.bml.error.nonusercantpost', { sitename => $LJ::SITENAME } );
    }
    elsif ( $variant eq 'cantpost' ) {
        $title   = LJ::Lang::ml('/update.bml.error.cantpost.title');
        $message = $LJ::MSG_NO_POST || LJ::Lang::ml('/update.bml.error.cantpost');
    }
    else {
        die "unknown legacy update terminal variant: $variant";
    }

    return DW::Template->render_template( 'entry/update-terminal.tt',
        { title => $title, message => $message } );
}

# Render-only readonly slice of retained /update GET.  Its caller owns the
# retained request ordering and authorization classification; this routine only
# composes the already-classified readonly form through the shared native renderer.
sub legacy_update_readonly_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';

    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless $remote && $remote->readonly;

    my $get = $opts{get} || DW::Entry::Legacy::legacy_post_hash( $r->get_args );

    # Retained update snapshots these prefill values before update_fields gets
    # its mutable flat GET reference.
    my $prefill = { map { $_ => $get->{$_} } qw(subject event prop_taglist) };
    my $hook    = LJ::Hooks::run_hook( 'update_fields', $get ) || {};

    my $warnings = DW::FormErrors->new;
    my ( $a_open, $a_close ) = ( '', '' );
    if ( $LJ::HELPURL{readonly} ) {
        $a_open  = q{<a href="} . $LJ::HELPURL{readonly} . q{">};
        $a_close = '</a>';
    }
    $warnings->add( undef, '/update.bml.rowarn', { a_open => $a_open, a_close => $a_close } );

    my %crosspost = map { $_->acctid => $_->xpostbydefault }
        DW::External::Account->get_external_accounts($remote);
    my $now = DateTime->now;
    if ( my $timezone = $remote->prop('timezone') ) {
        my $tz = eval { DateTime::TimeZone->new( name => $timezone ) };
        $now = eval { DateTime->from_epoch( epoch => time(), time_zone => $tz ) } if $tz;
    }

    my $usejournal =
        exists $opts{usejournal}
        ? $opts{usejournal}
        : LJ::canonical_username( $get->{usejournal} || '' );

    return legacy_update_get_render(
        remote        => $remote,
        get           => $prefill,
        update_fields => $hook,
        legacy_editor => $remote->new_entry_editor,
        rte_supported => LJ::is_enabled( 'rte_support', $r->header_in('User-Agent') ),
        datetime      => $opts{datetime} || $now->strftime('%F %R'),
        usejournal    => $usejournal,
        crosspost     => \%crosspost,
        warnings      => $warnings,
        action_url    => $opts{action_url} || '/entry/new',
    );
}

# Render-only anonymous retained /update GET seam. Its caller must choose an
# action URL before any public route can use this native credential schema.
sub legacy_update_anonymous_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';
    my $remote = exists $opts{remote} ? $opts{remote} : LJ::get_remote();
    return undef if $remote;
    die 'missing anonymous legacy update action URL' unless exists $opts{action_url};

    my $get = $opts{get} || DW::Entry::Legacy::legacy_post_hash( $r->get_args );

    # Retained update snapshots prefill before this hook mutates its original
    # flat GET reference. Repeated GET values therefore stay NUL-joined.
    my $prefill = { map { $_ => $get->{$_} } qw(subject event prop_taglist) };
    my $hook    = LJ::Hooks::run_hook( 'update_fields', $get ) || {};
    my $now     = DateTime->now;

    return legacy_update_get_render(
        remote        => undef,
        get           => $prefill,
        update_fields => $hook,
        legacy_editor => $LJ::DEFAULT_EDITOR || '',
        rte_supported => LJ::is_enabled( 'rte_support', $r->header_in('User-Agent') ),
        datetime      => $opts{datetime} || $now->strftime('%F %R'),
        usejournal    => LJ::canonical_username( $get->{usejournal} || '' ),

        # Retained update reads this login prefill after update_fields; unlike
        # subject/event/tags it deliberately observes the hook's mutable GET ref.
        username       => $get->{user},
        crosspost      => {},
        action_url     => $opts{action_url},
        title_override => LJ::Lang::ml('/update.bml.title2'),
    );
}

# Callable-only retained /update GET wrapper. A future route adapter owns
# public registration; excluded contexts return undef so retained BML continues
# to own its authentication, share-fetch, and warning behavior.
sub legacy_update_get_handler {
    my (%opts) = @_;

    my $r = DW::Request->get or return undef;
    return undef unless $r->method eq 'GET';

    # Retained %GET is a flat hash: repeated values are NUL-joined. Convert
    # once before every retained guard and pass that exact reference to hooks.
    my $get = DW::Entry::Legacy::legacy_post_hash( $r->get_args );

    # This is the retained page's first GET guard, before remote lookup or the
    # update_fields hook. Its terminal representation preserves the legacy
    # update title rather than the generic error title.
    return legacy_update_terminal_response('invalidusejournal')
        if $get->{usejournal} && !LJ::load_user( $get->{usejournal} );

    my $remote = $opts{remote} || LJ::get_remote();
    return undef unless LJ::isu($remote);

    # Retained /update redirects beta users before identity/can-post checks.
    if ( LJ::BetaFeatures->user_in_beta( $remote => 'updatepage' ) ) {
        $r->header_out(
            Location => LJ::create_url( '/entry/new', cur_args => $get, keep_args => 1 ) );
        $r->status(HTTP_FOUND);
        return $r->OK;
    }

    # These terminal branches precede alternate-login/share just as retained
    # update does; they do not initialize entry form state.
    return legacy_update_terminal_response('identity') if $remote->identity;
    return legacy_update_terminal_response('cantpost') unless $remote->can_post;

    # Alternate login retains its legacy credential schema. The share callable
    # returns undef for readonly and every excluded case; return that result
    # directly so BML retains share prefill plus its own warning/fallback.
    return undef if $get->{altlogin};
    return legacy_update_share_get_handler( remote => $remote, get => $get )
        if $get->{share};

    # Retained readonly output carries its own warning. Reuse the same flat
    # GET reference so update_fields can mutate its post-hook target once.
    return legacy_update_readonly_get_handler(
        remote     => $remote,
        get        => $get,
        action_url => LJ::create_url( '/entry/new', keep_query_string => 1 ),
    ) if $remote->readonly;

    # Retained update captures these form values before update_fields runs.
    # Keep that snapshot even if the hook mutates its original flat GET ref.
    my $prefill = { map { $_ => $get->{$_} } qw(subject event prop_taglist) };
    my $hook    = LJ::Hooks::run_hook( 'update_fields', $get ) || {};

    # Target is intentionally read after the hook, just as retained update
    # resolves its remaining mutable GET fields afterward. Ordinary GET always
    # uses account defaults; retained prop_xpost values apply only to spellcheck.
    my $usejournal = LJ::canonical_username( $get->{usejournal} || '' );
    my %crosspost  = map { $_->acctid => $_->xpostbydefault }
        DW::External::Account->get_external_accounts($remote);

    my $now = DateTime->now;
    if ( my $timezone = $remote->prop('timezone') ) {
        my $tz = eval { DateTime::TimeZone->new( name => $timezone ) };
        $now = eval { DateTime->from_epoch( epoch => time(), time_zone => $tz ) } if $tz;
    }

    return legacy_update_get_render(
        remote        => $remote,
        get           => $prefill,
        update_fields => $hook,
        legacy_editor => $remote->new_entry_editor,
        rte_supported => LJ::is_enabled( 'rte_support', $r->header_in('User-Agent') ),
        datetime      => $now->strftime('%F %R'),
        usejournal    => $usejournal,
        crosspost     => \%crosspost,
        action_url    => LJ::create_url( '/entry/new', keep_query_string => 1 ),
    );
}

# A carried-over custom access-list selection has no equivalent among a
# community's security options (public/access/private only); an unmatched
# <select> value submits as whichever option renders first (public) if the
# user does not notice and simply clicks post. Never let that resolve to
# public: fall back to the most restrictive option and say so explicitly.
sub _legacy_carryover_safe_security {
    my ( $canonical, $journal, $opts ) = @_;
    return $canonical
        unless $canonical->{security}
        && $canonical->{security} eq 'usemask'
        && LJ::isu($journal)
        && $journal->is_community;

    $canonical = {%$canonical};
    $canonical->{security} = 'private';
    delete $canonical->{allowmask};

    $opts->{warnings} ||= DW::FormErrors->new;
    $opts->{warnings}->add( undef, '.notice.legacy_security_downgraded' );

    return $canonical;
}

# Render a retained legacy new-entry error or transform response through the
# shared native form. This is deliberately not a route or save adapter: callers
# retain authorization and action decisions, and provide the already-prepared
# legacy decoder result.
sub legacy_new_rerender {
    my ( $prepared, %opts ) = @_;

    my $r           = DW::Request->get;
    my $remote      = $opts{remote};
    my $get         = $opts{get} || ( $r ? $r->get_args : Hash::MultiValue->new );
    my $canonical   = $prepared->{canonical};
    my $legacy_post = $prepared->{post};

    # A submitted empty usejournal deliberately selects the owner. Only fall
    # back to the request query when the legacy submission did not name it.
    my $usejournal =
        exists $legacy_post->{usejournal}
        ? $legacy_post->{usejournal}
        : $get->{usejournal};

    $canonical =
        _legacy_carryover_safe_security( $canonical,
        $usejournal ? LJ::load_user($usejournal) : undef, \%opts );

    my $formdata = DW::Entry::Legacy::formdata_from_legacy( $canonical, $legacy_post );
    if ( defined $opts{anonymous_username} ) {
        $formdata->{username} = $opts{anonymous_username};
        $formdata->{password} = '';
    }

    my %crosspost = map { $_ => 1 }
        grep { $canonical->{crosspost}{$_}{id} }
        keys %{ $canonical->{crosspost} || {} };

    my $datetime = '';
    if (   defined $canonical->{year}
        && defined $canonical->{mon}
        && defined $canonical->{day}
        && defined $canonical->{hour}
        && defined $canonical->{min} )
    {
        $datetime = join( ' ',
            join( '-', @{$canonical}{qw(year mon day)} ),
            join( ':', @{$canonical}{qw(hour min)} ) );
    }

    my $vars = _init(
        {
            usejournal           => $usejournal,
            remote               => $remote,
            datetime             => $datetime,
            trust_datetime_value => !exists $canonical->{tz},
            crosspost            => \%crosspost,
            suppress_crosspost   => $opts{suppress_crosspost},
        }
    );

    my $action_url = $opts{action_url};
    $action_url //= LJ::create_url( '/entry/new', keep_query_string => 1 ) if $r;
    $action_url //= '/entry/new';

    return _render_new_form(
        $vars,
        $formdata,
        $get, $remote,
        $opts{errors}   || DW::FormErrors->new,
        $opts{warnings} || DW::FormErrors->new,
        $opts{spellcheck_requested},
        {
            action_url         => $action_url,
            legacy_altlogin    => $opts{legacy_altlogin},
            submit_action_name => $opts{submit_action_name},
        },
    );
}

# Spellcheck is intentionally a non-persisting form transform. Its HTML is
# generated by the configured checker; user-submitted text is escaped before it
# crosses that trusted-result boundary.
sub _spellcheck_result {
    my ($post) = @_;

    my $event   = LJ::ehtml( $post->{event} // '' );
    my $checker = LJ::SpellCheck->new( { spellcommand => $LJ::SPELLER } );
    my $html    = $checker->check_html( \$event );

    return {
        did  => 1,
        html => length $html ? $html : LJ::Lang::ml('entryform.spellcheck.noerrors'),
    };
}

sub _spellcheck_unavailable {
    return { did => 1, html => LJ::Lang::ml('entryform.spellcheck.unavailable') };
}

sub _spellcheck_enabled {
    my ( $remote, $journal ) = @_;
    return 0 unless $LJ::SPELLER && LJ::isu($remote) && LJ::isu($journal);
    return 0 if $remote->readonly || $journal->readonly;
    return $remote->can_post_to($journal) ? 1 : 0;
}

# Initializes entry form values.
# Can be used when posting a new entry or editing an old entry.
# Arguments:
# * form_opts: options for initializing the form
#       usejournal    string: username of the journal we're posting to (if not provided,
#                        use journal of the user we're posting as)
#       datetime      string: display date of the entry in format "$year-$mon-$mday $hour:$min" (already taking into account timezones)
# * call_opts: instance of DW::Routing::CallInfo (currently unused)
sub _init {
    my ( $form_opts, $call_opts ) = @_;

    my $u    = $form_opts->{remote};
    my $vars = {};

    my %moodtheme;
    my @moodlist;
    my $moods = DW::Mood->get_moods;

    # we check whether the user can actually post to this journal on form submission
    # journal we explicitly say we want to post to
    my $usejournal = LJ::load_user( $form_opts->{usejournal} );
    my @journallist;
    push @journallist, $usejournal if LJ::isu($usejournal);

    # the journal we are actually posting to (whether implicitly or overriden by usejournal)
    my $journalu = LJ::isu($usejournal) ? $usejournal : $u;

    my @crosspost_list;
    my $crosspost_main     = 0;
    my %crosspost_selected = %{ $form_opts->{crosspost} || {} };

    my $panels;
    my $formwidth;
    my $min_animation;
    my $displaydate_check;
    if ($u) {

        # moods
        my $theme = DW::Mood->new( $u->{moodthemeid} );

        if ($theme) {
            $moodtheme{id} = $theme->id;
            foreach my $mood ( values %$moods ) {
                $theme->get_picture( $mood->{id}, \my %pic );
                next unless keys %pic;

                $moodtheme{pics}->{ $mood->{id} }->{pic}    = $pic{pic};
                $moodtheme{pics}->{ $mood->{id} }->{width}  = $pic{w};
                $moodtheme{pics}->{ $mood->{id} }->{height} = $pic{h};
                $moodtheme{pics}->{ $mood->{id} }->{name}   = $mood->{name};
            }
        }

        @journallist = ( $u, $u->posting_access_list )
            unless $usejournal;

        # The retained alternate-login presentation never exposes crossposting.
        # Keep its render-only compatibility seam from enumerating accounts.
        my @accounts =
            $form_opts->{suppress_crosspost}
            ? ()
            : DW::External::Account->get_external_accounts($u);
        if ( scalar @accounts ) {
            foreach my $acct (@accounts) {
                my $id = $acct->acctid;

                my $selected = $crosspost_selected{$id};

                push @crosspost_list,
                    {
                    id            => $id,
                    name          => $acct->displayname,
                    selected      => $selected,
                    need_password => $acct->password ? 0 : 1,
                    };

                $crosspost_main = 1 if $selected;
            }
        }

        $panels        = $u->entryform_panels;
        $formwidth     = $u->entryform_width;
        $min_animation = $u->prop("js_animations_minimal") ? 1 : 0;
        $displaydate_check =
            ( $u->displaydate_check && not $form_opts->{trust_datetime_value} ) ? 1 : 0;
    }
    else {
        $panels = LJ::User::default_entryform_panels( anonymous => 1 );
    }

    @moodlist = ( { id => "", name => LJ::Lang::ml("entryform.mood.noneother") } );
    push @moodlist, { id => $_, name => $moods->{$_}->{name} }
        foreach sort { $moods->{$a}->{name} cmp $moods->{$b}->{name} } keys %$moods;

    my %security_options = (
        "public" => {
            value  => "public",
            label  => ".public.label",
            format => ".public.format",
        },
        "private" => {
            value  => "private",
            label  => ".private.label",
            format => ".private.format",
            image  => $LJ::Img::img{"security-private"},
        },
        "admin" => {
            value  => "private",
            label  => ".admin.label",
            format => ".private.format",
            image  => $LJ::Img::img{"security-private"},
        },
        "access" => {
            value  => "access",
            label  => ".access.label",
            format => ".access.format",
            image  => $LJ::Img::img{"security-protected"},
        },
        "members" => {
            value  => "access",
            label  => ".members.label",
            format => ".members.format",
            image  => $LJ::Img::img{"security-protected"},
        },
        "custom" => {
            value  => "custom",
            label  => ".custom.label",
            format => ".custom.format",
            image  => $LJ::Img::img{"security-groups"},
        }
    );
    foreach my $data ( values %security_options ) {
        my $prefix = ".select.security";

        $data->{label}  = $prefix . $data->{label};
        $data->{format} = $prefix . $data->{format};
    }

    my $is_community = $journalu && $journalu->is_community;
    my @security     = $is_community ? qw( public members admin ) : qw( public access private );
    my @custom_groups;
    if ( $u && !$is_community ) {
        @custom_groups =
            map { { value => $_->{groupnum}, label => $_->{groupname} } } $u->trust_groups;
        push @security, "custom" if @custom_groups;
    }
    @security = map { $security_options{$_} } @security;

    my ( $year, $mon, $mday, $hour, $min ) = split( /\D/, $form_opts->{datetime} || "" );
    my %displaydate;
    $displaydate{year}   = $year;
    $displaydate{month}  = $mon;
    $displaydate{day}    = $mday;
    $displaydate{hour}   = $hour;
    $displaydate{minute} = $min;

    $displaydate{trust_initial} = $form_opts->{trust_datetime_value};

    # TODO:
    #             # JavaScript sets this value, so we know that the time we get is correct
    #             # but always trust the time if we've been through the form already
    #             my $date_diff = ($opts->{'mode'} eq "edit") ? 1 : 0;

    $vars = {
        remote        => $u,
        image_alt_faq => LJ::Hooks::run_hook( 'faqlink', 'alttext',
            LJ::Lang::ml('/entry/form.tt.insertimage.alt.faqlink') )
            || LJ::Lang::ml('/entry/form.tt.insertimage.alt.faqlink'),

        moodtheme => \%moodtheme,
        moods     => \@moodlist,

        journallist => \@journallist,
        usejournal  => $usejournal,

        security         => \@security,
        customgroups     => \@custom_groups,
        security_options => \%security_options,

        journalu => $journalu,

        crosspost_entry => $crosspost_main,
        crosspostlist   => \@crosspost_list,
        crosspost_url   => "$LJ::SITEROOT/manage/settings/?cat=othersites",

        sticky_url   => "$LJ::SITEROOT/manage/settings/?cat=display#DW__Setting__StickyEntry_",
        sticky_entry => $form_opts->{sticky_entry},

        displaydate       => \%displaydate,
        displaydate_check => $displaydate_check,

        panels        => $panels,
        formwidth     => $formwidth && $formwidth eq "P" ? "narrow" : "wide",
        min_animation => $min_animation ? 1 : 0,

        limits => {
            subject_length => LJ::CMAX_SUBJECT,
            current_length => LJ::std_max_length,
        },
    };

    return $vars;
}

=head2 C<< DW::Controller::Entry::edit_handler( ) >>

Handles generating the form for, and handling the actual edit of an entry

=cut

sub edit_handler {
    return _edit(@_);
}

# Render the property-only community maintainer surface. Callers may provide
# the canonical native action explicitly; the direct edit route retains its
# existing current-URL default.
sub _render_maintainer_form {
    my ( $entry, $journal, $remote, %opts ) = @_;

    return DW::Template->render_template(
        'entry/maintainer.tt',
        {
            entry                 => $entry,
            journal               => $journal,
            adult_content_enabled => LJ::is_enabled('adult_content'),
            remote                => $remote,
            action                => $opts{action} // LJ::create_url( undef, keep_args => 1 ),
            props                 => {
                adult_content_maintainer_reason => $entry->prop('adult_content_maintainer_reason')
                    || '',
                adult_content_maintainer  => $entry->prop('adult_content_maintainer')  || '',
                opt_nocomments_maintainer => $entry->prop('opt_nocomments_maintainer') || 0,
                adult_content             => $entry->prop('adult_content')             || '',
                opt_nocomments            => $entry->prop('opt_nocomments')            || 0,
            },
        },
        { ml_scope => '/entry/form.tt' }
    );
}

sub _edit {
    my ( $opts, $username, $ditemid ) = @_;

    my ( $ok, $rv ) = controller();
    return $rv unless $ok;

    my $r = DW::Request->get;

    my $remote  = $rv->{remote};
    my $journal = defined $username ? LJ::load_user($username) : $remote;

    return error_ml('error.invalidauth') unless $journal;

    my $errors   = DW::FormErrors->new;
    my $warnings = DW::FormErrors->new;
    my $post;
    my $spellcheck_requested;

    my $maintainer_post = $r->did_post ? $r->post_args : undef;
    if ( $maintainer_post && $maintainer_post->{'action:savemaintainer'} ) {
        my $entry  = LJ::Entry->new( $journal, ditemid => $ditemid );
        my $anum   = $ditemid % 256;
        my $itemid = $ditemid >> 8;
        return error_ml('/entry/form.tt.error.nofind')
            unless $entry->editable_by($remote)
            && $anum == $entry->anum
            && $itemid == $entry->jitemid
            && !$entry->poster->equals($remote)
            && $journal->is_comm
            && $remote->can_manage($journal)
            && !$journal->readonly;
        return error_ml('error.invalidform')
            unless LJ::check_form_auth( $maintainer_post->{lj_form_auth} );
        LJ::set_logprop(
            $journal, $itemid,
            {
                adult_content_maintainer_reason =>
                    $maintainer_post->{prop_adult_content_maintainer_reason},
                adult_content_maintainer  => $maintainer_post->{prop_adult_content_maintainer},
                opt_nocomments_maintainer => $maintainer_post->{prop_opt_nocomments_maintainer}
                ? 1
                : 0,
            }
        );
        $r->status(302);
        $r->header_out( Location => LJ::create_url( undef, keep_args => 1 ) );
        return $r->OK;
    }

    # The ordinary edit form also submits action:delete for a poster deleting
    # their own entry; only treat this as the manager-moderation action when
    # the poster differs from the actor, so an owner's delete still falls
    # through to the generic edit/delete handling below unaffected.
    if ( $maintainer_post
        && ( $maintainer_post->{'action:delete'} || $maintainer_post->{'action:deletespam'} ) )
    {
        my $entry  = LJ::Entry->new( $journal, ditemid => $ditemid );
        my $anum   = $ditemid % 256;
        my $itemid = $ditemid >> 8;
        if (   $entry->editable_by($remote)
            && $anum == $entry->anum
            && $itemid == $entry->jitemid
            && !$entry->poster->equals($remote) )
        {
            my $deletespam = $maintainer_post->{'action:deletespam'} ? 1 : 0;
            return error_ml('/entry/form.tt.error.nofind')
                unless $journal->is_comm && $remote->can_manage($journal) && !$journal->readonly;

            # Retained editjournal's disabled_spamdelete additionally requires
            # a clear spamreport sysban; ordinary delete does not.
            return error_ml('error.invalidform')
                if $deletespam && LJ::sysban_check( 'spamreport', $journal->user );
            return error_ml('error.invalidform')
                unless LJ::check_form_auth( $maintainer_post->{lj_form_auth} );

            LJ::mark_entry_as_spam( $journal, $itemid ) if $deletespam;

            $journal->log_event(
                'delete_entry',
                {
                    remote       => $remote,
                    actiontarget => $ditemid,
                    method       => 'web',
                }
            );

            my %edit_res = _do_edit(
                $ditemid,
                {
                    event     => '',
                    security  => $entry->security,
                    allowmask => $entry->allowmask,
                },
                { poster => $remote, journal => $journal },
                warnings => $warnings,
            );
            return $edit_res{render} if $edit_res{status} eq "ok";
            return DW::Template->render_template( 'error.tt', { message => $edit_res{errors} } )
                if $edit_res{errors};
            return error_ml('error.invalidform');
        }
    }

    if ( $r->did_post ) {
        $post = $r->post_args;

        # no difference because we rely on the entry info, but let's get rid of this
        # just to make sure it doesn't trip us up in the future...
        $post->remove('poster_remote');
        $post->remove('usejournal');

        my $mode_preview = $post->{"action:preview"} ? 1 : 0;
        my $mode_delete  = $post->{"action:delete"}  ? 1 : 0;
        $spellcheck_requested = $post->{"action:spellcheck"} ? 1 : 0;

        my $okay_formauth = LJ::check_form_auth( $post->{lj_form_auth} );
        if ($spellcheck_requested) {
            $errors->add( undef, "error.invalidform" ) unless $okay_formauth;
            $spellcheck_requested = 0 unless $okay_formauth;
        }
        else {
            $errors->add( undef, 'bml.badinput.body1' )
                unless LJ::text_in($post);
            $errors->add( undef, "error.invalidform" )
                unless $okay_formauth;

            if ($mode_preview) {

                # do nothing
            }
            elsif ($okay_formauth) {
                $errors->add_string( undef, $LJ::MSG_READONLY_USER )
                    if $journal && $journal->readonly;

                my $form_req = {};
                DW::Entry::_form_to_backend(
                    0, $form_req, $post,
                    allow_empty => $mode_delete,
                    errors      => $errors
                );

                # check for spam domains
                LJ::Hooks::run_hooks( 'spam_check', $remote, $form_req, 'entry' );

                # if we didn't have any errors with decoding the form, proceed to post
                unless ( $errors->exist ) {

                    if ($mode_delete) {
                        $form_req->{event} = "";

                        # now log the event created above
                        $journal->log_event(
                            'delete_entry',
                            {
                                remote       => $remote,
                                actiontarget => $ditemid,
                                method       => 'web',
                            }
                        );

                    }

                    my %edit_res = _do_edit(
                        $ditemid, $form_req,
                        { poster => $remote, journal => $journal },
                        warnings => $warnings,
                    );
                    return $edit_res{render} if $edit_res{status} eq "ok";

                    # oops errors when posting: show error, fall through to show form
                    $errors->add_string( undef, $edit_res{errors} ) if $edit_res{errors};
                }
            }
        }
    }

    # we can always trust this value:
    # it either came straight from the entry
    # or it's from the user's POST
    my $trust_datetime_value = 1;

    my $entry_obj = LJ::Entry->new( $journal, ditemid => $ditemid );

    # are you authorized to view this entry
    # and does the entry we got match the provided ditemid exactly?
    my $anum   = $ditemid % 256;
    my $itemid = $ditemid >> 8;
    return error_ml("/entry/form.tt.error.nofind")
        unless $entry_obj->editable_by($remote)
        && $anum == $entry_obj->anum
        && $itemid == $entry_obj->jitemid;

    # A community maintainer may manage another poster's entry, but never edit
    # its subject or body.  Keep that property-only surface separate from the
    # ordinary editor below.
    unless ( $entry_obj->poster->equals($remote) ) {
        return error_ml('/entry/form.tt.error.nofind')
            unless $journal->is_comm && $remote->can_manage($journal) && !$journal->readonly;
        return _render_maintainer_form( $entry_obj, $journal, $remote );
    }

    my %crosspost;
    if ( !$r->did_post && ( my $xpost = $entry_obj->prop("xpostdetail") ) ) {
        my $xposthash = DW::External::Account->xpost_string_to_hash($xpost);

        %crosspost = map { $_ => 1 } keys %{ $xposthash || {} };
    }

    my $vars = _init(
        {
            usejournal => $journal->username,
            remote     => $remote,

            datetime             => $entry_obj->eventtime_mysql,
            trust_datetime_value => $trust_datetime_value,

            crosspost    => \%crosspost,
            sticky_entry => $journal->sticky_entries_lookup->{$ditemid},
        },
        @_
    );

    return _render_edit_form( $r, $vars, $errors, $warnings, $post, $entry_obj, $remote, $journal,
        $spellcheck_requested );
}

sub _render_edit_form {
    my ( $r, $vars, $errors, $warnings, $post, $entry_obj, $remote, $journal,
        $spellcheck_requested, %opts )
        = @_;

    # now look for errors that we still want to recover from
    my $get = $r->get_args;
    $errors->add( undef, ".error.invalidusejournal" )
        if defined $get->{usejournal} && !$vars->{usejournal};

# this is an error in the user-submitted data, so regenerate the form with the error message and previous values
    $vars->{errors}   = $errors;
    $vars->{warnings} = $warnings;

    $vars->{formdata} = $post || DW::Entry::_backend_to_form( 0, $entry_obj );

    # Now that we have {formdata}->{editor}, we can get the list of available
    # editors.
    $vars->{editors} = DW::Formats::select_items(
        current   => $vars->{formdata}->{editor},
        preferred => $remote->prop('entry_editor2'),
    );

    # The template helper uses "formdata" to set the default values for fields,
    # so we'll update it in place with what DW::Formats thinks we should use.
    $vars->{formdata}->{editor} = $vars->{editors}->{selected};

    $vars->{spellcheck_enabled} = _spellcheck_enabled( $remote, $journal );
    if ($spellcheck_requested) {
        $vars->{spellcheck} =
            $vars->{spellcheck_enabled}
            ? _spellcheck_result($post)
            : _spellcheck_unavailable();
    }

    # Set up info for the icon select/preview/browse components
    $vars->{current_icon_kw} = $vars->{formdata}->{prop_picture_keyword};
    $vars->{current_icon}    = LJ::Userpic->new_from_keyword( $remote, $vars->{current_icon_kw} );

    my %editable = map { $_ => 1 } @modules;
    $vars->{editable} = \%editable;

    # this can't be edited after posting
    delete $editable{journal};

    $vars->{action} = $opts{action}
        || {
        edit => 1,
        url  => LJ::create_url( undef, keep_args => 1 ),
        };

    $vars->{js_for_rte} = LJ::rte_js_vars($remote);
    $vars->{sitevalues} = to_json( \@sitevalues );

    return DW::Template->render_template( 'entry/form.tt', $vars );
}

# A retained editjournal adapter supplies the already-resolved, owned entry and
# prepared legacy data. It intentionally does not dispatch, authenticate, or
# resolve the entry: maintainer-only editing remains on its separate path.
# A stale-tab old-schema edit POST that cannot be attributed to an entry the
# actor can edit (deleted, moved, or never theirs) has no editable form to
# safely resubmit through. Never discard what was typed: show it back
# read-only so it can at least be copied out.
sub legacy_carryover_unrecoverable {
    my ($prepared) = @_;
    my $canonical  = $prepared->{canonical} || {};
    my $subject    = LJ::ehtml( $canonical->{subject} // '' );
    my $event      = LJ::html_newlines( LJ::ehtml( $canonical->{event} // '' ) );

    my $message =
        LJ::Lang::ml('/entry/form.tt.notice.legacy_unrecoverable')
        . "<blockquote><p><b>$subject</b></p><p>$event</p></blockquote>";

    return DW::Template->render_template( 'error.tt', { message => $message } );
}

sub legacy_owned_edit_rerender {
    my (%opts) = @_;

    my $r         = DW::Request->get;
    my $entry     = $opts{entry};
    my $remote    = $opts{remote};
    my $journal   = $opts{journal};
    my $prepared  = $opts{prepared};
    my $canonical = _legacy_carryover_safe_security( $prepared->{canonical}, $journal, \%opts );
    my $formdata  = DW::Entry::Legacy::formdata_from_legacy( $canonical, $prepared->{post} );
    my $ditemid   = $entry->ditemid;

    my %crosspost = map { $_ => 1 }
        grep { $canonical->{crosspost}{$_}{id} } keys %{ $canonical->{crosspost} || {} };
    my $datetime = $entry->eventtime_mysql;
    my $date     = $formdata->get('entrytime_date');
    my $time     = $formdata->get('entrytime_time');
    $datetime = "$date $time" if defined $date && defined $time;
    my $vars = _init(
        {
            usejournal           => $journal->username,
            remote               => $remote,
            datetime             => $datetime,
            trust_datetime_value => 1,
            crosspost            => \%crosspost,
            sticky_entry         => $journal->sticky_entries_lookup->{$ditemid},
        },
        undef
    );
    my $action_path = '/entry/' . $journal->user . '/' . $ditemid . '/edit';

    return _render_edit_form(
        $r, $vars,
        $opts{errors}   || DW::FormErrors->new,
        $opts{warnings} || DW::FormErrors->new,
        $formdata,
        $entry, $remote, $journal, 0,
        action => {
            edit => 1,
            url  => LJ::create_url( $action_path, keep_query_string => 1 ),
        },
    );
}

# Dispatch the ordinary owned-entry subset of a retained editjournal POST. It
# deliberately receives an already-authorized entry from a future route wrapper.
# Personal ownership is the default; an explicit same-poster community opt-in
# may use the same mutation seam. Maintainer, non-opted-in community, and
# spam-delete requests fall through before decoding or mutating anything.
sub legacy_owned_edit_post {
    my (%opts) = @_;

    my $entry   = $opts{entry};
    my $remote  = $opts{remote};
    my $journal = $opts{journal};
    my $post    = $opts{post};
    my $get     = $opts{get} || {};
    return unless $entry && $remote && $journal && $post;
    return unless $entry->poster->equals($remote);
    return
        unless $journal->equals($remote)
        || ( $opts{same_poster_community} && $journal->is_comm );

    my $action = DW::Entry::Legacy::legacy_edit_action($post);
    return unless $action && ( $action eq 'save' || $action eq 'delete' );

    my $prepared       = DW::Entry::Legacy::prepare_entry_form( $opts{legacy_seed} || {}, $post );
    my $canonical      = $prepared->{canonical};
    my $legacy_request = $prepared->{request};
    my $legacy_post    = $prepared->{post};
    my $deleted        = $action eq 'delete';

    if ($deleted) {
        $legacy_request->{event} = '';
        $canonical->{event}      = '';
        $journal->log_event(
            'delete_entry',
            {
                remote => $opts{same_poster_community}
                ? ( $opts{session_remote} || $remote )
                : $remote,
                actiontarget => $entry->ditemid,
                method       => 'web',
            }
        );
    }

    LJ::Hooks::run_hooks( 'spam_check', $remote, $legacy_request, 'entry' );

    my $errors   = $opts{errors}   || DW::FormErrors->new;
    my $warnings = $opts{warnings} || DW::FormErrors->new;
    my %result   = _do_edit(
        $entry->ditemid,
        $canonical,
        { poster => $remote, journal => $journal },
        warnings    => $warnings,
        legacy_edit => {
            remote              => $opts{session_remote},
            crosspost_master    => _legacy_crosspost_master( $legacy_post, $get ),
            crosspost_callback  => _legacy_crosspost_callback( $legacy_post, $get ),
            editurl             => '/editjournal?itemid=' . $entry->ditemid,
            entry_was_suspended => $entry->is_suspended ? 1 : 0,
        },
    );
    return %result if ( $result{status} || '' ) eq 'ok';

    if ( $result{errors} ) {
        $errors->add_string( undef, $result{errors} );
    }
    return (
        status => 'rerender',
        render => legacy_owned_edit_rerender(
            entry    => $entry,
            remote   => $remote,
            journal  => $journal,
            prepared => $prepared,
            errors   => $errors,
            warnings => $warnings,
        ),
    );
}

# returns:
# poster: user object that contains the poster of the entry. may be the current remote user,
#           or may be someone logging in via the login form on the entry
# journal: user object for the journal the entry is being posted to. may be the same as the
#           poster, or may be a community
# unverified_username: username that current remote is trying to post as; remote may not
#           actually have access to this journal so don't treat as trusted
#
# modifies/sets:
# flags: hashref of flags for the protocol
#   noauth = 1 if the user is the same as remote or has authenticated successfully
#   u = user we're posting as

sub _auth {
    my ( $flags, $post, $remote, $referer ) = @_;

    # referer only should be passed in if outside web context, such as when running tests

    my %auth;
    foreach (qw( username chal response password )) {
        $auth{$_} = $post->{$_} || "";
    }

    my %ret;

    if (
        $auth{username}    # user argument given
        && !$remote
        )
    {                      # user not logged in

        my $u = LJ::load_user( $auth{username} );

        # verify entered password, if it is present
        my $ok = LJ::auth_okay( $u, $auth{password} );

        if ($ok) {
            $flags->{noauth} = 1;
            $flags->{u}      = $u;

            $ret{poster}  = $u;
            $ret{journal} = $post->{usejournal} ? LJ::load_user( $post->{usejournal} ) : $u;
        }
    }
    elsif ( $remote && LJ::check_referer( undef, $referer ) ) {
        $flags->{noauth} = 1;
        $flags->{u}      = $remote;

        $ret{poster}  = $remote;
        $ret{journal} = $post->{usejournal} ? LJ::load_user( $post->{usejournal} ) : $remote;
    }

    $ret{unverified_username} = $ret{poster} ? $ret{poster}->username : $auth{username};
    return %ret;
}

sub _queue_crosspost {
    my ( $form_req, %opts ) = @_;

    my $u                  = delete $opts{remote};
    my $ju                 = delete $opts{journal};
    my $deleted            = delete $opts{deleted};
    my $editurl            = delete $opts{editurl};
    my $ditemid            = delete $opts{ditemid};
    my $crosspost_callback = delete $opts{crosspost_callback};

    my @crossposts;
    if ( $u && $ju && $u->equals($ju) && $form_req->{crosspost_entry} ) {
        my $user_crosspost = $form_req->{crosspost};
        my ( $xpost_successes, $xpost_errors ) = LJ::Protocol::schedule_xposts(
            $u, $ditemid, $deleted,
            $crosspost_callback || sub {
                my $submitted = $user_crosspost->{ $_[0]->acctid } || {};

                # first argument is true if user checked the box
                # false otherwise
                return (
                    $submitted->{id} ? 1 : 0,
                    {
                        password       => $submitted->{password},
                        auth_challenge => $submitted->{chal},
                        auth_response  => $submitted->{resp},
                    }
                );
            }
        );

        foreach my $crosspost ( @{ $xpost_successes || [] } ) {
            push @crossposts,
                {
                text => LJ::Lang::ml(
                    "xpost.request.success2",
                    {
                        account       => $crosspost->displayname,
                        sitenameshort => $LJ::SITENAMESHORT,
                    }
                ),
                status => "ok",
                };
        }

        foreach my $crosspost ( @{ $xpost_errors || [] } ) {
            push @crossposts,
                {
                text => LJ::Lang::ml(
                    'xpost.request.failed',
                    {
                        account => $crosspost->displayname,
                        editurl => $editurl,
                    }
                ),
                status => "error",
                };
        }
    }

    return @crossposts;
}

# helper sub for printing success messages when posting or editing
sub _get_extradata {
    my ( $form_req, $journal ) = @_;
    my $extradata = {
        security_ml => "",
        filters     => "",
    };

    # use the HTML cleaner on the entry subject if one exists
    my $subject = $form_req->{subject};
    LJ::CleanHTML::clean_subject( \$subject ) if $subject;
    $extradata->{subject} = $subject;

    my $c_or_p = $journal->is_community ? 'c' : 'p';

    if ( $form_req->{security} eq "usemask" ) {
        if ( $form_req->{allowmask} == 1 ) {    # access list
            $extradata->{security_ml} = "post.security.access.$c_or_p";
        }
        elsif ( $form_req->{allowmask} > 1 ) {    # custom group
            $extradata->{security_ml} = "post.security.custom";
            $extradata->{filters}     = $journal->security_group_display( $form_req->{allowmask} );
        }
        else {    # custom security with no group - essentially private
            $extradata->{security_ml} = "post.security.private.$c_or_p";
        }
    }
    elsif ( $form_req->{security} eq "private" ) {
        $extradata->{security_ml} = "post.security.private.$c_or_p";
    }
    else {        #public
        $extradata->{security_ml} = "post.security.public";
    }

    # Figure out whether we should offer to update their default formatting.
    my $remote = LJ::get_remote();
    if (   $remote
        && DW::Formats::is_active( $form_req->{props}->{editor} )
        && $form_req->{props}->{editor} ne $remote->entry_editor2 )
    {
        $extradata->{format} = $DW::Formats::formats{ $form_req->{props}->{editor} };
    }

    return $extradata;
}

sub _do_post {
    my ( $form_req, $flags, $auth, %opts ) = @_;

    my $res = DW::Entry::_save_new_entry( $form_req, $flags, $auth );
    _legacy_post_spam_check( $opts{legacy_success}, $auth->{poster} );
    return %$res if $res->{errors};

    # post succeeded, time to do some housecleaning
    if ( my $legacy = $opts{legacy_success} ) {
        _legacy_success_housekeeping( $legacy, $form_req );
    }
    else {
        _persist_props( $auth->{poster}, $form_req, 0 );
        if ( $auth->{poster} ) {
            $auth->{poster}->set_prop( 'entry_draft',      '' );
            $auth->{poster}->set_prop( 'draft_properties', '' );
        }
    }

    my $render_ret;
    my @links;

    # we may have warnings generated by previous parts of the process
    my $warnings = $opts{warnings} || DW::FormErrors->new;

    # special-case moderated: no itemid, but have a message
    if ( !defined $res->{itemid} && $res->{message} ) {
        $render_ret = DW::Template->render_template(
            'entry/success.tt',
            {
                moderated_message => $res->{message},
                legacy_extra_html =>
                    _legacy_success_extra_html( $opts{legacy_success}, undef, undef ),
            }
        );
    }
    else {
        # e.g., bad HTML in the entry
        $warnings->add_string( undef, LJ::auto_linkify( LJ::ehtml( $res->{message} ) ) )
            if $res->{message};

        my $u       = $auth->{poster};
        my $journal = $auth->{journal};

        # we updated successfully! Now tell the user
        my $poststatus = {
            status    => 'posted',
            ml_string => $journal->is_community ? ".new.community" : ".new.journal",
            url       => $journal->journal_base . "/",
        };

        # bunch of helpful links
        my $juser        = $journal->user;
        my $ditemid      = $res->{itemid} * 256 + $res->{anum};
        my $itemlink     = $res->{url};
        my $edititemlink = "$LJ::SITEROOT/entry/$juser/$ditemid/edit";

        my @links = (
            {
                url       => $itemlink,
                ml_string => ".links.viewentry"
            },
            {
                url       => $edititemlink,
                ml_string => ".links.editentry"
            },
            {
                url       => "$LJ::SITEROOT/edittags?journal=$juser&itemid=$ditemid",
                ml_string => ".links.tags"
            },
        );

        push @links,
            {
            url       => $journal->journal_base . "?poster=" . $auth->{poster}->user,
            ml_string => ".links.myentries"
            }
            if $journal->is_community;

        push @links,
            (
            {
                url       => "$LJ::SITEROOT/tools/memadd?journal=$juser&itemid=$ditemid",
                ml_string => ".links.memories"
            },
            {
                url       => "$LJ::SITEROOT/editjournal",
                ml_string => '.links.manageentries',
            },
            {
                url       => "$LJ::SITEROOT/logout",
                ml_string => '.links.logout',
            }
            );

        # Legacy update keeps its master checkbox outside normalized form data.
        # Its POST-first, GET-fallback value is passed explicitly by its adapter.
        my $crosspost_form = $form_req;
        if ( $opts{legacy_success} && exists $opts{legacy_success}{crosspost_master} ) {
            $crosspost_form =
                { %$form_req, crosspost_entry => $opts{legacy_success}{crosspost_master} };
        }

        # crosspost!
        my @crossposts = _queue_crosspost(
            $crosspost_form,
            remote             => $opts{legacy_success} ? $opts{legacy_success}{remote} : $u,
            journal            => $journal,
            deleted            => 0,
            editurl            => $edititemlink,
            ditemid            => $ditemid,
            crosspost_callback => $opts{legacy_crosspost_callback},
        );

        my $legacy_extra_options =
            defined $res->{itemid}
            ? _legacy_success_extra_options( $opts{legacy_success}, $journal, $itemlink )
            : '';
        my $legacy_extra_html =
            _legacy_success_extra_html( $opts{legacy_success}, $journal, $itemlink );

        # set sticky
        if ( $form_req->{sticky_entry} && $u->can_manage($journal) ) {
            my $added_sticky = $journal->sticky_entry_new($ditemid);
            $warnings->add( '', '.sticky.max', { limit => $u->count_max_stickies } )
                unless $added_sticky;
        }

        $render_ret = DW::Template->render_template(
            'entry/success.tt',
            {
                poststatus   => $poststatus,     # did the update succeed or fail?
                warnings     => $warnings,       # warnings about the entry or your account
                crossposts   => \@crossposts,    # crosspost status list
                links        => \@links,
                links_header => ".links",
                entry_url    => $itemlink,
                legacy_extra_options => $legacy_extra_options,
                legacy_extra_html    => $legacy_extra_html,
                extradata            => _get_extradata( $form_req, $journal ),
            }
        );
    }

    return ( status => "ok", render => $render_ret );
}

# Retained compatibility paths sometimes need the original flat protocol
# request attempted after a prior login error.  This deliberately excludes
# _do_post's normal success housekeeping and rendering.
sub _legacy_flat_post_attempt {
    my ( $request, $flags, $poster ) = @_;
    my %response;
    LJ::do_request( $request, \%response, $flags );
    LJ::Hooks::run_hooks( 'spam_check', $poster, $request, 'entry' );
    return \%response;
}

sub _do_edit {
    my ( $ditemid, $form_req, $auth, %opts ) = @_;

    # Retained editjournal supplies its raw crosspost fields and response-only
    # state explicitly. The native edit path keeps its normalized request and
    # native links untouched.
    my $legacy_edit = $opts{legacy_edit};

    my $res = DW::Entry::_save_editted_entry( $ditemid, $form_req, $auth );
    return %$res if $res->{errors};

    my $remote  = $auth->{poster};
    my $journal = $auth->{journal};

    my $deleted = $form_req->{event} ? 0 : 1;

    # post succeeded, time to do some housecleaning
    _persist_props( $remote, $form_req, 1 );

    my $poststatus_ml;
    my $render_ret;
    my @links;

    # we may have warnings generated by previous parts of the process
    my $warnings = $opts{warnings} || DW::FormErrors->new;

    # e.g., bad HTML in the entry
    $warnings->add_string( undef,
        LJ::auto_linkify( LJ::html_newlines( LJ::ehtml( $res->{message} ) ) ) )
        if $res->{message};

    # bunch of helpful links:
    my $juser         = $journal->user;
    my $comm_modifier = $journal->is_community ? '.comm' : '';
    my $entry_url     = $res->{url};
    my $edit_url      = "$LJ::SITEROOT/entry/$juser/$ditemid/edit";

    my $is_sticky_entry = $journal->sticky_entries_lookup->{$ditemid};
    if ( $remote->can_manage($journal) ) {
        if ( $form_req->{sticky_entry} ) {
            $journal->sticky_entry_new($ditemid)
                unless $is_sticky_entry;
        }
        elsif ( $form_req->{sticky_select} ) {
            $journal->sticky_entry_remove($ditemid)
                if $is_sticky_entry;
        }
    }

    if ($deleted) {
        $poststatus_ml = ".edit.delete2$comm_modifier";

        $journal->sticky_entry_remove($ditemid)
            if $is_sticky_entry && $remote->can_manage($journal);

        push @links,
            {
            url       => $journal->journal_base . "?poster=" . $auth->{poster}->user,
            ml_string => ".links.myentries"
            }
            if $journal->is_community;

        push @links,
            {
            url       => "$LJ::SITEROOT/editjournal",
            ml_string => '.links.manageentries',
            },
            {
            url       => "$LJ::SITEROOT/logout",
            ml_string => '.links.logout',
            };

    }
    else {
        $poststatus_ml = ".edit.edited2$comm_modifier";

        push @links,
            (
            {
                url       => $entry_url,
                ml_string => ".links.viewentry",
            },
            {
                url       => $edit_url,
                ml_string => ".links.editentry",
            },
            {
                url       => "$LJ::SITEROOT/edittags?journal=$juser&itemid=$ditemid",
                ml_string => ".links.tags"
            },
            );

        push @links,
            {
            url       => $journal->journal_base . "?poster=" . $auth->{poster}->user,
            ml_string => ".links.myentries"
            }
            if $journal->is_community;

        push @links,
            (
            {
                url       => "$LJ::SITEROOT/tools/memadd?journal=$juser&itemid=$ditemid",
                ml_string => ".links.memories"
            },
            {
                url       => "$LJ::SITEROOT/editjournal",
                ml_string => '.links.manageentries',
            },
            {
                url       => "$LJ::SITEROOT/logout",
                ml_string => '.links.logout',
            }
            );

    }

    my $crosspost_form = $form_req;
    if ($legacy_edit) {
        $crosspost_form = { %$form_req, crosspost_entry => $legacy_edit->{crosspost_master}, };
    }

    my @crossposts = _queue_crosspost(
        $crosspost_form,
        remote             => $legacy_edit ? $legacy_edit->{remote} : $remote,
        journal            => $journal,
        deleted            => $deleted,
        ditemid            => $ditemid,
        editurl            => $legacy_edit ? $legacy_edit->{editurl} : $edit_url,
        crosspost_callback => $legacy_edit ? $legacy_edit->{crosspost_callback} : undef,
    );

    if ( $legacy_edit && $deleted ) {
        $opts{legacy_edit_deleted_extras} = LJ::Hooks::run_hook('entry_deleted_page_extras');
    }
    elsif ( $legacy_edit && $legacy_edit->{entry_was_suspended} ) {
        $warnings->add( undef, '/editjournal.tt.success.editedstillsuspended' );
    }

    my $poststatus = {
        status    => $deleted ? 'deleted' : 'edited',
        ml_string => $poststatus_ml,
        url       => $journal->journal_base . "/",
    };

    $render_ret = DW::Template->render_template(
        'entry/success.tt',
        {
            poststatus   => $poststatus,     # did the update succeed or fail?
            warnings     => $warnings,       # warnings about the entry or your account
            crossposts   => \@crossposts,    # crosspost status list
            links        => \@links,
            links_header => '.links',
            entry_url    => $entry_url,
            extradata                  => _get_extradata( $form_req, $journal ),
            legacy_edit_deleted_extras => $opts{legacy_edit_deleted_extras},
        }
    );

    return ( status => "ok", render => $render_ret );
}

# remember value of properties, to use the next time the user makes a post

# Retained update performs this after the protocol post attempt, including an
# unsuccessful attempt. Native handlers retain their existing pre-save check.
sub _legacy_post_spam_check {
    my ( $legacy, $poster ) = @_;
    return unless $legacy && exists $legacy->{request};

    LJ::Hooks::run_hooks( 'spam_check', $poster, $legacy->{request}, 'entry' );
}

# Legacy wrappers pass the old, flat decoder request explicitly. Do not derive
# it from the normalized request: deployment hooks may depend on fields that the
# native save pipeline intentionally does not retain.
sub _legacy_success_extra_options {
    my ( $legacy, $user, $itemlink ) = @_;
    return '' unless $legacy && exists $legacy->{request};

    my @results = LJ::Hooks::run_hooks(
        'after_entry_post_extra_options',
        user     => $user,
        itemlink => $itemlink,
    );
    return join '', map { $_->[0] // '' } @results;
}

sub _legacy_success_extra_html {
    my ( $legacy, $user, $itemlink ) = @_;
    return '' unless $legacy && exists $legacy->{request};

    return LJ::Hooks::run_hook(
        'after_entry_post_extra_html',
        user     => $user,
        itemlink => $itemlink,
        request  => $legacy->{request},
    ) // '';
}

# The legacy update form keeps its raw crosspost fields outside the normalized
# form request.  Preserve its POST-first, GET-fallback contract at the scheduler
# boundary without changing native form normalization.
sub _legacy_crosspost_master {
    my ( $post, $get ) = @_;
    return $post->{prop_xpost_check} || $get->{prop_xpost_check};
}

sub _legacy_crosspost_callback {
    my ( $post, $get ) = @_;

    return sub {
        my $acctid = $_[0]->acctid;
        my $prefix = "prop_xpost_$acctid";

        return (
            $post->{$prefix} || $get->{$prefix},
            {
                password => $post->{"prop_xpost_password_$acctid"}
                    || $get->{"prop_xpost_password_$acctid"},
                auth_challenge => $post->{"prop_xpost_chal_$acctid"}
                    || $get->{"prop_xpost_chal_$acctid"},
                auth_response => $post->{"prop_xpost_resp_$acctid"}
                    || $get->{"prop_xpost_resp_$acctid"},
            }
        );
    };
}

sub _legacy_success_housekeeping {
    my ( $legacy, $form ) = @_;
    my $poster = $legacy->{poster};
    my $remote = $legacy->{remote};
    $poster->set_prop( 'disable_auto_formatting', $legacy->{event_format} ? 1 : 0 ) if $poster;
    if ($remote) {
        $remote->set_prop( 'entry_draft', '' );
        my $editor = $remote->prop('entry_editor') || '';
        $remote->set_prop( 'entry_editor', $legacy->{switched_rte_on} ? 'rich' : 'plain' )
            unless $editor =~ /^always_/;
    }
}

sub _persist_props {
    my ( $u, $form, $is_edit ) = @_;

    return unless $u;

    $u->displaydate_check( $form->{update_displaydate} ? 1 : 0 ) unless $is_edit;

}

sub _prepopulate {
    my $get = $_[0];

    my $subject = $get->{subject};
    my $event   = $get->{event};
    my $tags    = $get->{tags};

    # if a share url was passed in, fill in the fields with the appropriate text
    if ( $get->{share} ) {
        eval "use DW::External::Page; 1;";
        if ( !$@ && ( my $page = DW::External::Page->new( url => $get->{share} ) ) ) {
            $subject = LJ::ehtml( $page->title );
            $event =
                  '<a href="'
                . $page->url . '">'
                . ( LJ::ehtml( $page->description ) || $subject || $page->url )
                . "</a>\n\n";
        }
    }

    return {
        subject => $subject,
        event   => $event,
        taglist => $tags,
    };
}

=head2 C<< DW::Controller::Entry::preview_handler( ) >>

Shows a preview of this entry

=cut

sub preview_handler {
    my $r      = DW::Request->get;
    my $remote = LJ::get_remote();

    # Can't count on template to handle resource group, since we might go
    # through S2 instead.
    LJ::set_active_resource_group('foundation');

    my $post = $r->post_args;
    my $styleid;
    my $siteskinned = 1;

    my $username   = $remote ? $remote->username : $post->{username};
    my $usejournal = $post->{usejournal};

    # figure out poster/journal
    my ( $u, $up );
    if ($usejournal) {
        $u  = LJ::load_user($usejournal);
        $up = $username ? LJ::load_user($username) : $remote;
    }
    elsif ( !$remote && $username ) {
        $u = LJ::load_user($username);
    }
    else {
        $u = $remote;
    }
    $up ||= $u;

    # set up preview variables
    my ( $ditemid, $anum, $itemid );

    my $form_req = {};
    DW::Entry::_form_to_backend( 0, $form_req, $post );

    return _render_preview( $r, $u, $up, $form_req );
}

sub _render_preview {
    my ( $r, $u, $up, $form_req, %opts ) = @_;
    my $styleid;
    my $siteskinned   = 1;
    my $preview_scope = $opts{legacy} ? $opts{ml_scope} : '/entry/preview.tt';

    # check for spam domains
    LJ::Hooks::run_hooks( 'spam_check', $up, $form_req, 'entry' ) unless $opts{legacy};

    my ( $event, $subject ) = ( $form_req->{event}, $form_req->{subject} );
    LJ::CleanHTML::clean_subject( \$subject );

    # preview poll
    if ( LJ::Poll->contains_new_poll( \$event ) ) {
        my $error;
        my @polls = LJ::Poll->new_from_html(
            \$event,
            \$error,
            {
                'journalid' => $u->userid,
                'posterid'  => $up->userid,
            }
        );

        my $can_create_poll = $up->can_create_polls || ( $u->is_community && $u->can_create_polls );
        my $poll_preview    = sub {
            my $poll = shift @polls;
            return '' unless $poll;
            return $can_create_poll
                ? $poll->preview
                : qq{<div class="highlight-box">}
                . LJ::Lang::ml('/poll/create.bml.error.accttype2')
                . qq{</div>};
        };

        $event =~ s/<poll-placeholder>/$poll_preview->()/eg;
    }

    # expand existing polls (for editing, or when transferring polls to another entry)
    LJ::Poll->expand_entry( \$event );

    # parse out embed tags from the RTE
    $event = LJ::EmbedModule->transform_rte_post($event);

    # do first expand_embedded pass with the preview flag to extract
    # embedded content before cleaning and replace with tags
    # the cleaner won't eat
    LJ::EmbedModule->parse_module_embed( $u, \$event, preview => 1 );

    my $editor = $form_req->{props}->{editor};

    # clean content normally
    LJ::CleanHTML::clean_event(
        \$event,
        {
            preformatted => $form_req->{props}->{opt_preformatted},
            editor       => $editor,
        }
    );

    # expand the embedded content for real
    LJ::EmbedModule->expand_entry( $u, \$event, preview => 1 );

    my $ctx;
    if ( $u && $up ) {
        $r->note( "_journal"  => $u->{user} );
        $r->note( "journalid" => $u->{userid} );

        # Legacy style selection also reads stylesys and force_s1 inputs.
        $u->preload_props(qw( stylesys s2_style journaltitle journalsubtitle ));

        # Legacy previews retain the old stylesys/force_s1 decision; native
        # previews retain their existing journal-entry-style decision.
        $ctx = LJ::S2::s2_context( $u->{s2_style} );
        if ( $opts{legacy} ) {
            if ( $u->{stylesys} == 2 ) {
                my $force_s1 = 0;
                LJ::Hooks::run_hooks( 'force_s1', $u, \$force_s1 );
                my $view_entry_disabled = !LJ::S2::use_journalstyle_entry_page($u);
                ( $siteskinned, $styleid ) =
                    $force_s1 || $view_entry_disabled ? ( 1, 0 ) : ( 0, $u->{s2_style} );
            }
            else {
                ( $siteskinned, $styleid ) = ( 1, 0 );
            }
        }
        else {
            my $view_entry_disabled = !LJ::S2::use_journalstyle_entry_page( $u, $ctx );
            ( $siteskinned, $styleid ) =
                $view_entry_disabled ? ( 1, 0 ) : ( 0, $u->{s2_style} );
        }
    }
    else {
        ( $siteskinned, $styleid ) = ( 1, 0 );
    }

    # Include helper CSS/JS for highest fidelity previews
    LJ::Talk::init_s2journal_js( noqr => 1, siteskin => $siteskinned );

    if ($siteskinned) {
        my $vars = {
            event   => $event,
            subject => $subject,
            journal => $u,
            poster  => $up,
        };

        my $pic = LJ::Userpic->new_from_keyword( $up, $form_req->{props}->{picture_keyword} );
        $vars->{icon} = $pic ? $pic->imgtag : undef;

        my $date  = "$form_req->{year}-$form_req->{mon}-$form_req->{day}";
        my $etime = $u ? LJ::date_to_view_links( $u, $date ) : $date;
        my $hour  = sprintf( "%02d", $form_req->{hour} );
        my $min   = sprintf( "%02d", $form_req->{min} );
        $vars->{displaydate} = "$etime $hour:$min:00";

        my %current = LJ::currents( $form_req->{props}, $up );
        if ($u) {
            $current{Groups} = $u->security_group_display( $form_req->{allowmask} );
            delete $current{Groups} unless $current{Groups};
        }

        my @taglist = ();
        LJ::Tags::is_valid_tagstring( $form_req->{props}->{taglist}, \@taglist );
        if (@taglist) {
            my $base = $u ? $u->journal_base : "";
            $current{Tags} = join( ', ',
                map { "<a href='$base/tag/" . LJ::eurl($_) . "'>" . LJ::ehtml($_) . "</a>" }
                    @taglist );
        }
        $vars->{currents} = LJ::currents_div(%current);

        my $security = "";
        if ( $form_req->{security} eq "private" ) {
            $security = $LJ::Img::img{"security-private"};
        }
        elsif ( $form_req->{security} eq "usemask" ) {
            $security =
                  $form_req->{allowmask} > 1
                ? $LJ::Img::img{"security-groups"}
                : $LJ::Img::img{"security-protected"};
        }
        $vars->{security} = $security;

        # The legacy page and native route share markup, but relative
        # translation keys must retain their physical page scope.
        return DW::Template->render_template( 'entry/preview.tt', $vars,
            $opts{legacy} ? { ml_scope => $preview_scope } : undef );
    }
    else {
        my $ret  = "";
        my $opts = {};

        LJ::need_res( { priority => $LJ::LIB_RES_PRIORITY, group => 'foundation' },
            "stc/css/foundation/foundation_minimal.css" );

        $LJ::S2::ret_ref = \$ret;
        $opts->{r} = $r;

        $u->{_s2styleid}   = ( $styleid || 0 ) + 0;
        $u->{_journalbase} = $u->journal_base;

        $LJ::S2::CURR_CTX = $ctx;

        my $p = LJ::S2::Page( $u, $opts );
        $p->{_type} = "EntryPreviewPage";
        $p->{view}  = "entry";

        # Mock up entry from form data
        my $userlite_journal = LJ::S2::UserLite($u);
        my $userlite_poster  = LJ::S2::UserLite($up);

        my $userpic  = LJ::S2::Image_userpic( $up, 0, $form_req->{props}->{picture_keyword} );
        my $comments = LJ::S2::CommentInfo(
            {
                read_url      => "#",
                post_url      => "#",
                permalink_url => "#",
                count         => "0",
                maxcomments   => 0,
                enabled =>
                    ( $u->{opt_showtalklinks} eq "Y" && !$form_req->{props}->{opt_nocomments} )
                ? 1
                : 0,
                screened => 0,
            }
        );

        # build tag objects, faking kwid as '-1'
        # * invalid tags will be stripped by is_valid_tagstring()
        my @taglist = ();
        LJ::Tags::is_valid_tagstring( $form_req->{props}->{taglist}, \@taglist );
        @taglist = map { LJ::S2::Tag( $u, -1, $_ ) } @taglist;

        # custom friends groups
        my $group_names = $u ? $u->security_group_display( $form_req->{allowmask} ) : undef;

        # format it
        my $raw_subj = $form_req->{subject};
        my $s2entry  = LJ::S2::Entry(
            $u,
            {
                subject => $subject,
                text    => $event,
                dateparts =>
"$form_req->{year} $form_req->{mon} $form_req->{day} $form_req->{hour} $form_req->{min} 00 ",
                security            => $form_req->{security},
                allowmask           => $form_req->{allowmask},
                props               => $form_req->{props},
                itemid              => -1,
                comments            => $comments,
                journal             => $userlite_journal,
                poster              => $userlite_poster,
                new_day             => 0,
                end_day             => 0,
                tags                => \@taglist,
                userpic             => $userpic,
                permalink_url       => "#",
                adult_content_level => $form_req->{props}->{adult_content},
                group_names         => $group_names,
            }
        );

        my $copts;
        $copts->{out_pages}     = $copts->{out_page}     = 1;
        $copts->{out_items}     = 0;
        $copts->{out_itemfirst} = $copts->{out_itemlast} = undef;

        $p->{comment_pages} = LJ::S2::ItemRange(
            {
                all_subitems_displayed => ( $copts->{out_pages} == 1 ),
                current                => $copts->{out_page},
                from_subitem           => $copts->{out_itemfirst},
                num_subitems_displayed => 0,
                to_subitem             => $copts->{out_itemlast},
                total                  => $copts->{out_pages},
                total_subitems         => $copts->{out_items},
                _url_of                => sub { return "#"; },
            }
        );

        $p->{entry}             = $s2entry;
        $p->{comments}          = [];
        $p->{preview_warn_text} = LJ::Lang::ml("$preview_scope.entry.preview_warn_text");

        $p->{viewing_thread} = 0;
        $p->{multiform_on}   = 0;

        # page display settings
        if ( $u->should_block_robots ) {
            $p->{head_content} .= LJ::robot_meta_tags();
        }
        my $charset = $opts->{saycharset} // '';
        $p->{head_content} .=
            '<meta http-equiv="Content-Type" content="text/html; charset=' . $charset . "\" />\n";

        # Include required CSS and really fundamental JS like Site object (most
        # other JS gets loaded at end of page by s2_run)
        $p->{head_content} .= LJ::res_includes_head();

        # Don't show the navigation strip or invisible content
        $p->{head_content} .= qq{
            <style type="text/css">
            html body {
                padding-top: 0 !important;
            }
            #lj_controlstrip {
                display: none !important;
            }
            .invisible {
                position: absolute;
                left: -10000px;
                top: auto;
            }
            .highlight-box {
                border: 1px solid #c1272c;
                background-color: #ffd8d8;
                color: #000;
            }
            </style>
        };

        LJ::S2::s2_run( $r, $ctx, $opts, "EntryPage::print()", $p );
        $r->print($ret);
        return $r->OK;
    }

}

# This legacy-schema wrapper derives from htdocs/preview/entry.bml, which was
# forked from LiveJournal and remains covered by its GNU General Public License
# notice in LICENSE-LiveJournal.txt. Keep that attribution with this wrapper
# while the shared renderer above remains Dreamwidth-native code.
sub legacy_preview_handler {
    my $r = DW::Request->get;

    # The BML page returned this localized text directly, rather than putting it
    # inside the modern error wrapper.
    unless ( $r->did_post ) {
        $r->print( LJ::Lang::ml('bml.requirepost') );
        return $r->OK;
    }
    my $remote = LJ::get_remote();
    LJ::set_active_resource_group('foundation');

    my $post       = $r->post_args;
    my $username   = $post->{user} || $post->{username};
    my $altlogin   = $r->get_args->{altlogin} || $post->{post_as_other};
    my $usejournal = $altlogin ? $post->{postas_usejournal} : $post->{usejournal};
    my ( $u, $up );
    if ($usejournal) {
        $u  = LJ::load_user($usejournal);
        $up = $username ? LJ::load_user($username) : $remote;
    }
    elsif ( $username && $altlogin ) {
        $u = LJ::load_user($username);
    }
    else {
        $u = $remote;
    }
    $up ||= $u;

    my %legacy = ( usejournal => $post->{usejournal} );
    LJ::entry_form_decode( \%legacy, $post );
    my $form_req = {
        ( map { $_ => $legacy{$_} } qw(subject event security allowmask year mon day hour min) ),
        props => {
            taglist          => $legacy{prop_taglist},
            picture_keyword  => $legacy{prop_picture_keyword},
            current_moodid   => $legacy{prop_current_moodid},
            current_mood     => $legacy{prop_current_mood},
            current_music    => $legacy{prop_current_music},
            current_location => $legacy{prop_current_location},
            current_coords   => $legacy{prop_current_coords},
            adult_content    => $legacy{prop_adult_content},
            opt_preformatted => $legacy{prop_opt_preformatted},
            opt_nocomments   => $legacy{prop_opt_nocomments},
            opt_noemail      => $legacy{prop_opt_noemail},
        },
    };
    return _render_preview( $r, $u, $up, $form_req, legacy => 1, ml_scope => '/preview/entry.bml' );
}

=head2 C<< DW::Controller::Entry::options_handler( ) >>

Show the entry options page in a separate page

=cut

sub options_handler {
    my ( $ok, $rv ) = controller();
    return $rv unless $ok;

    return DW::Template->render_template( 'entry/options.tt', _options( $rv->{remote} ) );
}

=head2 C<< DW::Controller::Entry::options_rpc_handler( ) >>

Show the entry options page in a form suitable for loading via JS

=cut

sub options_rpc_handler {
    my ( $ok, $rv ) = controller();
    return $rv unless $ok;

    my $vars = _options( $rv->{remote} );
    $vars->{use_js} = 1;

    my $r = DW::Request->get;
    $r->status( $vars->{errors} && $vars->{errors}->exist ? HTTP_BAD_REQUEST : HTTP_OK );

    return DW::Template->render_template( 'entry/options.tt', $vars, { fragment => 1 } );
}

=head2 C<< DW::Controller::Entry::collapse_rpc_handler( ) >>

Load or save entry form module header settings

=cut

sub collapse_rpc_handler {
    my ( $ok, $rv ) = controller();
    return $rv unless $ok;

    my $u    = $rv->{remote};
    my $r    = DW::Request->get;
    my $args = $r->get_args;

    my $module = $args->{id} || "";
    my $expand = $args->{expand} && $args->{expand} eq "true" ? 1 : 0;

    my $show = sub {
        $r->print( to_json( $u->entryform_panels_collapsed ) );
        return $r->OK;
    };

    if ($module) {
        my $is_collapsed = $u->entryform_panels_collapsed;

        # no further action needed
        return $show->() if $is_collapsed->{$module}  && !$expand;
        return $show->() if !$is_collapsed->{$module} && $expand;

        if ($expand) {
            delete $is_collapsed->{$module};
        }
        else {
            $is_collapsed->{$module} = 1;
        }
        $u->entryform_panels_collapsed($is_collapsed);

        return $show->();
    }
    else {
        # just view
        return $show->();
    }
}

sub _load_visible_panels {
    my $u = $_[0];

    my $user_panels = $u->entryform_panels;

    my @panels;
    foreach my $panel_group ( @{ $user_panels->{order} } ) {
        foreach my $panel (@$panel_group) {
            push @panels, $panel if $user_panels->{show}->{$panel};
        }
    }

    return \@panels;
}

sub _options {
    my $u = $_[0];

    my $panel_element_name = "visible_panels";
    my @panel_options      = map +{
        label_ml   => "/entry/module-$_.tt.header",
        panel_name => $_,
        id         => "panel_$_",
        name       => $panel_element_name,
    }, @modules;

    my $vars = { panels => \@panel_options };

    my $r      = DW::Request->get;
    my $errors = DW::FormErrors->new;
    if ( $r->did_post ) {
        my $post = $r->post_args;
        $vars->{formdata} = $post;

        if ( LJ::check_form_auth( $post->{lj_form_auth} ) ) {
            if ( $post->{reset_panels} ) {
                $vars->{formdata}->remove("reset_panels");
                $u->set_prop( "entryform_panels" => undef );
                $vars->{formdata}
                    ->set( $panel_element_name => @{ _load_visible_panels($u) || [] } );
            }
            else {
                $u->set_prop( entryform_width => $post->{entry_field_width} );

                my %panels;
                my %post_panels = map { $_ => 1 } $post->get_all($panel_element_name);
                foreach my $panel (@panel_options) {
                    my $name = $panel->{panel_name};
                    $panels{$name} = $post_panels{$name} ? 1 : 0;
                }
                $u->entryform_panels_visibility( \%panels );

                my @columns;
                my $didpost_order = 0;
                foreach my $column_index ( 0 ... 2 ) {
                    my @col;

                    foreach ( $post->get_all("column_$column_index") ) {
                        my ( $order, $panel ) = m/(\d+):(.+)/;
                        $col[$order] = $panel;

                        $didpost_order = 1;
                    }

                   # remove any in-betweens in case we managed to skip a number in the order somehow
                    $columns[$column_index] = [ grep { $_ } @col ];
                }
                $u->entryform_panels_order( \@columns ) if $didpost_order;
            }

            $u->set_prop( js_animations_minimal => $post->{minimal_animations} );
        }
        else {
            $errors->add( undef, "error.invalidform" );
        }

        $vars->{errors} = $errors;
    }
    else {

        my $default = {
            entry_field_width  => $u->entryform_width,
            minimal_animations => $u->prop("js_animations_minimal") ? 1 : 0,
        };

        $default->{$panel_element_name} = _load_visible_panels($u);

        $vars->{formdata} = $default;
    }

    return $vars;
}

sub draft_rpc_handler {
    my ( $ok, $rv ) = controller();
    return $rv unless $ok;

    my $u    = $rv->{remote};
    my $r    = DW::Request->get;
    my $GET  = $r->get_args;
    my $POST = $r->post_args;

    my $err = sub {
        my $msg = shift;
        return to_json(
            {
                'alert' => $msg,
            }
        );
    };

    my $ret = {};

    # This property thaws the contents of the userprop 'draft_properties' and
    # sends them back as a JS object.
    if ( defined $GET->{getProperties} ) {
        my $ret =
            $u->prop('draft_properties') ? Storable::thaw( $u->prop('draft_properties') ) : {};
        $r->print( to_json($ret) );
        return $r->OK;
    }

    # This property clears out all the fields of the user's draft, except the
    # draft body itself.
    if ( defined $POST->{clearProperties} ) {
        $u->clear_prop('draft_properties');
    }

    # If even one property of the draft was changed, this property saves them
    # all into a new draft (in order to avoid multiple HTTP posts which would
    # decrease performance considerably).
    # This is set up as a long if statement to avoid tying draft property saving to
    # the draft body save logic, so that users won't have to change their
    # draft body every time they want to get their properties saved.
    if (   ( defined $POST->{saveSubject} )
        || ( defined $POST->{saveEditor} )
        || ( defined $POST->{saveUserpic} )
        || ( defined $POST->{saveTaglist} )
        || ( defined $POST->{saveMoodID} )
        || ( defined $POST->{saveMood} )
        || ( defined $POST->{saveLocation} )
        || ( defined $POST->{saveMusic} )
        || ( defined $POST->{saveAdultReason} )
        || ( defined $POST->{saveCommentSet} )
        || ( defined $POST->{saveCommentScr} )
        || ( defined $POST->{saveAdultCnt} ) )
    {
        my %properties = (
            subject     => $POST->{saveSubject},
            editor      => $POST->{saveEditor},
            userpic     => $POST->{saveUserpic},
            taglist     => $POST->{saveTaglist},
            moodid      => $POST->{saveMoodID},
            mood        => $POST->{saveMood},
            location1   => $POST->{saveLocation},
            music       => $POST->{saveMusic},
            adultreason => $POST->{saveAdultReason},
            commentset  => $POST->{saveCommentSet},
            commentscr  => $POST->{saveCommentScr},
            adultcnt    => $POST->{saveAdultCnt}
        );

        # If the property is null, a default menu selection or a JS undefined
        # value, we don't want to save it.
        foreach my $key ( keys(%properties) ) {
            if (   !defined $properties{$key}
                || ( $properties{$key} =~ /^$/ )
                || ( $properties{$key} =~ /^0$/ )
                || ( $properties{$key} =~ /^undefined$/ ) )
            {
                delete $properties{$key};
            }
        }

        # Freeze the hash into a frozen storable string. If the hash is not empty
        # save it to the userprop. If it is, delete it.
        my $frozen_properties = Storable::nfreeze( \%properties );
        if ( $frozen_properties =~ /\w/ ) {
            $u->set_prop( 'draft_properties', $frozen_properties );
        }
        else {
            $u->clear_prop('draft_properties');
        }
    }

    # This property saves the main body of the draft.
    if ( defined $POST->{'saveDraft'} ) {
        $u->set_draft_text( $POST->{'saveDraft'} );

        # This property clears out the main body of the draft.
    }
    elsif ( $POST->{'clearDraft'} ) {
        $u->set_draft_text('');

    }
    else {
        $ret->{draft} = $u->draft_text;
    }

    $r->print( to_json($ret) );
    return $r->OK;
}

1;

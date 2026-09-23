#!/usr/bin/perl
# This code was forked from the LiveJournal project owned and operated
# by Live Journal, Inc. The code has been modified and expanded by
# Dreamwidth Studios, LLC. These files were originally licensed under
# the terms of the license supplied by Live Journal, Inc, which can
# currently be found at:
#
# http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
#
# In accordance with the original license, this code and all its
# modifications are provided under the GNU General Public License.
# A copy of that license can be found in the LICENSE file included as
# part of this distribution.
# Copyright (c) 2026 by Dreamwidth Studios, LLC.

package DW::Controller::EntryPicker;
use strict;
use warnings;

use DW::Controller;
use DW::Request;
use DW::Routing;
use DW::Template;

# The narrow personal-owned GET renderer returns undef for every retained
# context it does not own. DW::Routing then reaches app.psgi's BML fallback
# without changing the request method, body, or query string.
DW::Routing->register_string( '/editjournal', \&entry_picker_handler, app => 1, no_redirects => 1 );

sub entry_picker_handler {
    my $r    = DW::Request->get;
    my $get  = $r->get_args;
    my $post = $r->post_args;

    if ( defined $get->{itemid} || defined $post->{itemid} ) {
        require DW::Controller::Entry;
        return DW::Controller::Entry::legacy_owned_edit_get_handler() if $r->method eq 'GET';
        return DW::Controller::Entry::legacy_owned_edit_handler();
    }

    my ( $ok, $rv ) = controller( authas => { type => 'P' } );
    return $rv unless $ok;

    my $remote = $rv->{remote};
    my $u      = $rv->{u};
    return error_ml('error.person') unless $u->is_individual;

    # Match the legacy BML page exactly: an empty GET usejournal does not
    # suppress a nonempty POST usejournal or the journal alias.
    my $usejournal = $get->{usejournal} || $post->{usejournal} || $get->{journal};
    undef $usejournal if defined $usejournal && $usejournal eq $u->user;

    my $journal = $u;
    if ($usejournal) {
        $journal = LJ::load_user($usejournal);
        return error_ml('/editjournal.bml.error.nocomm') unless $journal && $journal->is_comm;
    }

    my %context;
    $context{authas}     = $get->{authas} if defined $get->{authas};
    $context{usejournal} = $usejournal    if $usejournal;
    my $self_uri = LJ::create_url( '/editjournal', args => \%context );

    my $mode = $get->{mode} || $post->{mode} || 'init';
    if ( !$r->did_post && $mode eq 'edit' ) {

        # The legacy no-item editor branch redirects a direct edit-mode GET
        # back to the picker, deliberately dropping its selection context.
        $r->status(302);
        $r->header_out( Location => "$LJ::SITEROOT/editjournal" );
        return $r->OK;
    }
    if ( $r->did_post && $mode eq 'edit' ) {
        return _select_entries( $rv, $u, $journal, $usejournal, $self_uri, \%context );
    }

    my $entries = _get_entries(
        $u, $journal,
        $usejournal,
        {
            selecttype => 'lastn',
            howmany    => 5,
        },
        $remote
    );

    return DW::Template->render_template(
        'editjournal.tt',
        {
            %$rv,
            self_uri   => $self_uri,
            usejournal => $usejournal,
            entries    => $entries,
            formdata   => {
                selecttype => 'last',
                howmany    => 20,
                year       => (localtime)[5] + 1900,
                month      => sprintf( '%02d', (localtime)[4] + 1 ),
                day        => sprintf( '%02d', (localtime)[3] ),
                usejournal => $usejournal || '',
            },
        },
        { ml_scope => '/editjournal.bml' }
    );
}

sub _select_entries {
    my ( $rv, $u, $journal, $usejournal, $self_uri, $context ) = @_;
    my $r    = $rv->{r};
    my $post = $r->post_args;

    my %selector;
    if ( ( $post->{selecttype} || '' ) eq 'last' ) {
        %selector = ( selecttype => 'one', itemid => -1 );
    }
    elsif ( ( $post->{selecttype} || '' ) eq 'lastn' ) {
        %selector = ( selecttype => 'lastn', howmany => $post->{howmany} );
    }
    elsif ( ( $post->{selecttype} || '' ) eq 'day' ) {
        %selector = map { $_ => $post->{$_} } qw(year month day);
        $selector{selecttype} = 'day';
    }
    else {
        return error_ml('/editjournal.bml.error.getting');
    }

    my ( $entries, $res ) = _get_entries( $u, $journal, $usejournal, \%selector, $rv->{remote} );
    return error_ml('/editjournal.bml.error.getting') unless $res->{success} eq 'OK';

    if ( $res->{events_count} == 1 ) {
        my $ditemid = ( $res->{events_1_itemid} << 8 ) + $res->{events_1_anum};
        $r->status(302);
        $r->header_out(
            Location => LJ::create_url( '/editjournal', args => { %$context, itemid => $ditemid } )
        );
        return $r->OK;
    }

    unless ( $res->{events_count} ) {
        my $message = $selector{selecttype} eq 'lastn' ? '.no.entries.exist' : '.no.entries.match';
        return DW::Template->render_template(
            'editjournal.tt',
            {
                %$rv,
                self_uri   => $self_uri,
                usejournal => $usejournal,
                entries    => [],
                message    => $message,
                formdata   => {
                    selecttype => $post->{selecttype},
                    howmany    => $post->{howmany},
                    year       => $post->{year},
                    month      => $post->{month},
                    day        => $post->{day},
                    usejournal => $usejournal || '',
                },
            },
            { ml_scope => '/editjournal.bml' }
        );
    }

    return DW::Template->render_template(
        'editjournal.tt',
        {
            %$rv,
            self_uri   => $self_uri,
            usejournal => $usejournal,
            entries    => $entries,
            formdata   => {
                selecttype => $post->{selecttype},
                howmany    => $post->{howmany},
                year       => $post->{year},
                month      => $post->{month},
                day        => $post->{day},
                usejournal => $usejournal || '',
            },
        },
        { ml_scope => '/editjournal.bml' }
    );
}

sub _get_entries {
    my ( $u, $journal, $usejournal, $selector, $remote ) = @_;
    my %res;
    my %req = (
        mode       => 'getevents',
        ver        => $LJ::PROTOCOL_VER,
        user       => $u->user,
        usejournal => $usejournal,
        truncate   => 300,
        noprops    => 1,
        %$selector,
    );
    LJ::do_request( \%req, \%res, { noauth => 1, u => $u } );

    my @entries;
    if ( ( $res{success} || '' ) eq 'OK' ) {
        for my $i ( 1 .. ( $res{events_count} || 0 ) ) {
            my $ditemid = ( $res{"events_${i}_itemid"} << 8 ) + $res{"events_${i}_anum"};
            my $entry   = LJ::Entry->new( $journal, ditemid => $ditemid );
            my $summary = '';
            $summary = $entry->event_html_summary(300)
                if $entry && $entry->valid && $entry->visible_to($remote);

            my $subject = $res{"events_${i}_subject"} || '';
            LJ::CleanHTML::clean_subject_all( \$subject ) if length $subject;
            push @entries,
                {
                ditemid   => $ditemid,
                eventtime => $res{"events_${i}_eventtime"},
                poster    => LJ::load_user( $res{"events_${i}_poster"} ),
                subject   => $subject,
                summary   => length $summary ? $summary : undef,
                html_only => length $summary ? 0 : 1,
                security  => _security_kind( \%res, $i ),
                };
        }
    }

    return wantarray ? ( \@entries, \%res ) : \@entries;
}

sub _security_kind {
    my ( $res, $i ) = @_;
    my $security = $res->{"events_${i}_security"} || '';
    return 'private' if $security eq 'private';
    return undef unless $security eq 'usemask';
    my $mask = $res->{"events_${i}_allowmask"} || 0;
    return 'private' if $mask == 0;
    return 'groups'  if $mask > 1;
    return 'protected';
}

1;

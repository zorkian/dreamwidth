#!/usr/bin/perl
#
# DW::Task::IncomingEmail
#
# Worker for processing incoming emails (post-by-email and support requests).
#
# Authors:
#     Mark Smith <mark@dreamwidth.org>
#
# Copyright (c) 2009-2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself.  For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.
#

package DW::Task::IncomingEmail;

use strict;
use v5.10;
use Log::Log4perl;
my $log = Log::Log4perl->get_logger(__PACKAGE__);

use MIME::Parser;
use File::Temp ();
use File::Path ();
use Mail::Address;
use Unicode::MapUTF8;

use DW::BlobStore;
use DW::EmailPost;
use LJ::Support;
use LJ::Sysban;

use base 'DW::Task';

sub work {
    my ( $self, $handle ) = @_;

    my $arg = $self->args->[0];

    my $tmpdir = File::Temp::tempdir();
    die "No tempdir made?" unless -d $tmpdir && -w $tmpdir;

    # Ensure cleanup
    my $cleanup = sub { File::Path::rmtree($tmpdir) if -d $tmpdir };

    my $parser = MIME::Parser->new;
    $parser->output_dir($tmpdir);

    my $entity;
    if ( $arg =~ /^ie:.+$/ ) {
        my $email = DW::BlobStore->retrieve( temp => $arg );
        unless ($email) {
            $log->error("Can't retrieve from BlobStore: $arg");
            $cleanup->();
            return DW::Task::COMPLETED;
        }
        $entity = eval { $parser->parse_data($$email) };
    }
    else {
        $entity = eval { $parser->parse_data($arg) };
    }
    if ($@) {
        $log->error("Can't parse MIME: $@");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    my $head = $entity->head;
    $head->unfold;

    my $subject = $head->get('Subject');
    chomp $subject;
    $subject = LJ::trim($subject);

    # simple/effective spam/bounce/virus checks
    if ( $head->get("Return-Path") =~ /^\s*<>\s*$/ ) {
        $log->debug("Bounce");
        $cleanup->();
        return DW::Task::COMPLETED;
    }
    if ( _subject_is_bogus($subject) ) {
        $log->debug("Spam (subject)");
        $cleanup->();
        return DW::Task::COMPLETED;
    }
    if ( _virus_check($entity) ) {
        $log->debug("Virus found");
        $cleanup->();
        return DW::Task::COMPLETED;
    }
    if ( $subject && $subject =~ /^\[SPAM: \d+\.?\d*\]/ ) {
        $log->debug("Spam (tagged)");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    # see if a hook is registered to handle this message
    if ( LJ::Hooks::are_hooks("incoming_email_handler") ) {
        my $errmsg = "";
        my $retry  = 0;

        my $rv = LJ::Hooks::run_hook(
            "incoming_email_handler",
            entity => $entity,
            errmsg => \$errmsg,
            retry  => \$retry
        );

        if ($rv) {
            if ($retry) {
                $log->warn("Hook retry: $errmsg");
                $cleanup->();
                return DW::Task::FAILED;
            }
            if ($errmsg) {
                $log->error("Hook failure: $errmsg");
                $cleanup->();
                return DW::Task::COMPLETED;
            }
            $cleanup->();
            return DW::Task::COMPLETED;
        }
    }

    # see if it's a post-by-email
    my $email_post = DW::EmailPost->get_handler($entity);
    if ($email_post) {
        my ( $ok, $status_msg ) = $email_post->process;

        if ($ok) {
            $cleanup->();
            return DW::Task::COMPLETED;
        }

        if ( $email_post->dequeue ) {
            $log->error("EmailPost permanent failure: $status_msg");
            $cleanup->();
            return DW::Task::COMPLETED;
        }
        else {
            $log->warn("EmailPost retry: $status_msg");
            $cleanup->();
            return DW::Task::FAILED;
        }
    }

    # stop more spam, based on body text checks
    my $tent = DW::EmailPost->get_entity( $entity, 'text' );
    $tent ||= DW::EmailPost->get_entity( $entity, 'html' );
    unless ($tent) {
        $log->error("Can't find text or html entity");
        $cleanup->();
        return DW::Task::COMPLETED;
    }
    my $body = $tent->bodyhandle->as_string;
    $body = LJ::trim($body);

    if (   $body =~ /I send you this file in order to have your advice/i
        || $body =~ /^Content-Type: application\/octet-stream/i
        || $body =~ /^(Please see|See) the attached file for details\.?$/i
        || $body =~ /^I apologize for this automatic reply to your email/i )
    {
        $log->debug("Spam (body)");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    # From this point on we know it's a support request of some type
    my $email2cat = LJ::Support::load_email_to_cat_map();

    my $to;
    my $toarg;
    foreach my $a (
        Mail::Address->parse( $head->get('To') ),
        Mail::Address->parse( $head->get('Cc') )
        )
    {
        my $address = $a->address;
        my $targ;
        if ( $address =~ /^(.+)\+(.*)\@(.+)$/ ) {
            ( $address, $targ ) = ( lc "$1\@$3", $2 );
        }
        if ( defined $LJ::ALIAS_TO_SUPPORTCAT{$address} ) {
            $address = $LJ::ALIAS_TO_SUPPORTCAT{$address};
        }
        if ( defined $email2cat->{$address} ) {
            $to    = $address;
            $toarg = $targ;
        }
    }

    unless ($to) {
        $log->debug("Not deliverable to support system (no match To:)");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    my $adf = ( Mail::Address->parse( $head->get('From') ) )[0];
    unless ($adf) {
        $log->debug("Bogus From: header");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    my $name = $adf->name;
    my $from = $adf->address;
    $subject ||= "(No Subject)";

    # is this a reply to another post?
    if ( $toarg =~ /^(\d+)z(.+)$/ ) {
        my $spid     = $1;
        my $miniauth = $2;
        my $sp       = LJ::Support::load_request($spid);

        LJ::Support::mini_auth($sp) eq $miniauth
            or die "Invalid authentication?";

        if ( LJ::sysban_check( 'support_email', $from ) ) {
            my $msg = "Support request blocked based on email.";
            LJ::Sysban::block( 0, $msg, { 'email' => $from } );
            $log->debug($msg);
            $cleanup->();
            return DW::Task::COMPLETED;
        }

        if ( LJ::Support::is_locked($sp) ) {
            $log->debug("Request is locked, can't append comment.");
            $cleanup->();
            return DW::Task::COMPLETED;
        }

        # valid. strip out stuff with authcodes
        $body =~ s!https?://.+/support/act\S+![snipped]!g;
        $body =~ s!\+(\d)+z\w{1,10}\@!\@!g;
        $body =~ s!&auth=\S+!!g;

        # try to get rid of reply stuff
        $body =~ s!(\S+.*?)-{4,10} Original Message -{4,10}.+!$1!s;
        $body =~ s!(\S+.*?)\bOn [^\n]+ wrote:\n.+!$1!s;

        my $splid = LJ::Support::append_request(
            $sp,
            {
                'type' => 'comment',
                'body' => $body,
            }
        );
        unless ($splid) {
            $log->error("Error appending request");
            $cleanup->();
            return DW::Task::COMPLETED;
        }

        LJ::Support::add_email_address( $sp, $from );
        LJ::Support::touch_request($spid);

        $cleanup->();
        return DW::Task::COMPLETED;
    }

    # Check if we want to ignore and bounce this email
    my ( $content_file, $content );
    if ( %LJ::DENY_REQUEST_FROM_EMAIL && $LJ::DENY_REQUEST_FROM_EMAIL{$to} ) {
        $content_file = $LJ::DENY_REQUEST_FROM_EMAIL{$to};
        $content      = LJ::load_include($content_file);
    }
    if ( $content_file && $content ) {
        my $bounce_body = <<EMAIL_END;
$content

Your original message:

$body
EMAIL_END

        LJ::send_mail(
            {
                'to'      => $from,
                'from'    => $LJ::BOGUS_EMAIL,
                'subject' => "Your Email to $to",
                'body'    => $bounce_body,
                'wrap'    => 1,
            }
        );

        $cleanup->();
        return DW::Task::COMPLETED;
    }

    # make a new post
    my @errors;

    # convert email body to utf-8
    my $content_type = $head->get('Content-type:');
    if ( $content_type =~ /\bcharset=[\'\"]?(\S+?)[\'\"]?[\s\;]/i ) {
        my $charset = $1;
        if (   defined $charset
            && $charset !~ /^UTF-?8$/i
            && Unicode::MapUTF8::utf8_supported_charset($charset) )
        {
            $body =
                Unicode::MapUTF8::to_utf8( { -string => $body, -charset => $charset } );
        }
    }

    my $spid = LJ::Support::file_request(
        \@errors,
        {
            'spcatid'  => $email2cat->{$to}->{'spcatid'},
            'subject'  => $subject,
            'reqtype'  => 'email',
            'reqname'  => $name,
            'reqemail' => $from,
            'body'     => $body,
        }
    );

    if (@errors) {
        $log->error("Support errors: @errors");
        $cleanup->();
        return DW::Task::COMPLETED;
    }

    $cleanup->();
    return DW::Task::COMPLETED;
}

sub _virus_check {
    my $entity = shift;
    return unless $entity;

    my @exe = DW::EmailPost->get_entity( $entity, 'all' );
    return unless scalar @exe;

    my @virus_sigs = qw(
        TVqQAAMAA TVpQAAIAA TVpAALQAc TVpyAXkAX TVrmAU4AA
        TVrhARwAk TVoFAQUAA TVoAAAQAA TVoIARMAA TVouARsAA
        TVrQAT8AA UEsDBBQAA UEsDBAoAAA
        R0lGODlhaAA7APcAAP///+rp6puSp6GZrDUjUUc6Zn53mFJMdbGvvVtXh2xre8bF1x8cU4yLprOy
    );

    my $maxlength =
        length( ( sort { length $b <=> length $a } @virus_sigs )[0] );
    $maxlength = 1024 if $maxlength >= 1024;

    foreach my $part (@exe) {
        my $contents = $part->stringify_body;
        $contents = substr $contents, 0, $maxlength;

        foreach (@virus_sigs) {
            return 1 if index( $contents, $_ ) == 0;
        }
    }

    return;
}

sub _subject_is_bogus {
    my $subject = shift;
    return $subject =~ /auto.?(response|reply)/i
        || $subject =~
        /^(Undelive|Mail System Error - |ScanMail Message: |\+\s*SPAM|Norton AntiVirus)/i
        || $subject =~ /^(Mail Delivery Problem|Mail delivery failed)/i
        || $subject =~ /^failure notice$/i
        || $subject =~ /\[BOUNCED SPAM\]/i
        || $subject =~ /^Symantec AVF /i
        || $subject =~ /Attachment block message/i
        || $subject =~ /Use this patch immediately/i
        || $subject =~ /^YOUR PAYPAL\.COM ACCOUNT EXPIRES/i
        || $subject =~ /^don\'t be late! ([\w\-]{1,25})$/i
        || $subject =~ /^your account ([\w\-]{1,25})$/i
        || $subject =~ /Message Undeliverable/i;
}

1;

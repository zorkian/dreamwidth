#!/usr/bin/perl
#
# export-config.pl
#
# Print the site configuration the journal server needs as JSON.
#
# Authors:
#      Dreamwidth contributors
#
# Copyright (c) 2026 by Dreamwidth Studios, LLC.
#
# This program is free software; you may redistribute it and/or modify it under
# the same terms as Perl itself. For a copy of the license, please reference
# 'perldoc perlartistic' or 'perldoc perlgpl'.

use strict;
use warnings;
BEGIN { require "$ENV{LJHOME}/cgi-bin/ljlib.pl"; }
use JSON;
use DW::Captcha;
use DW::Formats;
use LJ::Talk;

my %databases;
for my $id ( keys %LJ::DBINFO ) {
    next if $id =~ /^_/;
    my $db = $LJ::DBINFO{$id};
    $databases{$id} = {
        host     => $db->{host},
        port     => $db->{port} ? $db->{port} + 0 : undef,
        socket   => $db->{sock},
        user     => $db->{user},
        password => $db->{pass},
        database => $db->{dbname} || 'livejournal',
        roles    => [ sort grep { $db->{role}{$_} } keys %{ $db->{role} || {} } ],
    };
}

# LJ::Img's standard images, with alt text translated as Image_std does.
my %images;
for my $name ( keys %LJ::Img::img ) {
    my $img = $LJ::Img::img{$name};
    $images{$name} = {
        src    => $img->{src},
        width  => $img->{width} + 0,
        height => $img->{height} + 0,
        alt    => $img->{alt} ? LJ::Lang::ml( $img->{alt} ) : '',
    };
}

# Site text the journal pages use, in the default language.
my %strings;
my $dbr = LJ::get_db_reader();
for my $prefix (qw( userlinkbar. talk.curname_ s2theme. web.controlstrip.status. poll. /journal/talkform.tt. contentflag. )) {
    my $keys = $dbr->selectcol_arrayref(
        "SELECT itcode FROM ml_items WHERE dmid = 1 AND itcode LIKE ?",
        undef, "$prefix%" );
    $strings{$_} = LJ::Lang::ml($_) for @$keys;
}
$strings{$_} = LJ::Lang::ml($_)
    for ( map { "widget.cuttag.$_" } qw( collapsed expanded collapseAll expandAll ) ),
    qw( Username Password talk.btn.preview talk.error.quickquote markup.helplink.url markup.helplink.alttext );

# What LJ::Talk::talkform shows every visitor: subject icons (as HTML with a
# %s for extra attributes) and the formatting choices.
my $icons = LJ::Talk::get_subjecticons();
my @subjecticons =
    map { { id => $_, html => LJ::Talk::print_subjecticon_by_id( $_, '%s' ) } }
    ( 'none', map { $_->{id} } @{ $icons->{lists}{sm} }, @{ $icons->{lists}{md} } );
my $editors = DW::Formats::select_items( current => undef, preferred => '' );

print JSON->new->canonical->pretty->encode(
    {
        databases          => \%databases,
        clusterPairActive  => \%LJ::CLUSTER_PAIR_ACTIVE,
        defaultStyle       => $LJ::DEFAULT_STYLE,
        defaultFeedStyle   => $LJ::DEFAULT_FEED_STYLE || {},
        home               => $LJ::HOME,
        siteRoot           => $LJ::SITEROOT,
        protocol           => $LJ::PROTOCOL,
        domain             => $LJ::DOMAIN,
        domainWeb          => $LJ::DOMAIN_WEB,
        userDomain         => $LJ::USER_DOMAIN,
        embedModuleDomain  => $LJ::EMBED_MODULE_DOMAIN // '',
        trustedCssHosts    => [ sort keys %LJ::TRUSTED_CSS_HOST ],
        cssProxy           => $LJ::CSSPROXY,
        cssCleaner         => LJ::is_enabled('css_cleaner') ? JSON::true : JSON::false,
        subdomainRules     => $LJ::SUBDOMAIN_RULES,
        isDevServer        => $LJ::IS_DEV_SERVER ? JSON::true : JSON::false,
        siteName           => $LJ::SITENAME,
        siteNameShort      => $LJ::SITENAMESHORT,
        siteNameAbbrev     => $LJ::SITENAMEABBREV,
        imgPrefix          => $LJ::IMGPREFIX,
        statPrefix         => $LJ::STATPREFIX,
        jsPrefix           => $LJ::JSPREFIX,
        userpicRoot        => $LJ::USERPIC_ROOT,
        palImgRoot         => $LJ::PALIMGROOT,
        maxScrollback      => $LJ::MAX_SCROLLBACK_LASTN + 0,
        tagIntersection    => $LJ::TAG_INTERSECTION + 0,
        maxIconsPerPage    => $LJ::MAX_ICONS_PER_PAGE + 0,
        maxFriendsViewAge  => ( $LJ::MAX_FRIENDS_VIEW_AGE || 3600 * 24 * 14 ) + 0,
        maxScrollbackFriends => ( $LJ::MAX_SCROLLBACK_FRIENDS || 1000 ) + 0,
        talkPageSize       => ( $LJ::TALK_PAGE_SIZE || 25 ) + 0,
        talkMaxSubjects    => ( $LJ::TALK_MAX_SUBJECTS || 200 ) + 0,
        talkThreadPoint    => ( $LJ::TALK_THREAD_POINT || 50 ) + 0,
        images             => \%images,
        strings            => \%strings,
        capBits            => \%LJ::CAP,
        talkform           => {
            subjecticons   => \@subjecticons,
            editors        => $editors,
            captcha        => DW::Captcha->site_enabled ? JSON::true : JSON::false,
            maxlengthUser  => $LJ::USERNAME_MAXLENGTH + 0,
            maxlengthPass  => $LJ::PASSWORD_MAXLENGTH + 0,
        },
        # Snippets styles may print with Page::print_trusted; code values are called once here.
        trustedS2 => { map { $_ => '' . LJ::conf_test( $LJ::TRUSTED_S2_WHITELIST{$_} ) } keys %LJ::TRUSTED_S2_WHITELIST },
        trustedS2Usernames => [ sort keys %LJ::TRUSTED_S2_WHITELIST_USERNAMES ],
        capDefaults        => \%LJ::CAP_DEF,
        enabled => { map { $_ => LJ::is_enabled($_) ? JSON::true : JSON::false } qw( tags security_filter esn_ajax embed_module inbox_update_poll adult_content ) },
        robotBlockingContent => LJ::is_enabled('adult_content')
        ? [ sort grep { $LJ::CONTENT_FLAGS{$_}{block_robots} } keys %LJ::CONTENT_FLAGS ]
        : [],
    }
);

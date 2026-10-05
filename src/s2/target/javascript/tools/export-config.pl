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
use DW::Countries;
use DW::Formats;
use DW::Logic::MenuNav;
use DW::Routing;
use DW::SiteScheme;
use LJ::Hooks;
use LJ::Session;
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
for my $prefix (
    qw( userlinkbar. talk.curname_ s2theme. web.controlstrip.status. poll. /journal/talkform.tt. contentflag. ),
    qw( sitescheme. menunav. widget.search. tropo. error /error/ /journal/deleted.tt. /components/login.tt. ),
    qw( web.controlstrip.login. cprod.friendsfriendsinline. lynx.nav. label.security. /journal/security.tt. ),
    qw( /login.tt. captcha.accessibility. /profile/main.tt. /profile/logic.tt. lastupdated. time.ago. date.month. ),
    qw( statusvis_message. entryform.security number.punctuation profile.service. /legal/ /site/ /misc/about.tt. ),
    qw( /doc/s2/ /support/faq.tt. /support/faqbrowse.tt. cc.imgalt )
    )
{
    my $keys = $dbr->selectcol_arrayref(
        "SELECT itcode FROM ml_items WHERE dmid = 1 AND itcode LIKE ?",
        undef, "$prefix%" );
    $strings{$_} = LJ::Lang::ml($_) for @$keys;
}
$strings{$_} = LJ::Lang::ml($_)
    for ( map { "widget.cuttag.$_" } qw( collapsed expanded collapseAll expandAll ) ),
    qw( Username Password talk.btn.preview talk.error.quickquote markup.helplink.url markup.helplink.alttext ),
    qw( setting.xpost.option.footer.vars.comment_image.alt );

# What LJ::Talk::talkform shows every visitor: subject icons (as HTML with a
# %s for extra attributes) and the formatting choices.
my $icons = LJ::Talk::get_subjecticons();
my @subjecticons =
    map { { id => $_, html => LJ::Talk::print_subjecticon_by_id( $_, '%s' ) } }
    ( 'none', map { $_->{id} } @{ $icons->{lists}{sm} }, @{ $icons->{lists}{md} } );
my $editors = DW::Formats::select_items( current => undef, preferred => '' );

# Site schemes by name, as DW::SiteScheme->get accepts them: every scheme
# file that names a known scheme.
my @scheme_dirs = LJ::get_all_directories('schemes');
my %schemes;
for my $name ( map { m!/([^/_][^/]*)\.tt$! ? $1 : () } map { glob "$_/*.tt" } @scheme_dirs ) {
    next unless DW::SiteScheme->get($name)->name eq $name;
    $schemes{$name} = [ DW::SiteScheme->inheritance($name) ];
}

# The site menu a logged-out visitor sees.
my @menu = map {
    {
        name  => $_->{name},
        items => [
            map { { url => $_->{url}, text => $_->{text}, text_opts => $_->{text_opts} // {} } }
            grep { $_->{display} } @{ $_->{items} }
        ]
    }
} @{ DW::Logic::MenuNav->get_menu_navigation(undef) };

# Paths DW::Controller::Journal gives to DW::Routing's user controllers
# before the journal views, with any .format suffix removed.
my @route_patterns = map {
    "$_->{regex}" =~ /^\(\?\^([ims]*):(.*)\)\z/s
        or die "Cannot export route $_->{regex}\n";
    { source => $2, flags => $1 }
} @{ $DW::Routing::regex_choices{user} };

my $trusted_proxy_is_code = do { no warnings 'once'; ref $LJ::IS_TRUSTED_PROXY eq 'CODE' };

print JSON->new->canonical->pretty->encode(
    {
        databases          => \%databases,
        clusterPairActive  => \%LJ::CLUSTER_PAIR_ACTIVE,
        clusters           => [ map { $_ + 0 } @LJ::CLUSTERS ],
        defaultStyle       => $LJ::DEFAULT_STYLE,
        defaultFeedStyle   => $LJ::DEFAULT_FEED_STYLE || {},
        home               => $LJ::HOME,
        # Where LJ::_file_modtime finds static files, for resource versions.
        staticDocs         => $LJ::STATDOCS // "$LJ::HOME/htdocs",
        siteRoot           => $LJ::SITEROOT,
        protocol           => $LJ::PROTOCOL,
        domain             => $LJ::DOMAIN,
        domainWeb          => $LJ::DOMAIN_WEB,
        userDomain         => $LJ::USER_DOMAIN,
        # Subdomains that are not journals; "journal" ones name the journal in the path.
        subdomainFunction  => { map { $_ => ref $LJ::SUBDOMAIN_FUNCTION{$_} ? 'other' : $LJ::SUBDOMAIN_FUNCTION{$_} }
            keys %LJ::SUBDOMAIN_FUNCTION },
        embedModuleDomain  => $LJ::EMBED_MODULE_DOMAIN // '',
        trustedCssHosts    => [ sort keys %LJ::TRUSTED_CSS_HOST ],
        cssProxy           => $LJ::CSSPROXY,
        cssCleaner         => LJ::is_enabled('css_cleaner') ? JSON::true : JSON::false,
        subdomainRules     => $LJ::SUBDOMAIN_RULES,
        isDevServer        => $LJ::IS_DEV_SERVER ? JSON::true : JSON::false,
        siteName           => $LJ::SITENAME,
        siteNameShort      => $LJ::SITENAMESHORT,
        siteNameAbbrev     => $LJ::SITENAMEABBREV,
        # Whether accounts may have a site email alias.
        userEmail          => $LJ::USER_EMAIL ? JSON::true : JSON::false,
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
        # For the site's own Template Toolkit pages: DW::Template's engines and site constants.
        siteTemplates => {
            views         => [ LJ::get_all_directories('views') ],
            schemes       => \@scheme_dirs,
            schemeList    => \%schemes,
            defaultScheme => DW::SiteScheme->default,
            menu          => \@menu,
            shopRoot      => $LJ::SHOPROOT,
            isCanary      => $LJ::IS_CANARY ? JSON::true : JSON::false,
            constants     => {
                name           => $LJ::SITENAME,
                nameshort      => $LJ::SITENAMESHORT,
                nameabbrev     => $LJ::SITENAMEABBREV,
                company        => $LJ::SITECOMPANY,
                address        => $LJ::SITEADDRESS,
                addressline    => $LJ::SITEADDRESSLINE,
                domain         => $LJ::DOMAIN,
                domainweb      => $LJ::DOMAIN_WEB,
                help           => \%LJ::HELPURL,
                email          => { abuse => $LJ::ABUSE_EMAIL, coppa => $LJ::COPPA_EMAIL, privacy => $LJ::PRIVACY_EMAIL },
                maxlength_user => $LJ::USERNAME_MAXLENGTH,
                maxlength_pass => $LJ::PASSWORD_MAXLENGTH,
            },
        },
        strings            => \%strings,
        capBits            => \%LJ::CAP,
        talkform           => {
            subjecticons   => \@subjecticons,
            editors        => $editors,
            captcha        => DW::Captcha->site_enabled ? JSON::true : JSON::false,
            # The implementation DW::Captcha->new picks, and what hCaptcha's widget shows.
            captchaType     => DW::Captcha->site_enabled ? DW::Captcha->new->name : '',
            hcaptchaSitekey => $LJ::CAPTCHA_HCAPTCHA_SITEKEY // '',
            supportEmail    => $LJ::SUPPORT_EMAIL // '',
            maxlengthUser  => $LJ::USERNAME_MAXLENGTH + 0,
            maxlengthPass  => $LJ::PASSWORD_MAXLENGTH + 0,
        },
        # How Plack::Middleware::DW::XForwardedFor finds the client's address.
        remoteIp => {
            trustXHeaders       => $LJ::TRUST_X_HEADERS ? JSON::true : JSON::false,
            trustedProxyIsCode  => $trusted_proxy_is_code ? JSON::true : JSON::false,
        },
        # What LJ::Session->trusted_anon_user accepts in an ljtrust cookie.
        trustCookie => {
            generations => [ map { $_ // '' } $LJ::COOKIE_GEN, @LJ::COOKIE_GEN_OKAY ],
            maxAge      => LJ::Session::TRUST_COOKIE_MAX_AGE() + 0,
        },
        # Snippets styles may print with Page::print_trusted; code values are called once here.
        trustedS2 => { map { $_ => '' . LJ::conf_test( $LJ::TRUSTED_S2_WHITELIST{$_} ) } keys %LJ::TRUSTED_S2_WHITELIST },
        trustedS2Usernames => [ sort keys %LJ::TRUSTED_S2_WHITELIST_USERNAMES ],
        capDefaults        => \%LJ::CAP_DEF,
        enabled => {
            map { $_ => LJ::is_enabled($_) ? JSON::true : JSON::false }
                qw( tags security_filter esn_ajax embed_module inbox_update_poll adult_content infoshow_migrate ),
            qw( show-talkleft esn payments directory faq_summaries )
        },
        # The pages under /legal, as DW::Controller::Legal lists them.
        legalPages => do {
            my @pages = qw( tos privacy );
            LJ::Hooks::run_hook( 'modify_legal_index', \@pages );
            \@pages;
        },
        defaultLang => $LJ::DEFAULT_LANG,
        # $LJ::EXAMPLE_USER_ACCOUNT, whom the FAQs address anonymous visitors as.
        exampleUser => $LJ::EXAMPLE_USER_ACCOUNT // '',
        # $LJ::MERCH_URL
        merchUrl => $LJ::MERCH_URL // '',
        # Accounts whose profiles leave out their subscribers and members.
        forceEmptySubscriptions => [ map { $_ + 0 } keys %LJ::FORCE_EMPTY_SUBSCRIPTIONS ],
        # $LJ::MAX_WT_EDGES_LOAD
        maxWtEdgesLoad => ( $LJ::MAX_WT_EDGES_LOAD || 50000 ) + 0,
        # Country names by code, as DW::Countries->load_legacy gives them, and
        # the countries whose regions have names in the codes table.
        countries => do { my %c; DW::Countries->load_legacy( \%c ); \%c },
        countriesWithRegions => { map { $_ => $LJ::COUNTRIES_WITH_REGIONS{$_}{type} } keys %LJ::COUNTRIES_WITH_REGIONS },
        userRoutes => {
            paths    => [ sort map { m!^user(/.*)! ? $1 : () } keys %DW::Routing::string_choices ],
            patterns => \@route_patterns,
        },
        # The site's own not-found page picks one of these for its title.
        notFoundQuips => \@DW::Controller::Dreamwidth::Misc::QUIPS,
        robotBlockingContent => LJ::is_enabled('adult_content')
        ? [ sort grep { $LJ::CONTENT_FLAGS{$_}{block_robots} } keys %LJ::CONTENT_FLAGS ]
        : [],
    }
);

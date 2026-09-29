// embed-whitelist.ts
//
// The sites trusted for iframe embeds: a port of DW::Hooks::EmbedWhitelist's
// allow_iframe_embeds hook.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

export interface EmbedCheck {
    readonly allow: boolean;
    readonly canHttps: boolean;
}

// The path each host embeds from, and whether the host supports https.
const HOST_PATH_MATCH = new Map<string, [RegExp, boolean]>([
    ["www.4shared.com", [/^\/web\/embed\/file\//, true]],
    ["8tracks.com", [/^\/mixes\//, false]],

    ["airtable.com", [/^\/embed\//, true]],
    ["archive.org", [/^\/embed\//, true]],
    ["audiomack.com", [/^\/embed\//, true]],

    ["bandcamp.com", [/^\/EmbeddedPlayer\//, true]],
    ["player.bilibili.com", [/^\/player.html$/, true]],
    ["blip.tv", [/^\/play\//, true]],
    ["percolate.blogtalkradio.com", [/^\/offsiteplayer$/, true]],
    ["app.box.com", [/^\/embed\/s\//, true]],

    ["chirb.it", [/^\/wp\//, true]],
    ["codepen.io", [/^\/enxaneta\/embed\//, true]],
    ["coub.com", [/^\/embed\//, true]],
    ["criticalcommons.org", [/^\/embed$/, true]],
    ["www.criticalcommons.org", [/\/embed_view$/, false]],

    ["www.dailymotion.com", [/^\/embed\/video\//, true]],
    ["diode.zone", [/^\/videos\/embed\/[0-9a-fA-F-]{36}/, true]],
    ["dotsub.com", [/^\/media\//, true]],
    ["discordapp.com", [/^\/widget$/, true]],

    ["episodecalendar.com", [/^\/icalendar\//, false]],

    ["www.flickr.com", [/\/player\/$/, true]],
    ["www.funnyordie.com", [/\/embed\//, true]],

    ["embed.gettyimages.com", [/^\/embed\//, true]],
    ["getyarn.io", [/^\/yarn-clip\/embed\/[0-9a-fA-F-]{36}/, true]],
    ["www.goodreads.com", [/^\/widgets\//, true]],
    ["giphy.com", [/^\/embed\/\w+/, true]],

    ["maps.google.com", [/^\/maps/, true]],
    ["www.google.com", [/^\/(calendar\/|maps\/embed)/, true]],
    ["calendar.google.com", [/^\/calendar\//, true]],

    // Drawings are images, and forms are not trusted.
    ["docs.google.com", [/^\/(document|spreadsheets?|presentation)\//, true]],
    ["books.google.com", [/^\/ngrams\//, true]],
    ["drive.google.com", [/^\/file\/d\/[a-zA-Z0-9]+\/preview$/, true]],
    ["player.gimletmedia.com", [/^\/\w+$/, true]],

    ["imgur.com", [/^\/a\/.+?\/embed/, true]],
    ["instagram.com", [/^\/p\/.*\/embed\/$/, true]],
    ["www.imdb.com", [/^\/videoembed\/\w+$/, false]],

    ["jsfiddle.net", [/\/embedded\/$/, true]],

    ["www.kickstarter.com", [/\/widget\/[a-zA-Z]+\.html$/, true]],

    ["html5-player.libsyn.com", [/^\/embed\//, true]],
    ["lichess.org", [/\/study\/embed\//, true]],
    ["www.loc.gov", [/\/item\/[a-z0-9]+\/$/, true]],

    ["makertube.net", [/^\/videos\/embed\/[0-9a-fA-F-]{36}/, true]],
    ["mega.nz", [/^\/embed\//, true]],
    ["www.mixcloud.com", [/^\/widget\/iframe\/$/, true]],
    ["mixstep.co", [/^\/embed\//, true]],
    ["www.msnbc.com", [/^\/msnbc\/embedded-video\/\w+/, true]],
    ["my.mail.ru", [/^\/video\/embed\/\d+/, true]],

    ["nekocap.com", [/^\/view\/[a-zA-Z0-9]+$/, true]],
    ["ext.nicovideo.jp", [/^\/thumb\//, false]],
    ["noisetrade.com", [/^\/service\/widgetv2\//, true]],
    ["www.npr.org", [/^\/templates\/event\/embeddedVideo\.php/, true]],

    ["onedrive.live.com", [/^\/embed$/, true]],

    ["player.pbs.org", [/^\/viralplayer\/[0-9]+/, true]],
    ["playmoss.com", [/^\/embed\//, true]],
    ["www.plurk.com", [/^\/getWidget$/, true]],
    ["pastebin.com", [/^\/embed_iframe\/\w+$/, true]],
    ["podomatic.com", [/^\/embed\/html5\/episode\/\d*/, true]],

    ["www.random.org", [/^\/widgets\/integers\/iframe.php$/, true]],
    ["www.redditmedia.com", [/^\/r\/\w+\/comments\/\w+\/\w+\/$/, true]],
    ["www.reverbnation.com", [/^\/widget_code\/html_widget\/artist_\d+$/, true]],
    ["rumble.com", [/^\/embed\/[a-zA-Z0-9]+\/$/, true]],
    ["rutube.ru", [/^\/play\/embed\/[0-9]+$/, true]],

    // The language before /player may vary.
    ["www.sbs.com.au", [/\/player\/embed\//, false]],
    ["scratch.mit.edu", [/^\/projects\/embed\//, true]],
    ["www.scribd.com", [/^\/embeds\//, true]],
    ["www.slideshare.net", [/^\/slideshow\/embed_code\//, true]],
    ["api.smugmug.com", [/^\/services\/embed\/\w+$/, true]],
    ["w.soundcloud.com", [/^\/player\//, true]],
    ["embed.spotify.com", [/^\/$/, true]],
    ["open.spotify.com", [/^\/($)|(embed\/[/\w]+)/, true]],
    ["www.strava.com", [/^\/activities\/\d+\/embed\/\w+$/, true]],
    ["streamable.com", [/^\/[eos]\//, true]],

    ["embed.ted.com", [/^\/talks\//, true]],

    ["vid.me", [/^\/e\//, true]],
    ["player.vimeo.com", [/^\/video\/\d+$/, true]],
    ["vine.co", [/^\/v\/[a-zA-Z0-9]{11}\/embed\/simple$/, true]],

    ["vk.com", [/^\/video_ext\.php$/, true]],

    ["fast.wistia.com", [/^\/embed\/iframe\/\w+$/, true]],

    ["video.yandex.ru", [/^\/iframe\/[-\w]+\/[a-z0-9]+\.\d{4}\/?$/, true]],

    ["www.zippcast.com", [/^\/videoview\.php$/, false]],
]);

// The parts of a URL that Perl's URI module returns.
interface Uri {
    host: string | undefined;
    path: string;
    query: string | undefined;
    fragment: string | undefined;
}

const matchSubdomain = (domain: string, host: string | undefined) =>
    new RegExp(`^(?:[\\w.-]*\\.)?${domain.replaceAll(".", "\\.")}$`).test(host ?? "");

// Sites whose embeds are recognized by more than the host and path; these
// all support https.
const COMPLEX_MATCH: ((uri: Uri) => boolean)[] = [
    uri => (matchSubdomain("youtube.com", uri.host) || matchSubdomain("youtube-nocookie.com", uri.host)) &&
        /^\/embed\/[-_a-zA-Z0-9]{11,}$/.test(uri.path),
    uri => uri.host === "commons.wikimedia.org" && /^\/wiki\/File:/.test(uri.path) &&
        /embedplayer=yes/.test(uri.query ?? ""),
    uri => uri.host === "i.cdn.turner.com" && /\/cnn_\d+x\d+_embed.swf$/.test(uri.path) &&
        /^context=embed&videoId=/.test(uri.query ?? ""),
    uri => uri.host === "player.theplatform.com" && uri.path.includes("MSNBCEmbeddedOffSite") &&
        /^guid=/.test(uri.query ?? ""),
    uri => uri.host === "www.facebook.com" && uri.path === "/plugins/video.php" &&
        /^(height=\d+&)?href=https%3A%2F%2Fwww.facebook.com%2F[^%]+%2Fvideos%2F/.test(uri.query ?? ""),
    uri => uri.host === "www.jigsawplanet.com" && /rc=play/.test(uri.query ?? ""),
    uri => uri.host === "screen.yahoo.com" && /format=embed/.test(uri.query ?? ""),
    uri => matchSubdomain("livejournal.com", uri.host) && /^\/\d+\.html$/.test(uri.path) &&
        /embed/.test(uri.query ?? ""),
    uri => uri.host === "music.yandex.ru" && /track\/\d+\/\d+/.test(uri.fragment ?? ""),
    uri => uri.host === "player.twitch.tv" && /video=v\d+/.test(uri.query ?? ""),
];

const URIC = /[^;/?:@&=+$,[\]A-Za-z0-9\-_.!~*'()%#]/gu;
const bytes = new TextEncoder();

// URI->new for an http or https URL: the scheme, and the parts of the URL
// once characters URI does not allow are escaped. The host is not lowercased.
function parseUri(url: string): { scheme: string | undefined } & Uri {
    url = url.replace(/^<(?:URL:)?(.*)>$/, "$1").replace(/^"(.*)"$/, "$1").replace(/^\s+/, "").replace(/\s+$/, "");
    url = url.replace(URIC, c =>
        [...bytes.encode(c)].map(b => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join(""));
    const authority = /^(?:[a-zA-Z][a-zA-Z0-9.+-]*:)?(?:\/\/([^/?#]*))?/.exec(url)![1];
    return {
        scheme: /^([a-zA-Z][a-zA-Z0-9.+-]*):/.exec(url)?.[1]?.toLowerCase(),
        host: authority?.replace(/^.*@/s, "").replace(/:\d+$/, "").replace(/^\[(.*)\]$/s, "$1")
            .replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
        path: /^(?:[^:/?#]+:)?(?:\/\/[^/?#]*)?([^?#]*)/.exec(url)![1]!,
        query: /^[^?#]*(?:\?([^#]*))?/.exec(url)![1],
        fragment: /#(.*)/s.exec(url)?.[1],
    };
}

// DW::Hooks::EmbedWhitelist's allow_iframe_embeds: whether an iframe may
// embed this URL, and whether its host supports https.
export function checkIframeEmbed(src: string | undefined): EmbedCheck {
    const denied = { allow: false, canHttps: false };
    if (!src) return denied;
    if (src.startsWith("//")) src = "http:" + src;
    const uri = parseUri(src);
    if (uri.scheme !== "http" && uri.scheme !== "https") return denied;

    const details = HOST_PATH_MATCH.get(uri.host ?? "");
    if (details && details[0].test(uri.path)) return { allow: true, canHttps: details[1] };
    if (COMPLEX_MATCH.some(match => match(uri))) return { allow: true, canHttps: true };
    return denied;
}

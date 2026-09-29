// embed.test.ts
//
// Embedded media and the iframe whitelist, from t/cleaner-embed.t and
// t/embed-whitelist.t.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIframeEmbed } from "../embed-whitelist";
import { cleanEmbed } from "../index";
import { site } from "./site";

const embed = (text: string) => cleanEmbed(text, site);
const id = "ABC123abc-_";
const youtube = `http://www.youtube.com/embed/${id}`;

// An old-style flash embed, with allowscriptaccess spelled as given.
const flash = (movie: string, param: string, access: string) =>
    `<object width="640" height="385"><param name="movie" value="${movie}"></param>` +
    `<param name="allowFullScreen" value="true"></param><param name="${param}" value="${access}"></param>` +
    `<embed src="${movie}" type="application/x-shockwave-flash" allowscriptaccess="${access}" ` +
    `allowfullscreen="true" width="640" height="385"></embed></object>`;

test("objects and embeds are kept", () => {
    assert.equal(embed(""), "");
    assert.equal(embed("<object></object>"), "<object></object>");
    for (const html of ["<object width=\"100%\" height=\"100%\"></object>", "<object>bar</object>",
        "<embed>bar</embed>", "<embed>blah"]) assert.equal(embed(html), html);
});

test("script access is limited to the same domain unless it is never allowed", () => {
    const video = "http://www.example.com/video";
    assert.equal(embed(flash(video, "allowScrIpTaccess", "always").replace("allowscriptaccess=", "allowScrIptAccess=")),
        flash(video, "allowScrIpTaccess", "sameDomain"));
    assert.equal(embed(flash(video, "allowscriptaccess", "always")), flash(video, "allowscriptaccess", "sameDomain"));
    assert.equal(embed(flash(video, "allowscriptaccess", "never")), flash(video, "allowscriptaccess", "never"));
    const old = `http://www.youtube.com/v/${id}?fs=1&amp;hl=en_US`;
    assert.equal(embed(flash(old, "allowscriptaccess", "always")), flash(old, "allowscriptaccess", "sameDomain"));
});

test("object data and scripts are dropped", () => {
    assert.equal(embed("<object width=\"123\" data=\"abc\" height=\"456\"></object>"),
        "<object width=\"123\" height=\"456\"></object>");
    assert.equal(embed("<object><script>bar</script></object>"), "<object></object>");
});

test("only iframes from trusted sites are kept", () => {
    for (const src of ["http://example.com/randompage", "http://www.youtube.com/", "http://www.youtube.com/embed/123",
        `http://www.not-youtube.com/embed/${id}`]) assert.equal(embed(`<iframe src="${src}"></iframe>`), "", src);
    assert.equal(embed("<iframe>bar</iframe>"), "");
    for (const src of [youtube, `http://youtube.com/embed/${id}`, `http://abc.youtube.com/embed/${id}`]) {
        assert.equal(embed(`<iframe src="${src}"></iframe>`), `<iframe src="${src}"></iframe>`, src);
    }
    assert.equal(embed(`<iframe src="http://youtube.com/embed/${id}"></iframe> ` +
        `<iframe src="http://www.not-youtube.com/embed/${id}"></iframe>`),
    `<iframe src="http://youtube.com/embed/${id}"></iframe> `);
    assert.equal(embed(`<iframe src="http://not-youtube.com/embed/${id}" />end`), "end");
});

test("a trusted iframe's contents are text", () => {
    assert.equal(embed(`<iframe src="${youtube}"><iframe src="http://not-youtube.com/embed/${id}"></iframe></iframe>`),
        `<iframe src="${youtube}">&lt;iframe src="http://not-youtube.com/embed/${id}"&gt;</iframe>`);
    assert.equal(embed(`<iframe src="${youtube}"><script type="text/javascript">alert("hi");</script></iframe>`),
        `<iframe src="${youtube}">&lt;script type="text/javascript"&gt;alert("hi");&lt;/script&gt;</iframe>`);
    assert.equal(embed(`<iframe src="${youtube}"><style type="text/css">alert(document["coo"+"kies"])</style></iframe>`),
        `<iframe src="${youtube}">&lt;style type="text/css"&gt;alert(document["coo"+"kies"])&lt;/style&gt;</iframe>`);
});

test("a trusted iframe's attributes are cleaned", () => {
    for (const attr of ["onload=\"alert('hi!');\"", "style=\"javascript:alert('hi')\"", "style=\"position: absolute;\""]) {
        assert.equal(embed(`<iframe src="${youtube}" height="100" ${attr} width="200"></iframe>`),
            `<iframe src="${youtube}" height="100" width="200"></iframe>`, attr);
    }
    assert.equal(embed(`<iframe src="${youtube}" name="thisname"></iframe>`), `<iframe src="${youtube}"></iframe>`);
    assert.equal(embed(`<iframe src="${youtube}" width="1" height="1"></iframe>`),
        `<iframe src="${youtube}" width="1" height="1"></iframe>`);
});

test("a self-closed trusted iframe is closed", { todo: "the text after it is inside the iframe, as in Perl" }, () => {
    assert.equal(embed(`<iframe src="${youtube}" />end`), `<iframe src="${youtube}"></iframe>end`);
});

test("iframes shown as content use https where the site supports it", () => {
    assert.equal(cleanEmbed(`<iframe src="${youtube}"></iframe>`, site, true),
        `<iframe src="//www.youtube.com/embed/${id}"></iframe>`);
    const eight = "http://8tracks.com/mixes/878698/player_v3_universal";
    assert.equal(cleanEmbed(`<iframe src="${eight}"></iframe>`, site, true), `<iframe src="${eight}"></iframe>`);
});

const GOOD = [
    "http://www.youtube.com/embed/123457890abc", "http://www.youtube.com/embed/x1xx2xxxxxX",
    "https://www.youtube.com/embed/x1xx2xxxxxX", "http://www.youtube-nocookie.com/embed/x1xx2xxxxxX",
    "https://www.youtube-nocookie.com/embed/x1xx2xxxxxX",
    "http://www.youtube.com/embed/x1xx2xxxxxX?somearg=1&otherarg=2", "//www.youtube.com/embed/uzmR-Ru_P8Y",
    "http://www.4shared.com/web/embed/file/VtBG91EOba", "http://8tracks.com/mixes/878698/player_v3_universal",
    "https://airtable.com/embed/shr5l5zt9nyBVMj4L", "https://archive.org/embed/LeonardNimoy15Oct2013YiddishBookCenter",
    "https://audiomack.com/embed/song/ariox-1/faded",
    "http://bandcamp.com/EmbeddedPlayer/v=2/track=123123123/size=venti/bgcol=FFFFFF/linkcol=4285BB/",
    "http://bandcamp.com/EmbeddedPlayer/v=2/track=123123123",
    "https://player.bilibili.com/player.html?aid=593134119&bvid=BV1Dq4y1y7Zj&cid=483765371&page=1",
    "http://blip.tv/play/x11Xx11Xx.html",
    "https://percolate.blogtalkradio.com/offsiteplayer?hostId=123456&episodeId=12345678",
    "https://app.box.com/embed/s/eqbvgyrj6uqftb6k8vz2wcdzu4wx7yy4", "https://chirb.it/wp/pnC9Kh",
    "//codepen.io/enxaneta/embed/gPeZdP/?height=268&theme-id=0&default-tab=result", "http://coub.com/embed/x1xx2xxxxxX",
    "https://criticalcommons.org/embed?m=XycozAvcH", "http://www.dailymotion.com/embed/video/x1xx11x",
    "https://diode.zone/videos/embed/52a10666-3a18-4e73-93da-e8d3c12c305a",
    "http://dotsub.com/media/9db493c6-6168-44b0-89ea-e33a31db48db/e/m",
    "https://discordapp.com/widget?id=305444013354254349&theme=dark",
    "https://drive.google.com/file/d/0B65w91gNVFP0OFVsMGxpVmlvRzA/preview",
    "http://episodecalendar.com/icalendar/sampleuser@example.com/abcde/",
    "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FSenegocom%2Fvideos%2F775953559125595%2F&width=500&show_text=false&height=283&appId",
    "https://www.flickr.com/photos/cards_by_krisso/13983859958/player/", "//www.funnyordie.com/embed/7156588dc7",
    "https://getyarn.io/yarn-clip/embed/3e697ca5-0387-4fad-9315-f5a6d05c80cc?autoplay=false",
    "http://embed.gettyimages.com/embed/1346778162?et=tmUM_QxBRNBC0ZdAX7yudA&tld=com&sig=TU07b1wHvu0M_PGI59qhyV0-8AB7Fx6tT46Eoe4_UO8=&caption=true&ver=1",
    "http://www.goodreads.com/widgets/user_update_widget?height=400&num_updates=3&user=12345&width=250",
    "https://giphy.com/embed/Om0tF9bYdLCKI",
    "http://maps.google.com/maps?f=q&source=s_q&hl=en&geocode=&q=somethingsomething&aq=0&sll=00.000,-00.0000&sspn=0.00,0.0&vpsrc=0&ie=UTF8&hq=&hnear=somethingsomething&z=0&ll=0,-00&output=embed",
    "https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d10271.13503700941!2d11.57008615!3d49.94039865!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sde!2sde!4v1494881096867",
    "https://www.google.com/calendar/b/0/embed?showPrint=0&showTabs=0&showCalendars=0&showTz=0&height=600&wkst=1&bgcolor=%23FFFFFF&src=foo%40group.calendar.google.com",
    "https://docs.google.com/spreadsheet/pub?key=0ArL0HD_lYDPadEkxSi1DTzJDa09GUmtzWEEwUDd4WFE&output=html&widget=true",
    "https://docs.google.com/spreadsheets/d/1P84CUNTo5O4ZW7R58Gl1ksCknFx3p59XzzQa7y67IaI/pubhtml?gid=23737011&single=true&widget=true&headers=false",
    "https://docs.google.com/document/d/1Bo38jRzUWrEAHT6oaNyeGLlluscRY6TS2lE2E1T94dQ/pub?embedded=true",
    "https://docs.google.com/presentation/d/1AxZkO9k4ISxku0__jRD8Im6mJC9xv5i4MgETEJ_MnA8/embed?start=false&loop=false&delayms=3000",
    "https://player.gimletmedia.com/awhk76", "//imgur.com/a/J4OKE/embed", "//instagram.com/p/cA1pRXKGBT/embed/",
    "http://www.imdb.com/videoembed/vi1743501593",
    "//www.jigsawplanet.com/?rc=play&amp;pid=35458f1355c4&amp;view=iframe", "//jsfiddle.net/5c0ruh8s/10/embedded/",
    "http://www.kickstarter.com/projects/25352323/arrival-a-short-film-by-alex-myung/widget/video.html",
    "http://www.kickstarter.com/projects/25352323/arrival-a-short-film-by-alex-myung/widget/card.html",
    "//html5-player.libsyn.com/embed/episode/id/16608338/height/360/theme/standard-mini/thumbnail/yes/direction/backward/",
    "https://lichess.org/study/embed/JYjprYmJ/CeyjnPCj", "https://www.loc.gov/item/mbrs01991430/?embed=resources",
    "https://shad-tkhom.livejournal.com/1244088.html?embed",
    "https://makertube.net/videos/embed/52a10666-3a18-4e73-93da-e8d3c12c305a",
    "https://mega.nz/embed/yr5VEDDZ#6vvZAnbmADkNc6KX5fKUB9GXYYrYGOhkgsx-xw9_SMw",
    "https://www.mixcloud.com/widget/iframe/?feed=https%3A%2F%2Fwww.mixcloud.com%2Fvladmradio%2F25-podcast-from-august-24-2016%2F&hide_cover=1&light=1",
    "https://mixstep.co/embed/20v1uter690o", "https://www.msnbc.com/msnbc/embedded-video/mmvo123456789012",
    "https://my.mail.ru/video/embed/420151911556087230",
    "http://player.theplatform.com/p/7wvmTC/MSNBCEmbeddedOffSite?guid=n_hayes_cmerkleyimmig_180604",
    "https://nekocap.com/view/OUHX8PYzJE?embed=true", "http://ext.nicovideo.jp/thumb/sm123123123",
    "http://ext.nicovideo.jp/thumb/nm123123123", "http://ext.nicovideo.jp/thumb/123123123",
    "http://noisetrade.com/service/widgetv2/ff3a6475-69ef-479d-9773-8ef1676f3cfb",
    "http://www.npr.org/templates/event/embeddedVideo.php?storyId=326182003&mediaId=327658636",
    "https://onedrive.live.com/embed?cid=9B3AE57006984006&resid=9B3AE57006984006%21172&authkey=ACnVTXqwCqi3zpo",
    "https://player.pbs.org/viralplayer/2318689287/",
    "https://playmoss.com/embed/wingedbeastie/the-swamp-witch-nix-s-playlist",
    "http://www.plurk.com/getWidget?uid=123123123&h=375&w=200&u_info=2&bg=cf682f&tl=cae7fd",
    "https://pastebin.com/embed_iframe/Juks92Y2", "https://podomatic.com/embed/html5/episode/1234567?autoplay=false",
    "https://www.random.org/widgets/integers/iframe.php?title=True+Random+Number+Generator&buttontxt=Generate&width=160&height=200&border=on&bgcolor=%23FFFFFF&txtcolor=%23777777&altbgcolor=%23CCCCFF&alttxtcolor=%23000000&defaultmin=&defaultmax=&fixed=off",
    "https://www.redditmedia.com/r/groupname/comments/ab1xyz/seems_like_a_caption/?ref_source=embed&amp;ref=share&amp;embed=true",
    "https://www.reverbnation.com/widget_code/html_widget/artist_299962?widget_id=55&pwc[song_ids]=4189683&context_type=song&pwc[size]=small&pwc[color]=dark",
    "https://rumble.com/embed/vr722g/?pub=4", "https://rutube.ru/play/embed/7189654",
    "http://www.sbs.com.au/yourlanguage//player/embed/id/163111",
    "//scratch.mit.edu/projects/embed/144290094/?autostart=false",
    "http://www.scribd.com/embeds/123123/content?start_page=1&view_mode=list&access_key=",
    "http://www.slideshare.net/slideshow/embed_code/12312312",
    "https://api.smugmug.com/services/embed/10385063342_c6j9ncH?width=360&height=640&albumId=250921912&albumKey=BqhhKn",
    "http://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F23318382&show_artwork=true",
    "https://embed.spotify.com/?uri=spotify:track:1DeuZgn99eUC1hreXTWBvY",
    "https://open.spotify.com/embed/track/5IsdA6g8IFKGmC1xl37OG1",
    "https://open.spotify.com/?uri=spotify:track:1DeuZgn99eUC1hreXTWBvY",
    "https://open.spotify.com/embed/album/2aE3VcIiNPqqo4VzOXiDoR",
    "https://open.spotify.com/embed/user/64f31rn6hwblzmssibjvs75e8/playlist/1ACvcMYSJoqa3gwOw6j0NR",
    "https://www.strava.com/activities/1997053955/embed/54dd7dc49efe8f9b00b8fceb01fa822fcc7de662",
    "https://streamable.com/e/asq5b/knxvuf", "https://streamable.com/o/asq5b/knxvuf",
    "https://streamable.com/s/asq5b/knxvuf",
    "http://embed.ted.com/talks/handpring_puppet_co_the_genius_puppetry_behind_war_horse.html",
    "http://i.cdn.turner.com/cnn/.element/apps/cvp/3.0/swf/cnn_416x234_embed.swf?context=embed&videoId=bestoftv/2012/09/05/exp-tsr-dem-platform-voice-vote.cnn",
    "https://player.twitch.tv/?autoplay=false&video=v582773417", "https://vid.me/e/v63?stats=1&amp;tools=1",
    "https://vk.com/video_ext.php?oid=-49280571&id=165718332&hash=5eb26e7a4cd9982d",
    "http://player.vimeo.com/video/123123123?title=0&byline=0&portrait=0", "https://vine.co/v/bjHh0zHdgZT/embed/simple",
    "http://commons.wikimedia.org/wiki/File:somethingsomethingsomething.ogv?withJS=MediaWiki:MwEmbed.js&embedplayer=yes",
    "https://fast.wistia.com/embed/iframe/k1akcpc0ik",
    "https://screen.yahoo.com/fashion-photographer-life-changed-chance-193621376.html?format=embed",
    "http://video.yandex.ru/iframe/v-rednaia7/9hvgcmpgkd.5440/",
    "https://music.yandex.ru/iframe/#track/31910432/247808/",
    "//www.zippcast.com/videoview.php?vplay=6c91dae3fc1bc909db0&auto=no",
];
const BAD = [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==",
    "data://www.youtube.com/embed/123457890abc", "http://www.youtube.com/notreallyembed/x1xx2xxxxxX",
    "http://www.youtube.com/embed/x1xx2xxxxxX/butnotreally", "/www.youtube.com/embed/uzmR-Ru_P8Y",
    "ttp://www.youtube.com/embed/uzmR-Ru_P8Y", "https://shad-tkhom.livejournal.com/1244088.html",
    "https://shad-tkhom.livejournal.com/1244sd088.html?embed",
    "https://shad_tkhom.livejournal.com/1244sd088.html?embed",
    "http://player.vimeo.com/video/123abc?title=0&byline=0&portrait=0", "https://vine.co/v/bjHh0zHdgZT/embed/postcard",
    "https://vine.co/v/bjHh0zHdgZT/embed", "https://vine.co/v/abc/embed/simple",
    "http://commons.wikimedia.org/wiki/File:1903_Burnley_Ironworks_company_steam_engine_in_use.ogv?withJS=MediaWiki:MwEmbed.js",
];

test("trusted embed urls are allowed", () => {
    for (const url of GOOD) assert.equal(checkIframeEmbed(url).allow, true, url);
});

test("other embed urls are not", () => {
    for (const url of BAD) assert.equal(checkIframeEmbed(url).allow, false, url);
});

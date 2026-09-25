// fixtures.ts
//
// Focused adversarial checks for local live journal admission.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import type { PublicAppConfig, PublicSettings, RawJournalSnapshot, RawUser } from "../contracts";
import { MARKER, SOURCE_HASHES } from "../policy/cohort";

export const config: PublicAppConfig = {
    entryContent: {
        imagePlaceholder: {src: "/img/imageplaceholder2.png", width: 35, height: 35,
            alt: "Image", title: "Image"},
        urls: {siteDomain: "", knownHttpsSites: [], formDomainBanned: [],
            imageProxy: "not-configured"},
    },
    canonicalAppOrigin: "http://localhost:8080", listenOrigin: "http://localhost:8081",
    siteRoot: "", statPrefix: "/stc", imgPrefix: "/img", palImgRoot: "/palimg", userpicRoot: "/userpic",
    siteName: "DW Devcontainer", siteNameShort: "DWDev", siteNameAbbrev: "DW",
    appleTouchIcon: "", facebookPreviewIcon: "", anonymousCaptchaDisabled: true,
};
export const limits = {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128};
export const now = 1790294400;
export function snapshot(): RawJournalSnapshot {
    const settings: Record<string, string | null> = Object.create(null);
    for (const key of ("stylesys s2_style journaltitle journalsubtitle url urlname adult_content " +
        "adult_content_reason control_strip_display control_strip_color sticky_entry show_control_strip " +
        "view_control_strip customtext_title customtext_url customtext_content opt_blockrobots " +
        "opt_allowsearchby opt_blockglobalsearch opt_ctxpopup opt_no_quickreply opt_show_captcha_to " +
        "opt_whoscreened opt_usermsg opt_usesharedpic opt_tagpermissions opt_embedplaceholders " +
        "opt_imagelinks opt_imageundef opt_maxpicheight opt_maxpicwidth icbm timezone renamedto " +
        "google_analytics ga4_analytics exclude_from_own_stats use_journalstyle_entry_page " +
        "use_journalstyle_icons_page").split(" ")) settings[key] = null;
    settings.stylesys = "2"; settings.s2_style = "6";
    const owner: RawUser = {userid: 6, user: "s2js_slice3", clusterid: 1, status: "A", statusvis: "V",
        journaltype: "P", name: "S2 slice 3 fixture", optShowTalkLinks: "Y", optWhocanReply: "all",
        optForceMoodtheme: "N", moodthemeid: 1, defaultpicid: 0, dversion: 10, caps: "2",
        hasBio: "Y", bio: MARKER, publicSettings: settings as PublicSettings};
    return {owner, posters: [owner], fingerprint: "opaque-test-primary-generation-1",
        style: {styleid: 6, ownerid: 6, name: MARKER, modtime: now,
            layers: SOURCE_HASHES.map((hash, i) => ({type: i ? "layout" : "core", s2lid: i + 1,
                ownerid: 91, ownerUsername: "system", compiledTime: now, sourceHash: hash}))},
        entries: [1, 2].map(n => ({journalid: 6, jitemid: n, anum: 128, posterid: 6,
            eventtime: `2026-09-24 ${n + 10}:00:00`, logtime: `2026-09-24 ${n + 10}:00:00`,
            rlogtime: 2147483647 - (now - 86400 + (n + 10) * 3600),
            revttime: 2147483647 - (now - 86400 + (n + 10) * 3600),
            year: 2026, month: 9, day: 24, security: "public", allowmask: "0", replycount: 0,
            compressed: "N", props: Object.assign(Object.create(null), {editor: "html_raw0"}),
            subjectText: `Live sample ${n} café`, eventText: `<p>Fixture ${n}: café &amp; tea 😀</p>` })),
        features: {usertags: 0, userkeywords: 0, logtags: 0, logtagsrecent: 0, logkwsum: 0,
            links: 0, userpics: 0, comments: 0}};
}

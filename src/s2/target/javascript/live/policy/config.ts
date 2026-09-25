// config.ts
//
// Bounded local S2 journal policy and rendering support.
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

import type { PublicAppConfig, RenderLimits } from "../contracts";
import { Unsupported } from "./content";

export function validateConfig(config: PublicAppConfig): void {
    const origins = [config.listenOrigin, config.canonicalAppOrigin].map(value => {
        const url = new URL(value);
        if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
            !url.port || url.origin !== value || url.username || url.password) throw new Unsupported();
        return url;
    });
    if (origins[0]!.hostname !== origins[1]!.hostname || origins[0]!.port === origins[1]!.port ||
        config.anonymousCaptchaDisabled !== true) throw new Unsupported();
    for (const value of [config.siteRoot, config.statPrefix, config.imgPrefix, config.palImgRoot,
        config.userpicRoot, config.appleTouchIcon, config.facebookPreviewIcon]) {
        if (typeof value !== "string" || /[\x00-\x20"'<>\\]/.test(value) ||
            (value !== "" && !/^\/(?!\/)/.test(value) &&
             !value.startsWith(config.canonicalAppOrigin + "/") &&
             value !== config.canonicalAppOrigin)) throw new Unsupported();
    }
    for (const value of [config.siteName, config.siteNameShort, config.siteNameAbbrev]) {
        if (!value || value.length > 100 || /[<>"'&\x00-\x1f]/.test(value)) throw new Unsupported();
    }
}
export function validateLimits(limits: RenderLimits): void {
    for (const [value, max] of [[limits.timeoutMs, 10000], [limits.maxOutputBytes, 2097152],
        [limits.maxHeapMiB, 128]]) {
        if (!Number.isSafeInteger(value) || value! <= 0 || value! > max!) throw new Unsupported();
    }
}

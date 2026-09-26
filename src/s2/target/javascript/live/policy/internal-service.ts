// internal-service.ts
//
// Anonymous live render service and final primary privacy decision.
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

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { AnonymousRecentRequest, AnonymousEntryRequest, AnonymousRecentService,
    AnonymousRecentServiceDeps, PerlComparisonInputs, LiveResult, RawPageRequest } from "../contracts";
import type {RenderPage} from "../render/types";
import { approveSnapshot, canonicalUsername } from "./cohort";
import {approveEntrySnapshot, validEntryId} from "./entry";
import { Unsupported } from "./content";
import { validateConfig, validateLimits } from "./config";
import { formToken, parseUniqCookie } from "./token";
import { validateArtifact } from "../render/artifact";
import { Renderer } from "../render/child";
import {verifyRuntime} from "../render/manifest";
import { loadResourceTimes } from "../render/resources";

// Shared implementation, not an HTTP/config switch. Only the ordinary factory
// chooses live entropy; the separate offline entrypoint selects comparison data.
export async function buildService(deps: AnonymousRecentServiceDeps,
    inputs: Pick<PerlComparisonInputs, "clock" | "random">): Promise<AnonymousRecentService> {
    validateConfig(deps.config);
    validateLimits(deps.limits);
    if ("clock" in deps || "random" in deps || "comparison" in deps) throw new Unsupported();
    const path = resolve(deps.artifact.path);
    if (statSync(path).size > 8388608 || !statSync(path + ".sandbox").isFile()) throw new Unsupported();
    const artifact = validateArtifact(JSON.parse(readFileSync(path, "utf8")));
    const resources = loadResourceTimes();
    const config = Object.freeze({...deps.config, journalUrls: Object.freeze({...deps.config.journalUrls,
        subdomainRules: Object.freeze(Object.fromEntries(Object.entries(deps.config.journalUrls.subdomainRules)
            .map(([key, value]) => [key, Object.freeze([...value]) as readonly [boolean, string]]))),
    }), entryContent: Object.freeze({
        imagePlaceholder: Object.freeze({...deps.config.entryContent.imagePlaceholder}),
        urls: Object.freeze({...deps.config.entryContent.urls,
            knownHttpsSites: Object.freeze([...deps.config.entryContent.urls.knownHttpsSites]),
            formDomainBanned: Object.freeze([...deps.config.entryContent.urls.formDomainBanned])}),
    })});
    const capabilities = Object.freeze({...deps.capabilities, s2ViewEntry: Object.freeze({
        ...deps.capabilities.s2ViewEntry,
        byBit: Object.freeze(deps.capabilities.s2ViewEntry.byBit.map(item => Object.freeze({...item}))),
    })});
    const renderer = new Renderer(artifact, path + ".sandbox", {...deps.limits}, verifyRuntime(path));
    let closed = false;
    let active = 0;
    async function serve(request: AnonymousRecentRequest | AnonymousEntryRequest,
        kind: "recent" | "entry"): Promise<LiveResult> {
        if (closed || active >= 2) return {ok: false, reason: "unavailable"};
        active++;
        try {
            if (canonicalUsername(request.username, config.usernameMaxLength) !== request.username ||
                !["GET", "HEAD"].includes(request.method)) throw new Unsupported();
            let skip = 0, skipPresent = false;
            if (kind === "recent") {
                const recent = request as AnonymousRecentRequest;
                skip = recent.skip; skipPresent = recent.skipPresent;
                if (!Number.isSafeInteger(skip) || skip < 0 ||
                    typeof skipPresent !== "boolean" || (!skipPresent && skip !== 0)) throw new Unsupported();
            } else if (!validEntryId((request as AnonymousEntryRequest).ditemid)) throw new Unsupported();
            if (request.uniqCookie !== null) parseUniqCookie("ljuniq=" + request.uniqCookie);
            // Capture once: source month selection, tokens and worker time share
            // this clock. The repository must preserve this exact request when
            // it performs both the initial bracket and fresh final reread.
            const nowSeconds = inputs.clock.nowSeconds();
            const now = new Date(nowSeconds * 1000);
            if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 || !Number.isFinite(now.getTime())) {
                throw new Unsupported();
            }
            const rawRequest: RawPageRequest = Object.freeze({username: request.username,
                calendarNow: Object.freeze({year: now.getUTCFullYear(), month: now.getUTCMonth() + 1}),
                page: Object.freeze(kind === "recent" ? {kind, skip, itemshow: 20} :
                    {kind, ditemid: (request as AnonymousEntryRequest).ditemid})});
            const snapshot = await deps.repository.loadRawSnapshot(rawRequest);
            if (snapshot === null) return {ok: false, reason: "not-found"};
            const received = snapshot.request;
            if (received.username !== rawRequest.username ||
                received.calendarNow.year !== rawRequest.calendarNow.year ||
                received.calendarNow.month !== rawRequest.calendarNow.month ||
                received.page.kind !== rawRequest.page.kind ||
                (received.page.kind === "recent" && (rawRequest.page.kind !== "recent" ||
                    received.page.skip !== rawRequest.page.skip || received.page.itemshow !== rawRequest.page.itemshow)) ||
                (received.page.kind === "entry" && (rawRequest.page.kind !== "entry" ||
                    received.page.ditemid !== rawRequest.page.ditemid))) throw new Unsupported();
            const journal = rawRequest.page.kind === "entry" ?
                approveEntrySnapshot(snapshot, rawRequest.page.ditemid, config, capabilities) :
                approveSnapshot(snapshot, config, capabilities);
            if (journal === null) return {ok: false, reason: "not-found"};
            const selected = snapshot.selection;
            const page: RenderPage = selected.kind === "entry" ? {kind: "entry", ditemid: selected.ditemid} :
                {kind: "recent", pageSkip: selected.pageSkip, itemshow: selected.itemshow,
                    maxScrollback: selected.maxScrollback, hasPrevious: selected.window.length > selected.itemshow};
            const token = await formToken(deps.secretSource, inputs.random, nowSeconds, request.uniqCookie);
            const html = await renderer.render({page, journal, config, skip, skipPresent, nowSeconds,
                formChallenge: token.challenge, uniq: token.uniq, resourceTimes: resources});
            const ready: LiveResult = {ok: true, html, setCookie: token.setCookie};
            // This independent primary read is the authorization decision.
            // Full HTML is already buffered. No async work follows success;
            // the caller immediately enqueues this result. Later commits and
            // network receipt are outside this bounded decision's guarantee.
            if (!await deps.repository.revalidateFingerprint(snapshot)) return {ok: false, reason: "changed"};
            if (closed) return {ok: false, reason: "unavailable"};
            return ready;
        } catch (error) {
            const unsupported = error instanceof Unsupported ||
                (error instanceof Error && error.name === "RepositoryError" &&
                 (error as Error & {kind?: unknown}).kind === "unsupported");
            return {ok: false, reason: unsupported ? "unsupported" : "unavailable"};
        } finally {
            active--;
        }
    }
    return {
        serve: request => serve(request, "recent"),
        serveEntry: request => serve(request, "entry"),
        async close(): Promise<void> {
            closed = true;
            await renderer.close();
        },
    };
}

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
import type { AnonymousRecentService, AnonymousRecentServiceDeps, PerlComparisonInputs, LiveResult } from "../contracts";
import { approveSnapshot, USERNAME } from "./cohort";
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
    const config = Object.freeze({...deps.config, entryContent: Object.freeze({
        imagePlaceholder: Object.freeze({...deps.config.entryContent.imagePlaceholder}),
        urls: Object.freeze({...deps.config.entryContent.urls,
            knownHttpsSites: Object.freeze([...deps.config.entryContent.urls.knownHttpsSites]),
            formDomainBanned: Object.freeze([...deps.config.entryContent.urls.formDomainBanned])}),
    })});
    const renderer = new Renderer(artifact, path + ".sandbox", {...deps.limits}, verifyRuntime(path));
    let closed = false;
    let active = 0;
    return {
        async serve(request): Promise<LiveResult> {
            if (closed || active >= 2) return {ok: false, reason: "unavailable"};
            active++;
            try {
                if (request.username !== USERNAME || !["GET", "HEAD"].includes(request.method) ||
                    !Number.isSafeInteger(request.skip) || request.skip < 0 || request.skip > 200 ||
                    typeof request.skipPresent !== "boolean" || (!request.skipPresent && request.skip !== 0)) {
                    throw new Unsupported();
                }
                if (request.uniqCookie !== null) parseUniqCookie("ljuniq=" + request.uniqCookie);
                const snapshot = await deps.repository.loadRawSnapshot(request.username);
                if (snapshot === null) return {ok: false, reason: "not-found"};
                const journal = approveSnapshot(snapshot);
                const nowSeconds = inputs.clock.nowSeconds();
                const token = await formToken(deps.secretSource, inputs.random, nowSeconds, request.uniqCookie);
                const html = await renderer.render({journal, config, skip: request.skip, skipPresent: request.skipPresent, nowSeconds,
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
        },
        async close(): Promise<void> {
            closed = true;
            await renderer.close();
        },
    };
}

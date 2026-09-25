// app.ts
//
// Fastify transport for the admitted anonymous live S2 page.
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

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type {
    AnonymousRecentService, LiveFailure, PublicAppConfig, RedirectAdmissionRequest,
} from "../contracts";
import { createRedirectAdmission } from "../policy/redirects";

const FAILURE_STATUS: Readonly<Record<LiveFailure, number>> = {
    "not-found": 404, unsupported: 422, changed: 409, unavailable: 503,
};
const FAILURE_BODY: Readonly<Record<LiveFailure, string>> = {
    "not-found": "Journal not found\n",
    unsupported: "Unsupported journal state\n",
    changed: "Journal changed during render\n",
    unavailable: "Journal temporarily unavailable\n",
};

function headerValues(request: FastifyRequest, name: string): string[] {
    const raw = request.raw.rawHeaders;
    const values: string[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
        if (raw[i]?.toLowerCase() === name) values.push(raw[i + 1] ?? "");
    }
    return values;
}

function admissionInput(request: FastifyRequest): RedirectAdmissionRequest {
    const host = headerValues(request, "host");
    const origin = headerValues(request, "origin");
    const cookie = headerValues(request, "cookie");
    const raw = request.raw.rawHeaders;
    let hasAuthorization = false;
    let hasForwardedHeaders = false;
    for (let i = 0; i + 1 < raw.length; i += 2) {
        const name = raw[i]?.toLowerCase() ?? "";
        if (name === "authorization") hasAuthorization = true;
        if (name === "forwarded" || name.startsWith("x-forwarded-")) {
            hasForwardedHeaders = true;
        }
    }
    // Preserve duplicate values as tainted input. The pure admission policy
    // rejects ambiguous Host, Origin, and Cookie values.
    return {
        method: request.raw.method ?? "",
        rawTarget: request.raw.url ?? "",
        host: host.join(","),
        origin: origin.length ? origin.join(",") : null,
        cookieHeader: cookie.length ? cookie.join(",") : null,
        hasAuthorization, hasForwardedHeaders,
    };
}

function commonHeaders(reply: FastifyReply, cacheControl: string): FastifyReply {
    return reply
        .header("Cache-Control", cacheControl)
        .header("Referrer-Policy", "strict-origin-when-cross-origin")
        .header("X-Content-Type-Options", "nosniff");
}

function reject(reply: FastifyReply): FastifyReply {
    return commonHeaders(reply, "private, no-store")
        .code(400).type("text/plain; charset=utf-8").send("Unsupported request\n");
}

function fail(reply: FastifyReply, reason: LiveFailure): FastifyReply {
    return commonHeaders(reply, "private, no-store")
        .code(FAILURE_STATUS[reason]).type("text/plain; charset=utf-8")
        .send(FAILURE_BODY[reason]);
}

export function createLiveApp(
    config: PublicAppConfig, service: AnonymousRecentService,
): FastifyInstance {
    const admit = createRedirectAdmission(config);
    const app = Fastify({
        logger: false,
        exposeHeadRoutes: false,
        trustProxy: false,
        requestTimeout: 5000,
        handlerTimeout: 30000,
        connectionTimeout: 5000,
        bodyLimit: 1024,
        routerOptions: {
            ignoreTrailingSlash: false,
            ignoreDuplicateSlashes: false,
        },
    });
    app.setErrorHandler((_error, _request, reply) => {
        fail(reply, "unavailable");
    });
    app.setNotFoundHandler((_request, reply) => {
        reject(reply);
    });
    // onRequest is before preParsing. Redirects/rejections are sent before a
    // POST body is read, parsed, logged, authenticated, or forwarded.
    app.addHook("onRequest", async (request, reply) => {
        const decision = admit(admissionInput(request));
        if (decision.kind === "reject") return reject(reply);
        if (decision.kind === "redirect") {
            return commonHeaders(reply, "private, no-store")
                .code(decision.status).header("Location", decision.location).send("");
        }
        const result = await service.serve(decision.request);
        if (!result.ok) return fail(reply, result.reason);
        // The service has just completed its independent primary recheck.
        // Buffer and enqueue synchronously; no subsequent awaited work.
        const body = Buffer.from(result.html, "utf8");
        commonHeaders(reply, "private, no-store")
            .code(200)
            .type("text/html; charset=utf-8")
            .header("Content-Length", String(body.length));
        if (result.setCookie !== null) reply.header("Set-Cookie", result.setCookie);
        return reply.send(decision.request.method === "HEAD" ? "" : body);
    });
    // Admission always completes in onRequest. These catch-all routes ensure
    // every inventoried control path reaches that hook before body parsing.
    app.all("/", (_request, reply) => reject(reply));
    app.all("/*", (_request, reply) => reject(reply));
    return app;
}

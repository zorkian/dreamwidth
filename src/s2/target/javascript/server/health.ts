// health.ts
//
// The /admin/healthy status check, as DW::Controller::Admin::StatusCheck
// writes it, for what this server depends on: the databases it reads and its
// render workers.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { Databases } from "../data/db";
import type { SiteConfig } from "./config";

// Load balancer checks give up after five seconds.
const CHECK_TIMEOUT_MS = 2000;

const TIMED_OUT = Symbol("timed out");

// Resolves to the check's failure, or undefined when it passed.
async function failure(check: () => Promise<unknown>): Promise<string | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), CHECK_TIMEOUT_MS); });
    try {
        const outcome = await Promise.race([check(), timeout]);
        if (outcome === TIMED_OUT) return "timed out";
        return outcome === false ? "failed" : undefined;
    } catch (error) {
        console.error(error);
        return "test query failed";
    } finally {
        clearTimeout(timer);
    }
}

// DW::Controller::Admin::StatusCheck::healthy_handler. Unlike Perl's, a
// failing check answers 503, so a load balancer can act on it.
export async function healthy(config: SiteConfig, db: Databases, pingRenderer: () => Promise<boolean>):
    Promise<{ status: number; body: string }> {
    const checks: [string, () => Promise<unknown>][] = [
        ["global reader", () => db.global("SELECT UNIX_TIMESTAMP()")],
        ...config.clusters.map((cid): [string, () => Promise<unknown>] =>
            [`cluster ${cid} reader`, () => db.cluster(cid, "SELECT UNIX_TIMESTAMP()")]),
        ["render workers", pingRenderer],
    ];
    const results = await Promise.all(checks.map(async ([name, check]) => ({ name, failed: await failure(check) })));
    const pass = results.filter(result => !result.failed).map(result => result.name);
    const fail = results.filter(result => result.failed).map(result => `${result.name} ${result.failed}`);
    let body = fail.length ? `status=fail\n\nfailures:\n${fail.map(line => `  ${line}\n`).join("")}` : "status=ok\n";
    if (pass.length) body += `\nokay:\n${pass.map(line => `  ${line}\n`).join("")}`;
    return { status: fail.length ? 503 : 200, body };
}

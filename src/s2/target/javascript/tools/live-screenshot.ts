// live-screenshot.ts
//
// Capture an actual loopback TypeScript recent or selected-entry route.
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

import { mkdirSync } from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const entry = args.length === 0 ? null :
        args.length === 2 && args[0] === "--entry" &&
        /^[1-9][0-9]*$/.test(args[1] ?? "") &&
        Number(args[1]) <= 4294967295 ? Number(args[1]) : NaN;
    if (Number.isNaN(entry)) {
        throw new Error("Usage: live-screenshot [--entry <canonical positive ditemid>]");
    }
    const route = "http://localhost:8081/users/s2js_slice3/" +
        (entry === null ? "" : entry + ".html");
    const browserPackage = "/opt/dw-screenshot/node_modules/puppeteer-core";
    // The existing dev screenshot setup installs this local browser package.
    // This tool uses the TS listener URL, which bin/dev/screenshot cannot accept.
    const puppeteer = require(browserPackage);
    const browser = await puppeteer.launch({
        executablePath: "/usr/bin/google-chrome-stable",
        args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
        defaultViewport: {width: 1280, height: 1400},
    });
    try {
        const page = await browser.newPage();
        const response = await page.goto(route, {
            waitUntil: "networkidle2", timeout: 30000,
        });
        if (!response || response.status() !== 200 ||
            response.headers()["cache-control"] !== "private, no-store") {
            throw new Error("Actual TS route did not return an uncached HTTP 200");
        }
        const directory = path.resolve(__dirname, "../../artifacts/live");
        mkdirSync(directory, {recursive: true});
        const target = path.join(directory,
            entry === null ? "ts-recent.png" : `ts-entry-${entry}.png`);
        await page.screenshot({path: target, fullPage: true});
        process.stdout.write("Actual TS route screenshot: " + target + "\n");
    } finally {
        await browser.close();
    }
}

void main().catch(error => {
    process.stderr.write("TS screenshot failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});

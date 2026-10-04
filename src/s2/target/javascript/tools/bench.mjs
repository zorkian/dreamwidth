// bench.mjs
//
// Time the same journal pages on the Perl site and the JavaScript server:
// latency percentiles and requests per second at each concurrency, status
// mismatches, MySQL queries per page and server memory. Meant for the
// devcontainer, where both servers and MySQL run side by side.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const USAGE = `Usage: bench.mjs --config FILE [options] [PATH...]
  --perl ORIGIN        Perl site (default http://localhost:8080)
  --js ORIGIN          journal server (default http://localhost:8092)
  --start-js           start the journal server on --js's port, and time each
                       page's first request on both servers before warming
                       up (restart Starman first for Perl's cold figures)
  --requests N         timed requests per page and concurrency (default 50)
  --concurrency LIST   comma-separated (default 1,8)
  --warmup N           untimed requests per page first (default 5)
  --queries            count each page's MySQL queries from the general log
                       (needs the mysql client with rights to set it)
  --json               print results as JSON instead of tables
PATHs default to pages of the fixture journals from tools/seed-fixtures.pl.`;

const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        config: { type: "string" }, perl: { type: "string", default: "http://localhost:8080" },
        js: { type: "string", default: "http://localhost:8092" }, "start-js": { type: "boolean", default: false },
        requests: { type: "string", default: "50" }, concurrency: { type: "string", default: "1,8" },
        warmup: { type: "string", default: "5" }, queries: { type: "boolean", default: false },
        json: { type: "boolean", default: false }, help: { type: "boolean", default: false },
    },
});
if (opts.help || !opts.config) {
    console.error(USAGE);
    process.exit(opts.help ? 0 : 2);
}
const config = JSON.parse(readFileSync(opts.config, "utf8"));

// One keep-alive connection per request in flight, as a proxy would hold.
function request(origin, pagePath, agent) {
    const url = new URL(origin);
    const start = process.hrtime.bigint();
    return new Promise(resolve => {
        const req = http.get({ host: "127.0.0.1", port: url.port || 80, path: pagePath, agent,
            headers: { host: url.host } }, response => {
            response.on("data", () => {});
            response.on("end", () => resolve({ status: response.statusCode,
                ms: Number(process.hrtime.bigint() - start) / 1e6 }));
        });
        req.on("error", error => resolve({ status: 0, error: error.message,
            ms: Number(process.hrtime.bigint() - start) / 1e6 }));
    });
}

async function run(origin, pagePath, count, concurrency) {
    const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
    const results = [];
    let next = 0;
    const start = process.hrtime.bigint();
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < count) {
            next++;
            results.push(await request(origin, pagePath, agent));
        }
    }));
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    agent.destroy();
    const sorted = results.map(r => r.ms).sort((a, b) => a - b);
    const pct = p => sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)];
    const statuses = [...new Set(results.map(r => r.status))];
    return { p50: pct(50), p95: pct(95), p99: pct(99), rps: count / seconds, statuses,
        errors: results.filter(r => r.status === 0 || r.status >= 500).length };
}

// The fixture pages, with entry ids looked up by subject.
async function fixturePages() {
    const require = createRequire(path.join(HERE, "../package.json"));
    const mysql = require("mysql2/promise");
    const info = Object.values(config.databases).find(db => db.roles.includes("slave") || db.roles.includes("master"));
    const connect = db => mysql.createConnection({ host: db.host ?? "localhost", port: db.port ?? 3306,
        socketPath: db.socket ?? undefined, user: db.user, password: db.password, database: db.database });
    const global = await connect(info);
    const ditemid = async (user, subject) => {
        const [[u]] = await global.query("SELECT userid, clusterid FROM user WHERE user = ?", [user]);
        const cluster = Object.values(config.databases).find(db => db.roles.includes(`cluster${u.clusterid}`));
        const conn = await connect(cluster);
        const [[row]] = await conn.query(`SELECT l.jitemid, l.anum FROM log2 l JOIN logtext2 t USING (journalid, jitemid)
            WHERE l.journalid = ? AND t.subject LIKE ? ORDER BY l.jitemid DESC LIMIT 1`, [u.userid, `${subject}%`]);
        await conn.end();
        return row.jitemid * 256 + row.anum;
    };
    const pages = {
        "recent, site default style": "/~s2fix_default/",
        "recent, theme": "/~s2fix_theme/",
        "recent, user layer": "/~s2fix_custom/",
        "recent, 220-entry journal": "/~s2fix_big/",
        "entry, 5 comments": `/~s2fix_theme/${await ditemid("s2fix_theme", "Entry 25:")}.html`,
        "entry, 300 comments": `/~s2fix_big/${await ditemid("s2fix_big", "Entry 220:")}.html`,
        "year archive": "/~s2fix_big/2026/",
        "month archive": "/~s2fix_big/2026/03/",
        "day archive": "/~s2fix_archive/2025/03/10/",
        "tags": "/~s2fix_big/tag/",
        "icons": "/~s2fix_archive/icons",
        "reply, no captcha": `/~s2fix_theme/${await ditemid("s2fix_theme", "Entry 25:")}.html?mode=reply`,
        "reply, captcha": `/~s2fix_captcha/${await ditemid("s2fix_captcha", "Entry 1:")}.html?mode=reply`,
        "stylesheet": "/~s2fix_theme/res/14/stylesheet",
        "?style=site": "/~s2fix_big/?style=site",
        "?style=light": "/~s2fix_theme/?style=light",
        "reading page": "/~s2fix_reader/read",
        "network page": "/~s2fix_theme/network",
        "unknown journal": "/~no-such-user/",
        "hidden entry (404)": `/~s2fix_theme/${await ditemid("s2fix_theme", "Private entry")}.html`,
        "adult content (login)": "/~s2fix_adultjournal/",
    };
    await global.end();
    return pages;
}

// Queries the servers' MySQL user ran for one request, from the general log.
function countQueries(origin, pagePath, dbUser) {
    const sql = statement => execFileSync("mysql", ["-N", "-e", statement], { encoding: "utf8" }).trim();
    sql("SET GLOBAL log_output = 'TABLE'; SET GLOBAL general_log = 'ON'; TRUNCATE mysql.general_log");
    return request(origin, pagePath).then(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        const count = Number(sql(`SELECT COUNT(*) FROM mysql.general_log WHERE command_type IN ('Query', 'Execute')
            AND user_host LIKE '${dbUser}[${dbUser}]%'`));
        sql("SET GLOBAL general_log = 'OFF'");
        return count;
    });
}

// Resident memory, in MB, of every process whose command line matches.
function rss(pattern) {
    let kb = 0;
    for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
        try {
            const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
            if (!pattern.test(cmdline)) continue;
            kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
        } catch { /* exited */ }
    }
    return Math.round(kb / 1024);
}

async function startServer() {
    const port = new URL(opts.js).port;
    const child = spawn(process.execPath, [path.join(HERE, "../dist/server/main.js"), "--config", opts.config,
        "--port", port], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((resolve, reject) => {
        child.stdout.on("data", data => { if (/listening/i.test(String(data))) resolve(); });
        child.on("exit", code => reject(new Error(`journal server exited with ${code}`)));
    });
    return child;
}

const pages = positionals.length ? Object.fromEntries(positionals.map(p => [p, p])) : await fixturePages();
const servers = { perl: opts.perl, js: opts.js };
const report = { pages: {}, memory: {} };
const jsPattern = /dist\/server\/main\.js/;
const perlPattern = /^starman/;
const child = opts["start-js"] ? await startServer() : undefined;
report.memory.idle = { perl: rss(perlPattern), js: rss(jsPattern) };

// Each page's first request: for a just-started journal server, before any
// layer it needs is compiled, unless an earlier page compiled it.
if (child) {
    for (const [name, pagePath] of Object.entries(pages)) {
        report.pages[name] = { path: pagePath, cold: {
            perl: (await request(opts.perl, pagePath)).ms, js: (await request(opts.js, pagePath)).ms,
        } };
    }
}
for (const [name, pagePath] of Object.entries(pages)) {
    const entry = report.pages[name] ??= { path: pagePath };
    for (const [side, origin] of Object.entries(servers)) {
        for (let i = 0; i < Number(opts.warmup); i++) await request(origin, pagePath);
        for (const concurrency of opts.concurrency.split(",").map(Number)) {
            (entry[`c${concurrency}`] ??= {})[side] = await run(origin, pagePath, Number(opts.requests), concurrency);
        }
        if (opts.queries) (entry.queries ??= {})[side] = await countQueries(origin, pagePath, config.databases.master?.user ?? "dw");
    }
    const first = entry[`c${opts.concurrency.split(",")[0]}`];
    entry.statusMismatch = first.perl.statuses.join() !== first.js.statuses.join()
        ? `perl ${first.perl.statuses.join("/")}, js ${first.js.statuses.join("/")}` : "";
}
report.memory.afterRun = { perl: rss(perlPattern), js: rss(jsPattern) };
child?.kill();

if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    const f = n => n === undefined ? "" : n < 10 ? n.toFixed(1) : String(Math.round(n));
    for (const concurrency of opts.concurrency.split(",")) {
        console.log(`\nConcurrency ${concurrency}: latency in ms (Perl / JS), requests per second\n`);
        console.log("| Page | p50 | p95 | p99 | req/s | errors |");
        console.log("|---|---|---|---|---|---|");
        for (const [name, entry] of Object.entries(report.pages)) {
            const { perl, js } = entry[`c${concurrency}`];
            const both = key => `${f(perl[key])} / ${f(js[key])}`;
            console.log(`| ${name} | ${both("p50")} | ${both("p95")} | ${both("p99")} | ${both("rps")} | ` +
                `${perl.errors} / ${js.errors} |`);
        }
    }
    console.log("\n| Page | queries (Perl / JS) | first request, ms (Perl / JS) | status mismatch |");
    console.log("|---|---|---|---|");
    for (const [name, entry] of Object.entries(report.pages)) {
        const queries = entry.queries ? `${entry.queries.perl} / ${entry.queries.js}` : "";
        const cold = entry.cold ? `${f(entry.cold.perl)} / ${f(entry.cold.js)}` : "";
        console.log(`| ${name} | ${queries} | ${cold} | ${entry.statusMismatch} |`);
    }
    console.log(`\nMemory, MB RSS (Perl workers / JS server): idle ${report.memory.idle.perl} / ${report.memory.idle.js}, ` +
        `after the run ${report.memory.afterRun.perl} / ${report.memory.afterRun.js}`);
}

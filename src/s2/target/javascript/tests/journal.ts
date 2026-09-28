// journal.ts
//
// Render fixture journals in-process for tests. Needs the devcontainer
// database with tools/seed-fixtures.pl applied.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { Compiler } from "../compile/compiler";
import { Databases, int } from "../data/db";
import { User } from "../data/user";
import { type RenderRequest, type RenderResult, renderJournal } from "../render/render";
import { prepare } from "../server/app";
import type { SiteConfig } from "../server/config";

export const HOST = "localhost:8092";

export class TestJournals {
    readonly config: SiteConfig = JSON.parse(execFileSync("perl",
        [path.resolve(__dirname, "../../tools/export-config.pl")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    readonly db = new Databases(this.config);
    readonly compiler = new Compiler(this.db);

    // Render a journal URL in-process.
    async get(url: string): Promise<RenderResult> {
        const prepared = await prepare(this.config, this.db, this.compiler, url, HOST);
        return "layers" in prepared ? renderJournal(this.db, { config: this.config, host: HOST }, prepared) : prepared;
    }

    // What the server would send a render worker for this URL.
    async request(url: string): Promise<RenderRequest> {
        const prepared = await prepare(this.config, this.db, this.compiler, url, HOST);
        if (!("layers" in prepared)) throw new Error(`${url} needs no rendering`);
        return prepared;
    }

    // The ditemid of the journal's entry whose subject starts with this ASCII text.
    async ditemid(user: string, subject: string): Promise<number> {
        const u = (await User.byName(this.db, user))!;
        const rows = await u.cluster(this.db, `SELECT l.jitemid, l.anum FROM log2 l JOIN logtext2 t USING (journalid, jitemid)
            WHERE l.journalid = ? AND t.subject LIKE ?`, [u.userid, `${subject}%`]);
        return int(rows[0]!.jitemid) * 256 + int(rows[0]!.anum);
    }

    async close(): Promise<void> {
        this.compiler.close();
        await this.db.close();
    }
}

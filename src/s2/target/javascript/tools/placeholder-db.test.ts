// placeholder-db.test.ts
//
// Configured origins and source URL facts for the private journal renderer.
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

import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtempSync, writeFileSync, utimesSync, rmSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import mysql from "mysql2/promise";
import {sql} from "kysely";
import {PrimaryDatabases} from "../live/data/primary";
import {SnapshotError} from "../live/data/errors";
import {resolvePlaceholder} from "../live/domain/placeholder";
import type {ConfiguredDatabase} from "../live/startup-types";
import type {PlaceholderResolutionSpec} from "../live/contracts";

test("startup translation reads MyISAM without writes and applies normal DB/file projection", {
    skip: process.env.S2_PLACEHOLDER_FIXTURE !== "1",
}, async () => {
    assert.equal(process.env.LJHOME, "/workspaces/dreamwidth");
    const schema = "s6_placeholder_" + randomBytes(8).toString("hex");
    assert.match(schema, /^s6_placeholder_[a-f0-9]{16}$/);
    const dir = mkdtempSync("/tmp/slice6-placeholder-db-");
    const admin = await mysql.createConnection({socketPath: "/var/run/mysqld/mysqld.sock", user: "root"});
    let created = false, databases: PrimaryDatabases | undefined;
    try {
        await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`); created = true;
        const table = (name: string) => `\`${schema}\`.\`${name}\``;
        await admin.query(`CREATE TABLE ${table("ml_domains")} (dmid INT, type VARCHAR(30), args VARCHAR(255)) ENGINE=MyISAM`);
        await admin.query(`CREATE TABLE ${table("ml_langs")} (lnid INT, lncode VARCHAR(16)) ENGINE=MyISAM`);
        await admin.query(`CREATE TABLE ${table("ml_items")} (dmid INT,itid INT,itcode VARCHAR(120),visible INT) ENGINE=MyISAM`);
        await admin.query(`CREATE TABLE ${table("ml_latest")} (dmid INT,itid INT,lnid INT,txtid INT,chgtime DATETIME) ENGINE=MyISAM`);
        await admin.query(`CREATE TABLE ${table("ml_text")} (dmid INT,txtid INT,text TEXT) ENGINE=MyISAM`);
        await admin.query(`INSERT INTO ${table("ml_domains")} VALUES (1,'general','')`);
        await admin.query(`INSERT INTO ${table("ml_langs")} VALUES (7,'fr')`);
        await admin.query(`INSERT INTO ${table("ml_items")} VALUES (1,3,'img.placeholder',0)`);
        await admin.query(`INSERT INTO ${table("ml_latest")} VALUES (1,3,7,5,'2000-01-01 00:00:00')`);
        await admin.query(`INSERT INTO ${table("ml_text")} VALUES (1,5,CONVERT(? USING latin1))`,
            [Buffer.from('DB café 😀 &amp; &#34;', "utf8")]);
        const config: ConfiguredDatabase = {defaultDatabase: "livejournal", clusters: [], clusterPairActive: {},
            sources: [{id: "master", host: null, port: null, socketPath: "/var/run/mysqld/mysqld.sock",
                database: schema, user: "root", password: "", roles: {}}]};
        databases = PrimaryDatabases.create(config);
        const file = path.join(dir, "fr.dat"); writeFileSync(file, "img.placeholder=File label\n");
        utimesSync(file, 2000000000, 2000000000);
        const spec: PlaceholderResolutionSpec = {descriptor: {src: "/img/x.png", width: 35, height: 35,
            altKey: "img.placeholder"}, defaultLang: "fr", isDevServer: false, languageFiles: [file]};
        const read = (value = spec) => databases!.snapshot(undefined, [], connection => resolvePlaceholder(connection, value));
        const before = (await admin.query(`SELECT * FROM ${table("ml_items")}`))[0];
        assert.deepEqual(await read(), {alt: 'DB café 😀 & "', title: 'DB café 😀 & "'});
        assert.equal((await read({...spec, isDevServer: true})).alt, "File label");
        assert.deepEqual((await admin.query(`SELECT * FROM ${table("ml_items")}`))[0], before);
        // Startup exception is explicit: the ordinary transactional table gate still refuses MyISAM.
        await assert.rejects(databases.snapshot(undefined, ["ml_text"], connection => resolvePlaceholder(connection, spec)),
            (error: unknown) => error instanceof SnapshotError && error.kind === "unsupported");
        await admin.query(`UPDATE ${table("ml_text")} SET text='Literal " malformed'`);
        await assert.rejects(read(), (error: unknown) => error instanceof SnapshotError && error.kind === "unsupported");
        await admin.query(`UPDATE ${table("ml_text")} SET text=''`);
        assert.equal((await read()).alt, "File label");
        assert.equal((await read({...spec, languageFiles: []})).alt, "img.placeholder");
        await assert.rejects(read({...spec, defaultLang: "missing"}), SnapshotError);
        await admin.query(`DROP TABLE ${table("ml_text")}`);
        await assert.rejects(read(), (error: unknown) => error instanceof SnapshotError && error.kind === "unavailable");
        const failing = PrimaryDatabases.create({...config, sources: [{...config.sources[0]!,
            host: "127.0.0.1", port: 1, socketPath: null, password: "SECRET_NOT_IN_DIAGNOSTICS"}]});
        try {
            await assert.rejects(failing.snapshot(undefined, [], connection => resolvePlaceholder(connection, spec)),
                (error: unknown) => error instanceof SnapshotError && error.kind === "unavailable" &&
                    error.message === "Journal data unavailable" && !JSON.stringify(error).includes("SECRET"));
        } finally { await failing.close(); }
    } finally {
        await databases?.close();
        if (created) await admin.query(`DROP DATABASE \`${schema}\``);
        await admin.end(); rmSync(dir, {recursive: true, force: true});
    }
});

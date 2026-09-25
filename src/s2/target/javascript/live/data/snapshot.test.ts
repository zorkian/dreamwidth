// snapshot.test.ts
//
// Focused local primary-snapshot and legacy text boundary checks.
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
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { MysqlStoreConfig } from "./mysql";
import { decodeLegacyText } from "./legacy-text";
import { MysqlLiveStore } from "./mysql";

function decoderEdges(): void {
    assert.equal(decodeLegacyText(
        "636166C383C2A9", "636166C3A9", "636166C383C2A9", 64, 64, false,
    ).text, "café");
    assert.equal(decodeLegacyText(
        "C3B0C5B8CB9CE282AC", "F09F9880", "C3B0C5B8CB9CE282AC", 64, 64, false,
    ).text, "😀");
    // MySQL latin1 maps 0x80 to EURO, unlike ISO-8859-1. Reverse conversion
    // recovers the original C2 80 UTF-8 byte pair before strict decoding.
    assert.equal(decodeLegacyText(
        "C382E282AC", "C280", "C382E282AC", 64, 64, false,
    ).text, "\u0080");
    const gzip = gzipSync(Buffer.from("café 😀", "utf8"));
    const hex = gzip.toString("hex");
    assert.equal(decodeLegacyText(hex, hex, hex, 1024, 64, true).text, "café 😀");
    assert.throws(() => decodeLegacyText(
        "C281", "81", "C281", 64, 64, false,
    ), { name: "RepositoryError", kind: "unsupported" });
    assert.throws(() => decodeLegacyText(
        "C3BF", "FF", "C3BF", 64, 64, false,
    ), { name: "RepositoryError", kind: "unsupported" });
    assert.throws(() => decodeLegacyText(
        "C383C2A9", "C3A9", "C3A9", 64, 64, false,
    ), { name: "RepositoryError", kind: "unsupported" });
    const bomb = gzipSync(Buffer.alloc(65537, 0x61)).toString("hex");
    assert.throws(() => decodeLegacyText(
        bomb, bomb, bomb, 1024, 65536, true,
    ), { name: "RepositoryError", kind: "unsupported" });
}

function normalHelper(action: "--mutate" | "--restore"): void {
    const root = process.env.LJHOME;
    assert.ok(root, "LJHOME required");
    execFileSync("perl", [path.join(root, "src/s2/target/javascript/tools/live-mutate.pl"), action], {
        cwd: root, timeout: 10000, stdio: "pipe",
    });
}

async function main(): Promise<void> {
    decoderEdges();
    const pathToCredentials = path.join(process.cwd(), "artifacts/live/mysql-readonly.json");
    assert.equal(statSync(pathToCredentials).mode & 0o077, 0);
    const config = JSON.parse(readFileSync(pathToCredentials, "utf8")) as MysqlStoreConfig;
    const store = await MysqlLiveStore.open(config);
    try {
        const snapshot = await store.loadRawSnapshot("s2js_slice3");
        assert.ok(snapshot);
        assert.equal(snapshot.owner.user, "s2js_slice3");
        assert.equal(snapshot.owner.defaultpicid, 0);
        assert.equal(Object.getPrototypeOf(snapshot.owner.publicSettings), null);
        assert.equal(snapshot.entries.length, 2);
        assert.deepEqual(snapshot.entries.map(entry => entry.subjectText),
            ["Live sample 2 😀", "Live sample 1 café"]);
        assert.ok(snapshot.entries.every(entry => entry.props.editor === "html_raw0"));
        assert.deepEqual(snapshot.style?.layers.map(layer => layer.sourceHash), [
            "8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6",
            "c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411",
        ]);
        assert.deepEqual(snapshot.style?.layers.map(layer => layer.ownerUsername),
            ["system", "system"]);
        assert.ok(Object.values(snapshot.features).every(count => count === 0));
        assert.equal(await store.revalidateFingerprint(snapshot), true);
        const key = await store.loadLatestSecret(Math.floor(Date.now() / 1000), 86400);
        assert.ok(key && key.secret.length === 32);
        assert.equal(await store.loadRawSnapshot("s2js_slice3_missing"), null);
        try {
            normalHelper("--mutate");
            assert.equal(await store.revalidateFingerprint(snapshot), false);
            const changed = await store.loadRawSnapshot("s2js_slice3");
            assert.equal(changed?.owner.name, "S2 slice 3 mutation probe");
            assert.notEqual(changed.fingerprint, snapshot.fingerprint);
        } finally {
            normalHelper("--restore");
        }
        assert.equal(await store.revalidateFingerprint(snapshot), true);
    } finally {
        await store.close();
    }
    process.stdout.write("live primary snapshot, legacy text and fingerprint revocation: pass\n");
}

void main().catch(error => {
    process.stderr.write("snapshot test failed: " +
        (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
});

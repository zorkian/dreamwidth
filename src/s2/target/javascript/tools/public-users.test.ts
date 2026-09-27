// public-users.test.ts
//
// Actual SELECT-only public language witnesses and MyISAM qualification.
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
import test from "node:test";
import {withSelectedFixture} from "./selected-fixture";
import {MysqlPublicUsers} from "../live/data/public-users";

test("arbitrary public user, absence, identity and persistent changes are primary witnesses", () =>
    withSelectedFixture(async ({admin, g, table, startup}) => {
        const users = new MysqlPublicUsers(startup.database);
        try {
            const [rows] = await admin.query<import("mysql2/promise").RowDataPacket[]>(
                `SELECT user FROM ${table(g,"user")} WHERE userid=900001`);
            const name = String(rows[0]!.user);
            const initial = await users.snapshot(name);
            assert.equal(initial.user!.userid, 900001);
            assert.equal(await users.revalidate(initial), true);
            assert.equal(await users.revalidate({...initial}), false);
            await admin.query(`UPDATE ${table(g,"user")} SET status='V',statusvis='D',name='Public deleted label' WHERE userid=900001`);
            assert.equal(await users.revalidate(initial), false);
            const deleted = await users.snapshot(name);
            assert.equal(deleted.user!.status, "V");
            assert.equal(deleted.user!.statusvis, "D"); // UserLite summary is not owner authorization.
            assert.equal(deleted.user!.name.bytes().toString(), "Public deleted label");
            const absent = await users.snapshot("unplanned_missing_name");
            assert.equal(absent.user, null);
            assert.equal(await users.revalidate(absent), true);
            await admin.query(`INSERT INTO ${table(g,"useridmap")} (userid,user) VALUES (999999,'unplanned_missing_name')`);
            assert.equal(await users.revalidate(absent), false);
            await admin.query(`UPDATE ${table(g,"user")} SET journaltype='I' WHERE userid=900001`);
            await admin.query(`INSERT INTO ${table(g,"identitymap")} (idtype,identity,userid) VALUES ('O','https://identity.example.invalid/',900001)`);
            const identity = await users.snapshot(name);
            assert.equal(identity.user!.identity!.type, "O");
            assert.equal(identity.user!.identity!.value.bytes().toString(), "https://identity.example.invalid/");
            await admin.query(`UPDATE ${table(g,"identitymap")} SET identity='https://changed.example.invalid/' WHERE userid=900001`);
            assert.equal(await users.revalidate(identity), false);
            await admin.query(`UPDATE ${table(g,"useridmap")} SET user='renamed_user' WHERE userid=900001`);
            assert.equal(await users.revalidate(deleted), false);
        } finally {await users.close();}
    }, false, true));

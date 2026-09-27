// public-encodings.test.ts
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
import {execFileSync} from "node:child_process";
import {withSelectedFixture} from "./selected-fixture";
import {MysqlPublicEncodings, encodingName} from "../live/data/public-encodings";
import {NativeString} from "../runtime/native-string";

const oracle = `use strict; use warnings; no warnings 'once';
use lib '/workspaces/dreamwidth/cgi-bin'; use DBI; use JSON::PP; use MIME::Base64 qw(encode_base64);
require '/workspaces/dreamwidth/cgi-bin/ljlib.pl'; my $schema=shift;
die 'isolated schema required' unless $schema =~ /\\As6_selected_[a-f0-9]{16}_g\\z/;
my $db=DBI->connect("DBI:mysql:database=$schema;mysql_socket=/var/run/mysqld/mysqld.sock",'root','',
{RaiseError=>1,PrintError=>0,mysql_enable_utf8=>0}); $db->do('SET NAMES latin1');
$db->do('SET SESSION TRANSACTION READ ONLY'); $db->do('START TRANSACTION READ ONLY');
my %result; { no warnings 'redefine'; local *LJ::get_db_reader=sub{$db};
local *LJ::MemCache::get=sub{undef}; local *LJ::MemCache::set=sub{1}; local %LJ::CACHE_CODES;
LJ::load_codes({encoding=>\\%result}); }
print JSON::PP->new->canonical->encode({map {$_=>encode_base64($result{$_},'')} keys %result});
$db->do('ROLLBACK'); $db->disconnect;`;

test("public encoding table is exact native byte mapping, SELECT-only and freshly witnessed", () =>
    withSelectedFixture(async ({admin, g, table, startup}) => {
        await admin.query(`ALTER TABLE ${table(g,"codes")} ENGINE=MyISAM`);
        const codes = new MysqlPublicEncodings(startup.database);
        try {
            const empty = await codes.snapshot();
            assert.equal(encodingName(empty, 1252), undefined);
            assert.equal(await codes.revalidate(empty), true);
            await admin.query(`INSERT INTO ${table(g,"codes")} (type,code,item,sortorder) VALUES
                ('encoding','1252','windows-1252',2),('encoding','1251','windows-1251',1),
                ('encoding','99',CONVERT(? USING latin1),3),('unrelated','1','private irrelevant',0)`,
                [Buffer.from([255,0,97])]);
            assert.equal(await codes.revalidate(empty), false);
            const current = await codes.snapshot();
            const native = JSON.parse(execFileSync("perl",["-e",oracle,g],{encoding:"utf8",timeout:10000}));
            assert.deepEqual(Object.fromEntries(current.entries.map(([key,value]) =>
                [key.bytes().toString("latin1"),value.bytes().toString("base64")])), native);
            assert.equal(encodingName(current,1252)!.bytes().toString(),"windows-1252");
            assert.equal(await codes.revalidate(current),true);
            assert.equal(await codes.revalidate({...current}),false);
            await admin.query(`UPDATE ${table(g,"codes")} SET item='changed' WHERE type='unrelated'`);
            assert.equal(await codes.revalidate(current),true);
            await admin.query(`UPDATE ${table(g,"codes")} SET item='changed' WHERE type='encoding' AND code='1252'`);
            assert.equal(await codes.revalidate(current),false);
        } finally {await codes.close();}
    }, false, false, true));

test("native duplicate hash assignment follows sorted row order without name normalization", () => {
    const pv=(value:string)=>NativeString.hostUtf8Bytes(value);
    const snapshot={fingerprint:"synthetic",entries:[[pv("1"),pv("first")],[pv("01"),pv("distinct")],
        [pv("1"),pv("0")]] as const};
    assert.equal(encodingName(snapshot,1)!.bytes().toString(),"0");
    assert.equal(encodingName(snapshot,2),undefined);
});

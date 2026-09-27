// general-sticky.test.ts
//
// Actual native sticky capability/order and guarded selected SQL privacy controls.
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

test("native sticky helpers use actual capabilities and ordered active stored IDs",()=>{
    const oracle=String.raw`use strict;use warnings;no warnings 'once';
        use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
        BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
        require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Entry;
        {package StickyUser;our @ISA=('LJ::User');sub prop{die 'Unexpected property' unless $_[1] eq 'sticky_entry';$_[0]->{stored}};}
        local $LJ::CAP_DEF{stickies}=2;local $LJ::T_HAS_ALL_CAPS=0;
        local $LJ::CAP{1}{stickies}=4;
        no warnings 'redefine';local *LJ::Entry::new=sub{my($class,$u,%args)=@_;return {id=>$args{ditemid}};};
        my @out;for my $caps(0,2) {my $u=bless {caps=>$caps,stored=>'769,257,513,1025,'},'StickyUser';
        push @out,{max=>$u->count_max_stickies,active=>[$u->sticky_entry_active_ids],entries=>[map {$_->{id}} $u->sticky_entries]};}
        print encode_json([@out]);`;
    const native=JSON.parse(execFileSync("perl",["-e",oracle],{encoding:"utf8",timeout:10000}));
    assert.deepEqual(native,[{max:2,active:["769","257"],entries:["769","257"]},
        {max:4,active:["769","257","513","1025"],entries:["769","257","513","1025"]}]);
});

test("actual sticky selection prepends visible old/window entries without hidden text reads",async()=>{
    await withSelectedFixture(async({admin,store,g,c,table,request,prop,logProp})=>{
        const set=async(value:string)=>{
            await admin.query(`INSERT INTO ${table(c,"userproplite2")} (userid,upropid,value)
                VALUES (900001,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`,[prop("sticky_entry"),value]);
        };
        const recent=()=>store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:0,itemshow:3}));
        // Old ID1 lies outside the ordinary window; ID299 lies inside it.
        await set("257,76545");
        const first=await recent();assert.ok(first);assert.equal(first.stickyEntryCount,2);
        assert.deepEqual(first.facts.entries.map(entry=>entry.jitemid),[1,299,300,298]);
        assert.equal(first.facts.selection.kind,"recent");
        if(first.facts.selection.kind==="recent")assert.deepEqual(first.facts.selection.window.map(row=>row.jitemid),[298,299,300,297]);
        assert.equal(await store.revalidateNativeSelectedFingerprint(first),true);
        const skip=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:1,itemshow:3}));
        assert.ok(skip);assert.equal(skip.stickyEntryCount,0);assert.equal(skip.facts.entries.some(entry=>entry.jitemid===1),false);
        // Native valid() loads by jitemid and replaces the untrusted low byte.
        const [originalRows]=await admin.query(`SELECT revttime FROM ${table(c,"log2")} WHERE journalid=900001 AND jitemid=1`);
        const originalReverse=(originalRows as {revttime:number}[])[0]!.revttime;
        await admin.query(`UPDATE ${table(c,"log2")} SET anum=5,revttime=0 WHERE journalid=900001 AND jitemid=1`);
        await set("256");
        const mismatch=await store.loadNativeSelectedSnapshot(request("ordinary6",{kind:"recent",skip:0,itemshow:3}));
        assert.ok(mismatch);assert.equal(mismatch.stickyEntryCount,1);
        assert.equal(mismatch.facts.entries[0]?.jitemid,1);
        assert.equal(mismatch.facts.entries[0]?.anum,5);
        assert.equal(mismatch.facts.entries.filter(entry=>entry.jitemid===1).length,2);
        const [nativeRows]=await admin.query(`SELECT * FROM ${table(c,"log2")} WHERE journalid=900001 AND jitemid=1`);
        const loadingOracle=String.raw`use strict;use warnings;no warnings 'once';
            use lib '/workspaces/dreamwidth/cgi-bin';use JSON::PP;
            BEGIN {require DBI;no warnings 'redefine';*DBI::connect=sub{die 'DB forbidden'};*DBI::connect_cached=sub{die 'DB forbidden'};}
            require '/workspaces/dreamwidth/cgi-bin/ljlib.pl';require LJ::Entry;
            my $row=decode_json($ARGV[0]);my $u=bless {userid=>900001},'LJ::User';my @reads;
            no warnings 'redefine';local *LJ::want_user=sub{$u};
            local *LJ::get_log2_row=sub{push @reads,$_[1];die 'Unexpected row' unless $_[1]==1;return $row;};
            my $entry=LJ::Entry->new($u,ditemid=>256);my $valid=$entry->valid;
            print encode_json({valid=>$valid?1:0,jitemid=>$entry->jitemid,anum=>$entry->anum,
                displayed=>($entry->jitemid<<8)+$entry->anum,reads=>\@reads});`;
        const loaded=JSON.parse(execFileSync("perl",["-e",loadingOracle,JSON.stringify((nativeRows as unknown[])[0])],
            {encoding:"utf8",timeout:10000}));
        assert.deepEqual(loaded,{valid:1,jitemid:1,anum:5,displayed:261,reads:[1]});
        assert.equal(await store.revalidateNativeSelectedFingerprint(mismatch),true);
        await admin.query(`UPDATE ${table(c,"log2")} SET anum=1,revttime=? WHERE journalid=900001 AND jitemid=1`,[originalReverse]);
        assert.equal(await store.revalidateNativeSelectedFingerprint(mismatch),false);
        await set("257,76545");
        // Both candidates must fail native visible_to before a body read.
        await admin.query(`UPDATE ${table(c,"log2")} SET security='private' WHERE journalid=900001 AND jitemid=1`);
        await admin.query(`INSERT INTO ${table(c,"logprop2")} (journalid,jitemid,propid,value) VALUES (900001,299,?,'S')`,[logProp("statusvis")]);
        await admin.query(`DELETE FROM ${table(c,"logtext2")} WHERE journalid=900001 AND jitemid IN (1,299)`);
        const hidden=await recent();assert.ok(hidden);assert.equal(hidden.stickyEntryCount,0);
        assert.deepEqual(hidden.facts.entries.map(entry=>entry.jitemid),[300,298]);
        assert.equal(hidden.sources.some(cell=>/^entry:(?:1|299):(?:subject|event)$/.test(cell.key)),false);
        assert.equal(await store.revalidateNativeSelectedFingerprint(first),false);
        assert.equal(await store.revalidateNativeSelectedFingerprint(hidden),true);
        // A property-only ordering change invalidates even hidden sticky facts.
        await set("76545,257");assert.equal(await store.revalidateNativeSelectedFingerprint(hidden),false);
        // Restore public headers/text and exact status; fresh selection recovers.
        await admin.query(`UPDATE ${table(c,"log2")} SET security='public' WHERE journalid=900001 AND jitemid=1`);
        await admin.query(`DELETE FROM ${table(c,"logprop2")} WHERE journalid=900001 AND jitemid=299 AND propid=?`,[logProp("statusvis")]);
        await admin.query(`INSERT INTO ${table(c,"logtext2")} (journalid,jitemid,subject,event)
            VALUES (900001,1,'Restored','Restored'),(900001,299,'Restored','Restored')`);
        const recovered=await recent();assert.ok(recovered);assert.equal(recovered.stickyEntryCount,2);
        assert.deepEqual(recovered.facts.entries.map(entry=>entry.jitemid),[299,1,300,298]);
    });
});

// general-request-calendar.test.ts
//
// Request-scoped native calendar binding for the installed Page factory.
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

import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {NativeNumber,NativeString,scalarPV} from "../runtime/native-scalar";
import {loadGeneralCalendarProfile} from "../live/domain/general-native-calendar";
import {generalRequestCalendar} from "../live/render/general-request-calendar";
import {generalWorkerFactory} from "../live/render/general-worker-factory";
import {GeneralWorkerChannel} from "../live/render/general-worker-channel";

test("one native calendar session spans date and Entry logtime calls, fresh for next request",()=>{
    const scalar=JSON.parse(execFileSync("perl",["tools/compile-active.pl"],{
        input:JSON.stringify({profileOnly:true}),encoding:"utf8",timeout:30000,
        maxBuffer:8*1024*1024})).profile;
    const raw=JSON.parse(execFileSync("/usr/bin/prlimit",[
        "--as=268435456","--cpu=10","--","perl","tools/native-calendar-profile.pl"],{
        env:{...process.env,TZ:"UTC"},encoding:"utf8",timeout:15000,maxBuffer:4*1024*1024}));
    const profile=loadGeneralCalendarProfile(raw,scalar),effects:string[]=[];
    const first=generalRequestCalendar(profile,effect=>effects.push(effect.kind));
    const year=(value:number)=>NativeNumber.integer(BigInt(value));
    const date=(value:number)=>({_year:year(value),_month:year(1),_day:year(1)});
    const original=first.dates.dayOfWeek(undefined!,date(2026));
    const warmed=first.dates.dayOfWeek(undefined!,date(67562));
    const fresh=generalRequestCalendar(profile,()=>{}).dates.dayOfWeek(undefined!,date(67562));
    assert.notEqual(scalarPV(warmed).bytes().toString(),scalarPV(fresh).bytes().toString());
    assert.equal(scalarPV(original).bytes().toString(),"4");
    const mysql=first.mysqlDateToTime(NativeString.bytes(Buffer.from("2026-01-01 00:00:00")));
    assert.equal(mysql.kind,"returned");
    assert.deepEqual(effects,["cleared","cleared","cleared"]);
    assert.throws(()=>generalRequestCalendar({schema:1},()=>{}),/Unissued/);
});

test("Page factory requires one date authority and never silently chooses a stub",()=>{
    const channel=new GeneralWorkerChannel("a".repeat(64));
    assert.throws(()=>generalWorkerFactory(channel,{} as never),/Exactly one installed calendar/);
    assert.throws(()=>generalWorkerFactory(channel,{dates:{dayOfWeek:()=>0},
        calendarProfile:{schema:1}} as never),/Exactly one installed calendar/);
});

// general-model-date.ts
//
// Native public DateTime construction from approved clock and SQL date parts.
//
// Portions adapted from LJ::S2 object constructors, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import {NativeString,NativeNumber,scalarPV,scalarNumber} from "../../runtime/native-scalar";
import {byteCharacters,characterCodepoint} from "../../runtime/native-string";
import {arithmetic} from "../../runtime/native-number";
import {nativeCharacterClass,type NativeProfile} from "../../runtime/native-profile";
import type {GeneralModel} from "./general-model-primitives";

function numeric(value:unknown):NativeNumber {
    return arithmetic("+",scalarNumber(value),NativeNumber.integer(0n));
}

/** LJ::alldatepart_s2 for an already validated SQL civil timestamp, in UTC. */
export function generalMysqlDateParts(value:string):NativeString {
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
        throw Error("Invalid approved civil timestamp");
    const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
    const hour=Number(value.slice(11,13)),minute=Number(value.slice(14,16)),second=Number(value.slice(17,19));
    const date=new Date(0);
    date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
    if(year<1000||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||
        date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||
        date.getUTCSeconds()!==second)throw Error("Invalid approved civil timestamp");
    return NativeString.bytes(Buffer.from(value.replace(/[-:]/g," ")+" "+date.getUTCDay(),"ascii"));
}
/** Native split /\s+/ has leading empties and drops trailing empties. */
function dateParts(value:unknown,profile:NativeProfile):NativeString[] {
    const input=scalarPV(value),flag=input.flagged();
    const units=byteCharacters(input).map(character=>({point:characterCodepoint(character),bytes:character.bytes()}));
    const parts:NativeString[]=[];let pending:Buffer[]=[];let separator=false;
    for(const unit of units) {
        if(unit.point<=0x10ffffn&&nativeCharacterClass(profile,"space",Number(unit.point),flag)) {
            if(!separator)parts.push(NativeString.fromFrame({bytes:Buffer.concat(pending),utf8:flag}));
            pending=[];separator=true;
        }else {pending.push(unit.bytes);separator=false;}
    }
    parts.push(NativeString.fromFrame({bytes:Buffer.concat(pending),utf8:flag}));
    while(parts.at(-1)?.bytes().length===0)parts.pop();
    return parts;
}
/** Input is an approved native date-parts scalar, never a raw SQL record. */
export function generalDateTimeParts(value:unknown,profile:NativeProfile):GeneralModel {
    const parts=dateParts(value,profile),model:GeneralModel={".type":"DateTime"};
    for(const [index,name] of ["year","month","day","hour","min","sec"].entries())
        model["_"+name]=numeric(parts[index]);
    if(parts[6]!==undefined)model._dayofweek=arithmetic("+",scalarNumber(parts[6]),NativeNumber.integer(1n));
    return model;
}
/** Page time/local_time use an integral trusted request clock for anonymous views. */
export function generalDateTimeClock(seconds:number):GeneralModel {
    if(!Number.isSafeInteger(seconds))throw Error("Invalid approved request clock");
    const date=new Date(seconds*1000);
    if(!Number.isFinite(date.getTime()))throw Error("Request clock outside host time representation");
    return {".type":"DateTime",_year:numeric(date.getUTCFullYear()),_month:numeric(date.getUTCMonth()+1),
        _day:numeric(date.getUTCDate()),_hour:numeric(date.getUTCHours()),_min:numeric(date.getUTCMinutes()),
        _sec:numeric(date.getUTCSeconds()),_dayofweek:numeric(date.getUTCDay()+1)};
}

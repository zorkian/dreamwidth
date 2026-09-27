// general-model-primitives.ts
//
// Native public Image, Link, Date and CommentInfo model constructors.
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

import {runtime} from "../../runtime/s2runtime";
import {NativeNumber,scalarNumber,nativeProgramError} from "../../runtime/native-scalar";
import {arithmetic,numericCompare} from "../../runtime/native-number";

export type GeneralModel=Record<string,unknown>;
export type GeneralExtra=readonly (readonly [unknown,unknown])[];
const zero=()=>NativeNumber.integer(0n);
const plusZero=(value:unknown)=>arithmetic("+",scalarNumber(value),zero());

/** These helpers receive named approved fields, not a raw SQL/source bag. */
export function generalImage(url:unknown,width:unknown,height:unknown,alttext:unknown,
    extra:GeneralExtra=[]):GeneralModel {
    return {".type":"Image",_url:runtime.scalarCopy(url),_width:runtime.scalarCopy(width),
        _height:runtime.scalarCopy(height),_alttext:runtime.scalarCopy(alttext),_extra:runtime.makeHash(extra)};
}
export function generalLink(url:unknown,caption:unknown,icon:unknown,extra:GeneralExtra=[]):GeneralModel {
    return {".type":"Link",_url:runtime.scalarCopy(url),_caption:runtime.scalarCopy(caption),
        _icon:icon,_extra:runtime.makeHash(extra)};
}
export function generalNull(type:string):GeneralModel {return {".type":type,".isnull":true};}
export function generalDate(year:unknown,month:unknown,day:unknown,dayOfWeek?:unknown):GeneralModel {
    const model={".type":"Date",_year:plusZero(year),_month:plusZero(month),_day:plusZero(day),
        _dayofweek:runtime.scalarCopy(dayOfWeek)};
    if(dayOfWeek!==undefined && dayOfWeek!==null && numericCompare(scalarNumber(dayOfWeek),zero())===0)
        throw nativeProgramError("S2 Builtin Date() takes day of week 1-7, not 0-6");
    return model;
}
/** Native order is OTHER compared to THIS, including absent time fields as zero. */
export function generalDateCompare(thisDate:GeneralModel,other:GeneralModel):NativeNumber {
    for(const field of ["year","month","day","hour","min","sec"]) {
        const result=numericCompare(scalarNumber(other["_"+field]),scalarNumber(thisDate["_"+field]));
        if(result!==0)return NativeNumber.integer(BigInt(result));
    }
    return zero();
}
/** Native CommentInfo preserves the caller's object identity and other public fields. */
export function generalCommentInfo(options:GeneralModel):GeneralModel {
    options[".type"]="CommentInfo";options._count=plusZero(options._count);return options;
}

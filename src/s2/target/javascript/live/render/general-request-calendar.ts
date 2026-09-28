// general-request-calendar.ts
//
// One native calendar cache for all date operations in an anonymous request.
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

import type {GeneralModel} from "../domain/general-model-primitives";
import {createGeneralCalendarSession,generalNativeDayOfWeek,generalNativeMysqlDateToTime,
    type GeneralCalendarProfile,type GeneralCalendarResult,type GeneralMysqlDateResult} from
    "../domain/general-native-calendar";
import type {NativeString} from "../../runtime/native-scalar";
import type {GeneralDateOperations} from "./general-date-builtins";

type Effect=GeneralCalendarResult["exceptionEffect"]|GeneralMysqlDateResult["exceptionEffect"];

/** The installed profile is service-wide; Time::Local's mutable cache is request-wide. */
export function generalRequestCalendar(profile:GeneralCalendarProfile,
    applyEffect:(effect:Effect)=>void):{
        readonly dates:GeneralDateOperations;
        mysqlDateToTime(civil:NativeString|undefined):GeneralMysqlDateResult;
    } {
    const session=createGeneralCalendarSession(profile);
    return Object.freeze({
        dates:Object.freeze({dayOfWeek(_context:unknown,model:GeneralModel):unknown {
            const result=generalNativeDayOfWeek(session,model._year,model._month,model._day);
            applyEffect(result.exceptionEffect);
            return result.value;
        }}),
        mysqlDateToTime(civil:NativeString|undefined):GeneralMysqlDateResult {
            const result=generalNativeMysqlDateToTime(session,civil);
            applyEffect(result.exceptionEffect);
            return result;
        },
    });
}

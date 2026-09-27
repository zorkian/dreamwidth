// general-date-builtins.ts
//
// Native date/time format tokens and request-local formatter caches.
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
// Semantic ports from LJ/S2.pm, originally forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and subsequently modified by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. A copy of that license is
// included in the LICENSE file in this distribution.
//
import { runtime, type Context, type BuiltinFunction } from '../../runtime/s2runtime';
import { NativeString, NativeNumber, scalarPV, scalarNumber, scalarTruthy, scalarConcat } from '../../runtime/native-scalar';
import { arithmetic, modulo, numericCompare, arrayIndex, intCast } from '../../runtime/native-number';
import { splitString, compareStrings, hashKeyBytes } from '../../runtime/native-string';
import { escapeNativeHtml } from './general-diagnostics';
import type { GeneralModel } from '../domain/general-model-primitives';
export interface GeneralDateOperations {
    dayOfWeek(ctx: Context, model: GeneralModel): unknown;
}
type Formatter = (model: GeneralModel) => NativeString;
interface Cache {
    date: unknown;
    time: unknown;
    dateCount: number;
    timeCount: number;
}
const bytes = NativeString.hostUtf8Bytes;
function padded(value: unknown): NativeString {
    const number = scalarNumber(value), integer = intCast(number), pv = scalarPV(integer).bytes().toString('latin1');
    if (pv === 'NaN' || pv === 'Inf' || pv === '-Inf')
        return bytes(pv);
    const text = arrayIndex(number).toString();
    return bytes(text.length >= 2 ? text : text.padStart(2, '0'));
}
/** Fixed native vocabulary replaces generated eval, preserving captured literals. */
export function generalDateCallbacks(operations: GeneralDateOperations): Record<string, BuiltinFunction> {
    const caches = new WeakMap<Context, Cache>();
    function day(ctx: Context, model: GeneralModel): unknown {
        if (model._dayofweek !== undefined && model._dayofweek !== null)
            return model._dayofweek;
        return model._dayofweek = arithmetic('+', scalarNumber(operations.dayOfWeek(ctx, model)), NativeNumber.integer(1n));
    }
    function token(ctx: Context, model: GeneralModel, name: string): unknown {
        const field = (key: string) => model['_' + key];
        const alias = (key: string) => runtime.captureOperand(runtime.memberSlot(model, '_' + key, 'field'));
        switch (name) {
            case 'm': return alias('month');
            case 'd': return alias('day');
            case 'yyyy': return alias('year');
            case 'H': return alias('hour');
            case 'mm': return padded(field('month'));
            case 'dd': return padded(field('day'));
            case 'HH': return padded(field('hour'));
            case 'yy': return padded(modulo(scalarNumber(field('year')), NativeNumber.integer(100n)));
            case 'min': return padded(field('min'));
            case 'sec': return padded(field('sec'));
            case 'h':
            case 'hh': {
                const value = modulo(scalarNumber(field('hour')), NativeNumber.integer(12n));
                const hour = scalarTruthy(value) ? value : NativeNumber.integer(12n);
                return name === 'hh' ? padded(hour) : hour;
            }
            case 'a':
            case 'A': return bytes(numericCompare(scalarNumber(field('hour')), NativeNumber.integer(12n)) < 0 ? (name === 'a' ? 'a' : 'A') : (name === 'a' ? 'p' : 'P'));
            case 'mon':
            case 'month':
            case 'da':
            case 'day': {
                const property = name === 'mon' ? '_lang_monthname_short' : name === 'month' ? '_lang_monthname_long' : name === 'da' ? '_lang_dayname_short' : '_lang_dayname_long';
                let values = ctx.prop[property];
                if (values === undefined || values === null)
                    values = ctx.prop[property] = [];
                // Native undef property autovivifies an array before reading its index.
                const key = name === 'mon' || name === 'month' ? field('month') : day(ctx, model);
                return runtime.captureOperand(runtime.memberSlot(values, key, 'array'));
            }
            case 'dayord': return ctx.runNativeFunction('lang_ordinal(int)', [field('day')], 'ordinal');
            default: return undefined;
        }
    }
    function format(ctx: Context, model: GeneralModel, input: unknown, asLink: unknown, time: boolean): NativeString {
        const fmt = scalarTruthy(input) ? scalarPV(input) : bytes('short'), link = scalarTruthy(asLink) ? asLink : bytes('');
        let state = caches.get(ctx);
        if (!state) {
            state = { date: runtime.makeHash([]), time: runtime.makeHash([]), dateCount: 0, timeCount: 0 };
            caches.set(ctx, state);
        }
        const cache = time ? state.time : state.date, key = time ? fmt : scalarConcat(fmt, link);
        const slot = runtime.memberSlot(cache, key, 'hash'), hit = slot.get() as Formatter | undefined;
        if (hit)
            return hit(model);
        if ((time ? ++state.timeCount : ++state.dateCount) > 15)
            return bytes('[too_many_fmts]');
        const metadata = hashKeyBytes(scalarConcat(bytes(time ? 'lang_fmt_time_' : 'lang_fmt_date_'), fmt));
        const propertyName = metadata.utf8 ? '\0native-wide:' + metadata.bytes.toString('hex') : metadata.bytes.toString('latin1');
        const property = ctx.prop['_' + propertyName];
        const real = property !== undefined && property !== null ? scalarPV(property) : !time && compareStrings(fmt, bytes('iso')) === 0 ? bytes('%%yyyy%%-%%mm%%-%%dd%%') : fmt;
        const parts = splitString(real, bytes('%%')).map((part, index) => index % 2 ? part : escapeNativeHtml(part));
        const compiled: Formatter = value => {
            const operands: unknown[] = [];
            // Native join reads live field/element SVs only after the whole list,
            // including arbitrary ordinal reentry. Computed tokens stay snapshots.
            for (const [index, part] of parts.entries()) {
                if (!(index % 2)) {
                    operands.push(part);
                    continue;
                }
                const name = part.bytes().toString('latin1');
                const kind = ['d', 'dd', 'dayord'].includes(name) ? 'day' : ['m', 'mm', 'mon', 'month'].includes(name) ? 'month' : ['yy', 'yyyy'].includes(name) ? 'year' : undefined;
                if (!time && scalarTruthy(link) && kind) {
                    operands.push(bytes('<a href="/'));
                    operands.push(token(ctx, value, 'yyyy'));
                    operands.push(bytes('/'));
                    if (kind !== 'year') {
                        operands.push(token(ctx, value, 'mm'));
                        operands.push(bytes('/'));
                    }
                    if (kind === 'day') {
                        operands.push(token(ctx, value, 'dd'));
                        operands.push(bytes('/'));
                    }
                    operands.push(bytes('">'));
                    operands.push(token(ctx, value, name));
                    operands.push(bytes('</a>'));
                }
                else
                    operands.push(token(ctx, value, name));
            }
            let output = bytes('');
            for (const operand of runtime.operandList(operands))
                output = scalarConcat(output, operand);
            return output;
        };
        slot.set(compiled);
        return compiled(model);
    }
    const date: BuiltinFunction = (ctx, model, fmt, link) => format(ctx, model, fmt, link, false);
    const weekday: BuiltinFunction = (ctx, model) => day(ctx, model);
    return { _Date__date_format: date, _DateTime__date_format: date, _Date__day_of_week: weekday, _DateTime__day_of_week: weekday,
        _DateTime__time_format: (ctx, model, fmt) => format(ctx, model, fmt, undefined, true) };
}

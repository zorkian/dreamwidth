// objects.ts
//
// Source-derived preparation for the bounded stock S2 page.
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

export type S2Object = Record<string, any>;
export function object(type: string, fields: S2Object = {}): S2Object {
    const value: S2Object = { ".type": type, _type: type };
    for (const [name, field] of Object.entries(fields)) {
        value[`_${name}`] = field;
        Object.defineProperty(value, name, {
            enumerable: true, get: () => value[`_${name}`],
            set: next => { value[`_${name}`] = next; },
        });
    }
    return value;
}
export function nullObject(type: string): S2Object {
    return { ".type": type, ".isnull": true, _type: type, _isnull: 1 };
}
export function date(time: string | number): S2Object {
    const d = new Date(typeof time === "number" ? time * 1000 : time.replace(" ", "T") + "Z");
    return object("DateTime", {year: d.getUTCFullYear(), month: d.getUTCMonth() + 1,
        day: d.getUTCDate(), hour: d.getUTCHours(), min: d.getUTCMinutes(), sec: d.getUTCSeconds(),
        _dayofweek: d.getUTCDay() + 1});
}

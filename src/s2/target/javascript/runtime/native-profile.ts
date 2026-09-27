// native-profile.ts
//
// Trusted installed Perl scalar and Unicode mapping profile data.
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

export interface NativeCaseMap {
    readonly ranges: readonly number[];
    readonly values: readonly (number | readonly number[])[];
}
export interface NativeProfile {
    readonly version: string;
    readonly archname: string;
    readonly ivsize: string;
    readonly uvsize: string;
    readonly nvsize: string;
    readonly nvtype: string;
    readonly nv_preserves_uv_bits: string;
    readonly unicodeVersion: string;
    readonly lower: NativeCaseMap;
    readonly upper: NativeCaseMap;
    readonly title: NativeCaseMap;
}

export function mapNativeCase(codepoint: number, table: NativeCaseMap): readonly number[] {
    let low = 0, high = table.ranges.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (table.ranges[middle]! <= codepoint) low = middle + 1;
        else high = middle;
    }
    const index = low - 1, mapped = table.values[index];
    if (mapped === undefined || mapped === 0) return [codepoint];
    if (typeof mapped === 'number') return [mapped + codepoint - table.ranges[index]!];
    return mapped;
}

// location.ts
//
// Native coordinate grammar and exact binary half-even display rounding.
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

// Source ports: cgi-bin/LJ/Location.pm and cgi-bin/LJ/Entry.pm. Those files
// were forked from LiveJournal, owned and operated by Live Journal, Inc., and
// modified by Dreamwidth Studios, LLC. The inherited license can be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// These ports and modifications are provided under the GNU General Public
// License. See the LICENSE file included with this distribution.

// sprintf operates on binary doubles. Scale the exact IEEE-754 rational,
// rather than multiplying first (which can introduce a second rounding).
export function coordinateFixed(value: number): string {
    const negative = value < 0 || Object.is(value, -0);
    const buffer = new ArrayBuffer(8), view = new DataView(buffer);
    view.setFloat64(0, Math.abs(value));
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
    const shift = (exponent ? exponent - 1023 : -1022) - 52;
    numerator *= 10000n;
    const denominator = shift < 0 ? 1n << BigInt(-shift) : 1n;
    if (shift > 0) numerator <<= BigInt(shift);
    let rounded = numerator / denominator;
    const remainder = numerator % denominator;
    if (2n * remainder > denominator || (2n * remainder === denominator && rounded % 2n)) rounded++;
    const digits = rounded.toString().padStart(5, "0");
    return (negative ? "-" : "") + digits.slice(0, -4) + "." + digits.slice(-4);
}
export function locationCurrent(coords: string | null | undefined,
    location: string | null | undefined): string | undefined {
    const truth = (value: string | null | undefined): boolean => !!value && value !== "0";
    if (!truth(coords)) return truth(location) ? location! : undefined;
    const hemisphere = /^(\d+\.\d+)[\t\n\r\f\v ]*([NS])[\t\n\r\f\v ]*,?[\t\n\r\f\v ]*(\d+\.\d+)[\t\n\r\f\v ]*([EW])$/i.exec(coords!);
    const signed = /^(-?\d+\.\d+)[\t\n\r\f\v ]*,?[\t\n\r\f\v ]*(-?\d+\.\d+)$/.exec(coords!);
    if (!hemisphere && !signed) return ""; // caught native construction; existing empty key
    const lat = hemisphere ? Number(hemisphere[1]) * (hemisphere[2]!.toUpperCase() === "S" ? -1 : 1) : Number(signed![1]);
    const lon = hemisphere ? Number(hemisphere[3]) * (hemisphere[4]!.toUpperCase() === "W" ? -1 : 1) : Number(signed![2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return "";
    if (truth(location)) return location!;
    // N/E captures remain decimal strings (Perl-true even for zero). S/W
    // unary minus converts to a numeric scalar: both numeric zeros are false.
    if (hemisphere && hemisphere[2]!.toUpperCase()==="S" && hemisphere[4]!.toUpperCase()==="W" &&
        lat===0 && lon===0) return "";
    return coordinateFixed(lat) + "," + coordinateFixed(lon);
}

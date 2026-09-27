// native-number.ts
//
// Perl IV/UV64 and IEEE754 NV scalar operations for compiled S2 programs.
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
// Native arithmetic/coercion branches are adapted from Perl 5.34 sv.c and pp.c:
// Copyright (C) 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
// 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009 by Larry Wall and others.
// You may distribute under the terms of either the GNU General Public License
// or the Artistic License, as specified in Perl's README file.
//

import {NativeString} from './native-string';

export const NUMERIC_PROFILE = 'perl-5.34-ivuv64-nv64-preserve-ivuv-nvbits53-digits15-v1';
const IV_MIN = -(1n << 63n), IV_MAX = (1n << 63n) - 1n, UV_MAX = (1n << 64n) - 1n;
type IntegerCache = {mode: 'iv' | 'uv'; value: bigint; valid: boolean};
type Numeric = {mode: 'iv' | 'uv'; value: bigint} | {mode: 'nv'; value: number; integerCache?: IntegerCache};
interface State { numeric: Numeric; original?: NativeString }
interface NumericWire {
    mode: 'iv' | 'uv' | 'nv';
    value: string;
    integerCache?: {mode: 'iv' | 'uv'; value: string; valid: boolean};
    original?: {base64: string; utf8: boolean};
}
const states = new WeakMap<NativeNumber, State>();

export class NativeNumber {
    private constructor(state: State) {
        states.set(this, {...state, numeric: {...state.numeric}, ...(state.original ? {original: state.original.clone()} : {})});
        Object.freeze(this);
    }
    static integer(value: bigint): NativeNumber {
        if (value >= IV_MIN && value <= IV_MAX) return new NativeNumber({numeric: {mode: 'iv', value}});
        if (value >= 0 && value <= UV_MAX) return new NativeNumber({numeric: {mode: 'uv', value}});
        return NativeNumber.nv(Number(value));
    }
    static uv(value: bigint): NativeNumber {
        if (value < 0n || value > UV_MAX) throw new Error('Invalid target UV');
        return new NativeNumber({numeric: {mode: 'uv', value}});
    }
    static nv(value: number): NativeNumber { return new NativeNumber({numeric: {mode: 'nv', value}}); }
    static is(value: unknown): value is NativeNumber {
        return typeof value === 'object' && value !== null && states.has(value as NativeNumber);
    }
    static fromPV(value: NativeString, warning?: (message: string) => void): NativeNumber {
        const text = value.bytes().toString('latin1');
        const match = /^[\t\n\r\f\v ]*([+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Inf(?:inity)?|NaN))/i.exec(text);
        const complete = !!match && /^[\t\n\r\f\v ]*$/.test(text.slice(match[0].length));
        if ((!complete && text !== '0 but true')) warning?.('Argument is not numeric');
        const lexeme = match?.[1] ?? '0';
        if (text === '0 but true' || complete && /^[+-]?\d+$/.test(lexeme)) {
            return new NativeNumber({numeric: state(parseDecimalInteger(lexeme)).numeric, original: value});
        }
        const numeric: Numeric = {mode: 'nv', value: /^[-+]?inf/i.test(lexeme)
            ? (lexeme.startsWith('-') ? -Infinity : Infinity) : Number(lexeme)};
        // grok_number keeps the pre-radix integer approximation for a complete
        // decimal without an exponent. It is private IOKp, never precise IOK.
        const decimal = complete && /^([+-]?)(\d*)\.(\d*)$/.exec(lexeme);
        if (decimal && decimal[2]!.replace(/^0+/, '').length <= 20) {
            const integer = BigInt((decimal[1] === '-' ? '-' : '') + (decimal[2] || '0'));
            if (integer >= IV_MIN && integer <= UV_MAX) {
                numeric.integerCache = {mode: integer > IV_MAX ? 'uv' : 'iv', value: integer, valid: false};
            }
        }
        if (!numeric.integerCache) integerEligible(numeric);
        // Failed whole-PV numeric recognition clears public numeric flags even
        // when Atof successfully read a small prefix. Its private SvIV remains.
        if (!complete) numeric.integerCache!.valid = false;
        return new NativeNumber({numeric, original: value});
    }
    static literal(lexeme: string): NativeNumber {
        if (/^[+-]?\d+$/.test(lexeme)) return parseDecimalInteger(lexeme);
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(lexeme)) {
            throw new Error('Invalid native numeric literal');
        }
        return NativeNumber.nv(Number(lexeme));
    }
    static fromWire(wire: NumericWire): NativeNumber {
        let numeric: Numeric;
        if (wire.mode === 'nv') {
            if (!/^[0-9a-f]{16}$/.test(wire.value)) throw new Error('Invalid native NV wire bits');
            numeric = {mode: 'nv', value: Buffer.from(wire.value, 'hex').readDoubleBE()};
        } else {
            if (wire.value.length > 21 || !/^-?(?:0|[1-9][0-9]*)$/.test(wire.value)) throw new Error('Invalid native integer wire');
            const value = BigInt(wire.value);
            if (wire.mode === 'iv' ? value < IV_MIN || value > IV_MAX : wire.mode !== 'uv' || value < 0n || value > UV_MAX) {
                throw new Error('Native integer wire outside target range');
            }
            numeric = {mode: wire.mode, value};
        }
        if (wire.integerCache) {
            const cache = wire.integerCache;
            if (numeric.mode !== 'nv' || typeof cache.valid !== 'boolean' ||
                cache.value.length > 21 || !/^-?(?:0|[1-9][0-9]*)$/.test(cache.value)) {
                throw new Error('Invalid native integer cache wire');
            }
            const value = BigInt(cache.value);
            if (cache.mode === 'iv' ? value < IV_MIN || value > IV_MAX :
                cache.mode !== 'uv' || value < 0n || value > UV_MAX) {
                throw new Error('Native integer cache outside target range');
            }
            numeric.integerCache = {mode: cache.mode, value, valid: cache.valid};
        }
        let original: NativeString | undefined;
        if (wire.original) {
            const bytes = Buffer.from(wire.original.base64, 'base64');
            if (bytes.toString('base64') !== wire.original.base64 || typeof wire.original.utf8 !== 'boolean') throw new Error('Invalid native original PV wire');
            original = wire.original.utf8 ? NativeString.flagged(bytes) : NativeString.bytes(bytes);
        }
        return new NativeNumber({numeric, ...(original ? {original} : {})});
    }
    mode(): Numeric['mode'] { return state(this).numeric.mode; }
    clone(): NativeNumber { return new NativeNumber(state(this)); }
    pv(): NativeString {
        const data = state(this);
        return data.original?.clone() ?? NativeString.hostUtf8Bytes(data.numeric.mode === 'nv'
            ? formatNV(data.numeric.value) : data.numeric.value.toString());
    }
    wire(): NumericWire {
        const data = state(this), n = data.numeric;
        const bits = Buffer.alloc(8);
        if (n.mode === 'nv') bits.writeDoubleBE(n.value);
        return {mode: n.mode, value: n.mode === 'nv' ? bits.toString('hex') : n.value.toString(),
            ...(n.mode === 'nv' && n.integerCache ? {integerCache: {
                mode: n.integerCache.mode, value: n.integerCache.value.toString(),
                valid: n.integerCache.valid}} : {}),
            ...(data.original ? {original: {base64: data.original.bytes().toString('base64'),
                utf8: data.original.flagged()}} : {})};
    }
}
function parseDecimalInteger(lexeme: string): NativeNumber {
    const digits=lexeme.replace(/^[+-]/,'').replace(/^0+/, '');
    return digits.length <= 20 ? NativeNumber.integer(BigInt((lexeme.startsWith('-') ? '-' : '') + (digits || '0'))) : NativeNumber.nv(Number(lexeme));
}
function state(value: NativeNumber): State {
    const result = states.get(value);
    if (!result) throw new Error('Unbranded native numeric scalar');
    return result;
}
function numeric(value: NativeNumber): Numeric { return state(value).numeric; }
function nv(value: Numeric): number { return Number(value.value); }
function integerEligible(value: Numeric): bigint | undefined {
    if (value.mode !== 'nv') return value.value;
    if (value.integerCache) return value.integerCache.valid ? value.integerCache.value : undefined;
    let integer=0n, mode:'iv'|'uv'='iv';
    if(Number.isNaN(value.value)) {integer=0n;mode='uv';}
    else if(value.value < Number(IV_MIN))integer=IV_MIN;
    else if(value.value >= 2**64) {integer=UV_MAX;mode='uv';}
    else if(Number.isFinite(value.value)) {
        integer=BigInt(Math.trunc(value.value));mode=integer>IV_MAX?'uv':'iv';
    } else if(value.value>0) {integer=UV_MAX;mode='uv';}
    else integer=IV_MIN;
    const valid=Number.isFinite(value.value)&&Number.isInteger(value.value)&&Math.abs(value.value)<2**53;
    value.integerCache={mode,value:integer,valid};
    return valid?integer:undefined;
}
function losslessSignedNV(value: Numeric): bigint | undefined {
    if(value.mode!=='nv'||!Number.isFinite(value.value)||!Number.isInteger(value.value)||
        value.value<Number(IV_MIN)||value.value>=2**63)return undefined;
    return BigInt(value.value);
}

export function arithmetic(op: '+' | '-' | '*', left: NativeNumber, right: NativeNumber): NativeNumber {
    const a = numeric(left), b = numeric(right);
    const bothNV=a.mode==='nv'&&b.mode==='nv';
    const ai=bothNV?losslessSignedNV(a):integerEligible(a), bi=bothNV?losslessSignedNV(b):integerEligible(b);
    if (ai !== undefined && bi !== undefined) {
        const result = op === '+' ? ai + bi : op === '-' ? ai - bi : ai * bi;
        if (result >= IV_MIN && result <= UV_MAX) return NativeNumber.integer(result);
    }
    const x = nv(a), y = nv(b);
    return NativeNumber.nv(op === '+' ? x + y : op === '-' ? x - y : x * y);
}
export function intCast(value: NativeNumber): NativeNumber {
    const n = numeric(value);
    if (n.mode !== 'nv') return NativeNumber.integer(n.value);
    if (!Number.isFinite(n.value)) return NativeNumber.nv(n.value);
    const truncated = Math.trunc(n.value), exact = BigInt(truncated);
    return exact >= IV_MIN && exact <= UV_MAX ? NativeNumber.integer(exact) : NativeNumber.nv(truncated);
}
export function divide(left: NativeNumber, right: NativeNumber): NativeNumber {
    const a = numeric(left), b = numeric(right), ai = integerEligible(a), bi = integerEligible(b);
    if (nv(b) === 0) throw new Error('Illegal division by zero');
    if (ai !== undefined && bi !== undefined) {
        const absA = ai < 0 ? -ai : ai, absB = bi < 0 ? -bi : bi;
        if (absA >= absB && absA > (1n << 53n) && ai % bi === 0n) {
            const quotient = ai / bi;
            if (quotient >= IV_MIN && quotient <= UV_MAX) return NativeNumber.integer(quotient);
        }
    }
    return NativeNumber.nv(nv(a) / nv(b));
}
export function numericCompare(left: NativeNumber, right: NativeNumber): number {
    const a = numeric(left), b = numeric(right);
    if (a.mode !== 'nv' && b.mode !== 'nv') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    const x = nv(a), y = nv(b);
    return Number.isNaN(x) || Number.isNaN(y) ? NaN : x < y ? -1 : x > y ? 1 : 0;
}
export function arrayIndex(value: NativeNumber): bigint {
    const n = numeric(value);
    if (n.mode !== 'nv') return BigInt.asIntN(64, n.value);
    // Array access calls SvIV, not the language int operator. Its private
    // integer cache remains usable even when rounding made public IOK false.
    integerEligible(n);
    return BigInt.asIntN(64, n.integerCache!.value);
}
export function exactHostInteger(value: NativeNumber, min: number, max: number): number {
    const n = numeric(value);
    if (n.mode === 'nv' || n.value < BigInt(min) || n.value > BigInt(max)) {
        throw new Error('Native scalar is not an exact bounded host integer');
    }
    return Number(n.value);
}

// Native Gconvert uses NV_DIG=15. Exponent spelling is independent of JS's
// shortest-roundtrip Number.toString; negative zero prints as ordinary zero.
export function formatNV(value: number): string {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value < 0 ? '-Inf' : 'Inf';
    if (value === 0) return '0';
    const negative = value < 0, magnitude = Math.abs(value);
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(magnitude);
    const bits = bytes.readBigUInt64BE(), exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fraction = bits & ((1n << 52n) - 1n);
    const mantissa = exponentBits === 0 ? fraction : fraction | (1n << 52n);
    const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
    let numerator = mantissa, denominator = 1n;
    if (binaryExponent >= 0) numerator <<= BigInt(binaryExponent);
    else denominator <<= BigInt(-binaryExponent);
    let exponent = Math.floor(Math.log10(magnitude));
    const comparePower = (power: number) => power >= 0
        ? numerator - denominator * 10n ** BigInt(power)
        : numerator * 10n ** BigInt(-power) - denominator;
    while (comparePower(exponent) < 0n) exponent--;
    while (comparePower(exponent + 1) >= 0n) exponent++;
    const scale = 14 - exponent;
    const scaledNumerator = scale >= 0 ? numerator * 10n ** BigInt(scale) : numerator;
    const scaledDenominator = scale >= 0 ? denominator : denominator * 10n ** BigInt(-scale);
    let rounded = scaledNumerator / scaledDenominator;
    const remainder = scaledNumerator % scaledDenominator;
    if (remainder * 2n > scaledDenominator ||
        remainder * 2n === scaledDenominator && rounded % 2n !== 0n) rounded++;
    if (rounded === 10n ** 15n) { rounded /= 10n; exponent++; }
    const digits = rounded.toString().padStart(15, '0').replace(/0+$/, '');
    const sign = negative ? '-' : '';
    if (exponent < -4 || exponent >= 15) {
        const mantissaText = digits.length === 1 ? digits : digits[0] + '.' + digits.slice(1);
        return sign + mantissaText + 'e' + (exponent < 0 ? '-' : '+') +
            Math.abs(exponent).toString().padStart(2, '0');
    }
    const point = exponent + 1;
    return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits :
        point >= digits.length ? digits + '0'.repeat(point - digits.length) :
        digits.slice(0, point) + '.' + digits.slice(point));
}

// Port the target pp_modulo magnitude/promotion branches. In particular a wide
// left NV promotes a fractional right with floor(x+0.5), not truncation.
export function modulo(left: NativeNumber, right: NativeNumber): NativeNumber {
    const a=numeric(left), b=numeric(right), bi=integerEligible(b);
    let rightNegative=false, leftNegative=false, useDouble=false, rightNVValid=false;
    let rightInteger=0n, leftInteger=0n, rightNV=0, leftNV=0;
    if(bi!==undefined) {rightNegative=bi<0n;rightInteger=rightNegative?-bi:bi;}
    else {
        rightNV=nv(b);rightNegative=rightNV<0;if(rightNegative)rightNV=-rightNV;
        if(rightNV<2**64) {rightInteger=BigInt(Math.trunc(rightNV));rightNVValid=true;}
        else useDouble=true;
    }
    const ai=!useDouble?integerEligible(a):undefined;
    if(ai!==undefined) {leftNegative=ai<0n;leftInteger=leftNegative?-ai:ai;}
    else {
        leftNV=nv(a);leftNegative=leftNV<0;if(leftNegative)leftNV=-leftNV;
        if(!useDouble) {
            if(leftNV<2**64)leftInteger=BigInt(Math.trunc(leftNV));
            else {
                leftNV=Math.floor(leftNV+0.5);useDouble=true;
                rightNV=rightNVValid?Math.floor(rightNV+0.5):Number(rightInteger);
            }
        }
    }
    if(useDouble) {
        if(rightNV===0)throw new Error('Illegal modulus zero');
        let result=leftNV%rightNV;
        if(leftNegative!==rightNegative&&result!==0)result=rightNV-result;
        return NativeNumber.nv(rightNegative?-result:result);
    }
    if(rightInteger===0n)throw new Error('Illegal modulus zero');
    let result=leftInteger%rightInteger;
    if(leftNegative!==rightNegative&&result!==0n)result=rightInteger-result;
    return NativeNumber.integer(rightNegative?-result:result);
}


export function incrementNumber(value: NativeNumber, plus: boolean): NativeNumber {
    const n=numeric(value);
    let current: {mode:'iv'|'uv';value:bigint}|undefined;
    if(n.mode!=='nv')current=n;
    else {
        if(plus&&!n.integerCache)integerEligible(n);
        if(n.integerCache?.valid)current=n.integerCache;
        else return NativeNumber.nv(n.value+(plus?1:-1));
    }
    if(current.mode==='uv') {
        if(plus&&current.value===UV_MAX)return NativeNumber.nv(2**64);
        if(!plus&&current.value===0n)return NativeNumber.integer(-1n);
        return NativeNumber.uv(current.value+(plus?1n:-1n));
    }
    if(plus&&current.value===IV_MAX)return NativeNumber.uv(1n<<63n);
    if(!plus&&current.value===IV_MIN)return NativeNumber.nv(Number(IV_MIN)-1);
    return NativeNumber.integer(current.value+(plus?1n:-1n));
}

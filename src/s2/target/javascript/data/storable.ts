// storable.ts
//
// Read data Perl stored with Storable::nfreeze: hashes, arrays and scalars,
// which is all the journal data kept this way uses.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

export type Thawed = string | number | null | Thawed[] | { [key: string]: Thawed };

export function thaw(data: Buffer): Thawed {
    let at = 0;
    const byte = () => data[at++]!;
    const u32 = () => {
        const value = data.readUInt32BE(at);
        at += 4;
        return value;
    };
    const bytes = (length: number) => {
        const value = data.subarray(at, at + length);
        at += length;
        return value;
    };
    const seen: Thawed[] = [];
    const remember = <T extends Thawed>(value: T): T => {
        seen.push(value);
        return value;
    };

    const read = (): Thawed => {
        const type = byte();
        switch (type) {
            case 0: return seen[u32()]!;                                     // SX_OBJECT
            case 1: return remember(bytes(u32()).toString("latin1"));       // SX_LSCALAR
            case 2: {                                                        // SX_ARRAY
                const array = remember([] as Thawed[]);
                for (let n = u32(); n > 0; n--) array.push(read());
                return array;
            }
            case 3: {                                                        // SX_HASH
                const hash = remember({} as Record<string, Thawed>);
                for (let n = u32(); n > 0; n--) {
                    const value = read();
                    hash[bytes(u32()).toString("latin1")] = value;
                }
                return hash;
            }
            case 4: remember(null); return read();                           // SX_REF
            case 5: case 14: return remember(null);                          // SX_UNDEF, SX_SV_UNDEF
            case 8: return remember(byte() - 128);                           // SX_BYTE
            case 9: {                                                        // SX_NETINT
                const value = data.readInt32BE(at);
                at += 4;
                return remember(value);
            }
            case 10: return remember(bytes(byte()).toString("latin1"));     // SX_SCALAR
            case 15: return remember(1);                                     // SX_SV_YES
            case 16: return remember("");                                    // SX_SV_NO
            case 23: return remember(bytes(byte()).toString("utf8"));       // SX_UTF8STR
            case 24: return remember(bytes(u32()).toString("utf8"));        // SX_LUTF8STR
            case 25: {                                                       // SX_FLAG_HASH
                byte();
                const hash = remember({} as Record<string, Thawed>);
                for (let n = u32(); n > 0; n--) {
                    const value = read();
                    const flags = byte();
                    const key = bytes(u32());
                    hash[key.toString(flags & 1 ? "utf8" : "latin1")] = value;
                }
                return hash;
            }
            default: throw new Error(`Unsupported Storable type ${type}`);
        }
    };

    // The header: major version with the network-order bit, then minor version.
    if (!(byte() & 1)) throw new Error("Storable data is not in network order");
    byte();
    return read();
}

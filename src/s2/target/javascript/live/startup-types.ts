// startup-types.ts
//
// Private startup configuration for the anonymous S2 journal service.
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

import type { PublicAppConfig, PlaceholderResolutionSpec } from "./contracts";

export interface ConfiguredDatabaseSource {
    readonly id: string;
    readonly host: string | null;
    readonly port: number | null;
    readonly socketPath: string | null;
    readonly database: string;
    readonly user: string;
    readonly password: string; // parent-only; never logs, errors, worker or fixtures
    readonly roles: Readonly<Record<string, number>>;
}

export interface ConfiguredDatabase {
    readonly defaultDatabase: string;
    readonly sources: readonly ConfiguredDatabaseSource[];
    readonly clusters: readonly number[];
    readonly clusterPairActive: Readonly<Record<string, "a" | "b">>;
}

export interface SourceCapability {
    readonly defaultValue:number|null;
    readonly byBit:readonly {readonly bit:number;readonly value:number}[];
    readonly hookConfigured:boolean;
}

export interface SourceCapabilities {
    readonly threadExpander?:SourceCapability;
    readonly threadExpandAll?:SourceCapability;
    readonly maxComments?:SourceCapability;
    readonly moveInProgressMask: number; // configured class bits, BigInt operations
    readonly s2ViewEntry: {
        readonly defaultValue: number | null;
        readonly byBit: readonly {readonly bit: number; readonly value: number}[];
        readonly hookConfigured: boolean;
    };
}

export interface SourceStyleConfiguration {
    readonly defaultStyle: Readonly<Record<string, string>>;
    readonly layerRemap: Readonly<Record<string, number>>;
}

export interface StandaloneStartupConfig {
    readonly schema: 1;
    readonly listener: {readonly host: string; readonly port: number};
    readonly artifactPath: string;
    // Public config is completed with resolved placeholder attribute text before
    // service creation. Raw language file paths/alt key remain startup-only.
    readonly app: Omit<PublicAppConfig, "entryContent"> & {
        readonly entryContent: {readonly urls: PublicAppConfig["entryContent"]["urls"]};
    };
    readonly placeholder: PlaceholderResolutionSpec;
    readonly database: ConfiguredDatabase;
    readonly capabilities: SourceCapabilities;
    readonly styles: SourceStyleConfiguration;
}

// MysqlLiveStore.open owns primary role/topology validation. The server validates
// JSON/CLI/file boundaries; it does not duplicate data/policy predicates.
export interface LiveStoreConfig {
    readonly commentSettings?:PublicAppConfig["commentSettings"];
    readonly database: ConfiguredDatabase;
    readonly styles: SourceStyleConfiguration;
    readonly maxScrollback: number;
    readonly capabilities: SourceCapabilities;
}

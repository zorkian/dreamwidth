// installed-files.ts
//
// Installed compiler identity checks without repeated large binary reads.
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
import {createHash} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";

export interface InstalledFile {
    readonly file:string;
    readonly digest:string;
    readonly identity:readonly bigint[];
}
function identity(file:string):readonly bigint[] {
    const stat=lstatSync(file,{bigint:true});
    if(!stat.isFile()||stat.isSymbolicLink())throw Error("Installed compiler file changed");
    return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs];
}
export function checkInstalled(files:readonly InstalledFile[],full=false):void {
    for(const row of files) {
        if(identity(row.file).some((value,index)=>value!==row.identity[index]))
            throw Error("Installed compiler file changed");
        if(full) {
            if(createHash("sha256").update(readFileSync(row.file)).digest("hex")!==row.digest)
                throw Error("Installed compiler file changed");
            if(identity(row.file).some((value,index)=>value!==row.identity[index]))
                throw Error("Installed compiler file changed");
        }
    }
}
export function pinInstalled(file:string):InstalledFile {
    const row={file,identity:Object.freeze(identity(file)),
        digest:createHash("sha256").update(readFileSync(file)).digest("hex")};
    checkInstalled([row]);return Object.freeze(row);
}

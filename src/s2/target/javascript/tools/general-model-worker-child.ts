// general-model-worker-child.ts
//
// Fixed installed-model integration driver on the real private worker execution path.
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

import {GeneralWorkerChannel} from "../live/render/general-worker-channel";
import {executeGeneralWorker} from "../live/render/general-worker-execution";
import {generalScalarCallbacks} from "../live/render/general-builtins";
import {GeneralUserBindings} from "../live/render/general-user-bindings";
import {generalUserConstructor} from "../live/render/general-user-builtins";
import {workerLoadUser} from "../live/render/general-user-client";
import {generalModelCallbacks} from "../live/render/general-model-builtins";
import {generalImage,generalLink,generalDate} from "../live/domain/general-model-primitives";
import {NativeString} from "../runtime/native-string";

// This is a fixed test driver, not the unfinished ordinary worker/main factory.
// All program execution, admission, init/data handshake and output are real.
const bindings=new GeneralUserBindings();
const channel=new GeneralWorkerChannel(process.env.S2_PRIVATE_JOB!);
executeGeneralWorker(channel,{
    builtins(_start,page){return {...generalScalarCallbacks({page,seesControlStrip:()=>false}),
        ...generalUserConstructor(channel,bindings),...generalModelCallbacks()};},
    propertyCleaner(){return {clean(){throw Error("Fixed fixture has no rich property mode");}};},
    output(){return {contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
        stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
            trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},transformCss:chunk=>chunk,expandEmbed:chunk=>chunk};},
    preparePage(_session,start,approved){
        const input=approved as Record<string,unknown>;
        if(!input || !NativeString.is(input.title) || !NativeString.is(input.username))throw Error("Invalid fixed approved model");
        const image=generalImage(NativeString.hostUtf8Bytes("/declared-image"),75,51,NativeString.hostUtf8Bytes("alt"));
        return {".type":start.kind==="recent"?"RecentPage":"EntryPage",_title:input.title,
            _image:image,_link:generalLink(NativeString.hostUtf8Bytes("/relative"),NativeString.hostUtf8Bytes("caption"),image),
            _date:generalDate(2026,9,27),_other:generalDate(2026,9,28),
            _user:workerLoadUser(channel,bindings,input.username)};
    },
});

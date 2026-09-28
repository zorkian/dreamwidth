// general-page-worker-child.ts
//
// Fixed approved-source providers for exercising the installed Page worker factory.
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
import {generalWorkerFactory} from "../live/render/general-worker-factory";
import {NativeString,scalarPV} from "../runtime/native-scalar";
import {escapeGeneralPlainProperty} from "@dreamwidth/content/general-contexts";
import {generalCommentInfo,generalImage,generalNull,type GeneralModel} from "../live/domain/general-model-primitives";
import {generalMakeLink} from "../live/domain/general-navigation-url";
import type {GeneralWorkerPublicBindings} from "../live/render/general-worker-factory";

const pv=NativeString.hostUtf8Bytes,channel=new GeneralWorkerChannel(process.env.S2_PRIVATE_JOB!);
const username=pv("public_name");
const noContent=()=>{throw Error("Declared empty-content fixture reached an original cleaner");};
function entryOperations(bindings:GeneralWorkerPublicBindings) {
    return {features:{memories:false,tellafriend:false,esn:false},
        user:()=>bindings.loadUser(username) as GeneralModel,
        picture:()=>generalNull("Image"),moodtheme:()=>undefined,tagList:()=>({html:undefined,tags:[]}),
        commentInfo:()=>generalCommentInfo({_count:0,_enabled:0}),standardImage:noContent,
        currents:()=>({values:[]}),groupNames:()=>pv(""),cleanSubject:noContent,
        cleanEvent:noContent,expandEmbedded:(value:NativeString|undefined)=>value,
        transformAdult:(value:NativeString|undefined)=>value,recordPublicEntry(){}};
}
function escapeProperty(value:unknown,mode:"plain"|"html"):unknown {
    if(mode==="plain")return value===undefined?undefined:NativeString.fromFrame(escapeGeneralPlainProperty(scalarPV(value).frame()));
    if(value!==undefined)noContent();return value;
}
executeGeneralWorker(channel,generalWorkerFactory(channel,{
    propertyCleaner(){return {clean:noContent};},seesControlStrip:()=>false,
    subjectHelpers(){return {normalizeImageUrl:noContent,rewriteBlockedHref:noContent,
        expandSiteUrl:noContent,expandUser:noContent,templateError:noContent,
        videoError:noContent,markupError:noContent,validStylesheet:noContent};},
    dates:{dayOfWeek(_ctx,date){
        // Exact declared fixture civil day; the native oracle independently
        // runs LJ::day_of_week. This is not the installed calendar provider.
        if(scalarPV(date._year).bytes().toString()!=="2026"||
            scalarPV(date._month).bytes().toString()!=="9"||
            scalarPV(date._day).bytes().toString()!=="27")throw Error("Unplanned fixture civil day");
        return 0;
    }},
    output(){return {contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
        stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
            trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},transformCss:noContent,expandEmbed:noContent};},
    recentOperations(_session,_start,bindings){return {
        page:{clockSeconds:()=>0,escapeProperty},
        entry:()=>entryOperations(bindings),recent:{standardImage:kind=>generalImage(pv("/declared/"+kind),20,18,pv("")),
            makeLink:generalMakeLink,eventDisplayed(){}}};},
    entryOperations(_session,_start,bindings){return {
        page:{clockSeconds:()=>0,escapeProperty},
        entry:entryOperations(bindings),prepareHead(){},prepareCommentHead(){},comments:noContent,
        emptyComments(){return {permalink:pv("/261.html"),styledEntryUrl:pv("/261.html"),styleArgument:undefined,
            flat:false,topOnly:false,pages:1,current:1,items:0,first:undefined,last:undefined,expandAll:false};}};},
}));

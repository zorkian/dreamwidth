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
import {workerLoadUser} from "../live/render/general-user-client";
import {NativeString} from "../runtime/native-scalar";
import {generalCommentInfo,generalImage,type GeneralModel} from "../live/domain/general-model-primitives";
import type {GeneralPageInput} from "../live/domain/general-page-model";
import type {GeneralEntryPageEntryInput} from "../live/domain/general-entry-page-source";
import type {GeneralEntrySourceInput} from "../live/domain/general-entry-from-source";
import {generalMakeLink} from "../live/domain/general-navigation-url";
import type {GeneralWorkerPublicBindings} from "../live/render/general-worker-factory";

const pv=NativeString.hostUtf8Bytes,channel=new GeneralWorkerChannel(process.env.S2_PRIVATE_JOB!);
let username:NativeString;
const noContent=()=>{throw Error("Declared empty-content fixture reached an original cleaner");};
function page(value:unknown):GeneralPageInput {
    if(!value||typeof value!=="object"||Object.keys(value).length!==2||
        !NativeString.is((value as Record<string,unknown>).username)||
        !NativeString.is((value as Record<string,unknown>).title))throw Error("Invalid fixed source descriptor");
    const row=value as {username:NativeString;title:NativeString};username=row.username;
    return {styleId:0,styleModtime:0,baseUrl:pv("/journal"),journal:{".type":"User"},journalType:pv("P"),
        ownerName:row.title,journalTitle:undefined,journalSubtitle:undefined,layoutName:undefined,
        themeName:undefined,layoutUrl:pv(""),getargs:[],viewingStyleOptions:undefined,viewUrls:[],links:[],
        customtext:{title:undefined,url:undefined,content:undefined},
        customtextDefaults:{title:undefined,url:undefined,content:undefined},showControlStrip:0,
        isCanary:0,noMobileCookie:0,sessionMessages:undefined,headContent:pv(""),canUseNetwork:0,activeEntries:[]};
}
function entry():GeneralEntrySourceInput {
    return {journalId:111,posterId:111,forceMoodtheme:undefined,permalinkUrl:pv("/261.html"),
        dateparts:pv("2026 09 27 00 00 00 00"),systemDateparts:pv("2026 09 27 00 00 00 00"),
        security:pv("public"),allowmask:0,adultContentLevel:pv(""),adminPost:0,
        content:{subject:undefined,event:undefined,journalName:username,ditemid:261,jitemid:1,
            editor:undefined,preformatted:0,importSourceDefined:false,isSyndicated:0,
            logtimeMysql:pv("2026-09-27 00:00:00"),suspendMessage:0,noEntryBody:0,noHtml:0,
            cutUrl:pv("/261.html"),cutDisable:0}};
}
function entryOperations(bindings:GeneralWorkerPublicBindings) {
    return {features:{memories:false,tellafriend:false,esn:false},
        user:()=>workerLoadUser(channel,bindings.users,username) as GeneralModel,
        picture:()=>undefined,moodtheme:()=>undefined,tagList:()=>({html:undefined,tags:[]}),
        commentInfo:()=>generalCommentInfo({_count:0,_enabled:0}),standardImage:noContent,
        currents:()=>({values:[]}),groupNames:()=>pv(""),cleanSubject:noContent,
        cleanEvent:noContent,expandEmbedded:(value:NativeString|undefined)=>value,
        transformAdult:(value:NativeString|undefined)=>value,recordPublicEntry(){}};
}
executeGeneralWorker(channel,generalWorkerFactory(channel,{
    propertyCleaner(){return {clean:noContent};},seesControlStrip:()=>false,
    output(){return {contentType:"text/html",limits:{maxInputBytes:1048576,maxOutputBytes:1048576,timeoutMs:10000},
        stylesheet:{domain:"example.org",webDomain:"www.example.org",statPrefix:"https://static.example.org",
            trustedHosts:{},cssCleanerEnabled:true,cssProxy:null},transformCss:noContent,expandEmbed:noContent};},
    recentInput(value){return {page:page(value),selection:{skip:0,itemshow:3,maxskip:97,showStickies:false,
        stickyEntries:[],window:[{entry:entry(),countedSticky:false,datePrefix:pv("2026 09 27")}],
        hasLookahead:false},navigation:{filterActive:false,filterName:pv(""),filterTags:undefined,
            selectionHead:pv(""),feedTagQuery:pv(""),linkAttributes:[]}};},
    entryInput(value){return {page:page(value),entry:{...entry(),mode:undefined} as GeneralEntryPageEntryInput,thread:undefined};},
    recentOperations(_session,_start,bindings){return {
        page:{clockSeconds:()=>0,escapeProperty(value){if(value!==undefined)noContent();return value;}},
        entry:()=>entryOperations(bindings),recent:{standardImage:kind=>generalImage(pv("/declared/"+kind),20,18,pv("")),
            makeLink:generalMakeLink,eventDisplayed(){}}};},
    entryOperations(_session,_start,bindings){return {
        page:{clockSeconds:()=>0,escapeProperty(value){if(value!==undefined)noContent();return value;}},
        entry:entryOperations(bindings),prepareHead(){},prepareCommentHead(){},comments:noContent,
        emptyComments(){return {permalink:pv("/261.html"),styledEntryUrl:pv("/261.html"),styleArgument:undefined,
            flat:false,topOnly:false,pages:1,current:1,items:0,first:undefined,last:undefined,expandAll:false};}};},
}));

// comment-model.ts
//
// Source-derived public comment objects for the stock EntryPage.
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

import type {RenderInput,RenderContentPreparation,ApprovedComment} from './types';
import type {Context} from '../../runtime/s2runtime';
import {object,date,nullObject,type S2Object} from './objects';
import {escapeHtml} from './builtins';
import {prepareUserpic} from './prepare';
import {journalBase} from './journal-url';

// DateTime_tz: absent/invalid native author zone supplies a null DateTime.
function authorDate(time:string,zone:string|null):S2Object {
    if(!zone)return nullObject('DateTime');
    try {
        const instant=new Date(time.replace(' ','T')+'Z');
        const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',
            hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(instant);
        const fields=Object.fromEntries(parts.map(part=>[part.type,part.value]));
        const year=Number(fields.year),month=Number(fields.month),day=Number(fields.day);
        return object('DateTime',{year,month,day,hour:Number(fields.hour),min:Number(fields.minute),sec:Number(fields.second),
            _dayofweek:new Date(Date.UTC(year,month-1,day)).getUTCDay()+1});
    }catch{return nullObject('DateTime');}
}
export function prepareComments(input:RenderInput,ctx:Context,content:RenderContentPreparation,journal:S2Object,url:string):
    {comments:S2Object[];pages?:S2Object;nav?:S2Object} {
    const tree=input.journal.comments;
    if(!tree)return {comments:[]};
    if(input.page.kind!=='entry')throw new Error('Comments require EntryPage');
    const query=input.page.comments??{},anum=input.page.ditemid%256;
    const external=(id:number):number=>id*256+anum;
    const destination=query.destinationThread??query.thread??0;
    const ajax=`${input.config.listenOrigin}/users/${input.journal.username}/${input.page.ditemid}.html`;
    const convert=(node:ApprovedComment,depth:number):S2Object=>{
        const id=external(node.id),author=node.author;
        const poster=author?object('UserLite',{username:author.username,user:author.username,name:escapeHtml(author.name),
            journal_type:author.journalType,host_userid:author.userid,base_url:journalBase(author.username,input.config)}):nullObject('UserLite');
        const isVisible=!node.suspended&&!['S','D'].includes(node.state);
        const time=date(node.datepost),timePoster=authorDate(node.datepost,author?.timezone??null);
        const subject=escapeHtml(node.subject);
        const result=object('Comment',{journal,poster,replies:[],subject,_subject_recent:subject,_subject_all:subject,
            subject_icon:nullObject('Image'),talkid:id,ditemid:input.page.kind==='entry'?input.page.ditemid:0,
            text:node.full?(content.comment?content.comment(node,url):(()=>{throw new Error('Missing comment cleaner');})()):'',
            userpic:author?prepareUserpic(input,author.userpic,ctx,{username:author.username,userid:author.userid},true):nullObject('Image'),
            time,system_time:time,edittime:nullObject('DateTime'),editreason:'',tags:[],full:Number(node.full),depth,
            parent_url:node.parentId?`${url}?thread=${external(node.parentId)}#cmt${external(node.parentId)}`:'',
            threadroot_url:node.full&&node.parentId?`${input.config.siteRoot}/go?redir_type=threadroot&journal=${input.journal.username}&talkid=${id}`:'',
            permalink_url:`${url}?thread=${id}#cmt${id}`,reply_url:`${url}?replyto=${id}`+(destination?`&thread=${destination}`:''),
            screened:Number(node.state==='S'),screened_noshow:Number(node.state==='S'),frozen:Number(node.state==='F'),
            deleted:Number(node.state==='D'),fromsuspended:Number(node.suspended),link_keyseq:['delete_comment','screen_comment','freeze_thread','watch_thread','unwatch_thread','watching_parent'],
            anchor:`cmt${id}`,dom_id:`cmt${id}`,comment_posted:0,edited:0,time_remote:nullObject('DateTime'),time_poster:timePoster,
            seconds_since_entry:Math.floor(Date.parse(node.datepost.replace(' ','T')+'Z')/1000)-Math.floor(Date.parse(input.journal.entries[0]!.eventtime.replace(' ','T')+'Z')/1000),
            edittime_remote:nullObject('DateTime'),edittime_poster:nullObject('DateTime'),edit_url:'',timeformat24:0,
            showable_children:node.showableChildren,hide_children:0,hidden_child:0,echi:'',admin_post:Number(!!node.props.admin_post&&node.props.admin_post!=='0'),
            metadata:node.props.imported_from&&node.props.imported_from!=='0'?{imported_from:escapeHtml(node.props.imported_from)}:{},
            expand_url:`${url}?thread=${id}#cmt${id}`,
            js_expand_url:`${ajax}?thread=${id}&destination_thread=${destination}#cmt${id}`,
            thread_url:node.replies.length?`${url}?thread=${id}#cmt${id}`:'',
            _expander_allowed:tree.expanderAllowed,_public_visible:isVisible});
        result.replies=node.replies.map(reply=>convert(reply,depth+1));
        return result;
    };
    const pages=object('ItemRange',{all_subitems_displayed:Number(tree.pages===1),current:tree.page,
        from_subitem:tree.first,num_subitems_displayed:tree.roots.length,to_subitem:tree.last,total:tree.pages,total_subitems:tree.items,
        url_all:'',_page_base:url});
    const pageUrl=(page:number):string=>`${url}?page=${page}`;
    if(tree.page<tree.pages){pages._url_next=pageUrl(tree.page+1);pages._url_last=pageUrl(tree.pages);}
    if(tree.page>1){pages._url_prev=pageUrl(tree.page-1);pages._url_first=pageUrl(1);}
    return {comments:tree.roots.map(root=>convert(root,1)),pages,
        nav:object('CommentNav',{view_mode:'threaded',url,current_page:tree.page,show_expand_all:Number(tree.expandAllowed&&tree.collapsed),
            _ajax_url:ajax})};
}

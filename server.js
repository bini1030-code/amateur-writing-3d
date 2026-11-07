'use strict';
// Zero-dependency Node.js HTTP + WebSocket server. Run: node server.js
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname,'public');
const LIMIT = 20;
const APP_VERSION = '14.15.0';
const CHAT_HISTORY_LIMIT = 100;
const EMPTY_ROOM_CHAT_TTL = 24 * 60 * 60 * 1000; // recent history lasts only while this server process runs
const rooms = new Map(); // chat history in memory; local browsers separately save their own records
// A shared bookshelf. For persistent storage on Render, set BOOKSHELF_DATA_DIR to a mounted persistent disk.
const BOOKSHELF_LIMIT=100;
const BOOKSHELF_MAX_CHARS=10000;
const BOOKSHELF_MAX_BYTES=65000;
const WS_MAX_FRAME_BYTES=96*1024;
const BOOKSHELF_DIR=process.env.BOOKSHELF_DATA_DIR || path.join(__dirname,'data');
const BOOKSHELF_FILE=path.join(BOOKSHELF_DIR,'room-books.json');
const savedBooks=new Map();
// Keep deleted IDs across reconnects, so stale browser backups cannot resurrect removed books.
const deletedBooks=new Map();
const deletedRequests=new Map();
const ownerHash=(code,key)=>crypto.createHash('sha256').update(code+'\0'+key).digest('hex');
const validOwnerKey=key=>typeof key==='string'&&/^[a-f0-9-]{32,80}$/i.test(key);
// Never send the owner's secret hash to other visitors.
function publicBook(book){if(!book)return null;const {ownerHash:privateHash,lastMutationId,requestId,...fields}=book;return {...fields,ownerProtected:!!privateHash};}
function canManage(c,book,ownerKey,sourceDraftId=''){
 if(!book||book.author!==c.name)return false;
 if(book.ownerHash)return validOwnerKey(ownerKey)&&ownerHash(c.room.code,ownerKey)===book.ownerHash;
 // Legacy books predate ownership keys: limited compatibility by nickname and original draft ID.
 // This is NOT cryptographic authentication; see README security note.
 return !!(book.sourceDraftId&&sourceDraftId===book.sourceDraftId);
}
function diskError(e){return ({EROFS:'서버 저장 공간이 읽기 전용입니다.',EACCES:'서버 저장 권한이 없습니다.',ENOSPC:'서버 저장 공간이 부족합니다.',EDQUOT:'서버 디스크 할당량을 초과했습니다.'})[e?.code]||'서버에 책장 파일을 기록할 수 없습니다.';}

// Books shared only in memory due to server disk failure; never label their ACK as durable.
const transientBookIds=new Set();
try{
  const raw=JSON.parse(fs.readFileSync(BOOKSHELF_FILE,'utf8'));
  const bookRooms=raw?.__format===2?raw.rooms:raw;
  for(const [code,entries] of Object.entries(bookRooms||{})){
    if(!/^[A-Z0-9가-힣-]{1,18}$/.test(code)||!Array.isArray(entries))continue;
    savedBooks.set(code,entries.slice(-BOOKSHELF_LIMIT).filter(b=>b && typeof b.id==='string' && typeof b.text==='string' && typeof b.title==='string' && typeof b.author==='string'));
  }
  if(raw?.__format===2&&raw.deleted){for(const [code,ids] of Object.entries(raw.deleted)){
   if(/^[A-Z0-9가-힣-]{1,18}$/.test(code)&&Array.isArray(ids))deletedBooks.set(code,ids.filter(id=>typeof id==='string').slice(-2000));
  }}
}catch(e){if(e.code!=='ENOENT')console.warn('서가 저장 기록을 읽을 수 없습니다:',e.message)}
function persistBooks(){
  fs.mkdirSync(BOOKSHELF_DIR,{recursive:true});
  const obj={__format:2,rooms:Object.fromEntries(savedBooks),deleted:Object.fromEntries(deletedBooks)};
  const tmp=BOOKSHELF_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');
  fs.renameSync(tmp,BOOKSHELF_FILE);
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const server = http.createServer((req,res)=>{
  const target = new URL(req.url,'http://localhost');
  if (target.pathname === '/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:APP_VERSION,shelfStorage:process.env.BOOKSHELF_DATA_DIR?'configured-directory':'ephemeral'}));}
  let name;try{name=target.pathname==='/'?'/index.html':decodeURIComponent(target.pathname)}catch(e){res.writeHead(400);return res.end('Bad path')}
  const file=path.resolve(ROOT,'.'+name);
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden')}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  });
});
function encode(payload){const data=Buffer.from(JSON.stringify(payload));const h=data.length<126?2:data.length<65536?4:10;const b=Buffer.alloc(h+data.length);b[0]=0x81;if(h===2){b[1]=data.length;}else if(h===4){b[1]=126;b.writeUInt16BE(data.length,2)}else{b[1]=127;b.writeBigUInt64BE(BigInt(data.length),2)}data.copy(b,h);return b;}
function send(c,m){if(!c||c.socket.destroyed)return;try{c.socket.write(encode(m));}catch(e){}}
function broadcast(room,m,except){if(!room)return;for(const c of room.clients.values())if(c!==except)send(c,m)}
function cleanRoom(room){
  if(!room || room.clients.size!==0)return;
  room.emptyAt=Date.now();
  // Keep only recent chat in memory when everyone leaves. On Render's free instance
  // it is lost on restart; browsers save their own copy in localStorage.
  if(!room.history?.length)rooms.delete(room.code);
}
function peers(room){return [...room.clients.values()].map(c=>({id:c.id,name:c.name,color:c.color,gender:c.gender,x:c.x,z:c.z,rot:c.rot,action:c.action}));}
function leave(c){
  if(!c.room)return;const room=c.room;room.clients.delete(c.id);
  broadcast(room,{t:'leave',id:c.id});
  if(room.reading?.from===c.id||room.reading?.requester===c.id){
    room.reading=null;broadcast(room,{t:'reading',reading:null});
  }else if(room.reading?.hostId===c.id){
    room.reading={...room.reading,mode:'request',hostId:null,hostName:null,at:Date.now()};
    broadcast(room,{t:'reading',reading:room.reading});
  }
  c.room=null;cleanRoom(room);
}
function finite(n,min,max,fallback){return typeof n==='number'&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function safeStr(t,n){return typeof t==='string'?t.trim().slice(0,n):''}
function rate(c,key,ms){const now=Date.now();if(now-(c.last[key]||0)<ms)return false;c.last[key]=now;return true}
function handle(c,msg){if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
  if(msg.t==='join'){
    if(c.room)return;const code=safeStr(msg.code,18).toUpperCase().replace(/[^A-Z0-9가-힣-]/g,'').slice(0,18)||'NIGHT';
    let room=rooms.get(code);if(!room){room={code,clients:new Map(),reading:null,history:[],books:savedBooks.get(code)||[],lampOn:true,emptyAt:0};rooms.set(code,room)}
    room.emptyAt=0;
    if(room.clients.size>=LIMIT){send(c,{t:'error',message:'이 방은 20명 정원입니다.'});cleanRoom(room);return}
    c.name=safeStr(msg.name,18).replace(/[<>]/g,'')||'밤의 필자';c.color=Math.floor(finite(msg.color,0,5,0));c.gender=msg.gender==='female'?'female':'male';c.x=-2.2+(room.clients.size%5)*1.1;c.z=9.1+Math.floor(room.clients.size/5)*.48;c.rot=Math.PI;c.action='stand';c.room=room;room.clients.set(c.id,c);
    const ownerKey=validOwnerKey(msg.ownerKey)?msg.ownerKey:'';
    const editableBookIds=room.books.filter(book=>book.ownerHash&&canManage(c,book,ownerKey)).map(book=>book.id);
    send(c,{t:'welcome',id:c.id,code,people:peers(room),reading:room.reading,history:room.history,books:room.books.map(publicBook),deletedBookIds:deletedBooks.get(code)||[],editableBookIds,lampOn:room.lampOn!==false,limit:LIMIT,serverVersion:APP_VERSION,features:['shelf-save-ack-v2','multi-drafts-v1','shelf-char-limit-10000','shelf-manage-v1']});
    broadcast(room,{t:'join',person:peers(room).find(p=>p.id===c.id)},c);
    return;
  }
  const room=c.room;if(!room)return;
  switch(msg.t){
    case 'move':{
      if(!rate(c,'move',65))return;
      c.x=finite(msg.x,-8.5,8.5,c.x);c.z=finite(msg.z,-9.5,11.5,c.z);c.rot=finite(msg.rot,-20,20,c.rot);
      c.action=['sit','lie'].includes(safeStr(msg.action,12))?msg.action:'stand';
      broadcast(room,{t:'move',id:c.id,x:c.x,z:c.z,rot:c.rot,action:c.action},c);break;
    }
    case 'chat':{
      if(!rate(c,'chat',850))return;
      const text=safeStr(msg.text,200);
      if(text){
        const entry={messageId:crypto.randomUUID(),id:c.id,name:c.name,text,time:Date.now()};
        room.history.push(entry);
        if(room.history.length>CHAT_HISTORY_LIMIT)room.history.splice(0,room.history.length-CHAT_HISTORY_LIMIT);
        broadcast(room,{t:'chat',...entry});
      }
      break;
    }
    case 'scene':{
      if(!rate(c,'scene',550))return;
      if(msg.action==='lamp'){
        room.lampOn=room.lampOn===false;
        broadcast(room,{t:'scene',action:'lamp',lampOn:room.lampOn,id:c.id,at:Date.now()});
      }else if(msg.action==='water'){
        const plant=safeStr(msg.plant,30);
        if(!['main-left','main-right','main-back','tea-corner','mind-back','mind-front'].includes(plant))return;
        broadcast(room,{t:'scene',action:'water',plant,id:c.id,name:c.name,at:Date.now()});
      }
      break;
    }
    case 'react':{
      if(!rate(c,'react',650))return;
      const kind=['heart','clap','spark','tea','wave','cookie','jelly'].includes(msg.kind)?msg.kind:'heart';
      broadcast(room,{t:'react',id:c.id,name:c.name,kind,at:Date.now()});break;
    }
    case 'mood':{
      if(!rate(c,'mood',1800))return;
      const kind=safeStr(msg.kind,10);
      if(!['joy','sad','anger','worry','peace','hope','depression','anxiety','addiction','madness','love'].includes(kind))return;
      // Only the explicitly shared mood label is broadcast; reflection notes remain on the user's device.
      broadcast(room,{t:'mood',id:c.id,name:c.name,kind,at:Date.now()});break;
    }
    case 'shelfAdd':{
      // Explicit validation before trimming: never silently truncate user writing.
      const requestId=typeof msg.requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)?msg.requestId:'';
      const fail=(message,reason='INVALID_INPUT')=>send(c,{t:'shelfError',requestId,message,reason,maxChars:BOOKSHELF_MAX_CHARS});
      const prior=requestId&&room.books.find(b=>b.requestId===requestId);
      if(prior){send(c,{t:'shelfAck',requestId,book:publicBook(prior),updated:!!prior.updatedAt,storage:transientBookIds.has(prior.id)?'temporary':'file',reason:transientBookIds.has(prior.id)?'서버 파일 저장 실패 후 임시 공유 중':''});return}
      if(!rate(c,'shelfAdd',1200)){fail('등록 요청이 너무 빠르게 반복됐습니다. 잠시 후 다시 눌러 주세요.','RATE_LIMIT');return}
      if(typeof msg.text!=='string'){fail('본문 형식이 올바르지 않습니다. 글쓰기 화면에서 다시 저장해 주세요.','INVALID_TEXT');return}
      const rawText=msg.text;
      const text=rawText.trim();
      const count=[...text].length;
      if(!text){fail('본문이 비어 있습니다. 글을 작성한 후 책장에 꽂아 주세요.','EMPTY_TEXT');return}
      if(count>BOOKSHELF_MAX_CHARS){fail(`본문 저장 한도는 최대 ${BOOKSHELF_MAX_CHARS.toLocaleString()}자입니다. 현재 ${count.toLocaleString()}자로 ${(count-BOOKSHELF_MAX_CHARS).toLocaleString()}자를 줄여야 합니다. 작성한 글은 삭제되지 않습니다.`,'CHAR_LIMIT');return}
      if(typeof msg.title==='string'&&[...msg.title.trim()].length>80){
        const titleCount=[...msg.title.trim()].length;
        fail(`제목은 최대 80자입니다. 현재 ${titleCount}자로 ${titleCount-80}자를 줄여 주세요.`,'TITLE_LIMIT');return;
      }
      const title=(typeof msg.title==='string'?[...msg.title.trim()].slice(0,80).join(''):'')||'제목 없는 글';
      const sourceDraftId=(typeof msg.sourceDraftId==='string'&&/^draft-[a-z0-9-]{1,72}$/i.test(msg.sourceDraftId))?msg.sourceDraftId:'';
      const byteLength=Buffer.byteLength(JSON.stringify({t:'shelfAdd',requestId,title,text,sourceDraftId}),'utf8');
      if(byteLength>BOOKSHELF_MAX_BYTES){fail(`본문 전송 용량은 최대 ${BOOKSHELF_MAX_BYTES.toLocaleString()}바이트입니다. 현재 ${byteLength.toLocaleString()}바이트로 ${(byteLength-BOOKSHELF_MAX_BYTES).toLocaleString()}바이트를 줄여 주세요.`, 'BYTE_LIMIT');return}
      const ownerKey=validOwnerKey(msg.ownerKey)?msg.ownerKey:'';
      if(!ownerKey){fail('이 기기의 책장 관리 키를 사용할 수 없습니다. 브라우저 저장소 설정을 확인하고 새로고침한 뒤 다시 시도해 주세요.','NO_OWNER_KEY');return}
      const existingIndex=sourceDraftId?room.books.findIndex(b=>b.sourceDraftId===sourceDraftId && b.author===c.name):-1;
      if(existingIndex>=0&&!canManage(c,room.books[existingIndex],ownerKey,sourceDraftId)){
       fail('이 책을 등록한 기기의 관리 권한이 없습니다. 다른 사람이 작성한 책이나 관리 키가 없는 책은 덮어쓸 수 없습니다.','NOT_OWNER');return;
      }
      if(room.books.length>=BOOKSHELF_LIMIT&&existingIndex<0){fail(`이 모임방 책장은 최대 ${BOOKSHELF_LIMIT}권까지 저장할 수 있습니다. 현재 ${room.books.length}권이라 새 책을 꽂을 수 없습니다.`, 'SHELF_FULL');return}
      const existing=existingIndex>=0?room.books[existingIndex]:null;
      const now=Date.now();
      const entry=existing?
        {...existing,title,text,updatedAt:now,requestId,ownerHash:existing.ownerHash||ownerHash(room.code,ownerKey)}:
        {id:crypto.randomUUID(),title,text,author:c.name,createdAt:now,updatedAt:0,requestId,ownerHash:ownerHash(room.code,ownerKey),...(sourceDraftId?{sourceDraftId}:{})};
      const next=existingIndex>=0?room.books.map((b,i)=>i===existingIndex?entry:b):[...room.books,entry];
      savedBooks.set(room.code,next);
      let storage='file',reason='';
      try{persistBooks();transientBookIds.clear()}catch(e){
        transientBookIds.add(entry.id);
        storage='temporary';
        const reasons={EROFS:'서버 저장 공간이 읽기 전용입니다',EACCES:'서버 저장 권한이 없습니다',ENOSPC:'서버 저장 공간이 부족합니다',EDQUOT:'서버 디스크 할당량이 초과됐습니다'};
        reason=reasons[e.code]||'서버 파일에 쓸 수 없습니다';
        console.error('책장 디스크 저장 실패:',e.code||'UNKNOWN',e.message);
      }
      room.books=next;
      send(c,{t:'shelfAck',requestId,book:publicBook(entry),updated:!!existing,storage,reason});
      broadcast(room,{t:'shelfBook',book:publicBook(entry)},c);
      break;
    }
    case 'shelfUpdate':{
      const requestId=typeof msg.requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)?msg.requestId:'';
      const fail=(message,reason='INVALID_INPUT')=>send(c,{t:'shelfActionError',action:'update',requestId,message,reason,maxChars:BOOKSHELF_MAX_CHARS});
      const id=safeStr(msg.id,64),index=room.books.findIndex(b=>b.id===id);
      if(index<0){fail('선택한 책이 서버 책장에 없습니다. 다른 사람이 삭제했거나 서버가 재시작되었을 수 있습니다.','BOOK_NOT_FOUND');break}
      const old=room.books[index];
      if(requestId&&old.lastMutationId===requestId){send(c,{t:'shelfUpdateAck',requestId,book:publicBook(old)});break}
      if(!rate(c,'shelfMutate',500)){fail('수정 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.','RATE_LIMIT');break}
      if(!canManage(c,old,msg.ownerKey,msg.sourceDraftId)){fail('이 책을 수정할 권한이 없습니다. 등록한 기기·브라우저의 관리 키가 필요합니다. 이전 버전의 책은 동일 작성자명과 원본 초안이 필요합니다.','NOT_OWNER');break}
      if(Number(msg.expectedVersion)!==(old.updatedAt||old.createdAt)){fail('다른 곳에서 책이 수정되었습니다. 책장을 다시 열어 최신 내용을 확인해 주세요.','CONFLICT');break}
      if(typeof msg.title!=='string'||typeof msg.text!=='string'){fail('제목 또는 본문 형식이 잘못됐습니다.','INVALID_INPUT');break}
      const title=msg.title.trim()||'제목 없는 글',text=msg.text.trim(),count=[...text].length,titleCount=[...title].length;
      if(!text){fail('책 본문이 비어 있습니다. 글을 작성해 주세요.','EMPTY_TEXT');break}
      if(titleCount>80){fail(`제목은 최대 80자입니다. 현재 ${titleCount}자이므로 ${titleCount-80}자를 줄여 주세요.`,'TITLE_LIMIT');break}
      if(count>BOOKSHELF_MAX_CHARS){fail(`본문은 최대 ${BOOKSHELF_MAX_CHARS.toLocaleString()}자입니다. 현재 ${count.toLocaleString()}자이므로 ${(count-BOOKSHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요.`,'CHAR_LIMIT');break}
      if(Buffer.byteLength(JSON.stringify({t:'shelfUpdate',requestId,id,title,text,ownerKey:msg.ownerKey}),'utf8')>BOOKSHELF_MAX_BYTES){fail(`전송 용량 ${BOOKSHELF_MAX_BYTES.toLocaleString()}바이트를 초과했습니다. 이모지와 특수문자를 줄여 주세요.`,'BYTE_LIMIT');break}
      const entry={...old,title,text,updatedAt:Date.now(),lastMutationId:requestId,ownerHash:old.ownerHash||ownerHash(room.code,msg.ownerKey)};
      const next=room.books.map((b,i)=>i===index?entry:b);
      savedBooks.set(room.code,next);
      try{persistBooks();transientBookIds.delete(id)}catch(e){savedBooks.set(room.code,room.books);fail(diskError(e)+' 기존 책은 그대로 남아 있습니다.','STORAGE_FAILED');break}
      room.books=next;
      send(c,{t:'shelfUpdateAck',requestId,book:publicBook(entry)});
      broadcast(room,{t:'shelfBook',book:publicBook(entry)},c);
      break;
    }
    case 'shelfDelete':{
      const requestId=typeof msg.requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)?msg.requestId:'';
      const fail=(message,reason='INVALID_INPUT')=>send(c,{t:'shelfActionError',action:'delete',requestId,message,reason});
      const id=safeStr(msg.id,64),index=room.books.findIndex(b=>b.id===id);
      const completed=deletedRequests.get(room.code+':'+id);
      if(index<0&&completed===requestId){send(c,{t:'shelfDeleteAck',requestId,id});break}
      if(index<0){fail('이미 삭제되었거나 책장에 없는 책입니다. 책장을 다시 확인해 주세요.','BOOK_NOT_FOUND');break}
      if(!rate(c,'shelfMutate',500)){fail('삭제 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.','RATE_LIMIT');break}
      const old=room.books[index];
      if(!canManage(c,old,msg.ownerKey,msg.sourceDraftId)){fail('이 책을 삭제할 권한이 없습니다. 등록한 기기의 관리 키 또는 이전 버전 원본 초안이 필요합니다.','NOT_OWNER');break}
      if(Number(msg.expectedVersion)!==(old.updatedAt||old.createdAt)){fail('책이 변경되었습니다. 최신 책을 다시 확인한 다음 삭제해 주세요.','CONFLICT');break}
      const next=room.books.filter(b=>b.id!==id),oldDeleted=deletedBooks.get(room.code)||[];
      const nextDeleted=[...oldDeleted.filter(x=>x!==id),id].slice(-2000);
      savedBooks.set(room.code,next);deletedBooks.set(room.code,nextDeleted);
      try{persistBooks()}catch(e){savedBooks.set(room.code,room.books);deletedBooks.set(room.code,oldDeleted);fail(diskError(e)+' 책이 삭제되지 않았습니다.','STORAGE_FAILED');break}
      room.books=next;transientBookIds.delete(id);
      deletedRequests.set(room.code+':'+id,requestId);
      send(c,{t:'shelfDeleteAck',requestId,id});
      broadcast(room,{t:'shelfRemove',id},c);
      break;
    }
    case 'reading':{
      if(!rate(c,'reading',1500))return;
      const title=safeStr(msg.title,80)||'제목 없는 글',rawText=typeof msg.text==='string'?msg.text:'',text=rawText.trim();
      if(!text){send(c,{t:'error',message:'먼저 글을 작성해 주세요.'});return}
      const length=[...text].length;if(length>BOOKSHELF_MAX_CHARS){send(c,{t:'error',message:`함께 읽기는 최대 ${BOOKSHELF_MAX_CHARS.toLocaleString()}자까지 가능합니다. 현재 ${length.toLocaleString()}자이므로 ${(length-BOOKSHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요.`});return}
      const mode=msg.mode==='request'?'request':'self';
      room.reading={from:c.id,requester:c.id,name:c.name,title,text,mode,at:Date.now()};
      broadcast(room,{t:'reading',reading:room.reading});break;
    }
    case 'acceptRead':{
      if(!room.reading||room.reading.mode!=='request')return;
      room.reading={...room.reading,mode:'host',hostId:c.id,hostName:c.name,at:Date.now()};
      broadcast(room,{t:'reading',reading:room.reading});break;
    }
    case 'endRead':{
      if(!room.reading)return;
      if(![room.reading.requester,room.reading.hostId].includes(c.id))return;
      room.reading=null;broadcast(room,{t:'reading',reading:null});break;
    }
    case 'signal':{
      // WebRTC SDP and ICE forwarded only to specified peer, no media stored.
      if(!rate(c,'signal',12))return;
      const to=room.clients.get(safeStr(msg.to,80));
      if(!to||typeof msg.data!=='object'||!msg.data||JSON.stringify(msg.data).length>16000)return;
      send(to,{t:'signal',from:c.id,data:msg.data});break;
    }
  }
}
server.on('upgrade',(req,socket)=>{
  if(new URL(req.url,'http://localhost').pathname!=='/ws'){socket.destroy();return}
  // Prevent unrelated websites from using a user's live room session from a browser.
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host){socket.destroy();return}}catch(e){socket.destroy();return}}
  const key=req.headers['sec-websocket-key'];if(typeof key!=='string'||!/^[-+/\w=]{16,}$/.test(key)){socket.destroy();return}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const c={id:crypto.randomUUID(),socket,buffer:Buffer.alloc(0),room:null,name:'',last:{},seen:Date.now()};
  socket.on('data',chunk=>{
    c.seen=Date.now();c.buffer=Buffer.concat([c.buffer,chunk]);
    if(c.buffer.length>220000){send(c,{t:'error',message:'전송 데이터가 너무 큽니다. 본문은 최대 10,000자까지 저장할 수 있습니다.'});socket.destroy();return}
    while(c.buffer.length>=2){const b=c.buffer,op=b[0]&15,fin=!!(b[0]&128);let len=b[1]&127,offset=2;if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);offset=4}else if(len===127){if(b.length<10)return;const v=b.readBigUInt64BE(2);if(v>BigInt(WS_MAX_FRAME_BYTES)){send(c,{t:'error',message:`전송 용량이 ${WS_MAX_FRAME_BYTES.toLocaleString()}바이트를 초과했습니다. 본문은 최대 10,000자까지 저장할 수 있습니다.`});socket.destroy();return}len=Number(v);offset=10}
      if(len>WS_MAX_FRAME_BYTES||!(b[1]&128)){socket.destroy();return}if(b.length<offset+4+len)return;
      const mask=b.subarray(offset,offset+4),payload=Buffer.from(b.subarray(offset+4,offset+4+len));for(let i=0;i<len;i++)payload[i]^=mask[i%4];c.buffer=b.subarray(offset+4+len);
      if(op===8){socket.end();return}if(op===9){socket.write(Buffer.from([0x8a,payload.length,...payload]));continue}if(op===10)continue;if(op!==1||!fin){socket.destroy();return}
      try{handle(c,JSON.parse(payload.toString('utf8')))}catch(e){
        console.error('WebSocket 처리 오류:',e.stack||e.message);
        let m;try{m=JSON.parse(payload.toString('utf8'))}catch(_){m=null}
        if(m?.t==='shelfAdd')send(c,{t:'shelfError',requestId:typeof m.requestId==='string'?m.requestId:'',message:'서버 내부 오류로 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
      };
    }
  });
  socket.on('error',()=>{});socket.on('close',()=>leave(c));
});
const cleanup=setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    for(const c of r.clients.values())if(now-c.seen>120000)c.socket.destroy();
    if(r.clients.size===0 && r.emptyAt && now-r.emptyAt>EMPTY_ROOM_CHAT_TTL)rooms.delete(r.code);
  }
},30000);cleanup.unref();
server.listen(PORT,HOST,()=>console.log(`아마추어 글쓰기 3D | http://localhost:${PORT}`));
module.exports={server,rooms};

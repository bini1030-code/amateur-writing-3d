'use strict';
// Zero-dependency Node.js HTTP + WebSocket server. Run: node server.js
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const petsEngine=require('./pets-server');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname,'public');
const LIMIT = 20;
const APP_VERSION = '14.27.0';
const CHAT_HISTORY_LIMIT = 100;
const EMPTY_ROOM_CHAT_TTL = 24 * 60 * 60 * 1000; // recent history lasts only while this server process runs
const rooms = new Map(); // chat history in memory; local browsers separately save their own records
// A shared bookshelf. For persistent storage on Render, set BOOKSHELF_DATA_DIR to a mounted persistent disk.
const BOOKSHELF_LIMIT=100;
const BOOKSHELF_MAX_CHARS=10000;
const GUESTBOOK_LIMIT=120; // per room, never overwrite older messages silently
const GUESTBOOK_MAX_CHARS=500;
const COMMENT_MAX_CHARS=400;
const COMMENT_LIMIT_PER_ITEM=40;
const COMMENT_LIMIT_TOTAL=2400;
const BOOKSHELF_MAX_BYTES=256*1024;
const WS_MAX_FRAME_BYTES=256*1024;
const BOOKSHELF_DIR=process.env.BOOKSHELF_DATA_DIR || path.join(__dirname,'data');
const BOOKSHELF_FILE=path.join(BOOKSHELF_DIR,'room-books.json');
// Render Free deletes local data on sleep/restart/deploy. An external Supabase database
// provides durable storage. The secret key is ONLY used by this Node server.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');
const SUPABASE_SECRET_KEY=(process.env.SUPABASE_SECRET_KEY||'').trim();
const REMOTE_ENABLED=!!(SUPABASE_URL&&SUPABASE_SECRET_KEY);
const REMOTE_MISCONFIGURED=!!(SUPABASE_URL||SUPABASE_SECRET_KEY)&&!REMOTE_ENABLED;
const STORAGE_MODE=REMOTE_ENABLED?'supabase':(process.env.BOOKSHELF_DATA_DIR?'configured-directory':'ephemeral');
const remoteLoaded=new Set(),remoteLoading=new Map(),shelfLocks=new Map();
function storageProblem(e){
 let raw=String(e?.message||'저장 요청에 실패했습니다.');
 if(SUPABASE_SECRET_KEY)raw=raw.split(SUPABASE_SECRET_KEY).join('[비밀 키 보호]');
 const msg=raw.slice(0,250);
 return '공개 책 영구 저장소에 접속하거나 기록하지 못했습니다. '+msg+' Render의 SUPABASE_URL, SUPABASE_SECRET_KEY 및 Supabase 테이블 설정을 확인해 주세요.';
}
function withShelfLock(code,fn){
 const previous=shelfLocks.get(code)||Promise.resolve();
 let release;const current=new Promise(r=>{release=r});shelfLocks.set(code,current);
 return (async()=>{await previous;try{return await fn()}finally{release();if(shelfLocks.get(code)===current)shelfLocks.delete(code)}})();
}
async function remoteRequest(relative,method='GET',body){
 if(REMOTE_MISCONFIGURED)throw new Error('환경 변수 두 개 중 하나가 비어 있습니다.');
 let base;try{base=new URL(SUPABASE_URL)}catch(e){throw new Error('SUPABASE_URL 형식이 올바르지 않습니다.')}
 if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Supabase 주소는 HTTPS여야 합니다.');
 const url=SUPABASE_URL+'/rest/v1/writing_room_shelves'+relative;
 const headers={apikey:SUPABASE_SECRET_KEY,Accept:'application/json'};
 if(body!==undefined){headers['Content-Type']='application/json';headers.Prefer='resolution=merge-duplicates,return=minimal'}
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
 try{
  const resp=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  if(!resp.ok){let detail='';try{const err=await resp.json();detail=String(err.message||err.code||'').slice(0,120)}catch(e){}
   throw new Error('Supabase HTTP '+resp.status+(detail?' - '+detail:''));}
  if(method==='GET')return await resp.json();return null;
 }finally{clearTimeout(timeout)}
}
async function remoteSaveRoom(code,books,deleted,guestbook=savedGuestbook.get(code)||[],comments=savedComments.get(code)||{}){
 // Keep existing table and SQL unchanged. Older rows simply lack these two keys.
 await remoteRequest('?on_conflict=room_code','POST',{room_code:code,state:{books,deleted,guestbook,comments},updated_at:new Date().toISOString()});
}
async function ensureRoomLoaded(code){
 if(REMOTE_MISCONFIGURED)throw new Error('SUPABASE_URL과 SUPABASE_SECRET_KEY를 모두 입력해야 합니다.');
 if(!REMOTE_ENABLED||remoteLoaded.has(code))return;
 if(!remoteLoading.has(code)){
  const job=(async()=>{
   const rows=await remoteRequest('?room_code=eq.'+encodeURIComponent(code)+'&select=state&limit=1');
   if(!Array.isArray(rows))throw new Error('데이터베이스가 올바른 책장 목록을 반환하지 않았습니다.');
   if(rows.length){
    const state=rows[0]?.state;
    if(!state||!Array.isArray(state.books)||!Array.isArray(state.deleted))throw new Error('데이터베이스의 책장 형식이 올바르지 않습니다.');
    savedBooks.set(code,state.books.filter(b=>b&&typeof b.id==='string'&&typeof b.text==='string'&&typeof b.title==='string'&&typeof b.author==='string').slice(-BOOKSHELF_LIMIT));
    deletedBooks.set(code,state.deleted.filter(id=>typeof id==='string').slice(-2000));
    savedGuestbook.set(code,Array.isArray(state.guestbook)?state.guestbook.filter(validCommunityEntry).slice(-GUESTBOOK_LIMIT):[]);
    savedComments.set(code,sanitizeComments(state.comments));
   }else{
    // One-time migration: if this instance still has saved local books, upload them.
    const old=savedBooks.get(code)||[],gone=deletedBooks.get(code)||[];
    if(old.length||gone.length||(savedGuestbook.get(code)||[]).length||Object.keys(savedComments.get(code)||{}).length)await remoteSaveRoom(code,old,gone);
    else {savedBooks.set(code,[]);deletedBooks.set(code,[]);savedGuestbook.set(code,[]);savedComments.set(code,{})}
   }
   const existing=rooms.get(code);if(existing)existing.books=savedBooks.get(code)||[];
   remoteLoaded.add(code);
  })();
  remoteLoading.set(code,job);
  job.finally(()=>{if(remoteLoading.get(code)===job)remoteLoading.delete(code)}).catch(()=>{});
 }
 return remoteLoading.get(code);
}
async function saveShelfState(code,books,deleted,comments=savedComments.get(code)||{}){
 if(REMOTE_ENABLED){await remoteSaveRoom(code,books,deleted,savedGuestbook.get(code)||[],comments);savedBooks.set(code,books);deletedBooks.set(code,deleted);savedComments.set(code,comments);return 'supabase'}
 if(REMOTE_MISCONFIGURED)throw new Error('Supabase 환경 변수 두 개를 모두 설정해야 합니다.');
 const prev=savedBooks.get(code),prevDeleted=deletedBooks.get(code),prevComments=savedComments.get(code);
 savedBooks.set(code,books);deletedBooks.set(code,deleted);savedComments.set(code,comments);
 try{persistBooks()}catch(e){if(prev===undefined)savedBooks.delete(code);else savedBooks.set(code,prev);if(prevDeleted===undefined)deletedBooks.delete(code);else deletedBooks.set(code,prevDeleted);if(prevComments===undefined)savedComments.delete(code);else savedComments.set(code,prevComments);throw e}
 return STORAGE_MODE;
}

const savedBooks=new Map();
const savedGuestbook=new Map();
const savedComments=new Map();
function validCommunityEntry(v){return !!(v&&typeof v.id==='string'&&typeof v.author==='string'&&typeof v.text==='string'&&Number.isFinite(v.at))}
function sanitizeComments(obj){
 const result={};if(!obj||typeof obj!=='object'||Array.isArray(obj))return result;
 let total=0;
 for(const [key,items] of Object.entries(obj)){
  if(!/^(book|guest):[a-zA-Z0-9-]{1,80}$/.test(key)||!Array.isArray(items))continue;
  const accepted=items.filter(validCommunityEntry).slice(-COMMENT_LIMIT_PER_ITEM);
  if(total+accepted.length>COMMENT_LIMIT_TOTAL)continue;
  if(accepted.length)result[key]=accepted;
  total+=accepted.length;
 }return result;
}
async function saveCommunityState(code,guestbook,comments){
 const books=savedBooks.get(code)||[],deleted=deletedBooks.get(code)||[];
 if(REMOTE_MISCONFIGURED)throw new Error('Supabase 설정이 불완전합니다.');
 if(REMOTE_ENABLED){await remoteSaveRoom(code,books,deleted,guestbook,comments);savedGuestbook.set(code,guestbook);savedComments.set(code,comments);return;}
 const prevGuest=savedGuestbook.get(code),prevComments=savedComments.get(code);
 savedGuestbook.set(code,guestbook);savedComments.set(code,comments);
 try{persistBooks()}catch(e){if(prevGuest===undefined)savedGuestbook.delete(code);else savedGuestbook.set(code,prevGuest);if(prevComments===undefined)savedComments.delete(code);else savedComments.set(code,prevComments);throw e}
}

// Keep deleted IDs across reconnects, so stale browser backups cannot resurrect removed books.
const deletedBooks=new Map();
const deletedRequests=new Map();
const ownerHash=(code,key)=>crypto.createHash('sha256').update(code+'\0'+key).digest('hex');
const validOwnerKey=key=>typeof key==='string'&&/^[a-f0-9-]{32,80}$/i.test(key);
// Never send the owner's secret hash to other visitors.
function publicBook(book){if(!book)return null;const {ownerHash:privateHash,lastMutationId,requestId,...fields}=book;return {...fields,ownerProtected:!!privateHash};}
function canManage(c,book,ownerKey,sourceDraftId=''){
 if(!book)return false;
 if(book.ownerHash)return validOwnerKey(ownerKey)&&ownerHash(c.room.code,ownerKey)===book.ownerHash;
 if(book.author!==c.name)return false;
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
  if(raw?.community&&typeof raw.community==='object')for(const [code,entry] of Object.entries(raw.community)){
    if(!/^[A-Z0-9가-힣-]{1,18}$/.test(code))continue;
    savedGuestbook.set(code,Array.isArray(entry?.guestbook)?entry.guestbook.filter(validCommunityEntry).slice(-GUESTBOOK_LIMIT):[]);
    savedComments.set(code,sanitizeComments(entry?.comments));
  }
  if(raw?.__format===2&&raw.deleted){for(const [code,ids] of Object.entries(raw.deleted)){
   if(/^[A-Z0-9가-힣-]{1,18}$/.test(code)&&Array.isArray(ids))deletedBooks.set(code,ids.filter(id=>typeof id==='string').slice(-2000));
  }}
}catch(e){if(e.code!=='ENOENT')console.warn('서가 저장 기록을 읽을 수 없습니다:',e.message)}
function persistBooks(){
  fs.mkdirSync(BOOKSHELF_DIR,{recursive:true});
  const community={};for(const code of new Set([...savedGuestbook.keys(),...savedComments.keys()]))community[code]={guestbook:savedGuestbook.get(code)||[],comments:savedComments.get(code)||{}};
  const obj={__format:2,rooms:Object.fromEntries(savedBooks),deleted:Object.fromEntries(deletedBooks),community};
  const tmp=BOOKSHELF_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');
  fs.renameSync(tmp,BOOKSHELF_FILE);
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
// V14.19: Reliable book publishing through an ordinary HTTP request. WebSocket remains
// for presence and live fanout, but publication no longer depends on a long WS frame.
async function publishOverHttp(raw){
 const message={t:'shelfError',requestId:typeof raw?.requestId==='string'?raw.requestId.slice(0,80):'',maxChars:BOOKSHELF_MAX_CHARS};
 const fail=(status,reason,text)=>({status,body:{...message,reason,message:text}});
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail(400,'INVALID_INPUT','요청 형식이 잘못됐습니다.');
 const code=safeStr(raw.room,18).toUpperCase();
 if(!/^[A-Z0-9가-힣-]{1,18}$/.test(code))return fail(400,'ROOM_INVALID','모임방 코드가 올바르지 않습니다. 다시 입장해 주세요.');
 const name=safeStr(raw.name,18).replace(/[<>]/g,'');
 if(!name)return fail(400,'NAME_INVALID','작성자 이름이 없습니다. 모임방에 다시 입장해 주세요.');
 const ownerKey=raw.ownerKey;
 if(!validOwnerKey(ownerKey))return fail(400,'NO_OWNER_KEY','브라우저 책장 관리 키를 읽을 수 없습니다. 원래 기기에서 사이트 저장을 허용한 뒤 다시 시도해 주세요.');
 const requestId=raw.requestId;
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(requestId))return fail(400,'REQUEST_INVALID','공개 요청 번호가 잘못됐습니다. 새로고침 후 다시 시도해 주세요.');
 if(typeof raw.title!=='string'||typeof raw.text!=='string')return fail(400,'INVALID_INPUT','제목 또는 본문 형식이 올바르지 않습니다.');
 const title=raw.title.trim()||'제목 없는 글',text=raw.text.trim();
 const count=[...text].length,titleCount=[...title].length;
 if(!count)return fail(422,'EMPTY_TEXT','본문이 비어 있습니다. 글을 작성한 뒤 공개해 주세요.');
 if(titleCount>80)return fail(422,'TITLE_LIMIT',`제목은 최대 80자입니다. 현재 ${titleCount.toLocaleString()}자로 ${(titleCount-80).toLocaleString()}자를 줄여 주세요.`);
 if(count>BOOKSHELF_MAX_CHARS)return fail(422,'CHAR_LIMIT',`본문은 최대 ${BOOKSHELF_MAX_CHARS.toLocaleString()}자까지 공개할 수 있습니다. 현재 ${count.toLocaleString()}자로 ${(count-BOOKSHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요. 비공개 글은 그대로 남아 있습니다.`);
 const sourceDraftId=(typeof raw.sourceDraftId==='string'&&/^draft-[a-z0-9-]{1,72}$/i.test(raw.sourceDraftId))?raw.sourceDraftId:'';
 return withShelfLock(code,async()=>{
  try{await ensureRoomLoaded(code)}catch(e){return fail(503,'STORAGE_UNAVAILABLE',storageProblem(e))}
  let room=rooms.get(code);
  if(!room){room={code,clients:new Map(),reading:null,history:[],books:savedBooks.get(code)||[],lampOn:true,emptyAt:0};rooms.set(code,room)}
  const prior=room.books.find(b=>b.requestId===requestId);
  if(prior)return {status:200,body:{t:'shelfAck',requestId,book:publicBook(prior),updated:!!prior.updatedAt,storage:STORAGE_MODE}};
  const ctx={room,name};
  const existingIndex=sourceDraftId?room.books.findIndex(b=>b.sourceDraftId===sourceDraftId&&(b.ownerHash?canManage(ctx,b,ownerKey,sourceDraftId):b.author===name)):-1;
  if(room.books.length>=BOOKSHELF_LIMIT&&existingIndex<0)return fail(409,'SHELF_FULL',`책장이 가득 찼습니다. 현재 ${room.books.length}권, 최대 ${BOOKSHELF_LIMIT}권까지 공개할 수 있습니다.`);
  const existing=existingIndex>=0?room.books[existingIndex]:null;
  if(existing&&!canManage(ctx,existing,ownerKey,sourceDraftId))return fail(403,'NOT_OWNER','이미 공개된 책을 수정할 권한이 없습니다. 처음 등록한 브라우저의 관리 키가 필요합니다.');
  const now=Date.now();
  const entry=existing?
    {...existing,title,text,updatedAt:now,requestId,ownerHash:existing.ownerHash||ownerHash(room.code,ownerKey)}:
    {id:crypto.randomUUID(),title,text,author:name,createdAt:now,updatedAt:0,requestId,ownerHash:ownerHash(room.code,ownerKey),...(sourceDraftId?{sourceDraftId}:{})};
  const next=existingIndex>=0?room.books.map((b,i)=>i===existingIndex?entry:b):[...room.books,entry];
  let storage;
  try{storage=await saveShelfState(code,next,deletedBooks.get(code)||[])}catch(e){console.error('책 공개 기록 실패:',e.message);return fail(503,'STORAGE_FAILED',storageProblem(e))}
  room.books=next;
  broadcast(room,{t:'shelfBook',book:publicBook(entry)});
  return {status:200,body:{t:'shelfAck',requestId,book:publicBook(entry),updated:!!existing,storage}};
 });
}
function sendShelfHttpJson(res,status,body){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(body));
}
const server = http.createServer((req,res)=>{
  const target = new URL(req.url,'http://localhost');
  if (target.pathname === '/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:APP_VERSION,shelfMaxChars:BOOKSHELF_MAX_CHARS,shelfPublish:'http-v1',shelfStorage:STORAGE_MODE,shelfStorageDurable:STORAGE_MODE==='supabase',shelfConfigured:!REMOTE_MISCONFIGURED,community:'guestbook-comments-v1'}));}
  if(target.pathname==='/api/shelf/publish'){
    if(req.method!=='POST')return sendShelfHttpJson(res,405,{t:'shelfError',reason:'METHOD_INVALID',message:'책 공개에는 POST 요청이 필요합니다.'});
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return sendShelfHttpJson(res,403,{t:'shelfError',reason:'ORIGIN_INVALID',message:'다른 사이트에서 책을 등록할 수 없습니다.'})}catch(e){return sendShelfHttpJson(res,403,{t:'shelfError',reason:'ORIGIN_INVALID',message:'허용되지 않은 접속입니다.'})}}
    if(!(req.headers['content-type']||'').startsWith('application/json'))return sendShelfHttpJson(res,415,{t:'shelfError',reason:'CONTENT_TYPE',message:'전송 형식이 JSON이 아닙니다. 사이트를 새로고침해 주세요.'});
    let bytes=0,parts=[],tooLarge=false;
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>BOOKSHELF_MAX_BYTES){tooLarge=true;parts=[];return;}if(!tooLarge)parts.push(chunk)});
    req.on('end',()=>{
      if(tooLarge)return sendShelfHttpJson(res,413,{t:'shelfError',reason:'BYTE_LIMIT',maxChars:BOOKSHELF_MAX_CHARS,message:`전송 데이터가 ${BOOKSHELF_MAX_BYTES.toLocaleString()}바이트를 넘었습니다. 본문은 최대 10,000자까지 가능합니다. 글에 대량의 특수문자가 포함됐다면 일부를 줄여 주세요.`});
      let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch(e){return sendShelfHttpJson(res,400,{t:'shelfError',reason:'JSON_INVALID',message:'책 데이터의 전송 형식이 깨졌습니다. 페이지를 새로고침해 다시 시도해 주세요.'})}
      publishOverHttp(body).then(result=>sendShelfHttpJson(res,result.status,result.body)).catch(e=>{console.error('HTTP 책 공개 실패:',e.stack||e.message);if(!res.headersSent)sendShelfHttpJson(res,500,{t:'shelfError',reason:'SERVER_ERROR',message:'서버에서 책 공개 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'})})
    });
    req.on('error',e=>{console.error('HTTP 책 요청 전송 오류:',e.message);if(!res.headersSent)sendShelfHttpJson(res,400,{t:'shelfError',reason:'NETWORK_ERROR',message:'책 데이터를 받다가 연결이 끊겼습니다.'})});
    return;
  }

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
async function handle(c,msg){if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
  if(msg.t==='join'){
    if(c.room)return;const code=safeStr(msg.code,18).toUpperCase().replace(/[^A-Z0-9가-힣-]/g,'').slice(0,18)||'NIGHT';
    let shelfLoadError='';
    try{await ensureRoomLoaded(code)}catch(e){shelfLoadError=storageProblem(e);console.error('책장 초기화 실패:',e.message)}
    if(c.socket.destroyed)return;
    let room=rooms.get(code);if(!room){room={code,clients:new Map(),reading:null,history:[],books:savedBooks.get(code)||[],lampOn:true,emptyAt:0};rooms.set(code,room)}
    if(!room.pets)room.pets=petsEngine.makePets();
    room.emptyAt=0;
    if(room.clients.size>=LIMIT){send(c,{t:'error',message:'이 방은 20명 정원입니다.'});cleanRoom(room);return}
    c.name=safeStr(msg.name,18).replace(/[<>]/g,'')||'밤의 필자';c.color=Math.floor(finite(msg.color,0,5,0));c.gender=msg.gender==='female'?'female':'male';c.x=-2.2+(room.clients.size%5)*1.1;c.z=9.1+Math.floor(room.clients.size/5)*.48;c.rot=Math.PI;c.action='stand';c.room=room;room.clients.set(c.id,c);
    const ownerKey=validOwnerKey(msg.ownerKey)?msg.ownerKey:'';
    const ownerKeys=[];
    for(const candidate of [ownerKey,...(Array.isArray(msg.ownerKeys)?msg.ownerKeys.slice(0,20):[])]){
      if(validOwnerKey(candidate)&&!ownerKeys.includes(candidate))ownerKeys.push(candidate);
    }
    const editableBookKeyIndices={};
    for(const book of room.books){
      if(!book.ownerHash)continue;
      const ix=ownerKeys.findIndex(k=>canManage(c,book,k));
      if(ix>=0)editableBookKeyIndices[book.id]=ix;
    }
    const editableBookIds=Object.keys(editableBookKeyIndices);
    send(c,{t:'welcome',id:c.id,code,people:peers(room),reading:room.reading,history:room.history,books:shelfLoadError?[]:room.books.map(publicBook),deletedBookIds:deletedBooks.get(code)||[],editableBookIds,editableBookKeyIndices,lampOn:room.lampOn!==false,pets:petsEngine.publicPets(room),limit:LIMIT,serverVersion:APP_VERSION,shelfStorage:STORAGE_MODE,shelfLoadError,guestbook:shelfLoadError?[]:savedGuestbook.get(code)||[],comments:shelfLoadError?{}:savedComments.get(code)||{},features:['shelf-save-ack-v2','multi-drafts-v1','shelf-char-limit-10000','shelf-manage-v1','shelf-owner-multikey-v1','shelf-http-publish-v1','three-pets-v1','guestbook-comments-v1']});
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
    case 'petAction':{
      if(!rate(c,'petAction',700))return;
      const id=safeStr(msg.petId,20),action=safeStr(msg.action,15);
      const result=petsEngine.act(room,id,action,c);
      if(result.error){send(c,{t:'petError',message:result.error});break}
      broadcast(room,result.event);
      broadcast(room,{t:'pets',pets:petsEngine.publicPets(room)});
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
    case 'guestbookAdd':{
      const requestId=safeStr(msg.requestId,80);
      const fail=(reason,message)=>send(c,{t:'communityError',action:'guestbook',requestId,reason,message});
      if(REMOTE_ENABLED&&!remoteLoaded.has(room.code)){fail('STORAGE_UNAVAILABLE','영구 책장 목록을 아직 읽지 못했습니다. 서버의 Supabase 설정을 확인하고 재접속해 주세요.');break}
      if(!rate(c,'guestbookAdd',2000)){fail('RATE_LIMIT','방명록은 2초 간격으로 등록할 수 있습니다.');break}
      if(typeof msg.text!=='string'){fail('INVALID_INPUT','방명록 내용 형식을 확인해 주세요.');break}
      const body=msg.text.trim(),count=[...body].length;
      if(!count){fail('EMPTY_TEXT','방명록 내용을 입력해 주세요.');break}
      if(count>GUESTBOOK_MAX_CHARS){fail('CHAR_LIMIT',`방명록은 최대 ${GUESTBOOK_MAX_CHARS}자입니다. 현재 ${count}자이므로 ${count-GUESTBOOK_MAX_CHARS}자를 줄여 주세요.`);break}
      await withShelfLock(room.code,async()=>{
        const old=savedGuestbook.get(room.code)||[];
        if(old.length>=GUESTBOOK_LIMIT){fail('GUESTBOOK_FULL',`방명록에 ${GUESTBOOK_LIMIT}개가 등록되어 있습니다. 보관 한도에 도달해 더 추가할 수 없습니다.`);return}
        const entry={id:crypto.randomUUID(),author:c.name,text:body,at:Date.now()};
        try{await saveCommunityState(room.code,[...old,entry],savedComments.get(room.code)||{})}
        catch(e){console.error('방명록 영구 저장 실패:',e.message);fail('STORAGE_FAILED',storageProblem(e));return}
        broadcast(room,{t:'guestbookAdded',entry});send(c,{t:'communityAck',action:'guestbook',requestId});
      });break;
    }
    case 'commentAdd':{
      const requestId=safeStr(msg.requestId,80);
      const fail=(reason,message)=>send(c,{t:'communityError',action:'comment',requestId,reason,message});
      if(REMOTE_ENABLED&&!remoteLoaded.has(room.code)){fail('STORAGE_UNAVAILABLE','영구 책장 목록을 아직 읽지 못했습니다. 서버의 Supabase 설정을 확인하고 재접속해 주세요.');break}
      if(!rate(c,'commentAdd',1300)){fail('RATE_LIMIT','댓글은 1.3초 간격으로 등록할 수 있습니다.');break}
      const kind=msg.targetType==='book'?'book':msg.targetType==='guest'?'guest':'';
      const id=safeStr(msg.targetId,80);
      if(!kind||!id){fail('TARGET_INVALID','댓글을 남길 글을 다시 선택해 주세요.');break}
      if(typeof msg.text!=='string'){fail('INVALID_INPUT','댓글 형식이 올바르지 않습니다.');break}
      const body=msg.text.trim(),count=[...body].length;
      if(!count){fail('EMPTY_TEXT','댓글 내용을 입력해 주세요.');break}
      if(count>COMMENT_MAX_CHARS){fail('CHAR_LIMIT',`댓글은 최대 ${COMMENT_MAX_CHARS}자입니다. 현재 ${count}자이므로 ${count-COMMENT_MAX_CHARS}자를 줄여 주세요.`);break}
      await withShelfLock(room.code,async()=>{
        if(kind==='book'&&!room.books.some(b=>b.id===id)){fail('BOOK_NOT_FOUND','책장에서 찾을 수 없는 책입니다. 새로고침한 뒤 다시 선택해 주세요.');return}
        if(kind==='guest'&&!(savedGuestbook.get(room.code)||[]).some(b=>b.id===id)){fail('POST_NOT_FOUND','방명록 글을 찾을 수 없습니다. 목록을 다시 확인해 주세요.');return}
        const prev=savedComments.get(room.code)||{},key=kind+':'+id,list=prev[key]||[];
        if(list.length>=COMMENT_LIMIT_PER_ITEM){fail('COMMENT_FULL',`이 글에는 댓글을 최대 ${COMMENT_LIMIT_PER_ITEM}개까지 달 수 있습니다.`);return}
        if(Object.values(prev).reduce((n,a)=>n+a.length,0)>=COMMENT_LIMIT_TOTAL){fail('COMMENT_FULL','모임방 댓글 보관 한도에 도달했습니다.');return}
        const entry={id:crypto.randomUUID(),author:c.name,text:body,at:Date.now()};
        try{await saveCommunityState(room.code,savedGuestbook.get(room.code)||[],{...prev,[key]:[...list,entry]})}
        catch(e){console.error('댓글 영구 저장 실패:',e.message);fail('STORAGE_FAILED',storageProblem(e));return}
        broadcast(room,{t:'commentAdded',targetType:kind,targetId:id,entry});send(c,{t:'communityAck',action:'comment',requestId});
      });break;
    }
    case 'shelfAdd':{
      if(!rate(c,'shelfAdd',1200)){send(c,{t:'shelfError',requestId:msg.requestId||'',reason:'RATE_LIMIT',message:'등록 요청을 너무 빠르게 반복했습니다. 잠시 후 다시 시도해 주세요.'});break}
      const result=await publishOverHttp({...msg,room:room.code,name:c.name});
      send(c,result.body);
      break;
    }
    case 'shelfUpdate':{
      await withShelfLock(room.code,async()=>{
      const requestId=typeof msg.requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)?msg.requestId:'';
      const fail=(message,reason='INVALID_INPUT')=>send(c,{t:'shelfActionError',action:'update',requestId,message,reason,maxChars:BOOKSHELF_MAX_CHARS});
      const id=safeStr(msg.id,64),index=room.books.findIndex(b=>b.id===id);
      if(index<0){fail('선택한 책이 서버 책장에 없습니다. 다른 사람이 삭제했거나 서버가 재시작되었을 수 있습니다.','BOOK_NOT_FOUND');return}
      const old=room.books[index];
      if(requestId&&old.lastMutationId===requestId){send(c,{t:'shelfUpdateAck',requestId,book:publicBook(old)});return}
      if(!rate(c,'shelfMutate',500)){fail('수정 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.','RATE_LIMIT');return}
      if(!canManage(c,old,msg.ownerKey,msg.sourceDraftId)){fail('이 책을 수정할 권한이 없습니다. 등록한 기기·브라우저의 관리 키가 필요합니다. 이전 버전의 책은 동일 작성자명과 원본 초안이 필요합니다.','NOT_OWNER');return}
      if(Number(msg.expectedVersion)!==(old.updatedAt||old.createdAt)){fail('다른 곳에서 책이 수정되었습니다. 책장을 다시 열어 최신 내용을 확인해 주세요.','CONFLICT');return}
      if(typeof msg.title!=='string'||typeof msg.text!=='string'){fail('제목 또는 본문 형식이 잘못됐습니다.','INVALID_INPUT');return}
      const title=msg.title.trim()||'제목 없는 글',text=msg.text.trim(),count=[...text].length,titleCount=[...title].length;
      if(!text){fail('책 본문이 비어 있습니다. 글을 작성해 주세요.','EMPTY_TEXT');return}
      if(titleCount>80){fail(`제목은 최대 80자입니다. 현재 ${titleCount}자이므로 ${titleCount-80}자를 줄여 주세요.`,'TITLE_LIMIT');return}
      if(count>BOOKSHELF_MAX_CHARS){fail(`본문은 최대 ${BOOKSHELF_MAX_CHARS.toLocaleString()}자입니다. 현재 ${count.toLocaleString()}자이므로 ${(count-BOOKSHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요.`,'CHAR_LIMIT');return}
      if(Buffer.byteLength(JSON.stringify({t:'shelfUpdate',requestId,id,title,text,ownerKey:msg.ownerKey}),'utf8')>BOOKSHELF_MAX_BYTES){fail(`전송 용량 ${BOOKSHELF_MAX_BYTES.toLocaleString()}바이트를 초과했습니다. 이모지와 특수문자를 줄여 주세요.`,'BYTE_LIMIT');return}
      const entry={...old,title,text,updatedAt:Date.now(),lastMutationId:requestId,ownerHash:old.ownerHash||ownerHash(room.code,msg.ownerKey)};
      const next=room.books.map((b,i)=>i===index?entry:b);
      try{await saveShelfState(room.code,next,deletedBooks.get(room.code)||[])}catch(e){fail(storageProblem(e)+' 기존 책은 그대로 남아 있습니다.','STORAGE_FAILED');return}
      room.books=next;
      send(c,{t:'shelfUpdateAck',requestId,book:publicBook(entry)});
      broadcast(room,{t:'shelfBook',book:publicBook(entry)},c);
      });
      break;
    }
    case 'shelfDelete':{
      await withShelfLock(room.code,async()=>{
      const requestId=typeof msg.requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)?msg.requestId:'';
      const fail=(message,reason='INVALID_INPUT')=>send(c,{t:'shelfActionError',action:'delete',requestId,message,reason});
      const id=safeStr(msg.id,64),index=room.books.findIndex(b=>b.id===id);
      const completed=deletedRequests.get(room.code+':'+id);
      if(index<0&&completed===requestId){send(c,{t:'shelfDeleteAck',requestId,id});return}
      if(index<0){fail('이미 삭제되었거나 책장에 없는 책입니다. 책장을 다시 확인해 주세요.','BOOK_NOT_FOUND');return}
      if(!rate(c,'shelfMutate',500)){fail('삭제 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.','RATE_LIMIT');return}
      const old=room.books[index];
      if(!canManage(c,old,msg.ownerKey,msg.sourceDraftId)){fail('이 책을 삭제할 권한이 없습니다. 등록한 기기의 관리 키 또는 이전 버전 원본 초안이 필요합니다.','NOT_OWNER');return}
      if(Number(msg.expectedVersion)!==(old.updatedAt||old.createdAt)){fail('책이 변경되었습니다. 최신 책을 다시 확인한 다음 삭제해 주세요.','CONFLICT');return}
      const next=room.books.filter(b=>b.id!==id),oldDeleted=deletedBooks.get(room.code)||[];
      const nextDeleted=[...oldDeleted.filter(x=>x!==id),id].slice(-2000);
      const nextComments={...(savedComments.get(room.code)||{})};delete nextComments['book:'+id];
      try{await saveShelfState(room.code,next,nextDeleted,nextComments)}catch(e){fail(storageProblem(e)+' 책은 삭제되지 않았습니다.','STORAGE_FAILED');return}
      room.books=next;
      deletedRequests.set(room.code+':'+id,requestId);
      send(c,{t:'shelfDeleteAck',requestId,id});
      broadcast(room,{t:'shelfRemove',id},c);
      });
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
    if(c.buffer.length>640000){send(c,{t:'error',message:'전송 데이터가 너무 큽니다. 본문은 최대 10,000자까지 저장할 수 있습니다.'});socket.destroy();return}
    while(c.buffer.length>=2){const b=c.buffer,op=b[0]&15,fin=!!(b[0]&128);let len=b[1]&127,offset=2;if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);offset=4}else if(len===127){if(b.length<10)return;const v=b.readBigUInt64BE(2);if(v>BigInt(WS_MAX_FRAME_BYTES)){send(c,{t:'error',message:`전송 용량이 ${WS_MAX_FRAME_BYTES.toLocaleString()}바이트를 초과했습니다. 본문은 최대 10,000자까지 저장할 수 있습니다.`});socket.destroy();return}len=Number(v);offset=10}
      if(len>WS_MAX_FRAME_BYTES||!(b[1]&128)){socket.destroy();return}if(b.length<offset+4+len)return;
      const mask=b.subarray(offset,offset+4),payload=Buffer.from(b.subarray(offset+4,offset+4+len));for(let i=0;i<len;i++)payload[i]^=mask[i%4];c.buffer=b.subarray(offset+4+len);
      if(op===8){socket.end();return}if(op===9){socket.write(Buffer.from([0x8a,payload.length,...payload]));continue}if(op===10)continue;if(op!==1||!fin){socket.destroy();return}
      let m;try{m=JSON.parse(payload.toString('utf8'))}catch(e){continue}
      c.messageQueue=(c.messageQueue||Promise.resolve()).then(()=>handle(c,m)).catch(e=>{
        console.error('WebSocket 처리 오류:',e.stack||e.message);
        if(m?.t==='shelfAdd')send(c,{t:'shelfError',requestId:typeof m.requestId==='string'?m.requestId:'',reason:'SERVER_ERROR',message:'서버 내부 오류로 책을 공개하지 못했습니다.'});
        if(m?.t==='shelfUpdate'||m?.t==='shelfDelete')send(c,{t:'shelfActionError',requestId:m.requestId||'',action:m.t==='shelfUpdate'?'update':'delete',reason:'SERVER_ERROR',message:'서버 내부 오류로 책을 변경하지 못했습니다.'});
      });
    }
  });
  socket.on('error',()=>{});socket.on('close',()=>leave(c));
});
// One roaming state per room, shared between all connected visitors.
// No animal state is written into the writing bookshelf or Supabase data.
const petClock=setInterval(()=>{
 const now=Date.now();
 for(const room of rooms.values()){
  if(!room.clients.size||!room.pets)continue;
  for(const pet of room.pets)petsEngine.advance(pet,now);
  broadcast(room,{t:'pets',pets:petsEngine.publicPets(room)});
 }
},180);petClock.unref();
const cleanup=setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    for(const c of r.clients.values())if(now-c.seen>120000)c.socket.destroy();
    if(r.clients.size===0 && r.emptyAt && now-r.emptyAt>EMPTY_ROOM_CHAT_TTL)rooms.delete(r.code);
  }
},30000);cleanup.unref();
server.listen(PORT,HOST,()=>console.log(`아마추어 글쓰기 3D | http://localhost:${PORT}`));
module.exports={server,rooms};

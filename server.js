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
const CHAT_HISTORY_LIMIT = 100;
const EMPTY_ROOM_CHAT_TTL = 24 * 60 * 60 * 1000; // recent history lasts only while this server process runs
const rooms = new Map(); // chat history in memory; local browsers separately save their own records
// A shared bookshelf. For persistent storage on Render, set BOOKSHELF_DATA_DIR to a mounted persistent disk.
const BOOKSHELF_LIMIT=64;
const BOOKSHELF_DIR=process.env.BOOKSHELF_DATA_DIR || path.join(__dirname,'data');
const BOOKSHELF_FILE=path.join(BOOKSHELF_DIR,'room-books.json');
const savedBooks=new Map();
try{
  const raw=JSON.parse(fs.readFileSync(BOOKSHELF_FILE,'utf8'));
  for(const [code,entries] of Object.entries(raw)){
    if(!/^[A-Z0-9가-힣-]{1,18}$/.test(code)||!Array.isArray(entries))continue;
    savedBooks.set(code,entries.slice(-BOOKSHELF_LIMIT).filter(b=>b && typeof b.id==='string' && typeof b.text==='string' && typeof b.title==='string' && typeof b.author==='string'));
  }
}catch(e){if(e.code!=='ENOENT')console.warn('서가 저장 기록을 읽을 수 없습니다:',e.message)}
function persistBooks(){
  fs.mkdirSync(BOOKSHELF_DIR,{recursive:true});
  const obj=Object.fromEntries(savedBooks);
  const tmp=BOOKSHELF_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');
  fs.renameSync(tmp,BOOKSHELF_FILE);
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const server = http.createServer((req,res)=>{
  const target = new URL(req.url,'http://localhost');
  if (target.pathname === '/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
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
    send(c,{t:'welcome',id:c.id,code,people:peers(room),reading:room.reading,history:room.history,books:room.books,lampOn:room.lampOn!==false,limit:LIMIT});
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
      if(!['joy','sad','anger','worry','peace','hope'].includes(kind))return;
      // Only the explicitly shared mood label is broadcast; reflection notes remain on the user's device.
      broadcast(room,{t:'mood',id:c.id,name:c.name,kind,at:Date.now()});break;
    }
    case 'shelfAdd':{
      if(!rate(c,'shelfAdd',1600))return;
      const title=safeStr(msg.title,80)||'제목 없는 글';
      const text=safeStr(msg.text,10000);
      if(!text){send(c,{t:'error',message:'책장에 꽂을 글을 먼저 작성해 주세요.'});return}
      if(room.books.length>=BOOKSHELF_LIMIT){send(c,{t:'error',message:'이 모임방의 책장이 가득 찼어요(64권).'});return}
      const entry={id:crypto.randomUUID(),title,text,author:c.name,createdAt:Date.now()};
      const next=[...room.books,entry];
      savedBooks.set(room.code,next);
      try{persistBooks()}catch(e){
        savedBooks.set(room.code,room.books);
        console.error('책장 저장 실패:',e.message);
        send(c,{t:'error',message:'서버에 책을 저장하지 못했어요. 서버 저장 공간을 확인해 주세요.'});return;
      }
      room.books=next;
      broadcast(room,{t:'shelfBook',book:entry});
      break;
    }
    case 'reading':{
      if(!rate(c,'reading',1500))return;
      const title=safeStr(msg.title,80)||'제목 없는 글',text=safeStr(msg.text,4000);
      if(!text){send(c,{t:'error',message:'먼저 글을 작성해 주세요.'});return}
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
    if(c.buffer.length>200000){socket.destroy();return}
    while(c.buffer.length>=2){const b=c.buffer,op=b[0]&15,fin=!!(b[0]&128);let len=b[1]&127,offset=2;if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);offset=4}else if(len===127){if(b.length<10)return;const v=b.readBigUInt64BE(2);if(v>32000n){socket.destroy();return}len=Number(v);offset=10}
      if(len>32000||!(b[1]&128)){socket.destroy();return}if(b.length<offset+4+len)return;
      const mask=b.subarray(offset,offset+4),payload=Buffer.from(b.subarray(offset+4,offset+4+len));for(let i=0;i<len;i++)payload[i]^=mask[i%4];c.buffer=b.subarray(offset+4+len);
      if(op===8){socket.end();return}if(op===9){socket.write(Buffer.from([0x8a,payload.length,...payload]));continue}if(op===10)continue;if(op!==1||!fin){socket.destroy();return}
      try{handle(c,JSON.parse(payload.toString('utf8')))}catch(e){};
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

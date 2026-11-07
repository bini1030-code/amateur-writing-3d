'use strict';
// Real perspective WebGL game, shared live movement, text, reactions and opt-in WebRTC voice.
const $=sel=>document.querySelector(sel), $$=sel=>[...document.querySelectorAll(sel)];
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const prompts=['어느 날 문득 나를 위로해 준 작은 말','지금 다시 만나고 싶은 한 사람','오늘 내가 지켜낸 작은 용기','말로는 꺼내지 못했던 마음 한 조각','내게 평안함을 주는 저녁의 풍경','지나온 계절에 전하고 싶은 편지','아무것도 특별하지 않았던 소중한 순간','내 삶에 남아 있는 누군가의 친절'];
let saved={};try{saved=JSON.parse(localStorage.getItem('amateur-writing-live-v2')||'{}')}catch(e){}
const state={name:saved.name||'',code:new URLSearchParams(location.search).get('room')||saved.code||'NIGHT',color:saved.color||0,gender:saved.gender==='female'?'female':'male',notes:saved.notes||'',topic:saved.topic||'',title:saved.title||'',story:saved.story||'',step:0,read:null,connected:false,me:null,mic:false,muted:false,room:'main',sitting:false,restSpot:null,lampOn:true,timer:20*60,running:false};
const SHELF_MAX_CHARS=10000;
const SHELF_MAX_BYTES=65000;
const DRAFT_LIMIT=80;
const DRAFT_STORAGE_KEY='amateur-writing-personal-drafts-v1';
const charCount=value=>[...String(value||'')].length;
const makeDraftId=()=> 'draft-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
let drafts=[];
let draftStorageWarning='';
function cleanDraft(d){
 if(!d||typeof d!=='object'||typeof d.id!=='string')return null;
 return {id:d.id.slice(0,80),title:String(d.title||'').slice(0,80),story:String(d.story||''),topic:String(d.topic||''),notes:String(d.notes||''),createdAt:Number(d.createdAt)||Date.now(),updatedAt:Number(d.updatedAt)||Date.now()};
}
function saveDraftStorage(){
 try{localStorage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(drafts));draftStorageWarning='';return true}
 catch(e){draftStorageWarning='기기 저장 공간이 부족하거나 차단되어 이 글의 자동 저장이 실패했습니다. 먼저 「↓ 나의 글 저장」으로 파일을 내려받으세요.';return false}
}
function saveActiveDraft(){
 if(!state.activeDraftId)return;
 let d=drafts.find(d=>d.id===state.activeDraftId);
 if(!d){d=cleanDraft({id:state.activeDraftId,createdAt:Date.now()});drafts.push(d)}
 d.title=state.title;d.story=state.story;d.topic=state.topic;d.notes=state.notes;d.updatedAt=Date.now();
 saveDraftStorage();
}
function loadDraft(id){
 const d=drafts.find(d=>d.id===id);if(!d)return false;
 state.activeDraftId=d.id;state.title=d.title;state.story=d.story;state.topic=d.topic;state.notes=d.notes;
 try{localStorage.setItem('amateur-writing-live-v2',JSON.stringify({name:state.name,code:state.code,color:state.color,gender:state.gender,notes:state.notes,topic:state.topic,title:state.title,story:state.story,activeDraftId:state.activeDraftId}))}catch(e){}
 return true;
}
function initDrafts(){
 try{const raw=JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY)||'[]');if(Array.isArray(raw))drafts=raw.map(cleanDraft).filter(Boolean).slice(-DRAFT_LIMIT)}catch(e){}
 // Migration: keep the user's previous single writing as a draft instead of replacing it.
 if(!drafts.length){
  const draft=cleanDraft({id:makeDraftId(),title:state.title,story:state.story,topic:state.topic,notes:state.notes});
  drafts=[draft];saveDraftStorage();
 }
 const chosen=drafts.find(d=>d.id===saved.activeDraftId)||drafts[drafts.length-1];
 loadDraft(chosen.id);
}
function persist(){
 saveActiveDraft();
 try{localStorage.setItem('amateur-writing-live-v2',JSON.stringify({name:state.name,code:state.code,color:state.color,gender:state.gender,notes:state.notes,topic:state.topic,title:state.title,story:state.story,activeDraftId:state.activeDraftId}))}catch(e){draftStorageWarning='기기 저장 공간 부족으로 자동 저장에 실패했습니다. 글을 파일로 내려받으세요.'}
 const panel=document.querySelector('.draftManager');
 if(panel){let warning=panel.querySelector('.draftStorageError');
  if(draftStorageWarning){if(!warning){warning=document.createElement('p');warning.className='draftStorageError';warning.setAttribute('role','alert');panel.append(warning)}warning.textContent=draftStorageWarning}
  else warning?.remove();
 }
}
initDrafts();
function newDraft(){
 if(drafts.length>=DRAFT_LIMIT){toast(`이 기기에 글은 최대 ${DRAFT_LIMIT}편까지 저장할 수 있어요. 필요 없는 글을 삭제하거나 파일로 내려받으세요.`);return}
 persist();const draft=cleanDraft({id:makeDraftId()});drafts.push(draft);
 loadDraft(draft.id);persist();state.step=2;renderWriting();toast('새 글을 만들었어요. 이전 글은 내 글 목록에 남아 있습니다.');
}
function switchDraft(id){
 if(id===state.activeDraftId)return;
 persist();if(!loadDraft(id))return;state.step=2;renderWriting();playSound('click');toast('선택한 글을 불러왔어요.');
}
function deleteDraft(){
 const target=drafts.find(d=>d.id===state.activeDraftId);if(!target)return;
 if(!confirm(`『${target.title||'제목 없는 글'}』의 이 기기 초안을 삭제할까요? 책장에 공개한 책은 삭제되지 않습니다.`))return;
 drafts=drafts.filter(d=>d.id!==target.id);
 if(!drafts.length)drafts=[cleanDraft({id:makeDraftId()})];
 loadDraft(drafts[drafts.length-1].id);persist();state.step=2;renderWriting();toast('선택한 초안을 삭제했어요.');
}

let burstLight=null;let socket=null,peers=new Map(),audioContext=null,toastTimer,readingRequest=null,lastNet=0,route=[],particles=[],activeKey=new Set(),microphoneStream=null,rtc=new Map(),pointer={down:false,x:0,y:0,id:null,travel:0},stick={x:0,z:0};
const actor={x:0,z:9.1,rot:Math.PI,action:'stand',moving:false};
const cam={yaw:0,pitch:.31,dist:4.7,followPos:null,first:false,eye:[0,0,0],center:[0,0,0],matrix:null};
const worldLights=[
 {x:-2.6,y:3.05,z:4.9,color:'#ffdca0',size:230,alpha:.48},{x:0,y:3.05,z:4.9,color:'#ffdca0',size:255,alpha:.52},{x:2.6,y:3.05,z:4.9,color:'#ffdca0',size:230,alpha:.48},
 {x:-2.4,y:3.05,z:6.4,color:'#ffd7a2',size:215,alpha:.45},{x:0,y:3.05,z:6.4,color:'#ffd7a2',size:245,alpha:.49},{x:2.4,y:3.05,z:6.4,color:'#ffd7a2',size:215,alpha:.45},
 {id:'standing-lamp',x:6.95,y:3.08,z:10.15,color:'#ffe0a7',size:230,alpha:.38},{x:-5.6,y:3.22,z:-0.9,color:'#f6deb2',size:145,alpha:.23},{x:5.6,y:3.22,z:-0.9,color:'#f6deb2',size:145,alpha:.23},
 {x:-7.1,y:3.58,z:-6.9,color:'#ffe4ac',size:105,alpha:.17},{x:-5.2,y:3.58,z:-6.25,color:'#ffe4ac',size:105,alpha:.17},{x:-3.2,y:3.58,z:-7.1,color:'#ffe4ac',size:105,alpha:.17},
 {x:1.12,y:2.37,z:-9.3,color:'#e9bb7a',size:85,alpha:.18},{x:2.45,y:2.37,z:-9.3,color:'#80a4cd',size:85,alpha:.18},{x:3.78,y:2.37,z:-9.3,color:'#d58b8e',size:85,alpha:.18},{x:5.1,y:2.37,z:-9.3,color:'#a798d2',size:85,alpha:.18},{x:6.43,y:2.37,z:-9.3,color:'#9ebfa5',size:85,alpha:.18},{x:7.76,y:2.37,z:-9.3,color:'#d7b978',size:85,alpha:.18},{x:4.5,y:3.40,z:-5.4,color:'#c9b3f5',size:180,alpha:.28}
];
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2700)}
function playSound(kind='click'){
  if(state.muted)return;
  try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();
  const patterns={enter:[[523,.0,.14],[659,.13,.17],[784,.27,.26]],click:[[660,0,.07]],walk:[[150,0,.035]],step:[[115,0,.065],[165,.028,.042]],heart:[[523,0,.12],[784,.12,.22]],clap:[[240,0,.065],[330,.07,.07],[420,.15,.09]],spark:[[880,0,.08],[1175,.10,.10],[1320,.2,.20]],tea:[[445,0,.17],[659,.14,.22]],cookie:[[490,0,.05],[330,.07,.08],[520,.16,.13]],jelly:[[780,0,.06],[990,.10,.07],[730,.18,.14]],door:[[260,0,.06],[400,.10,.15],[580,.22,.18]],wave:[[580,0,.08],[725,.09,.16]],reading:[[392,0,.16],[523,.17,.20],[784,.39,.24]]};
  const now=audioContext.currentTime;for(const [freq,delay,len] of (patterns[kind]||patterns.click)){
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=kind==='clap'?'triangle':'sine';osc.frequency.setValueAtTime(freq,now+delay);gain.gain.setValueAtTime(0.0001,now+delay);gain.gain.exponentialRampToValueAtTime(kind==='clap'?.055:.035,now+delay+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+len);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now+delay);osc.stop(now+delay+len+.018);
  }}catch(e){}
}
// Quiet original ambient music made from Web Audio tones (no external audio files).
// Browsers permit audio only after a user gesture; entry button unlocks AudioContext.
let musicTimer=null,musicStep=0,musicMaster=null,musicNext=0;
function ensureAudio(){
 try{
  if(!audioContext){audioContext=new (window.AudioContext||window.webkitAudioContext)()}
  if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
  return audioContext;
 }catch(e){return null}
}
function musicNote(hz,when,duration=.9,volume=.018){
 const ctx=audioContext;if(!ctx)return;
 const gain=ctx.createGain(),osc=ctx.createOscillator(),second=ctx.createOscillator();
 osc.type='sine';second.type='triangle';osc.frequency.setValueAtTime(hz,when);second.frequency.setValueAtTime(hz*.5,when);
 gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),when+.16);
 gain.gain.setTargetAtTime(.0001,when+duration*.59,Math.max(.06,duration*.20));
 osc.connect(gain);second.connect(gain);gain.connect(musicMaster||ctx.destination);
 osc.start(when);second.start(when);osc.stop(when+duration+.70);second.stop(when+duration+.70);
}
function scheduleAmbient(){
 if(!state.connected||state.muted||!audioContext||audioContext.state!=='running')return;
 // An original, slow four-chord ambience; very soft, sparse bell/pad tones.
 const chords=[[174.61,220,261.63],[146.83,196,246.94],[130.81,174.61,220],[155.56,196,233.08]];
 const now=audioContext.currentTime;
 while(musicNext<now+1.7){
  const chord=chords[musicStep%chords.length];
  musicNote(chord[0],musicNext,3.1,.0095);
  musicNote(chord[1],musicNext+.41,2.6,.0063);
  musicNote(chord[2],musicNext+1.03,2.4,.0060);
  musicStep++;musicNext+=3.7;
 }
}
function startAmbient(){
 if(!state.connected||state.muted)return;
 const ctx=ensureAudio();if(!ctx)return;
 if(!musicMaster){musicMaster=ctx.createGain();musicMaster.gain.value=.48;musicMaster.connect(ctx.destination)}
 if(musicTimer!==null)return;
 musicNext=ctx.currentTime+.06;scheduleAmbient();musicTimer=setInterval(scheduleAmbient,760);
}
function stopAmbient(){if(musicTimer!==null){clearInterval(musicTimer);musicTimer=null}if(musicMaster&&audioContext){
 musicMaster.gain.cancelScheduledValues(audioContext.currentTime);musicMaster.gain.setTargetAtTime(0,audioContext.currentTime,.08);
 musicMaster.disconnect();musicMaster=null
}}
function playFootstep(){
 if(state.muted||!state.connected)return;const ctx=ensureAudio();if(!ctx||ctx.state!=='running')return;
 const length=.085,samples=Math.ceil(ctx.sampleRate*length),buffer=ctx.createBuffer(1,samples,ctx.sampleRate),data=buffer.getChannelData(0);
 for(let i=0;i<samples;i++){const t=i/samples;data[i]=(Math.random()*2-1)*Math.pow(1-t,2.6)}
 const src=ctx.createBufferSource(),low=ctx.createBiquadFilter(),gain=ctx.createGain();
 src.buffer=buffer;low.type='lowpass';low.frequency.value=450;gain.gain.value=.09; // 50% of v14.4 footstep amplitude
 src.connect(low);low.connect(gain);gain.connect(ctx.destination);src.start();src.stop(ctx.currentTime+length);
}
function send(o){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(o))}
// A browser-local owner key is never shown on book covers or sent to other readers.
// It protects new books even when another visitor chooses the same nickname.
const bookshelfOwnerStorage=()=>`amateur-writing-book-owner-v1:${state.code}:${state.name}`;
let bookshelfOwnerKey='';
let roomOwnerKeys=[];
function collectRoomOwnerKeys(){
 const valid=x=>typeof x==='string'&&/^[a-f0-9-]{32,80}$/i.test(x);
 const keys=[];const add=x=>{if(valid(x)&&!keys.includes(x))keys.push(x)};
 add(bookshelfOwnerKey);
 try{
  const prefix=`amateur-writing-book-owner-v1:${state.code}:`;
  for(let i=0;i<localStorage.length&&keys.length<20;i++){
   const k=localStorage.key(i);
   if(k?.startsWith(prefix))add(localStorage.getItem(k));
  }
 }catch(e){}
 roomOwnerKeys=keys;
 return keys;
}
function ensureBookshelfOwnerKey(previousName=''){
 const k=bookshelfOwnerStorage();
 try{
  let v=localStorage.getItem(k);
  // Same browser, renamed nickname: preserve the original secret instead of losing management rights.
  if(!v&&previousName&&previousName!==state.name){const old=localStorage.getItem(`amateur-writing-book-owner-v1:${state.code}:${previousName}`);if(old){v=old;localStorage.setItem(k,v)}}
  if(!v){
   if(!crypto?.randomUUID)throw new Error('Secure UUID unavailable');
   v=crypto.randomUUID();localStorage.setItem(k,v);
  }
  bookshelfOwnerKey=v;
 }catch(e){bookshelfOwnerKey='';}
 return bookshelfOwnerKey;
}
function join(){const name=$('#nickname').value.trim()||'밤의 필자',code=($('#inviteCode').value||'NIGHT').trim().toUpperCase().replace(/[^A-Z0-9가-힣-]/g,'').slice(0,18)||'NIGHT';
  if(!state.muted)ensureAudio(); // entry click unlocks ambient playback on mobile browsers
  const previousName=state.name;state.name=name;state.code=code;ensureBookshelfOwnerKey(previousName);collectRoomOwnerKeys();persist();$('#entryError').textContent='모임방에 연결하는 중입니다…';$('#enterBtn').disabled=true;
  try{socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){joinFail('서버 주소를 확인해 주세요.');return}
  socket.onopen=()=>send({t:'join',name,code,color:state.color,gender:state.gender,ownerKey:bookshelfOwnerKey,ownerKeys:roomOwnerKeys});
  socket.onmessage=ev=>{let p;try{p=JSON.parse(ev.data)}catch(e){return}message(p)};
  socket.onerror=()=>joinFail('연결에 문제가 있어요. 서버가 실행 중인지 확인해 주세요.');
  socket.onclose=()=>{if(shelfActionPending)shelfActionFailed({message:'연결이 끊어져 수정·삭제 여부를 확인하지 못했습니다. 재접속한 뒤 책장을 확인해 주세요.',requestId:shelfActionPending.requestId});if(shelfPending)shelfFailed('연결이 끊겨 책장 저장을 확인하지 못했습니다. 재입장 후 책장을 확인해 주세요.',shelfPending.requestId);stopAmbient();if(!state.connected)joinFail('방에 들어가지 못했어요. 다시 시도해 주세요.');else{state.connected=false;toast('서버 연결이 끊어졌어요. 새로고침해 다시 들어와 주세요.');$('#count').textContent='—';$('#micState').textContent='서버 연결이 종료되었습니다.'}}
}
function joinFail(t){$('#entryError').textContent=t;$('#enterBtn').disabled=false}
function message(p){
 switch(p.t){
  case 'welcome':state.me=p.id;state.code=p.code;state.connected=true;state.shelfManageSupported=!!p.features?.includes('shelf-manage-v1');state.lampOn=p.lampOn!==false;startAmbient();actor.x=(p.people.find(x=>x.id===p.id)||{x:0}).x;actor.z=(p.people.find(x=>x.id===p.id)||{z:9.1}).z;peers.clear();for(const person of p.people)peers.set(person.id,{...person,rx:person.x,rz:person.z,rr:person.rot});$('#roomCode').textContent=p.code;$('#entrance').classList.add('hidden');$('#enterBtn').disabled=false;try{history.replaceState(null,'','?room='+encodeURIComponent(p.code))}catch(e){};renderPeople();updateZone();playSound('enter');toast('어서 와요, '+state.name+' 님. 오늘도 한 문장씩 써 보아요.');restoreChatRoom(p.code,p.history||[]);syncLibrary(p.code,p.books||[],p.deletedBookIds||[],p.editableBookIds||[],p.editableBookKeyIndices||{});
   if(!state.shelfManageSupported)shelfFeedback('현재 서버에 수정·삭제 기능이 없습니다. GitHub에서 server.js와 public 폴더를 함께 업로드하고 Render 배포 후 /health 버전을 확인해 주세요.','warning');
   else if(!p.features?.includes('shelf-save-ack-v2'))shelfFeedback('서버가 최신 책장 저장 기능을 확인해 주지 않았습니다. GitHub 루트의 server.js와 public 폴더를 함께 업로드해 주세요.','warning');
   if(p.reading)showReading(p.reading);break;
  case 'join':peers.set(p.person.id,{...p.person,rx:p.person.x,rz:p.person.z,rr:p.person.rot});renderPeople();addSystem(p.person.name+' 님이 모임방에 왔어요.');playSound('click');if(state.mic)offer(p.person.id);break;
  case 'leave':{let gone=peers.get(p.id);if(gone)addSystem(gone.name+' 님이 나갔어요.');peers.delete(p.id);const pc=rtc.get(p.id);if(pc){pc.close();rtc.delete(p.id)}document.getElementById('audio-'+p.id)?.remove();renderPeople();break;}
  case 'move':{const other=peers.get(p.id);if(other){other.moving=Math.hypot(other.x-p.x,other.z-p.z)>.02;other.lastMoved=performance.now();other.x=p.x;other.z=p.z;other.rot=p.rot;other.action=p.action;}break;}
  case 'scene':{
    if(p.action==='lamp'){state.lampOn=p.lampOn!==false;lightPulse(6.95,10.15,state.lampOn?'#ffe5a2':'#b8c9e4',145);toast('스탠드 조명을 '+(state.lampOn?'켰어요.':'껐어요.'));playSound('click');}
    else if(p.action==='water'){const plant=wateringPlants.find(v=>v.id===p.plant);if(plant){lightPulse(plant.x,plant.z,'#b5edbd',145,'water');playSound('tea');toast((p.name||'누군가')+' 님이 식물에 물을 주었어요.');}}
    break;
  }
  case 'shelfBook': receiveLibraryBook(p.book);break;
  case 'shelfAck': shelfSaved(p);break;
  case 'shelfUpdateAck': shelfActionUpdated(p);break;
  case 'shelfDeleteAck': shelfActionDeleted(p);break;
  case 'shelfActionError': shelfActionFailed(p);break;
  case 'shelfRemove': removeLibraryBook(p.id);break;
  case 'shelfError': shelfFailed(p.message,p.requestId);break;
  case 'chat':{receiveChat(p);bubble(p.id,p.text);break;}
  case 'react':{if(p.id===state.me)break;const other=peers.get(p.id);if(other){emote(p.kind,other.x,other.z);showReactionAboveHead(p.kind,p.id);toast(p.name+' 님이 '+({heart:'마음을',clap:'박수를',spark:'반짝임을',wave:'인사를',tea:'차 한 잔을',cookie:'과자를',jelly:'젤리를'}[p.kind]||'온기를')+' 전했어요.');playSound(p.kind);}break;}
  case 'mood':{const mood={joy:'☀️ 기쁨',sad:'💧 슬픔',anger:'🔥 분노',worry:'🌧️ 불안',peace:'🍃 평온',hope:'✨ 기대',depression:'🌧️ 우울',anxiety:'🌪️ 불안',addiction:'🌀 중독',madness:'⚡ 광기',love:'💗 사랑'}[p.kind];const other=peers.get(p.id);if(mood){toast(p.name+' 님이 오늘의 마음을 나눴어요 · '+mood);if(other)emote('spark',other.x,other.z);playSound('heart')}break;}

  case 'reading':showReading(p.reading);if(p.reading){toast(p.reading.mode==='request'?p.reading.name+' 님이 대신 읽기를 부탁했어요.':'함께 낭독하는 시간이 시작됐어요.');playSound('reading')}else toast('낭독을 마쳤어요. 따뜻한 박수를 보내요.');break;
  case 'signal':handleSignal(p.from,p.data);break;
  case 'error':toast(p.message);if(!state.connected)joinFail(p.message);else if(shelfPending)shelfFailed(p.message,shelfPending.requestId);break;
 }
}
function renderPeople(){$('#count').textContent=peers.size;$('#peopleCount').textContent=peers.size;
 const list=[...peers.values()];$('#people').innerHTML=list.map(p=>`<div class="personrow"><div class="persondot" style="background:${coatColors[p.color]||coatColors[0]}"></div><span>${escapeHtml(p.name)}${p.id===state.me?' (나)':''}</span><small>${p.action==='lie'?'누워 있음':p.action==='sit'?'앉아 있음':p.z<-1?(p.x<0?'다과룸':'여섯 얼굴의 방'):'모임방'}</small></div>`).join('');}
// V14 chat history: local-only durable copy, scoped by room code.
// Server also sends its recent room messages; merge by server-generated ID.
const CHAT_KEEP=100;
let chatEntries=[],chatIds=new Set(),activeChatRoom='';
function chatKey(code){return 'amateur-writing-room-chat-v1:'+String(code||'NIGHT').toUpperCase()}
function chatClearKey(code){return chatKey(code)+':clearedAt'}
function chatCutoff(code){try{return Number(localStorage.getItem(chatClearKey(code)))||0}catch(e){return 0}}
function normalizeChat(raw,code){
 if(!raw||typeof raw!=='object')return null;
 const messageId=String(raw.messageId||'').slice(0,90);
 const name=String(raw.name||'').slice(0,18);
 const text=String(raw.text||'').slice(0,200);
 const time=Number(raw.time);
 if(!messageId||!name||!text||!Number.isFinite(time)||time<=chatCutoff(code))return null;
 return {messageId,name,text,time,mine:raw.mine===true};
}
function saveChats(){
 if(!activeChatRoom)return;
 try{localStorage.setItem(chatKey(activeChatRoom),JSON.stringify(chatEntries))}catch(e){}
}
function paintChats(){
 const el=$('#messages');el.textContent='';
 const fragment=document.createDocumentFragment();
 for(const m of chatEntries){
  const box=document.createElement('div');box.className='msg'+(m.mine?' mine':'');
  box.dataset.messageId=m.messageId;
  const label=document.createElement('strong');label.textContent=m.name;
  const body=document.createElement('span');body.textContent=m.text;
  const clock=document.createElement('small');clock.className='chatTime';
  try{clock.textContent=new Date(m.time).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){}
  box.append(label,body,clock);fragment.append(box);
 }
 el.append(fragment);el.scrollTop=el.scrollHeight;
}
function mergeChats(incoming,code=activeChatRoom){
 if(!code||!Array.isArray(incoming))return;
 const all=new Map(chatEntries.map(m=>[m.messageId,m]));
 for(const raw of incoming){
  const m=normalizeChat(raw,code);if(!m)continue;
  const old=all.get(m.messageId);
  // Local mine flag remains true even after a reconnect (client socket ID changes).
  if(old?.mine)m.mine=true;
  all.set(m.messageId,m);
 }
 chatEntries=[...all.values()].sort((a,b)=>a.time-b.time||a.messageId.localeCompare(b.messageId)).slice(-CHAT_KEEP);
 chatIds=new Set(chatEntries.map(m=>m.messageId));
 saveChats();paintChats();
}
function restoreChatRoom(code,serverHistory){
 activeChatRoom=String(code||'NIGHT').toUpperCase();chatEntries=[];chatIds=new Set();
 try{const raw=JSON.parse(localStorage.getItem(chatKey(activeChatRoom))||'[]');if(Array.isArray(raw)){chatEntries=raw.map(m=>normalizeChat(m,activeChatRoom)).filter(Boolean).slice(-CHAT_KEEP)}}catch(e){}
 chatIds=new Set(chatEntries.map(m=>m.messageId));
 mergeChats(serverHistory,activeChatRoom);
}
function receiveChat(p){
 if(!activeChatRoom)return;
 const m={messageId:p.messageId,name:p.name,text:p.text,time:p.time,mine:p.id===state.me};
 mergeChats([m]);
}
function clearDeviceChat(){
 if(!activeChatRoom)return;
 try{localStorage.setItem(chatClearKey(activeChatRoom),String(Date.now()));localStorage.removeItem(chatKey(activeChatRoom))}catch(e){}
 chatEntries=[];chatIds=new Set();paintChats();
 toast('이 기기에서 이 방의 대화 기록을 지웠어요. 다른 참가자의 기록은 그대로예요.');
}
$('#clearChatLocal').onclick=()=>{
 if(confirm('이 기기에서 이 모임방의 대화 기록을 지울까요? 다른 참가자의 기록은 삭제되지 않습니다.'))clearDeviceChat();
};
function addSystem(text){const el=document.createElement('div');el.className='msg system';el.textContent=text;$('#messages').append(el);$('#messages').scrollTop=$('#messages').scrollHeight;}
function bubble(id,text){const other=peers.get(id);if(!other)return;other.bubble=text.slice(0,22);other.bubbleEnd=Date.now()+4400;}
const reactionEmoji={heart:'💗',clap:'👏',spark:'✨',wave:'👋',tea:'☕',cookie:'🍪',jelly:'🍬'};
// A short, stationary symbol appears and disappears WITH its light glow.
// Only the tea/cookie/jelly reactions gain pictograms; no droplets or flying particles.
function emote(kind,x,z){
 const pulseColors={heart:'#f6b8c8',clap:'#ffe1a0',spark:'#fff2b3',wave:'#cbe8ff',tea:'#d8ecc7',cookie:'#f1c48d',jelly:'#efb3df'};
 lightPulse(x,z,pulseColors[kind]||'#ffe2a8',kind==='clap'?150:132);
 burstLight={x,y:1.63,z,kind,end:performance.now()+1000};
}
const activeReactionBadges=[];
function showReactionAboveHead(kind,personId){
 if(!state.connected||!reactionEmoji[kind])return;
 const el=document.createElement('div');el.className='overheadReaction';el.textContent=reactionEmoji[kind];
 el.setAttribute('role','img');el.setAttribute('aria-label',({heart:'마음',clap:'박수',spark:'반짝임',wave:'인사',tea:'차 한 잔',cookie:'과자',jelly:'젤리'}[kind]||'반응'));
 $('#fxlayer').append(el);
 activeReactionBadges.push({el,personId,expires:performance.now()+1700});
 positionReactionBadges();
}
function positionReactionBadges(){
 const now=performance.now();
 for(let i=activeReactionBadges.length-1;i>=0;i--){
  const r=activeReactionBadges[i];if(now>=r.expires){r.el.remove();activeReactionBadges.splice(i,1);continue;}
  const person=peers.get(r.personId);if(!person){r.el.remove();activeReactionBadges.splice(i,1);continue;}
  // Above the real avatar head (head top ~=1.98m). Higher than the regular name label (2.25m).
  const isMe=r.personId===state.me;
  const pos=isMe&&cam.first?[canvas.clientWidth*.5,Math.max(72,canvas.clientHeight*.21),1]:screenAt([isMe?actor.x:(person.rx??person.x),2.43,isMe?actor.z:(person.rz??person.z)]);
  if(!pos){r.el.style.display='none';continue}
  const [x,y]=pos;const visible=x>=-70&&x<=canvas.clientWidth+70&&y>=-60&&y<=canvas.clientHeight+30;
  r.el.style.display=visible?'grid':'none';if(visible){r.el.style.left=x+'px';r.el.style.top=Math.max(61,y)+'px';}
 }
}
function react(kind){if(!state.connected)return;send({t:'react',kind});emote(kind,actor.x,actor.z);showReactionAboveHead(kind,state.me);playSound(kind)}
$$('[data-react]').forEach(b=>b.addEventListener('click',()=>react(b.dataset.react)));
$('#chatForm').addEventListener('submit',e=>{e.preventDefault();const el=$('#chatInput'),t=el.value.trim();if(!t||!state.connected)return;send({t:'chat',text:t.slice(0,200)});el.value='';setTab('chat')});
function setTab(t){$$('.tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===t));$$('.tabpane').forEach(p=>p.classList.toggle('active',p.id===t+'Pane'));}
$$('.tabs button').forEach(b=>b.onclick=()=>{setTab(b.dataset.tab);playSound()});
function renderWriting(){const s=state.step;let h='';
 const draftOptions=drafts.map((d,i)=>`<option value="${escapeHtml(d.id)}" ${d.id===state.activeDraftId?'selected':''}>${escapeHtml(d.title.trim()||`제목 없는 글 ${i+1}`)} · ${new Date(d.updatedAt).toLocaleDateString('ko-KR')}</option>`).join('');
 const draftToolbar=`<div class="draftManager"><div class="draftManagerHeader"><strong>✍️ 내 글 목록 <span>(${drafts.length}/${DRAFT_LIMIT}편)</span></strong><small>서로 다른 글을 불러오거나 새로 쓸 수 있어요</small></div><label for="draftSelect">작업 중인 글 선택</label><select id="draftSelect" class="field" aria-label="저장된 내 글 선택">${draftOptions}</select><div class="draftManagerActions"><button type="button" class="button secondary" data-action="newDraft">＋ 새 글 쓰기</button><button type="button" class="button subtle" data-action="deleteDraft">현재 글 삭제</button></div>${draftStorageWarning?`<p class="draftStorageError" role="alert">${escapeHtml(draftStorageWarning)}</p>`:''}</div>`;

 if(s===0)h=`<div class="stagehead">마음의 서랍 열기</div><p class="stage-desc">지금 내 마음에 가장 오래 머무는 생각은 무엇일까요?</p><div class="stagequote">“오늘 내가 가장 많이 느낀 감정은 무엇이었나요?”</div><label class="lab">생각을 순서 없이 적어 보세요</label><textarea class="field" id="notes" placeholder="사건, 기억, 걱정, 감사… 무엇이든 좋아요.">${escapeHtml(state.notes)}</textarea><div class="rowbtn"><button class="button primary" data-action="next">글감 찾기 →</button></div>`;
 if(s===1)h=`<div class="stagehead">글감 찾기</div><p class="stage-desc">마음에 닿는 문장이 있다면 그곳에서 시작해 보세요.</p><div class="stagequote" id="topicQuote">${escapeHtml(state.topic||prompts[0])}</div><button class="button secondary" data-action="shuffle">↻ 다른 글감 보여주기</button><label class="lab">나만의 글감</label><input class="field" id="topic" placeholder="직접 떠올린 주제도 좋아요" value="${escapeHtml(state.topic)}"><div class="rowbtn"><button class="button primary" data-action="next">문장 쓰기 →</button><button class="button subtle" data-action="prev">← 돌아가기</button></div>`;
 if(s===2)h=`<div class="stagehead">나의 문장 만들기</div><p class="stage-desc">부담 없이 적고, 나누고 싶은 만큼만 나누어요. 글은 이 기기에 자동 저장돼요.</p><label class="lab">제목</label><input class="field" id="storyTitle" maxlength="80" placeholder="아직 제목 없는 이야기" value="${escapeHtml(state.title)}"><label class="lab">본문</label><textarea class="field big" id="story" placeholder="오늘 밤에는 이런 이야기를 남기고 싶어요…">${escapeHtml(state.story)}</textarea><div class="timer"><small class="muted" id="len">${charCount(state.story).toLocaleString()} / ${SHELF_MAX_CHARS.toLocaleString()}자 · 초안 자동 저장</small><strong id="time">${timeFormat(state.timer)}</strong></div><div class="rowbtn"><button class="button secondary" data-action="timer">${state.running?'Ⅱ 타이머 멈추기':'▷ 20분 글쓰기 타이머'}</button><button class="button secondary" data-action="download">↓ 나의 글 저장</button><button class="button secondary" data-action="shelf">📚 내 글 책장에 꽂기</button><button class="button primary" data-action="next">낭독하기 →</button></div>`;
 if(s===3)h=`<div class="stagehead">함께 읽는 밤</div><p class="stage-desc">글이 완벽하지 않아도 괜찮아요. 누군가의 마음을 듣는 것만으로 이 공간은 따뜻해져요.</p><div class="stagequote">“부끄러워도 괜찮아요. 당신의 문장을 소중하게 듣겠습니다.”</div><div class="rowbtn"><button class="button primary" data-action="self">📖 모두에게 내 글 나누기</button><button class="button secondary" data-action="request">♡ 진행자에게 대신 읽기 부탁하기</button></div><p class="muted">공유하면 다른 사람에게 책 도착 알림이 뜹니다. 각자 원할 때 책을 펼쳐 읽을 수 있어요. 음성 대화를 쓰려면 ‘함께’ 탭에서 마이크를 연결하세요. 마이크 없이도 기기 읽기 기능을 사용할 수 있어요.</p><div class="rowbtn"><button class="button subtle" data-action="prev">← 글 수정하기</button><button class="button secondary" data-action="download">↓ 내 글 저장</button><button class="button secondary" data-action="shelf">📚 내 글 책장에 꽂기</button></div>`;
 $('#writingContent').innerHTML=draftToolbar+h;$$('.steps button').forEach(b=>b.classList.toggle('active',+b.dataset.step===s));}
function timeFormat(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function setStep(i){state.step=clamp(i,0,3);playSound();renderWriting()}
$$('[data-step]').forEach(b=>b.onclick=()=>setStep(+b.dataset.step));
$('#writingContent').addEventListener('change',e=>{if(e.target.id==='draftSelect')switchDraft(e.target.value)});
$('#writingContent').addEventListener('input',e=>{if(e.target.id==='notes')state.notes=e.target.value;else if(e.target.id==='topic'){state.topic=e.target.value;$('#topicQuote').textContent=state.topic||prompts[0];}else if(e.target.id==='storyTitle'){state.title=e.target.value;const opt=$('#draftSelect')?.selectedOptions?.[0];if(opt)opt.textContent=(state.title.trim()||'제목 없는 글')+' · 오늘';}else if(e.target.id==='story'){state.story=e.target.value;$('#len').textContent=charCount(state.story).toLocaleString()+' / '+SHELF_MAX_CHARS.toLocaleString()+'자 · 초안 자동 저장'}persist()});
$('#writingContent').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){
 case 'next':setStep(state.step+1);break;case 'prev':setStep(state.step-1);break;
 case 'shuffle':state.topic=prompts[Math.floor(Math.random()*prompts.length)];renderWriting();playSound('spark');break;
 case 'timer':state.running=!state.running;renderWriting();toast(state.running?'20분 글쓰기를 시작했어요.':'타이머를 멈췄어요.');break;
 case 'newDraft':newDraft();break;case 'deleteDraft':deleteDraft();break;
 case 'download':downloadWriting();break;case 'shelf':publishToShelf();break;
 case 'self':case 'request':if(!state.story.trim()){toast('먼저 나의 글을 작성해 주세요.');setStep(2);break}send({t:'reading',title:state.title,text:state.story,mode:b.dataset.action});break;
 }});
function downloadWriting(){const text=`아마추어 글쓰기 — ${state.name}\n\n글감: ${state.topic}\n제목: ${state.title||'제목 없는 글'}\n\n${state.story}`;const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='아마추어글쓰기_나의글.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('내 글을 저장했어요.');playSound('spark')}
setInterval(()=>{if(state.running&&state.timer>0){state.timer--;if($('#time'))$('#time').textContent=timeFormat(state.timer);if(state.timer===0){state.running=false;playSound('reading');toast('글쓰기 시간이 되었어요. 문장을 나눠 볼까요?')}}},1000);
// V6 / Private page turns: reading data is shared, but book visibility and page are local.
const bookState={open:false,page:0,pages:[],lastIdentity:'',compact:matchMedia('(max-width:700px)').matches};
function paginateBook(text,limit){
  // Preserve line breaks while splitting long paragraphs safely, including Korean text.
  const out=[];let page='';
  const flush=()=>{if(page){out.push(page.trimEnd());page=''}};
  const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');
  for(let i=0;i<lines.length;i++){
    let line=lines[i];
    if(i>0){if(page.length+1>limit)flush();else page+='\n'}
    while(line.length){
      const space=limit-page.length;
      if(space<28){flush();continue}
      if(line.length<=space){page+=line;line='';continue}
      let n=space;const lastSpace=line.slice(0,n).lastIndexOf(' ');
      if(lastSpace>n*.65)n=lastSpace+1;
      page+=line.slice(0,n);line=line.slice(n);flush();
    }
  }
  flush();return out.length?out:[''];
}
function refreshBookPages(){
  if(!state.read)return;
  const small=matchMedia('(max-width:700px)').matches;
  const before=bookState.page;
  if(small!==bookState.compact||!bookState.pages.length){
    // Recalculate after a device orientation or window size change.
    bookState.compact=small;bookState.pages=paginateBook(state.read.text,small?150:170);
    bookState.page=small?Math.min(before,bookState.pages.length-1):Math.floor(before/2)*2;
  }
  bookState.page=Math.max(0,Math.min(bookState.page,bookState.pages.length-1));
  const n=bookState.page, last=bookState.pages.length,step=small?1:2;
  $('#bookLeft').textContent=bookState.pages[n]||'';
  $('#leftPageNumber').textContent=`${n+1}`;
  $('#bookRight').textContent=bookState.pages[n+1]||'';
  $('#rightPageNumber').textContent=n+1<last?`${n+2}`:'';
  $('#bookProgress').textContent=small?`${n+1} / ${last}쪽`:`${n+1}${n+1<last?'–'+(n+2):''} / ${last}쪽`;
  $('#bookPrev').disabled=n===0;
  $('#bookNext').disabled=n+step>=last;
  $('.bookPageRight').classList.toggle('blankPage',n+1>=last);
}
function openBook(){
  if(!state.read)return;
  // On mobile, the writing drawer must close so the book is unobstructed.
  $('#sidebar').classList.remove('panelOpen');
  $('#mobilePanelScrim').classList.remove('visible');
  bookState.open=true;
  $('#reading').classList.remove('hidden');$('#reading').setAttribute('aria-hidden','false');
  $('#space').classList.add('book-is-open');
  $('#bookNotice').classList.add('hidden');
  refreshBookPages();playSound('click');
}
function closeBook(){
  bookState.open=false;$('#reading').classList.add('hidden');$('#reading').setAttribute('aria-hidden','true');
  $('#space').classList.remove('book-is-open');
  if(state.read)$('#bookNotice').classList.remove('hidden');
  if('speechSynthesis' in window)speechSynthesis.cancel();
}
function showReading(r){
  const old=bookState.lastIdentity;
  state.read=r;
  if(!r){bookState.lastIdentity='';bookState.page=0;bookState.pages=[];closeBook();$('#bookNotice').classList.add('hidden');return}
  const identity=JSON.stringify([r.from,r.title,r.text]);
  const changed=identity!==old;
  bookState.lastIdentity=identity;
  if(changed){bookState.page=0;bookState.pages=[];}
  $('#readSpeaker').textContent=r.mode==='request'?r.name+' 님이 대신 읽어 줄 분을 기다려요':r.mode==='host'?(r.hostName||'함께하는 분')+' 님이 '+r.name+' 님의 글을 대신 읽어요':r.name+' 님이 글을 나눠 주셨어요';
  $('#readTitle').textContent=r.title||'제목 없는 글';
  $('#readHint').textContent=r.mode==='request'?'이 글을 대신 읽고 싶다면 아래 버튼을 눌러 주세요.':'한 사람의 문장을, 각자의 속도로 읽어요.';
  $('#acceptReading').classList.toggle('hidden',r.mode!=='request');
  $('#endReading').classList.toggle('hidden',![r.from,r.hostId].includes(state.me));
  $('#bookNoticeTitle').textContent=changed?'📖 새로운 글이 도착했어요':'📖 함께 읽는 글';
  $('#bookNoticeBy').textContent=(r.name||'참가자')+' · '+(r.title||'제목 없는 글');
  refreshBookPages();
  if(bookState.open){$('#reading').classList.remove('hidden');$('#bookNotice').classList.add('hidden');}
  else{$('#reading').classList.add('hidden');$('#bookNotice').classList.remove('hidden');}
}
$('#openBook').onclick=openBook;
$('#closeReading').onclick=closeBook;
$('#bookPrev').onclick=()=>{bookState.page=Math.max(0,bookState.page-(bookState.compact?1:2));refreshBookPages();playSound('click')};
$('#bookNext').onclick=()=>{bookState.page=Math.min(bookState.pages.length-1,bookState.page+(bookState.compact?1:2));refreshBookPages();playSound('click')};
$('#acceptReading').onclick=()=>{send({t:'acceptRead'});playSound('heart')};
$('#endReading').onclick=()=>send({t:'endRead'});
$('#ttsBtn').onclick=()=>{if(!state.read)return;if(!('speechSynthesis' in window)){toast('이 브라우저는 글 읽기 기능을 지원하지 않아요.');return}speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance((state.read.title||'')+'. '+state.read.text);utter.lang='ko-KR';utter.rate=.9;utter.pitch=.96;speechSynthesis.speak(utter);toast('내 기기에서만 글을 읽어요. 다른 사람의 마이크에는 전송되지 않습니다.')};
window.addEventListener('resize',()=>{if(!state.read)return;const small=matchMedia('(max-width:700px)').matches;if(small!==bookState.compact){bookState.pages=[];refreshBookPages()}});

// Rooms are one continuous 3D model. These paths go THROUGH the physical doorways.

function roomOf(x,z){return z>=-1?'main':x<0?'tea':'mind'}
// Closed walls, furniture and door frames are the single source of truth for collision and navigation.
// A small body-radius clearance prevents avatars from getting wedged at thresholds.
const solidRects=[
 // main room furniture
 {x:-.25,z:5.0,w:9.25,h:3.8}, // central meeting tables
 {x:-3.4,z:7.5,w:1.0,h:.96},{x:-1.5,z:7.5,w:1.0,h:.96},{x:.7,z:7.5,w:1.0,h:.96},{x:2.9,z:7.5,w:1.0,h:.96},
 {x:-3.4,z:2.48,w:1.0,h:.96},{x:-1.5,z:2.48,w:1.0,h:.96},{x:.7,z:2.48,w:1.0,h:.96},{x:2.9,z:2.48,w:1.0,h:.96},
 {x:-5.4,z:4.4,w:.95,h:1.0},{x:4.85,z:4.5,w:.95,h:1.0},
 {x:-7.85,z:2.40,w:.62,h:2.27}, // unified writing-room bookshelf
 {x:6.95,z:10.15,w:.95,h:.95},{x:-7.65,z:.25,w:.95,h:.95},{x:7.55,z:1.65,w:.92,h:.92},{x:-7.5,z:10.5,w:.80,h:.80},
 // tea room
 {x:-4.6,z:-9.15,w:7.95,h:1.45}, // back counter
 {x:-4.5,z:-5.1,w:3.95,h:1.86}, // standing snack table
 {x:-8.2,z:-2.7,w:.88,h:.88},{x:-4.45,z:-5.0,w:1.25,h:.82},
 // psychology room: eight circle seats, couch, bookshelf and the central round table
 ...Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return {x:4.5+1.90*Math.cos(a),z:-5.42+1.90*Math.sin(a),w:.66,h:.66}}),
 {x:7.61,z:-7.52,w:1.05,h:1.76}, // couch
 {x:8.24,z:-3.14,w:.62,h:2.27}, // same bookshelf footprint as the writing room
 {x:1.0,z:-3.75,w:.98,h:2.20}, // entry console
 {x:.72,z:-7.6,w:.76,h:.76},{x:.72,z:-3.0,w:.76,h:.76}
 ];
function inRect(x,z,r,margin=.14){return x>r.x-r.w/2-margin&&x<r.x+r.w/2+margin&&z>r.z-r.h/2-margin&&z<r.z+r.h/2+margin}
function traversable(x,z){
 if(x<-8.47||x>8.47||z>11.4||z<-9.45)return false;
 if(z<-1.18&&x>-.33&&x<.33)return false;
 if(z>-1.32&&z<-.68&&!((x>-6.58&&x<-4.62)||(x>4.62&&x<6.58)))return false;
 // Collision fits the circular table top, rather than blocking an entire square.
 if(x>.4&&z<-1.4&&Math.hypot(x-4.5,z+5.42)<.82)return false;
 for(const r of solidRects)if(inRect(x,z,r))return false;
 return true;
}
function wallFree(x,z){
 if(x<-8.55||x>8.55||z>11.48||z<-9.53)return false;
 if(z<-1.13&&x>-.24&&x<.24)return false;
 if(z>-1.3&&z<-.7&&!((x>-6.75&&x<-4.45)||(x>4.45&&x<6.75)))return false;
 return true;
}
function lineClear(x0,z0,x1,z1,check=traversable){
 const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,z1-z0)/.11));
 for(let i=1;i<=n;i++){const t=i/n;if(!check(x0+(x1-x0)*t,z0+(z1-z0)*t))return false}return true;
}
// A* grid routing. Never cut through solid walls or blocked door frames.
const NAV_STEP=.28,NAV_MINX=-8.35,NAV_MINZ=-9.3,NAV_NX=61,NAV_NZ=75;
const navFree=(i,j)=>i>=0&&j>=0&&i<NAV_NX&&j<NAV_NZ&&traversable(NAV_MINX+i*NAV_STEP,NAV_MINZ+j*NAV_STEP);
const navXY=(i,j)=>[NAV_MINX+i*NAV_STEP,NAV_MINZ+j*NAV_STEP];
function nearestCell(x,z){let ix=Math.round((x-NAV_MINX)/NAV_STEP),iz=Math.round((z-NAV_MINZ)/NAV_STEP);
 if(navFree(ix,iz))return [ix,iz];
 for(let r=1;r<9;r++){let best=null,d=Infinity;for(let i=ix-r;i<=ix+r;i++)for(let j=iz-r;j<=iz+r;j++){
  if(!navFree(i,j))continue;const [xx,zz]=navXY(i,j),dist=Math.hypot(x-xx,z-zz);if(dist<d){best=[i,j];d=dist}}
  if(best)return best}return null;
}
function pathTo(x,z){
 if(!traversable(x,z))return [];
 if(lineClear(actor.x,actor.z,x,z))return [[x,z]];
 const s=nearestCell(actor.x,actor.z),e=nearestCell(x,z);if(!s||!e)return [];
 const key=(i,j)=>i+j*NAV_NX, start=key(...s),goal=key(...e),open=[[start,0]],g=new Float64Array(NAV_NX*NAV_NZ).fill(Infinity),parent=new Int32Array(NAV_NX*NAV_NZ).fill(-1),closed=new Uint8Array(NAV_NX*NAV_NZ);
 g[start]=0;const heuristic=k=>Math.hypot(k%NAV_NX-e[0],Math.floor(k/NAV_NX)-e[1]);
 let found=false;
 while(open.length){let min=0;for(let i=1;i<open.length;i++)if(open[i][1]<open[min][1])min=i;
  const curr=open.splice(min,1)[0][0];if(closed[curr])continue;closed[curr]=1;if(curr===goal){found=true;break}
  const cx=curr%NAV_NX,cz=Math.floor(curr/NAV_NX);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
   const nx=cx+dx,nz=cz+dz;if(!navFree(nx,nz))continue;
   if(dx&&dz&&(!navFree(cx+dx,cz)||!navFree(cx,cz+dz)))continue;
   const nkey=key(nx,nz);if(closed[nkey])continue;const cand=g[curr]+(dx&&dz?1.414213562:1);
   if(cand>=g[nkey])continue;g[nkey]=cand;parent[nkey]=curr;open.push([nkey,cand+heuristic(nkey)]);
  }
 }
 if(!found)return [];
 let raw=[],curr=goal;while(curr!==start&&curr!==-1){raw.push(navXY(curr%NAV_NX,Math.floor(curr/NAV_NX)));curr=parent[curr]}
 raw.reverse();raw.push([x,z]);
 // Funnel-like line-of-sight smoothing; keep short waypoints inside doors.
 const smoothed=[],pts=[[actor.x,actor.z],...raw];let i=0;
 while(i<pts.length-1){let j=pts.length-1;for(;j>i+1;j--)if(lineClear(...pts[i],...pts[j]))break;
   smoothed.push(pts[j]);i=j;
 }
 return smoothed;
}
function routeTo(place){playSound('click');if(!state.connected)return;if(place===state.room){toast('이미 이 공간에 있어요.');return}
 const dest=place==='main'?[-6.93,8.85]:place==='tea'?[-5.5,-3.1]:[5.25,-3.05];
 if(state.sitting||actor.action==='lie')standUp();
 const next=pathTo(...dest);if(!next.length){toast('통로를 찾지 못했어요. 조금 움직여 다시 시도해 주세요.');return}
 route=next;actor.action='stand';state.sitting=false;
 toast((place==='tea'?'다과룸':place==='mind'?'여섯 얼굴의 방':'모임방')+'으로 안내할게요. 통로를 따라 걸어가요.');
}
$$('[data-travel]').forEach(b=>b.addEventListener('click',()=>routeTo(b.dataset.travel)));
// Every chair faces the center of the circle. Chairs are separate interactive seats.
const mindSeats=Array.from({length:8},(_,i)=>{
 const a=i*Math.PI/4,x=4.5+1.90*Math.cos(a),z=-5.42+1.90*Math.sin(a);
 return {id:'circle-'+i,x,z,rot:Math.atan2(4.5-x,-5.42-z),type:'mind-chair',action:'sit',label:`원형 의자 ${i+1}`};
});
const mindCouch={id:'couch',x:7.61,z:-7.52,rot:-Math.PI/2,type:'couch',action:'sit',label:'카우치'};
// The six-emotion activity is available from the full circumference of the round table.
// Visitors can approach from any direction through the gaps between the eight chairs.
const mindActivityTable={x:4.5,z:-5.42,modelRadius:.69,reachRadius:1.58};
function nearMindActivityTable(){return Math.hypot(actor.x-mindActivityTable.x,actor.z-mindActivityTable.z)<=mindActivityTable.reachRadius;}
const faceStories={
 depression:{name:'우울',emoji:'🌧️',color:'#8ca8c8',tag:'빛이 낮아진 마음',summary:`우울은 마음의 에너지가 낮아지고, 세상이 전보다 무겁게 느껴질 때 나타나는 얼굴입니다.
기운이 없고 아무것도 하기 싫거나, 평소 좋아하던 일도 멀게 느껴질 수 있어요.
이 얼굴을 만났을 때는 억지로 밝아지기보다 “나는 지금 많이 지쳐 있구나” 하고 알아차리는 일이 먼저일 수 있습니다.`},
 anxiety:{name:'불안',emoji:'🌪️',color:'#b19bdd',tag:'조여 오는 걱정의 마음',summary:`불안은 아직 오지 않은 일을 미리 걱정하며 몸과 마음이 긴장하는 얼굴입니다.
가슴이 답답하거나 생각이 꼬리를 물고 이어지면서, 안전한데도 안전하지 않은 것처럼 느껴질 수 있어요.
불안을 만났을 때는 미래를 다 해결하려 하기보다, 지금 내가 딛고 있는 한 칸의 바닥을 확인하는 연습이 도움이 됩니다.`},
 anger:{name:'분노',emoji:'🔥',color:'#d79892',tag:'상처와 경계의 마음',summary:`분노는 내 경계가 침범되었거나 부당함을 느낄 때 튀어나오는 얼굴입니다.
거칠고 위험해 보이지만, 자세히 보면 “이건 아파”, “이건 싫어”라는 신호가 숨어 있기도 합니다.
분노를 다룰 때는 폭발을 참는 것만이 아니라, 그 안에 있는 상처와 필요를 함께 읽는 일이 중요합니다.`},
 addiction:{name:'중독',emoji:'🌀',color:'#d8be84',tag:'자꾸 끌리는 마음',summary:`중독은 멈추고 싶어도 같은 자극과 행동으로 자꾸 돌아가게 되는 얼굴입니다.
잠깐은 위로처럼 느껴지지만, 시간이 지날수록 내 선택이 좁아지고 삶의 균형이 흔들릴 수 있어요.
이 얼굴을 바라볼 때는 의지 부족만 탓하기보다, 내가 무엇으로 버티고 있었는지를 같이 살펴보는 태도가 필요합니다.`},
 madness:{name:'광기',emoji:'⚡',color:'#caa0cf',tag:'과열된 마음의 얼굴',summary:`광기는 생각과 감정이 너무 빠르게 치솟아 스스로도 따라가기 어려운 상태를 가리키는 얼굴입니다.
과장된 확신, 극단적인 감정, 현실감의 흔들림처럼 보일 수 있어 조심스럽게 다뤄야 합니다.
이 얼굴은 낭만화하기보다 안전과 돌봄이 먼저라는 점을 기억하며, 필요할 때는 전문적인 도움을 연결하는 것이 중요합니다.`},
 love:{name:'사랑',emoji:'💗',color:'#e59bb0',tag:'연결과 돌봄의 마음',summary:`사랑은 누군가를 향해 마음이 열리고, 나를 넘어 타인과 이어지고 싶어지는 얼굴입니다.
따뜻함과 기쁨을 주기도 하지만, 동시에 두려움·집착·상실의 가능성도 함께 데려오곤 합니다.
그래서 사랑은 달콤함만이 아니라, 서로를 존중하고 돌보는 연습까지 포함하는 넓은 마음의 얼굴입니다.`}
};
const faceSpots=[
 {id:'face-depression',key:'depression',x:1.12,z:-8.83},
 {id:'face-anxiety',key:'anxiety',x:2.45,z:-8.83},
 {id:'face-anger',key:'anger',x:3.78,z:-8.83},
 {id:'face-addiction',key:'addiction',x:5.10,z:-8.83},
 {id:'face-madness',key:'madness',x:6.43,z:-8.83},
 {id:'face-love',key:'love',x:7.76,z:-8.83}
];
function nearestFaceSpot(){
 let best=null,dist=Infinity;
 for(const spot of faceSpots){const d=Math.hypot(actor.x-spot.x,actor.z-spot.z);if(d<.88&&d<dist){best=spot;dist=d;}}
 return best?{spot:best,distance:dist}:null;
}
const wateringPlants=[
 {id:'main-left',x:-7.65,z:.25,room:'main'},
 {id:'main-right',x:7.55,z:1.65,room:'main'},
 {id:'main-back',x:-7.5,z:10.5,room:'main'},
 {id:'tea-corner',x:-8.2,z:-2.7,room:'tea'},
 {id:'mind-back',x:.72,z:-7.6,room:'mind'},
 {id:'mind-front',x:.72,z:-3.0,room:'mind'}
];
const standLamp={x:6.95,z:10.15,room:'main'};
// The real book spines are on the left wall of the main writing room.
const bookshelves=[{id:'main-library',x:-7.85,z:2.40,w:.62,h:2.27,room:'main'},{id:'mind-library',x:8.24,z:-3.14,w:.62,h:2.27,room:'mind'}];
const WATERING_CAN_ICON=`<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 20h25l-3 17H13L9 20Z" fill="#9bc0b1" stroke="#f2fff6" stroke-width="2.2" stroke-linejoin="round"/><path d="M34 22c8-1 9 8 2 10h-4" stroke="#e6f6ec" stroke-width="3" stroke-linecap="round"/><path d="M12 20 7 10 2 11" stroke="#d7ede0" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><path d="m9 19 9-9" stroke="#d7ede0" stroke-width="3" stroke-linecap="round"/><path d="M6 6v2m5-4 1 2m-1 4 3 1" stroke="#b5dce8" stroke-width="2.3" stroke-linecap="round"/></svg>`;
const ICON_LIBRARY={snacks:'🍵',water:WATERING_CAN_ICON,bookshelf:'📚',lamp:'💡',chair:'🪑',stand:'🚶',mind:'💭',face:'🪞',lounge:'🛋️', 'mind-chair':'🪑'};

function closestWateringPlant(){let best=null,distance=Infinity;for(const plant of wateringPlants){if(plant.room!==state.room)continue;const d=Math.hypot(actor.x-plant.x,actor.z-plant.z);if(d<1.28&&d<distance){best=plant;distance=d}}return best?{...best,distance}:null}
function offsetByRot(x,z,rot,forward=0,side=0){return {x:x+Math.sin(rot)*forward+Math.cos(rot)*side,z:z+Math.cos(rot)*forward-Math.sin(rot)*side}}
function standUp(){
 if(!(state.sitting||actor.action==='sit'||actor.action==='lie'))return false;
 const base=state.restSpot||{x:actor.x,z:actor.z,rot:actor.rot,type:'chair'};
 const tries=[];
 if(base.type==='chair'||base.type==='mind-chair')tries.push(offsetByRot(base.x,base.z,base.rot,0,.82),offsetByRot(base.x,base.z,base.rot,0,-.82),offsetByRot(base.x,base.z,base.rot,-.78,0),offsetByRot(base.x,base.z,base.rot,.86,0));
 else if(base.type==='couch')tries.push({x:6.70,z:-7.92},{x:6.75,z:-8.35},{x:6.48,z:-7.65},{x:7.10,z:-6.78});
 else {
  // The hammock sits beside the outer wall: exit into the open center of the room.
  tries.push({x:5.86,z:-3.83},{x:5.75,z:-4.15},{x:6.12,z:-3.85},{x:5.55,z:-3.90});
  tries.push(offsetByRot(base.x,base.z,base.rot,0,-1.85));
 }
 let dest=tries.find(t=>traversable(t.x,t.z));
 if(!dest){for(const radius of [.9,1.15,1.45,1.8,2.15]){
   for(let r=0;r<24&&!dest;r++){const a=Math.PI*2*r/24,c={x:base.x+Math.cos(a)*radius,z:base.z+Math.sin(a)*radius};if(traversable(c.x,c.z))dest=c}
   if(dest)break;
 }}
 if(!dest){toast('일어날 수 있는 빈 공간을 찾지 못했어요.');return false}
 actor.x=dest.x;actor.z=dest.z;
 actor.action='stand';state.sitting=false;state.restSpot=null;route=[];sendMove();toast('자리에서 일어났어요.');return true;
}
function nearestRectDistance(x,z,cx,cz,w,h){
 return Math.hypot(Math.max(0,Math.abs(x-cx)-w/2),Math.max(0,Math.abs(z-cz)-h/2))
}
function closestMindSeat(){
 let best=null,dist=Infinity;
 for(const spot of [...mindSeats,mindCouch]){
   const occupied=[...peers.values()].some(person=>person.id!==state.me&&person.action==='sit'&&Math.hypot((person.x??person.rx)-spot.x,(person.z??person.rz)-spot.z)<.32);
   if(occupied)continue;
   const d=nearestRectDistance(actor.x,actor.z,spot.x,spot.z,spot.type==='couch'?1.05:.66,spot.type==='couch'?1.76:.66);
   if(d<.85&&d<dist){best=spot;dist=d;}
 }
 return best;
}
const chairSeats=[...[-3.4,-1.5,.7,2.9].map(x=>({x,z:7.5,rot:Math.PI})),
 ...[-3.4,-1.5,.7,2.9].map(x=>({x,z:2.5,rot:0})),
 {x:-5.4,z:4.4,rot:Math.PI/2},{x:4.85,z:4.5,rot:-Math.PI/2}];
function nearbyInteraction(){
 if(!state.connected)return null;
 if(state.sitting||actor.action==='sit'||actor.action==='lie'){
  const kind=state.restSpot?.type;
  return {type:'stand',label:kind==='couch'?'카우치에서 일어나기':'의자에서 일어나기',detail:'상호작용으로 안전한 바닥에 내려와요.'}
 }
 const plant=closestWateringPlant();
 if(state.room==='main'){
  let seat=null,dist=Infinity;
  for(const p of chairSeats){const d=Math.hypot(actor.x-p.x,actor.z-p.z);if(d<dist){dist=d;seat=p}}
  const lampDistance=Math.hypot(actor.x-standLamp.x,actor.z-standLamp.z);
  // Closest furniture wins where a plant overlaps a lamp or a chair.
  const candidates=[];
  if(dist<1.21)candidates.push({score:dist-.50,action:{type:'chair',label:'의자에 앉기',detail:'상호작용을 누르면 자리에 앉습니다.'}});
  if(plant)candidates.push({score:plant.distance-.47,action:{type:'water',plant,label:'식물에 물주기',detail:'물뿌리개로 식물에 물을 주는 행동이에요.'}});
  if(lampDistance<1.27)candidates.push({score:lampDistance-.25,action:{type:'lamp',label:state.lampOn?'스탠드 조명 끄기':'스탠드 조명 켜기',detail:'상호작용으로 방의 조명 밝기를 바꿉니다.'}});
  for(const shelf of bookshelves.filter(x=>x.room===state.room)){
   const d=nearestRectDistance(actor.x,actor.z,shelf.x,shelf.z,shelf.w,shelf.h);
   if(d<.87)candidates.push({score:d+.14,action:{type:'bookshelf',label:'우리 글이 담긴 책장',detail:'📚 모임원들의 글을 책처럼 읽거나 내 글을 꽂아요.'}})
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]?.action||null;
 }
 if(state.room==='tea'){
  const d1=nearestRectDistance(actor.x,actor.z,-4.5,-5.1,3.85,1.66);
  const d2=nearestRectDistance(actor.x,actor.z,-4.6,-9.15,7.8,1.35);
  if(plant&&plant.distance<1.15)return {type:'water',plant,label:'식물에 물주기',detail:'물뿌리개로 식물에 물을 주는 행동이에요.'};
  return Math.min(d1,d2)<.83?{type:'snacks',label:'다과 고르기',detail:'상호작용을 누른 뒤 원하는 다과를 골라요.'}:null
 }
 if(state.room==='mind'){
  const candidates=[];
  const faceHit=nearestFaceSpot();
  if(faceHit){const face=faceStories[faceHit.spot.key];
   candidates.push({score:faceHit.distance-.7,action:{type:'face',faceKey:faceHit.spot.key,label:`${face.name} 얼굴 이야기 읽기`,detail:`${face.emoji} ${face.tag} · 가까이 다가가 짧은 안내문을 읽어 보세요.`}})}
  // Table wins over chairs when standing inside the inner activity ring.
  // The same check drives the hint and the actual interact() action.
  if(nearMindActivityTable())candidates.push({score:-2,action:{type:'mind',label:'원형 테이블 · 내 마음 알아보기 / 몰라보기',detail:'✦ 테이블 어느 쪽에서든 여섯 얼굴 활동을 시작해요.'}});
  if(plant&&plant.distance<1.22)candidates.push({score:plant.distance,action:{type:'water',plant,label:'식물에 물주기',detail:'물뿌리개로 식물에 물을 줘요.'}});
  const seat=closestMindSeat();
  if(seat){const d=nearestRectDistance(actor.x,actor.z,seat.x,seat.z,seat.type==='couch'?1.05:.66,seat.type==='couch'?1.76:.66);
   candidates.push({score:d,action:{type:'lounge',spot:seat,label:seat.type==='couch'?'카우치에 앉기':'원형 의자에 앉기',detail:seat.type==='couch'?'카우치에 앉아 편안하게 이야기를 나눠요.':'여덟 사람이 둥글게 모이는 의자예요.'}})}
  for(const shelf of bookshelves.filter(x=>x.room==='mind')){
   const d=nearestRectDistance(actor.x,actor.z,shelf.x,shelf.z,shelf.w,shelf.h);
   if(d<.9)candidates.push({score:d,action:{type:'bookshelf',label:'우리 글이 담긴 책장',detail:'📚 모임원들이 쓴 글을 읽거나 내 글을 꽂아요.'}});
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]?.action||null;
 }
 return null
}
function useMindLounge(spot){
 if(!spot)return;
 actor.x=spot.x;actor.z=spot.z;actor.rot=spot.rot;actor.action='sit';state.sitting=true;state.restSpot=spot;route=[];sendMove();
 emote('spark',actor.x,actor.z);playSound('click');
 toast(spot.type==='couch'?'카우치에 편하게 앉았어요.':'모임 의자에 앉았어요. 서로 얼굴을 보며 이야기해요.');
 lightPulse(actor.x,actor.z,'#cbb8ed',155);
}

let lastHintKey='';
function updateProximityHint(){
 const hint=$('#proximityHint');if(!hint)return;
 const action=nearbyInteraction();
 const hidden=!!$('#entrance:not(.hidden)')||!!document.querySelector('.mindOverlay:not(.hidden)')||!!document.querySelector('.snackOverlay:not(.hidden)')||!!document.querySelector('.libraryOverlay:not(.hidden)');
 if(!action||hidden){hint.hidden=true;lastHintKey='';return}
 const key=action.type+action.label;
 if(lastHintKey!==key){
  $('#proximityTitle').textContent=action.label;
  $('#proximityText').textContent=action.detail;
  const icon=$('#proximityIcon');icon.innerHTML=ICON_LIBRARY[action.type]||'✦';
  const chips=$('#proximityChoices');chips.textContent='';
  const choices=action.type==='snacks'?[['🍵','차 마시기'],['🍪','과자 먹기'],['🍬','젤리 먹기']]:
    action.type==='water'?[['🪴','화분에 물주기']]:action.type==='bookshelf'?[['📚','우리 글 읽기 · 꽂기']]:action.type==='mind'?[['💭','내 마음 알아보기'],['☾','내 마음 몰라보기']]:action.type==='face'?[['🪞','얼굴 이야기 읽기']]:[];
  for(const [emoji,title] of choices){const chip=document.createElement('span');chip.className='proximityChoice';
   const art=document.createElement('span');art.textContent=emoji;const text=document.createElement('span');text.textContent=title;
   chip.append(art,text);chips.append(chip)}
  chips.hidden=!choices.length;
  lastHintKey=key;
 }
 hint.hidden=false;
}

// V14.9: reliable shared bookshelf. Server acknowledgement is authoritative;
// draft text is always kept locally and is never published automatically.
const libraryState={open:false,id:null,page:0,view:'shelf',search:'',books:[],publishedIds:new Set(),editableIds:new Set(),serverEditableIds:new Set(),keyIndexById:{},deletedIds:new Set(),room:'',editing:false};
const BOOKSHELF_LIMIT=100;
let shelfPending=null,shelfTimer=null,shelfActionPending=null,shelfActionTimer=null;
const libraryCacheKey=code=>'amateur-writing-shelf-v1-'+code;
const ownedBooksKey=()=>`amateur-writing-owned-books-v1:${state.code}:${state.name}`;
function getLocallyOwnedIds(){try{return JSON.parse(localStorage.getItem(ownedBooksKey())||'[]')}catch(e){return []}}
function saveLocallyOwnedIds(){try{localStorage.setItem(ownedBooksKey(),JSON.stringify([...libraryState.editableIds].slice(-BOOKSHELF_LIMIT)))}catch(e){}}
function legacyOwnDraft(book){return !book.ownerProtected&&book.author===state.name&&!!book.sourceDraftId&&drafts.some(d=>d.id===book.sourceDraftId)}
function canEditBook(book){
 if(!book||!state.shelfManageSupported||!libraryState.publishedIds.has(book.id))return false;
 return book.ownerProtected?!!ownerKeyForBook(book)&&libraryState.serverEditableIds.has(book.id):legacyOwnDraft(book);
}
function ownerKeyForBook(book){
 if(book?.ownerProtected){
  const n=libraryState.keyIndexById?.[book.id];
  if(Number.isInteger(n)&&roomOwnerKeys[n])return roomOwnerKeys[n];
 }
 return bookshelfOwnerKey;
}
function bookManagementReason(book){
 if(!book)return '책을 선택해 주세요.';
 if(book.author!==state.name)return '다른 참가자가 등록한 책입니다. 글쓴이만 수정하거나 삭제할 수 있어요.';
 if(!state.shelfManageSupported)return '서버에 책 관리 기능이 적용되지 않았습니다. GitHub의 server.js와 public 파일을 함께 업데이트하고 배포한 뒤 /health에서 버전을 확인해 주세요.';
 if(!libraryState.publishedIds.has(book.id))return '현재 서버 책장에 없는 오래된 로컬 복사본입니다. 이 기기에 저장된 글을 새로 책장에 꽂아 공유해 주세요.';
 if(book.ownerProtected){
   if(!bookshelfOwnerKey)return '이 브라우저에서 책 관리 키를 읽을 수 없습니다. 사이트 데이터 저장을 허용하고 원래 등록한 기기에서 다시 열어 주세요.';
   if(!libraryState.serverEditableIds.has(book.id))return '이 책의 관리 키가 현재 브라우저와 일치하지 않습니다. 원래 책을 등록한 브라우저에서 같은 모임방 코드·작성자 이름으로 접속해 주세요. 이름만 같아도 관리할 수 없습니다.';
 }else if(!legacyOwnDraft(book))return '이전 버전의 책에는 관리 키가 없습니다. 현재 기기에 등록 당시의 원본 초안이 없어서 본인임을 안전하게 확인할 수 없습니다. 기존 책을 임의로 삭제할 수 없으며, 원본 초안을 찾은 뒤 새 책으로 다시 등록할 수 있습니다.';
 return '';
}
function freshRequestId(){return 'manage-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}

function sanitizeShelfBook(b){
 if(!b||typeof b.id!=='string'||typeof b.title!=='string'||typeof b.text!=='string'||typeof b.author!=='string')return null;
 return {id:b.id.slice(0,64),title:b.title.slice(0,80),text:b.text,author:b.author.slice(0,18),createdAt:Number(b.createdAt)||0,sourceDraftId:typeof b.sourceDraftId==='string'?b.sourceDraftId.slice(0,80):'',updatedAt:Number(b.updatedAt)||0,ownerProtected:b.ownerProtected===true};
}
function cacheLibrary(){
 try{localStorage.setItem(libraryCacheKey(state.code),JSON.stringify(libraryState.books.slice(-BOOKSHELF_LIMIT)))}catch(e){}
}
function shelfFeedback(text,kind='info'){
 const el=$('#libraryFeedback');
 if(el){
  el.textContent=text;el.dataset.kind=kind;
  el.setAttribute('role',kind==='error'?'alert':'status');
  el.setAttribute('aria-live',kind==='error'?'assertive':'polite');
 }
 if(kind==='error'||kind==='success'||kind==='warning')toast(text);
}
function shelfBusy(busy){
 // Never disable because the draft is empty: the button must explain why saving failed.
 const save=$('#librarySave');if(save)save.disabled=busy||!state.connected;
 if(save)save.textContent=busy?'⏳ 서버에 저장하고 있어요…':'📚 내 글 책장에 꽂기';
 $$('[data-action="shelf"]').forEach(el=>{el.disabled=busy;});
}
function clearShelfPending(){if(shelfTimer){clearTimeout(shelfTimer);shelfTimer=null;}shelfPending=null;shelfBusy(false)}
function syncLibrary(code,serverBooks,serverDeleted=[],serverEditable=[],serverKeyIndices={}){
 libraryState.room=code;
 libraryState.deletedIds=new Set(Array.isArray(serverDeleted)?serverDeleted:[]);
 libraryState.serverEditableIds=new Set(Array.isArray(serverEditable)?serverEditable:[]);
 libraryState.keyIndexById=(serverKeyIndices&&typeof serverKeyIndices==='object')?serverKeyIndices:{};
 libraryState.editableIds=new Set([...(Array.isArray(serverEditable)?serverEditable:[]),...getLocallyOwnedIds()]);
 let local=[];try{local=JSON.parse(localStorage.getItem(libraryCacheKey(code))||'[]')}catch(e){}
 if(!Array.isArray(local))local=[];
 const live=(Array.isArray(serverBooks)?serverBooks:[]).map(sanitizeShelfBook).filter(b=>b&&!libraryState.deletedIds.has(b.id));
 libraryState.publishedIds=new Set(live.map(b=>b.id));
 const publishedSources=new Set(live.map(b=>b.sourceDraftId).filter(Boolean));
 // Offline cached copies belong only to this browser's author; do not mistake another member's stale cache for a shared server book.
 const map=new Map();for(const b of local.map(sanitizeShelfBook).filter(Boolean))if(b.author===state.name&&!libraryState.deletedIds.has(b.id)&&(!b.sourceDraftId||!publishedSources.has(b.sourceDraftId)))map.set(b.id,b);
 for(const b of live)map.set(b.id,b);
 libraryState.books=[...map.values()].sort((a,b)=>a.createdAt-b.createdAt).slice(-BOOKSHELF_LIMIT);
 if(libraryState.books.length)libraryState.id=libraryState.books.at(-1).id;
 cacheLibrary();saveLocallyOwnedIds();refreshLibraryBook();
}
function receiveLibraryBook(raw){
 const book=sanitizeShelfBook(raw);if(!book)return;
 libraryState.deletedIds.delete(book.id);libraryState.publishedIds.add(book.id);
 const existing=libraryState.books.findIndex(b=>b.id===book.id);
 if(existing<0)libraryState.books.push(book);else libraryState.books[existing]=book;
 libraryState.books=libraryState.books.sort((a,b)=>a.createdAt-b.createdAt).slice(-BOOKSHELF_LIMIT);
 // Don't tear another reader away from the current page just because somebody published.
 if(!libraryState.id)libraryState.id=book.id;
 cacheLibrary();refreshLibraryBook();
 if(existing<0)toast(`${book.author} 님의 글 『${book.title}』이 책장에 추가됐어요.`);
}
function shelfSaved(reply){
 const book=sanitizeShelfBook(reply?.book);
 if(!book){
  if(shelfPending)shelfFailed('서버가 저장 확인을 보냈지만 책 데이터가 올바르지 않습니다. 서버 버전을 확인해 주세요.',shelfPending.requestId);
  return;
 }
 const own=!!shelfPending&&(reply.requestId===shelfPending.requestId);
 // Handles a slow/stale response safely, without mutating a different room.
 receiveLibraryBook(book);
 if(!own)return;
 libraryState.editableIds.add(book.id);libraryState.serverEditableIds.add(book.id);libraryState.keyIndexById[book.id]=Math.max(0,roomOwnerKeys.indexOf(shelfPending?.ownerKey));saveLocallyOwnedIds();
 libraryState.id=book.id;libraryState.page=0;libraryState.view='shelf';
 clearShelfPending();refreshLibraryBook();
 if(reply.storage==='temporary'){
  shelfFeedback(`『${book.title}』을(를) 임시 책장에 공유했습니다. 서버 저장 공간에 문제가 있어 이 기기에는 보관되지만 서버가 재시작되면 다른 멤버에게 다시 공유해야 할 수 있어요. (${reply.reason||'서버 파일 저장 불가'})`,'warning');
 }else{
  shelfFeedback(`『${book.title}』을(를) ${reply.updated?'책장에서 수정':'새 책으로 저장'}했습니다. 현재 서가에 ${libraryState.books.length}권이 있어요. 다른 멤버도 읽을 수 있습니다. 단, Render 무료 서버는 재배포 시 저장 파일이 사라질 수 있습니다.`,'success');
 }
 playSound('reading');
}
function shelfFailed(text,requestId){
 if(requestId&&(!shelfPending||requestId!==shelfPending.requestId))return;
 clearShelfPending();
 shelfFeedback(text||'책장 저장에 실패했습니다. 글은 이 기기에 남아 있으니 다시 시도해 주세요.','error');
}
function publishToShelf(book=null){
 if(!state.connected){shelfFeedback('먼저 모임방에 접속해 주세요.','error');return}
 if(shelfPending){shelfFeedback('이미 저장 요청을 처리 중입니다. 현재 작업이 끝날 때까지 기다려 주세요.','loading');return}
 // IME/mobile keyboards may still contain the newest uncommitted text.
 const currentText=book?book.text:($('#story')?.value??state.story);
 const currentTitle=book?book.title:($('#storyTitle')?.value??state.title);
 const body=String(currentText||'').trim(),title=String(currentTitle||'').trim()||'제목 없는 글';
 // Open the visible feedback panel BEFORE checks, including character-limit errors.
 // From the writing sidebar, errors used to be sent to a hidden bookshelf modal.
 openLibrary(true);
 const count=charCount(body),titleCount=charCount(title);
 if(!bookshelfOwnerKey){shelfFeedback('이 기기의 책 관리 키를 저장할 수 없습니다. 브라우저의 사이트 데이터 저장이 허용되어 있는지 확인한 뒤 다시 들어오세요.','error');return}
 if(!body){shelfFeedback('저장할 본문이 없습니다. 「글쓰기 → 03 글쓰기」에서 글을 작성해 주세요.','error');setStep(2);return}
 if(titleCount>80){shelfFeedback(`제목은 최대 80자까지 저장할 수 있습니다. 현재 ${titleCount}자이므로 ${titleCount-80}자를 줄여 주세요.`,'error');return}
 if(count>SHELF_MAX_CHARS){shelfFeedback(`본문 저장 한도는 최대 ${SHELF_MAX_CHARS.toLocaleString()}자입니다. 현재 ${count.toLocaleString()}자이므로 ${(count-SHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요. 초안은 삭제되지 않습니다.`,'error');return}
 const requestId='book-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
 const sourceDraftId=book?.sourceDraftId||(!book?state.activeDraftId:'');
 const payload={t:'shelfAdd',requestId,title,text:body,sourceDraftId,ownerKey:bookshelfOwnerKey};
 const byteCount=new TextEncoder().encode(JSON.stringify(payload)).length;
 if(byteCount>SHELF_MAX_BYTES){shelfFeedback(`전송 용량 한도는 ${SHELF_MAX_BYTES.toLocaleString()}바이트입니다. 현재 ${byteCount.toLocaleString()}바이트로 ${(byteCount-SHELF_MAX_BYTES).toLocaleString()}바이트 초과했습니다. 이 경우 글을 나누거나 일부 문자를 줄여 주세요.`,'error');return}
 const previouslyPublished=libraryState.books.find(b=>b.sourceDraftId&&b.sourceDraftId===sourceDraftId&&canEditBook(b));
 const exists=!!previouslyPublished;
 payload.ownerKey=previouslyPublished?ownerKeyForBook(previouslyPublished):bookshelfOwnerKey;
 if(!confirm(`『${title}』 (${count.toLocaleString()}자)을(를) ${exists?'책장에서 최신 내용으로 바꾸고':'새 책으로 추가해'} 이 모임방 모두에게 공개할까요?`))return;
 if(!book){state.story=body;state.title=title;persist()}
 if(!socket||socket.readyState!==WebSocket.OPEN){shelfFeedback('서버 연결이 끊어졌습니다. 다시 접속한 뒤 저장해 주세요. 초안은 이 기기에 남아 있습니다.','error');return}
 shelfPending={requestId,title,ownerKey:payload.ownerKey};shelfBusy(true);
 shelfFeedback(`『${title}』 (${count.toLocaleString()}자)을(를) 서버에 저장하는 중입니다. 성공/실패는 여기에 표시됩니다.`,'loading');
 try{socket.send(JSON.stringify(payload))}catch(e){shelfFailed('전송 실패: 네트워크 연결을 확인해 주세요. 초안은 이 기기에 남아 있습니다.',requestId);return}
 shelfTimer=setTimeout(()=>{
  if(shelfPending?.requestId!==requestId)return;
  if(socket?.readyState===WebSocket.OPEN){
   shelfFeedback('서버 응답이 지연되어 동일한 요청으로 저장 상태를 다시 확인하고 있어요. 중복 등록하지 않습니다.','loading');
   try{socket.send(JSON.stringify(payload))}catch(e){}
  }
  shelfTimer=setTimeout(()=>{
   if(shelfPending?.requestId===requestId)shelfFailed('서버가 19초 안에 저장 결과를 보내지 않았습니다. Render 배포 상태와 GitHub 루트의 server.js 및 public/game.js 버전을 확인해 주세요. 초안은 보관돼 있습니다.',requestId);
  },10000);
 },9000);
}

// V14.15: edit and delete only the selected book (not another personal draft).
function libraryActionFeedback(message,kind='info'){
 const e=$('#libraryActionFeedback');if(e){e.textContent=message;e.dataset.kind=kind;e.setAttribute('role',kind==='error'?'alert':'status')}
 if(kind==='error')toast(message);
}
function libraryActionBusy(busy){for(const id of ['libraryEdit','libraryDelete','libraryEditSave']){const el=$('#'+id);if(el)el.disabled=busy}}
function clearShelfAction(){
 if(shelfActionTimer){clearTimeout(shelfActionTimer);shelfActionTimer=null}
 shelfActionPending=null;libraryActionBusy(false);
}
function removeLibraryBook(id){
 if(typeof id!=='string')return;
 libraryState.books=libraryState.books.filter(b=>b.id!==id);
 libraryState.publishedIds.delete(id);libraryState.editableIds.delete(id);libraryState.serverEditableIds.delete(id);delete libraryState.keyIndexById[id];libraryState.deletedIds.add(id);
 saveLocallyOwnedIds();cacheLibrary();
 if(libraryState.id===id){libraryState.id=null;libraryState.page=0;libraryState.view='shelf';libraryState.editing=false}
 refreshLibraryBook();
}
function openLibraryEditor(){
 const book=libraryState.books.find(b=>b.id===libraryState.id);
 if(!canEditBook(book)||shelfActionPending){libraryActionFeedback(shelfActionPending?'다른 책 관리 작업이 끝난 뒤 시도해 주세요.':bookManagementReason(book),'error');return}
 $('#libraryEditTitle').value=book.title;$('#libraryEditText').value=book.text;
 libraryState.editing=true;$('#libraryEditCount').textContent=charCount(book.text).toLocaleString()+' / '+SHELF_MAX_CHARS.toLocaleString()+'자';
 libraryActionFeedback('책장에 공개된 책을 수정합니다. 이 기기에 저장된 초안은 자동으로 바뀌지 않습니다.');
 refreshLibraryBook();$('#libraryEditTitle').focus({preventScroll:true});
}
function cancelLibraryEditor(){if(shelfActionPending)return;libraryState.editing=false;refreshLibraryBook()}
function sendShelfAction(payload){
 if(!state.connected||socket?.readyState!==WebSocket.OPEN){libraryActionFeedback('서버 연결이 끊겼습니다. 다시 접속해 주세요.','error');return}
 shelfActionPending={requestId:payload.requestId,type:payload.t};libraryActionBusy(true);
 libraryActionFeedback(payload.t==='shelfUpdate'?'수정한 책을 서버에 저장하는 중입니다…':'책을 서버 책장에서 삭제하는 중입니다…','loading');
 try{socket.send(JSON.stringify(payload))}catch(e){shelfActionFailed({requestId:payload.requestId,message:'전송 실패: 연결 상태를 확인해 주세요.'});return}
 shelfActionTimer=setTimeout(()=>{
  if(!shelfActionPending||shelfActionPending.requestId!==payload.requestId)return;
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify(payload))}catch(e){}}
  shelfActionTimer=setTimeout(()=>{if(shelfActionPending?.requestId===payload.requestId)shelfActionFailed({requestId:payload.requestId,message:'서버 응답이 없습니다. 재접속한 뒤 책장 목록에서 반영 여부를 확인해 주세요.'})},10000);
 },9000);
}
function saveLibraryEdit(){
 const book=libraryState.books.find(b=>b.id===libraryState.id);
 if(!canEditBook(book)){libraryActionFeedback(bookManagementReason(book),'error');return}
 const title=$('#libraryEditTitle').value.trim()||'제목 없는 글',text=$('#libraryEditText').value.trim();
 const chars=charCount(text),titles=charCount(title);
 if(!text){libraryActionFeedback('본문이 비어 있습니다. 내용을 작성해 주세요.','error');return}
 if(titles>80){libraryActionFeedback(`제목은 최대 80자입니다. 현재 ${titles}자이므로 ${titles-80}자를 줄여 주세요.`,'error');return}
 if(chars>SHELF_MAX_CHARS){libraryActionFeedback(`본문은 최대 ${SHELF_MAX_CHARS.toLocaleString()}자입니다. 현재 ${chars.toLocaleString()}자이므로 ${(chars-SHELF_MAX_CHARS).toLocaleString()}자를 줄여 주세요.`,'error');return}
 const payload={t:'shelfUpdate',requestId:freshRequestId(),id:book.id,title,text,ownerKey:ownerKeyForBook(book),sourceDraftId:legacyOwnDraft(book)?book.sourceDraftId:'',expectedVersion:book.updatedAt||book.createdAt};
 const bytes=new TextEncoder().encode(JSON.stringify(payload)).length;
 if(bytes>SHELF_MAX_BYTES){libraryActionFeedback(`전송 한도는 ${SHELF_MAX_BYTES.toLocaleString()}바이트입니다. 현재 ${bytes.toLocaleString()}바이트로 ${bytes-SHELF_MAX_BYTES}바이트 초과했습니다.`,'error');return}
 sendShelfAction(payload);
}
function deleteLibraryBook(){
 const book=libraryState.books.find(b=>b.id===libraryState.id);
 if(!canEditBook(book)){libraryActionFeedback(bookManagementReason(book),'error');return}
 if(!confirm(`『${book.title}』을(를) 모임방 책장에서 삭제할까요? 다른 멤버의 책장에서도 사라집니다.\n내 기기의 글쓰기 초안은 삭제되지 않습니다.`))return;
 sendShelfAction({t:'shelfDelete',requestId:freshRequestId(),id:book.id,ownerKey:ownerKeyForBook(book),sourceDraftId:legacyOwnDraft(book)?book.sourceDraftId:'',expectedVersion:book.updatedAt||book.createdAt});
}
function shelfActionUpdated(p){
 if(!shelfActionPending||p?.requestId!==shelfActionPending.requestId||shelfActionPending.type!=='shelfUpdate')return;
 clearShelfAction();libraryState.editing=false;
 const book=sanitizeShelfBook(p.book);
 if(!book){libraryActionFeedback('서버의 수정 완료 응답이 잘못됐습니다. 책장을 다시 열어 확인해 주세요.','error');return}
 libraryState.editableIds.add(book.id);libraryState.serverEditableIds.add(book.id);saveLocallyOwnedIds();receiveLibraryBook(book);
 libraryState.id=book.id;libraryState.page=0;libraryState.view='reader';refreshLibraryBook();
 libraryActionFeedback('『'+book.title+'』 수정 완료! 다른 멤버의 책장에도 반영됐습니다.','success');playSound('reading');
}
function shelfActionDeleted(p){
 if(!shelfActionPending||p?.requestId!==shelfActionPending.requestId||shelfActionPending.type!=='shelfDelete')return;
 clearShelfAction();removeLibraryBook(p.id);libraryActionFeedback('책을 책장에서 삭제했습니다. 원본 초안은 그대로 남아 있습니다.','success');
 shelfFeedback('책장에 꽂힌 책을 삭제했습니다. 다른 멤버의 책장에서도 제거됐습니다.','success');
}
function shelfActionFailed(p){
 if(!shelfActionPending||p?.requestId!==shelfActionPending.requestId)return;
 clearShelfAction();libraryActionFeedback(p.message||'서버에서 수정·삭제에 실패했습니다.','error');
}
// A single shared book catalog powers BOTH physical bookshelves. Covers always show the author.
const libraryCoverTones=6;
function coverToneFor(id){let h=17;for(const ch of String(id))h=(Math.imul(h,31)+ch.charCodeAt(0))|0;return (h>>>0)%libraryCoverTones}
function renderLibraryGallery(){
 const holder=$('#libraryChoices');if(!holder)return;
 const books=[...libraryState.books].reverse();
 const q=libraryState.search.trim().toLocaleLowerCase('ko-KR');
 const filtered=q?books.filter(b=>(b.title+' '+b.author).toLocaleLowerCase('ko-KR').includes(q)):books;
 const shared=books.filter(b=>libraryState.publishedIds.has(b.id)).length;
 $('#libraryCount').textContent=q?`검색 결과 ${filtered.length}권 / 전체 ${books.length}권 (공유 ${shared}권)`:`${books.length}권 · 서버 공유 중 ${shared}권`;
 const fragment=document.createDocumentFragment();
 for(const b of filtered){
  const btn=document.createElement('button');btn.type='button';btn.className='libraryBookTile';
  btn.dataset.libraryBook=b.id;
  const published=libraryState.publishedIds.has(b.id);
  btn.setAttribute('aria-label',`『${b.title}』, 글쓴이 ${b.author}${published?'':' (이 기기에만 저장됨)'} — 펼쳐 읽기`);
  const cover=document.createElement('span');cover.className='libraryBookCover tone-'+coverToneFor(b.id);
  const top=document.createElement('span');top.className='libraryCoverTop';top.textContent='밤의 문장들 · OUR STORIES';
  const motif=document.createElement('span');motif.className='libraryCoverMotif';motif.textContent='✦';motif.setAttribute('aria-hidden','true');
  const title=document.createElement('strong');title.className='libraryCoverTitle';title.textContent=b.title;
  const author=document.createElement('span');author.className='libraryCoverAuthor';author.textContent='글쓴이 · '+b.author;
  const foot=document.createElement('span');foot.className='libraryCoverBottom';foot.textContent=canEditBook(b)?'내 책 · 수정/삭제 가능':published?(b.author===state.name?'내 책 · 관리 권한 확인 필요':'모임방 공유 중'):'이 기기에만 보관';
  cover.append(top,motif,title,author,foot);
  const label=document.createElement('span');label.className='libraryBookTileLabel';label.textContent=b.title;
  const by=document.createElement('span');by.className='libraryBookTileBy';by.textContent='✍ '+b.author;
  btn.append(cover,label,by);fragment.append(btn);
 }
 if(!books.length){const empty=document.createElement('div');empty.className='libraryGalleryEmpty';empty.textContent='아직 책이 없습니다. 글을 작성한 뒤 아래 「내 글 책장에 꽂기」로 첫 번째 책을 등록해 보세요.';fragment.append(empty)}
 else if(!filtered.length){const empty=document.createElement('div');empty.className='libraryGalleryEmpty';empty.textContent=`‘${libraryState.search}’에 맞는 책이 없어요. 제목이나 글쓴이를 다시 검색해 보세요.`;fragment.append(empty)}
 holder.replaceChildren(fragment);
}
function renderLibraryReader(){
 const books=libraryState.books;
 const b=books.find(x=>x.id===libraryState.id);
 if(!b){libraryState.view='shelf';return}
 $('#libraryBookTitle').textContent=b.title;
 $('#libraryAuthor').textContent=`✍ 글쓴이: ${b.author} · ${new Date(b.createdAt||Date.now()).toLocaleDateString('ko-KR')}`;
 const pages=paginateBook(b.text,300);
 libraryState.page=Math.min(Math.max(0,libraryState.page),pages.length-1);
 $('#libraryBody').textContent=pages[libraryState.page];
 $('#libraryProgress').textContent=`${libraryState.page+1} / ${pages.length}쪽`;
 $('#libraryPrev').disabled=libraryState.page===0;
 $('#libraryNext').disabled=libraryState.page>=pages.length-1;
 $('#libraryRestore').hidden=libraryState.publishedIds.has(b.id);
 const manageable=canEditBook(b);
 if(!manageable)libraryState.editing=false;
 const sameAuthor=b.author===state.name;
 $('#libraryOwnerActions').hidden=!(sameAuthor||manageable);
 const ownerHelp=$('#libraryOwnerHelp');
 if(ownerHelp){ownerHelp.textContent=manageable?'이 책을 관리할 수 있습니다. 수정·삭제는 모든 멤버의 책장에 반영됩니다.':bookManagementReason(b);ownerHelp.dataset.kind=manageable?'success':'warning';}
 $('#libraryOwnerTitle').textContent=manageable?'✍️ 내가 관리하는 책 · 수정/삭제 가능':'✍️ 내 이름의 책 · 권한 확인 필요';
 $('#libraryReadPaper').hidden=libraryState.editing;
 $('#libraryEditor').hidden=!libraryState.editing;
 $('#libraryReadToolbarActions').hidden=libraryState.editing;
 $('#libraryNote').textContent=libraryState.publishedIds.has(b.id)?'같은 모임방 참가자는 글쓰기 모임방과 심리 모임방에서 이 책을 읽을 수 있어요.':'이 책은 이 기기에만 남아 있어요. 다른 참가자에게 보이게 하려면 다시 공유해 주세요.';
}
function refreshLibraryBook(){
 if(!$('#libraryChoices'))return;
 if(libraryState.view==='reader'&&!libraryState.books.some(b=>b.id===libraryState.id))libraryState.view='shelf';
 const isReader=libraryState.view==='reader';
 $('#libraryShelfView').hidden=isReader;
 $('#libraryReaderView').hidden=!isReader;
 if(isReader)renderLibraryReader();else renderLibraryGallery();
 shelfBusy(!!shelfPending);
}
function openLibrary(force=false){
 if(!state.connected||(!force&&!['main','mind'].includes(state.room)))return;
 if(bookState.open)closeBook();hideSnackMenu();hideMindModal();closeMobilePanel();
 libraryState.open=true;libraryState.view='shelf';libraryState.search='';
 $('#librarySearch').value='';
 $('#libraryModal').classList.remove('hidden');$('#libraryModal').setAttribute('aria-hidden','false');
 refreshLibraryBook();playSound('reading');
}
function closeLibrary(){if(shelfActionPending){libraryActionFeedback('저장/삭제 처리 중입니다. 결과를 확인한 뒤 닫아 주세요.','loading');return}libraryState.editing=false;libraryState.open=false;$('#libraryModal').classList.add('hidden');$('#libraryModal').setAttribute('aria-hidden','true')}
function returnToLibraryGallery(){if(shelfActionPending){libraryActionFeedback('저장/삭제 처리 결과를 먼저 확인해 주세요.','loading');return}libraryState.editing=false;libraryState.view='shelf';refreshLibraryBook();$('#libraryBack')?.blur();$('#librarySearch')?.focus({preventScroll:true});}
$('#libraryClose').onclick=closeLibrary;
$('#libraryModal').addEventListener('click',e=>{if(e.target.id==='libraryModal')closeLibrary()});
$('#libraryChoices').addEventListener('click',e=>{
 const btn=e.target.closest('[data-library-book]');if(!btn)return;
 libraryState.id=btn.dataset.libraryBook;libraryState.page=0;libraryState.view='reader';libraryState.editing=false;libraryActionFeedback('책을 읽고 있습니다. 본인이 등록한 책은 아래에서 수정하거나 삭제할 수 있어요.');
 refreshLibraryBook();$('#libraryBack')?.focus({preventScroll:true});playSound('reading');
});
$('#libraryBack').onclick=()=>{returnToLibraryGallery();playSound('click')};
$('#librarySearch').addEventListener('input',e=>{libraryState.search=e.target.value;renderLibraryGallery()});
$('#libraryPrev').onclick=()=>{libraryState.page=Math.max(0,libraryState.page-1);renderLibraryReader();playSound('click')};
$('#libraryNext').onclick=()=>{libraryState.page++;renderLibraryReader();playSound('click')};
$('#librarySave').onclick=()=>publishToShelf();
$('#libraryRestore').onclick=()=>{const b=libraryState.books.find(x=>x.id===libraryState.id);if(b)publishToShelf(b)};
$('#libraryEdit').onclick=openLibraryEditor;
$('#libraryDelete').onclick=deleteLibraryBook;
$('#libraryEditSave').onclick=saveLibraryEdit;
$('#libraryEditCancel').onclick=cancelLibraryEditor;
$('#libraryEditText').addEventListener('input',e=>{$('#libraryEditCount').textContent=charCount(e.target.value).toLocaleString()+' / '+SHELF_MAX_CHARS.toLocaleString()+'자'});


function roomGlow(zone){const label=zone==='tea'?'☕ 다과룸에 오셨어요':zone==='mind'?'✧ 여섯 얼굴의 방에 오셨어요':'✎ 글쓰기 모임방에 오셨어요';
 const el=document.createElement('div');el.className='arrival';el.textContent=label;$('#fxlayer').append(el);setTimeout(()=>el.remove(),1700);
 lightPulse(actor.x,actor.z,zone==='tea'?'#ffe0aa':zone==='mind'?'#d1b4fa':'#ffd6ae',160);
}
function updateZone(){const zone=roomOf(actor.x,actor.z);if(zone===state.room&&$('#zoneTitle').dataset.ready)return;if(zone!=='tea')hideSnackMenu();if(zone!=='mind'){hideMindModal();hideFaceInfo()}if(zone!=='main'&&zone!=='mind')closeLibrary();const o={main:['THE WRITING ROOM','밤의 문장들','모여서 쓰고, 서로의 이야기를 듣는 방'],tea:['THE SNACK ROOM','달콤한 다과 시간','서서 즐기는 차 · 과자 · 젤리'],mind:['THE SIX FACES ROOM','내 마음은 왜 여섯 얼굴일까?','여덟 자리에 둥글게 앉아 서로의 마음을 나누는 공간']};const t=o[zone];$('#zoneLabel').textContent=t[0];$('#zoneTitle').textContent=t[1];$('#zoneSub').textContent=t[2];$('#zoneTitle').dataset.ready=1;state.room=zone;renderPeople();if($('#zoneTitle').dataset.visited){playSound('door');roomGlow(zone)}$('#zoneTitle').dataset.visited='1'}
function closestSeat(){let best=null,dist=1e9;for(const p of chairSeats){const d=Math.hypot(actor.x-p.x,actor.z-p.z);if(d<dist){dist=d;best=p}}return dist<1.21?best:null}
function sit(){if(state.sitting||actor.action==='lie'){standUp();return}const p=closestSeat();if(!p){toast('의자에 가까이 가면 앉을 수 있어요.');return}actor.x=p.x;actor.z=p.z;actor.rot=p.rot;actor.action='sit';state.sitting=true;state.restSpot={...p,type:'chair'};route=[];sendMove();emote('spark',actor.x,actor.z);playSound('click');toast('자리에 앉았어요. 마음을 정리해 볼까요?');setTab('write')}
function showSnackMenu(){if(!state.connected||state.room!=='tea')return;
 const el=$('#snackMenu');el.classList.remove('hidden');el.setAttribute('aria-hidden','false');
 playSound('click');}
function hideSnackMenu(){const el=$('#snackMenu');el.classList.add('hidden');el.setAttribute('aria-hidden','true')}
function eatSnack(kind){if(!state.connected||state.room!=='tea'){hideSnackMenu();return}
 const labels={tea:'따뜻한 차 한 잔 ☕',cookie:'바삭한 과자 🍪',jelly:'말랑한 젤리 🍬'};
 if(!Object.prototype.hasOwnProperty.call(labels,kind))return;
 hideSnackMenu();if(state.sitting){state.sitting=false;actor.action='stand';sendMove()}
 react(kind);toast(labels[kind]+' · 서서 맛있게 즐겼어요!');}
$('#snackMenuClose').onclick=hideSnackMenu;
$('#snackMenu').addEventListener('click',e=>{if(e.target.id==='snackMenu')hideSnackMenu();const button=e.target.closest('[data-snack]');if(button)eatSnack(button.dataset.snack)});

// Six faces of the heart. Reflection activity is personal; it never travels over WebSocket.
const emotions={depression:{name:'우울',color:'#8ca8c8'},anxiety:{name:'불안',color:'#b19bdd'},anger:{name:'분노',color:'#d79892'},addiction:{name:'중독',color:'#d8be84'},madness:{name:'광기',color:'#caa0cf'},love:{name:'사랑',color:'#e59bb0'}};
const mindQuestions=[
 '지금 내 마음은 여섯 얼굴 중 어느 얼굴에 가장 가까운가요?',
 '내 마음이 날씨라면 오늘은 어떤 하늘일까요?',
 '오늘 하루에서 오래 남은 소리는 무엇이었나요?',
 '말이 되지 않는 기분을 색깔 하나로 표현한다면?',
 '내 마음이 작은 편지라면 누구에게 닿고 싶을까요?',
 '아직 모르는 마음을 잠시 옆자리에 앉힌다면 무슨 말을 건넬까요?'
];
let mindMood=null,mindPromptIndex=0;
function showMindModal(){if(!state.connected||state.room!=='mind')return;hideSnackMenu();closeMobilePanel();const el=$('#mindModal');el.classList.remove('hidden');el.setAttribute('aria-hidden','false');playSound('spark')}
function hideMindModal(){const el=$('#mindModal');if(!el)return;el.classList.add('hidden');el.setAttribute('aria-hidden','true')}
function mindSetTab(tab){$$('[data-mind-tab]').forEach(b=>b.classList.toggle('chosen',b.dataset.mindTab===tab));$('#mindRecognize').classList.toggle('hidden',tab!=='recognize');$('#mindUnknown').classList.toggle('hidden',tab!=='unknown');playSound('click')}
$$('[data-mind-tab]').forEach(b=>b.onclick=()=>mindSetTab(b.dataset.mindTab));
$$('[data-mood]').forEach(b=>b.onclick=()=>{mindMood=b.dataset.mood;$$('[data-mood]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))});playSound('spark');lightPulse(actor.x,actor.z,emotions[mindMood].color,140)});
$('#mindClose').onclick=hideMindModal;
$('#mindModal').addEventListener('click',e=>{if(e.target.id==='mindModal')hideMindModal()});
function mindRecord(){if(!mindMood){toast('오늘 마음에 가장 가까운 얼굴을 하나 골라 주세요.');return null}
 const record={mood:mindMood,cause:$('#mindCause').value.trim().slice(0,600),need:$('#mindNeed').value.trim().slice(0,400),day:new Date().toLocaleDateString('ko-KR')};
 try{localStorage.setItem('amateur-writing-mind-private',JSON.stringify(record))}catch(e){}
 toast('이 마음은 내 기기에만 간직했어요.');return record;
}
$('#mindSave').onclick=()=>{const r=mindRecord();if(r)playSound('heart')};
$('#mindShare').onclick=()=>{if(!mindMood){toast('먼저 나누고 싶은 마음의 얼굴을 골라 주세요.');return;}send({t:'mood',kind:mindMood});playSound('heart');lightPulse(actor.x,actor.z,emotions[mindMood].color,150);toast('오늘 고른 마음의 얼굴 이름만 다른 참가자에게 나눴어요. 개인 기록은 전송되지 않아요.');};
$('#mindWrite').onclick=()=>{const r=mindRecord();if(!r)return;
 state.topic='지금 내 마음 — '+emotions[r.mood].name;
 state.notes=[state.notes.trim(),`${r.day} / 나의 마음: ${emotions[r.mood].name}`,r.cause?'떠오르는 순간: '+r.cause:'',r.need?'내게 필요한 말: '+r.need:''].filter(Boolean).join('\n');persist();
 setStep(2);hideMindModal();openMobilePanel('write');setTab('write');toast('마음 기록을 나만의 글감으로 옮겼어요.');
};
$('#mindShuffle').onclick=()=>{mindPromptIndex=(mindPromptIndex+1+Math.floor(Math.random()*(mindQuestions.length-1)))%mindQuestions.length;$('#mindPrompt').textContent=mindQuestions[mindPromptIndex];playSound('spark')};
$('#mindUnknownWrite').onclick=()=>{state.topic='아직 이름 없는 마음';state.notes=[state.notes.trim(),mindQuestions[mindPromptIndex]].filter(Boolean).join('\n');persist();setStep(2);hideMindModal();openMobilePanel('write');setTab('write');toast('마음 질문이 나의 글감으로 옮겨졌어요.')};
let currentFaceKey='';
function showFaceInfo(faceKey){
 const face=faceStories[faceKey]; if(!face)return;
 currentFaceKey=faceKey; hideMindModal(); hideSnackMenu(); closeLibrary(); closeMobilePanel();
 $('#faceInfoHeading').textContent=face.name+'의 얼굴';
 $('#faceInfoLead').textContent='이 얼굴을 천천히 읽고, 지금의 마음과 닿는 부분이 있는지 살펴보세요.';
 $('#faceInfoEmoji').textContent=face.emoji;
 $('#faceInfoTitle').textContent=face.name;
 $('#faceInfoTag').textContent=face.tag;
 $('#faceInfoText').textContent=face.summary;
 const el=$('#faceInfoModal'); el.classList.remove('hidden'); el.setAttribute('aria-hidden','false');
 playSound('spark'); lightPulse(actor.x,actor.z,face.color,170);
}
function hideFaceInfo(){const el=$('#faceInfoModal'); if(!el)return; el.classList.add('hidden'); el.setAttribute('aria-hidden','true');}
$('#faceInfoClose').onclick=hideFaceInfo;
$('#faceInfoModal').addEventListener('click',e=>{if(e.target.id==='faceInfoModal')hideFaceInfo()});
$('#faceInfoToWrite').onclick=()=>{const face=faceStories[currentFaceKey]; if(!face)return; state.topic='여섯 얼굴 — '+face.name; state.notes=[state.notes.trim(),`[${face.name}]`,face.summary.split('\n')[0]].filter(Boolean).join('\n'); persist(); setStep(2); hideFaceInfo(); openMobilePanel('write'); setTab('write'); toast(face.name+'에 대한 생각이 글감으로 옮겨졌어요.');};
function interact(){
 const choice=nearbyInteraction();
 if(!choice){toast('가구 가까이 가면 가능한 상호작용이 나타나요.');return}
 if(choice.type==='stand'){standUp();return}
 if(choice.type==='chair'){sit();return}
 if(choice.type==='snacks'){showSnackMenu();return}
 if(choice.type==='bookshelf'){openLibrary();return}
 if(choice.type==='lounge'){useMindLounge(choice.spot);return}
 if(choice.type==='mind'){showMindModal();lightPulse(actor.x,actor.z,'#cbb8ed',155);return}
 if(choice.type==='face'){showFaceInfo(choice.faceKey);return}
 if(choice.type==='water'){send({t:'scene',action:'water',plant:choice.plant.id});return}
 if(choice.type==='lamp'){send({t:'scene',action:'lamp'});return}
}

function sendMove(){send({t:'move',x:actor.x,z:actor.z,rot:actor.rot,action:actor.action});const p=peers.get(state.me);if(p){p.x=actor.x;p.z=actor.z;p.rot=actor.rot;p.action=actor.action}}
const moveKeys=new Set(['w','a','s','d','arrowup','arrowleft','arrowright','arrowdown']);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#libraryModal').classList.contains('hidden')){if(libraryState.editing)cancelLibraryEditor();else if(libraryState.view==='reader')returnToLibraryGallery();else closeLibrary()}else if(!$('#faceInfoModal').classList.contains('hidden'))hideFaceInfo();else if(!$('#mindModal').classList.contains('hidden'))hideMindModal();else if(!$('#snackMenu').classList.contains('hidden'))hideSnackMenu();else if(bookState.open)closeBook();else document.activeElement?.blur();return}if(e.target.closest('input,textarea,button')||!state.connected)return;const k=e.key.toLowerCase();if(moveKeys.has(k)){e.preventDefault();activeKey.add(k);route=[];if(state.sitting||actor.action==='lie')standUp()}else if(k==='v'){toggleCam()}else if(k==='f'){interact()}else if(k==='e'){interact()}else if(k==='enter'){setTab('chat');$('#chatInput').focus()}});
document.addEventListener('keyup',e=>activeKey.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>activeKey.clear());
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAmbient();else startAmbient()});
function toggleCam(){cam.first=!cam.first;cam.pitch=cam.first?.05:.31;cam.dist=4.7;cam.followPos=null;toast(cam.first?'1인칭 시점 · 마우스로 자유롭게 둘러보세요.':'3인칭 시점 · 내 캐릭터를 볼 수 있어요.');playSound()}
$('#camToggle').onclick=toggleCam;
$('#soundToggle').onclick=()=>{state.muted=!state.muted;$('#soundToggle span').textContent=state.muted?'소리 끔':'소리 켬';if(state.muted)stopAmbient();else{playSound('click');startAmbient()}};
$('#copy').onclick=async()=>{const url=location.origin+'/?room='+encodeURIComponent(state.code);try{await navigator.clipboard.writeText(url);toast('초대 링크를 복사했어요.')}catch(e){prompt('아래 링크를 복사해 주세요.',url)}playSound('spark')};
canvas.addEventListener('pointerdown',e=>{pointer={down:true,id:e.pointerId,x:e.clientX,y:e.clientY,travel:0};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!pointer.down||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;pointer.travel+=Math.abs(dx)+Math.abs(dy);if(pointer.travel>2){cam.yaw-=dx*.006;cam.pitch=clamp(cam.pitch+dy*.004,cam.first?-.85:.04,cam.first?.85:1.17)}});
canvas.addEventListener('pointerup',e=>{if(e.pointerId!==pointer.id)return;if(pointer.travel<8&&state.connected)floorClick(e);pointer.down=false});
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!cam.first)cam.dist=clamp(cam.dist+e.deltaY*.005,2.2,9.0)},{passive:false});
function floorClick(e){const rect=canvas.getBoundingClientRect(),nx=(e.clientX-rect.left)/rect.width*2-1,ny=1-(e.clientY-rect.top)/rect.height*2;const forward=norm(cam.center.map((v,i)=>v-cam.eye[i]));const right=norm(cross(forward,[0,1,0])),up=cross(right,forward),t=Math.tan(Math.PI/5.1),aspect=rect.width/rect.height;const dir=norm([forward[0]+right[0]*nx*t*aspect+up[0]*ny*t,forward[1]+right[1]*nx*t*aspect+up[1]*ny*t,forward[2]+right[2]*nx*t*aspect+up[2]*ny*t]);if(dir[1]>=-.02)return;const k=-cam.eye[1]/dir[1],x=cam.eye[0]+dir[0]*k,z=cam.eye[2]+dir[2]*k;if(traversable(x,z)){if(state.sitting||actor.action==='lie')standUp();const p=pathTo(x,z);if(p.length){route=p;state.sitting=false;actor.action='stand'}else toast('그곳까지 가는 통로를 찾지 못했어요.')}else toast('가구와 벽을 피해서 이동할 수 있어요.')}
const joystick=$('#joystick');let stickId=null;
function touchStick(e){const r=joystick.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,len=Math.hypot(x,y)||1,scale=Math.min(38,len)/len;const xx=x*scale,yy=y*scale;$('#stick').style.transform=`translate(${xx}px,${yy}px)`;stick.x=xx/38;stick.z=yy/38;route=[];if(state.sitting||actor.action==='lie')standUp()}
joystick.addEventListener('pointerdown',e=>{stickId=e.pointerId;joystick.setPointerCapture(e.pointerId);touchStick(e)});joystick.addEventListener('pointermove',e=>{if(stickId===e.pointerId)touchStick(e)});for(const event of ['pointerup','pointercancel'])joystick.addEventListener(event,()=>{stickId=null;stick.x=0;stick.z=0;$('#stick').style.transform='translate(0,0)'});

function stepMove(vx,vz,dt){let n=Math.hypot(vx,vz);if(!n)return false;vx/=n;vz/=n;
 const speed=3.45,oldX=actor.x,oldZ=actor.z,nx=actor.x+vx*dt*speed,nz=actor.z+vz*dt*speed;
 if(lineClear(actor.x,actor.z,nx,actor.z))actor.x=nx;
 if(lineClear(actor.x,actor.z,actor.x,nz))actor.z=nz;
 if(Math.hypot(actor.x-oldX,actor.z-oldZ)>.002){actor.rot=Math.atan2(vx,vz);return true}return false;
}
function move(dt){let f=0,r=0;if(activeKey.has('w')||activeKey.has('arrowup'))f++;if(activeKey.has('s')||activeKey.has('arrowdown'))f--;if(activeKey.has('a')||activeKey.has('arrowleft'))r--;if(activeKey.has('d')||activeKey.has('arrowright'))r++;f-=stick.z;r+=stick.x;
 if(f||r){route=[];return stepMove(-Math.sin(cam.yaw)*f+Math.cos(cam.yaw)*r,-Math.cos(cam.yaw)*f-Math.sin(cam.yaw)*r,dt)}
 if(!route.length||state.sitting)return false;
 // Skipping visible waypoints avoids getting stuck on tiny grid corners.
 while(route.length>1&&lineClear(actor.x,actor.z,...route[1]))route.shift();
 const [x,z]=route[0],len=Math.hypot(x-actor.x,z-actor.z);
 if(len<.13){route.shift();return false}
 const did=stepMove((x-actor.x)/len,(z-actor.z)/len,dt);
 if(!did){const dest=route[route.length-1],replacement=pathTo(...dest);
  if(replacement.length)route=replacement;else{route=[];toast('길이 막혔어요. 다른 쪽에서 다시 이동해 주세요.')}}
 return did;
}
// Use a camera ray within the walkable shell: transitions through a doorway, never through a wall.
function cameraUpdate(dt){
 if(cam.first){cam.eye=[actor.x,1.73,actor.z];cam.center=[actor.x-Math.sin(cam.yaw)*Math.cos(cam.pitch),1.73-Math.sin(cam.pitch),actor.z-Math.cos(cam.yaw)*Math.cos(cam.pitch)]}
 else{
  const dx=Math.sin(cam.yaw)*cam.dist*Math.cos(cam.pitch),dz=Math.cos(cam.yaw)*cam.dist*Math.cos(cam.pitch);
  // Only check the room shell, not furniture that the raised camera can look over.
  let safe=0;for(let t=.10;t<=1.001;t+=.04){if(!wallFree(actor.x+dx*t,actor.z+dz*t))break;safe=t}
  safe=Math.max(.12,Math.min(1,safe-.035));
  const desired=[actor.x+dx*safe,1.57+Math.sin(cam.pitch)*cam.dist*.82*safe,actor.z+dz*safe];
  if(!cam.followPos||Math.hypot(cam.followPos[0]-desired[0],cam.followPos[2]-desired[2])>9)cam.followPos=desired.slice();
  const ease=Math.min(1,dt*12);
  for(let i=0;i<3;i++)cam.followPos[i]+=(desired[i]-cam.followPos[i])*ease;
  // The camera must not linger behind an old room wall while crossing a threshold.
  if(!lineClear(actor.x,actor.z,cam.followPos[0],cam.followPos[2],wallFree))cam.followPos=desired.slice();
  cam.eye=cam.followPos.slice();cam.center=[actor.x,1.47,actor.z-Math.cos(cam.yaw)*.18];
 }
 cam.matrix=mul(persp(Math.PI/2.55,canvas.width/canvas.height,.07,95),lookAt(cam.eye,cam.center));
}
function screenAt(pos){if(!cam.matrix)return null;const [x,y,z]=pos,m=cam.matrix,w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<.12)return null;const a=(m[0]*x+m[4]*y+m[8]*z+m[12])/w,b=(m[1]*x+m[5]*y+m[9]*z+m[13])/w;return [(a*.5+.5)*canvas.clientWidth,(.5-b*.5)*canvas.clientHeight,w]}
// The pictogram and light pulse share ONE container and ONE lifetime (820ms).
// Stationary icons are distinct from the old floating droplet/particle animation.
function lightPulse(x,z,color='#ffe2a8',size=130,actionIcon=null){
 const pt=screenAt([x,1.8,z]);if(!pt)return;
 const holder=document.createElement('div');holder.className='actionEffect';
 holder.style.left=pt[0]+'px';holder.style.top=pt[1]+'px';
 const glow=document.createElement('div');glow.className='lightPulse';
 glow.style.setProperty('--pulse-color',color);glow.style.setProperty('--pulse-size',size+'px');
 holder.append(glow);
 const glyphs={tea:'🍵',cookie:'🍪',jelly:'🍬'};
 if(actionIcon==='water'||Object.prototype.hasOwnProperty.call(glyphs,actionIcon)){
  const icon=document.createElement('div');icon.className='actionEffectIcon';
  if(actionIcon==='water')icon.innerHTML=WATERING_CAN_ICON;
  else icon.textContent=glyphs[actionIcon];
  holder.append(icon);
 }
 $('#fxlayer').append(holder);
 setTimeout(()=>holder.remove(),820);
}
let lastLightPaint=0;function renderLightGlows(){const timestamp=performance.now();if(timestamp-lastLightPaint<65)return;lastLightPaint=timestamp;const layer=$('#lightlayer');if(!layer||!cam.matrix)return;const out=[];for(const l of worldLights){if(l.id==='standing-lamp'&&!state.lampOn)continue;const pt=screenAt([l.x,l.y,l.z]);if(!pt)continue;const [sx,sy,w]=pt;if(sx<-120||sx>canvas.clientWidth+120||sy<-120||sy>canvas.clientHeight+120)continue;const dist=Math.hypot(cam.eye[0]-l.x,cam.eye[1]-l.y,cam.eye[2]-l.z);const size=Math.max(58,l.size*Math.min(1.75,8/Math.max(3,dist)));const alpha=(l.alpha||.2)*Math.max(.18,Math.min(1,.98-dist/24));out.push(`<div class="sceneGlow" style="left:${sx}px;top:${sy}px;--size:${size}px;--glow:${l.color};--alpha:${alpha}"></div>`)}layer.innerHTML=out.join('')}
function screenLabels(){if(!state.connected)return;const labels=[];for(const door of [{x:-5.6,z:-1.0,t:'☕ 다과룸'},{x:5.6,z:-1.0,t:'✧ 여섯 얼굴의 방'}]){
 if(Math.hypot(actor.x-door.x,actor.z-door.z)<8){const loc=screenAt([door.x,2.93,door.z]);if(loc&&loc[0]>20&&loc[0]<canvas.clientWidth-20&&loc[1]>90&&loc[1]<canvas.clientHeight-30)labels.push(`<div class="door-label" style="left:${loc[0]}px;top:${loc[1]}px">${door.t}</div>`)}}
 for(const p of peers.values()){if(p.id===state.me&&cam.first)continue;const x=p.id===state.me?actor.x:p.rx,z=p.id===state.me?actor.z:p.rz;const pt=screenAt([x,2.25,z]);if(!pt||pt[0]<-30||pt[0]>canvas.clientWidth+30||pt[1]<60||pt[1]>canvas.clientHeight)continue;const txt=p.bubble&&p.bubbleEnd>Date.now()?p.bubble:(p.id===state.me?'나 · '+p.name:p.name);labels.push(`<div class="world-label ${p.id===state.me?'me':''}" style="left:${pt[0]}px;top:${pt[1]}px">${escapeHtml(txt)}</div>`)}$('#worldlabels').innerHTML=labels.join('')}
let lastFrame=0,lastStepAt=0;
function frame(now){const dt=Math.min(.045,(now-lastFrame)/1000||.016);lastFrame=now;
 const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),dpr=Math.min(matchMedia('(max-width:700px)').matches?1.25:1.5,devicePixelRatio||1);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(gl)gl.viewport(0,0,canvas.width,canvas.height)}
 if(state.connected){const moving=move(dt);actor.moving=moving;if(moving&&now-lastStepAt>405){playFootstep();lastStepAt=now}if(moving&&now-lastNet>85){sendMove();lastNet=now}if(!moving&&now-lastNet>950){sendMove();lastNet=now}updateZone();}
 updateProximityHint();
 cameraUpdate(dt);
 positionReactionBadges();
 if(gl){gl.uniform1f(uStandLampOn,state.lampOn?1:0);if(burstLight&&now<burstLight.end){const color=burstLight.kind==='heart'?[1,.38,.55]:burstLight.kind==='jelly'?[.93,.54,.94]:burstLight.kind==='tea'?[.68,1,.60]:[1,.84,.54];gl.uniform3f(uFxPos,burstLight.x,burstLight.y,burstLight.z);gl.uniform3fv(uFxColor,new Float32Array(color));gl.uniform1f(uFxPower,Math.max(0,(burstLight.end-now)/1000)*2.1);}else{gl.uniform1f(uFxPower,0);}gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);draw(staticBuffer,cam.matrix);draw(state.lampOn?lampBulbOnBuffer:lampBulbOffBuffer,cam.matrix);if(state.connected){for(const p of peers.values()){if((cam.first||Math.hypot(cam.eye[0]-actor.x,cam.eye[2]-actor.z)<2.85)&&p.id===state.me)continue;
  if(p.id!==state.me){p.rx+=(p.x-p.rx)*Math.min(1,dt*11);p.rz+=(p.z-p.rz)*Math.min(1,dt*11);p.rr+=(p.rot-p.rr)*Math.min(1,dt*10)}
  const x=p.id===state.me?actor.x:p.rx,z=p.id===state.me?actor.z:p.rz,rot=p.id===state.me?actor.rot:p.rr;
  const isMe=p.id===state.me,action=(isMe?actor.action:p.action),isSitting=action==='sit',isLying=action==='lie';const isWalking=isMe?actor.moving:(p.moving&&now-p.lastMoved<280);const pose=isLying?5:isSitting?4:isWalking?1+(Math.floor(now/170)%3):0;const gender=(p.gender==='female'?'female':'male');const m=(avatars[gender][p.color]||avatars[gender][0])[pose],model=modelMat(x,isLying?.67:0,z,rot);draw(m,mul(cam.matrix,model),model)}
 }
 }
 if(!gl && softCtx && state.connected){const players=[...peers.values()].map(p=>{const action=p.id===state.me?actor.action:p.action;return {self:p.id===state.me&&(cam.first||Math.hypot(cam.eye[0]-actor.x,cam.eye[2]-actor.z)<2.85),x:p.id===state.me?actor.x:p.rx,z:p.id===state.me?actor.z:p.rz,rot:p.id===state.me?actor.rot:p.rr,color:p.color,gender:p.gender,action,py:action==='lie'?.67:0,pose:(p.id===state.me?actor.moving:(p.moving&&now-p.lastMoved<280))?1+(Math.floor(now/170)%3):(action==='lie'?5:action==='sit'?4:0)}});drawSoftware(now,players,cam,particles,state.lampOn)}
 renderLightGlows();
 if(now%120<30)screenLabels();requestAnimationFrame(frame)}
// WebRTC mesh voice: opt-in microphone, P2P audio. HTTPS/local-only; restricted NAT may require TURN.
async function peerFor(id){let pc=rtc.get(id);if(pc)return pc;
 pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});rtc.set(id,pc);
 pc.onicecandidate=e=>{if(e.candidate)send({t:'signal',to:id,data:{candidate:e.candidate}})};
 pc.ontrack=e=>{let audio=document.getElementById('audio-'+id);if(!audio){audio=document.createElement('audio');audio.id='audio-'+id;audio.autoplay=true;audio.playsInline=true;document.body.append(audio)}audio.srcObject=e.streams[0];audio.play().catch(()=>{$('#micState').textContent='상대방 소리를 듣기 위해 화면을 눌러 주세요.'})};
 pc.onconnectionstatechange=()=>{if(['closed','failed'].includes(pc.connectionState)){rtc.delete(id);pc.close()}};
 if(microphoneStream){for(const track of microphoneStream.getAudioTracks())pc.addTrack(track,microphoneStream)}
 return pc;
}
async function offer(id){const pc=await peerFor(id);try{if(pc.signalingState!=='stable')return;const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({t:'signal',to:id,data:{description:pc.localDescription}})}catch(e){console.warn('offer',e)}}
async function handleSignal(id,data){try{
 const pc=await peerFor(id);
 if(data.description){const desc=data.description;const collision=desc.type==='offer'&&pc.signalingState!=='stable';const polite=String(state.me)>String(id);if(collision&&!polite)return;
  if(collision&&polite)await pc.setLocalDescription({type:'rollback'});
  await pc.setRemoteDescription(desc);
  if(desc.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);send({t:'signal',to:id,data:{description:pc.localDescription}})}
 }else if(data.candidate){try{await pc.addIceCandidate(data.candidate)}catch(e){/* candidate before offer */}}
 }catch(e){console.warn('WebRTC signal',e)}}
$('#micToggle').onclick=async()=>{if(!state.connected)return;if(state.mic){microphoneStream?.getTracks().forEach(t=>t.stop());microphoneStream=null;state.mic=false;for(const pc of rtc.values())for(const s of pc.getSenders())if(s.track?.kind==='audio')s.replaceTrack(null).catch(()=>{});$('#micToggle').textContent='마이크 연결하기';$('#micState').textContent='마이크를 껐어요. 다른 참가자의 음성은 들을 수 있습니다.';toast('마이크가 꺼졌어요.');return}
 try{if(!navigator.mediaDevices?.getUserMedia)throw Error('HTTPS 또는 localhost에서만 마이크를 사용할 수 있습니다.');microphoneStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});state.mic=true;$('#micToggle').textContent='마이크 끄기';$('#micState').textContent='● 마이크가 켜졌습니다 · 다른 사람들도 내 목소리를 들을 수 있어요.';const ids=[...peers.keys()].filter(id=>id!==state.me);for(const id of ids){const existing=rtc.get(id);if(existing){let sender=existing.getSenders().find(s=>s.track?.kind==='audio');if(sender)await sender.replaceTrack(microphoneStream.getAudioTracks()[0]);else existing.addTrack(microphoneStream.getAudioTracks()[0],microphoneStream)}await offer(id)}playSound('enter');toast('마이크를 연결했어요.');}
 catch(e){$('#micState').textContent='연결 실패: '+e.message;toast('마이크 권한 또는 HTTPS 환경을 확인해 주세요.')}
};
$('#nickname').value=state.name;$('#inviteCode').value=state.code;$('#enterBtn').onclick=join;
$('#nickname').addEventListener('keydown',e=>{if(e.key==='Enter')join()});$('#inviteCode').addEventListener('keydown',e=>{if(e.key==='Enter')join()});
$$('#colors button').forEach(b=>b.addEventListener('click',()=>{state.color=+b.dataset.color;$$('#colors button').forEach(x=>x.classList.toggle('chosen',x===b));playSound()}));
$$('#colors button').forEach(b=>b.classList.toggle('chosen',+b.dataset.color===state.color));

// Mobile layout is a fullscreen 3D game with a draggable camera and a bottom sheet.
const isMobile=()=>window.matchMedia('(max-width:700px)').matches;
function openMobilePanel(tab){setTab(tab);if(!isMobile())return;
  $('#sidebar').classList.add('panelOpen');$('#mobilePanelScrim').classList.add('visible');
  const names={write:'나의 글쓰기',together:'함께하기',chat:'모임 대화'};
  $('#mobilePanelTitle').textContent=names[tab]||'모임 메뉴';
  $$('.mobileDock button[data-open-tab]').forEach(b=>b.classList.toggle('active',b.dataset.openTab===tab));
}
function closeMobilePanel(){ $('#sidebar').classList.remove('panelOpen');$('#mobilePanelScrim').classList.remove('visible'); }
$$('[data-open-tab]').forEach(b=>b.addEventListener('click',()=>{playSound();openMobilePanel(b.dataset.openTab)}));
$('#closeMobilePanel').onclick=closeMobilePanel;
$('#mobilePanelScrim').onclick=closeMobilePanel;
$('#mobileSeat').onclick=interact;
const mobileInteractButton=$('#mobileInteract');if(mobileInteractButton)mobileInteractButton.onclick=interact;
window.addEventListener('resize',()=>{if(!isMobile())closeMobilePanel()});
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>{if(isMobile())$('#mobilePanelTitle').textContent=({write:'나의 글쓰기',together:'함께하기',chat:'모임 대화'})[b.dataset.tab]}));
$$('#avatarTypes button').forEach(b=>b.addEventListener('click',()=>{
 state.gender=b.dataset.gender==='female'?'female':'male';
 $$('#avatarTypes button').forEach(x=>{const active=x===b;x.classList.toggle('chosen',active);x.setAttribute('aria-pressed',String(active))});
 persist();playSound('click');
}));
$$('#avatarTypes button').forEach(b=>{const active=b.dataset.gender===state.gender;b.classList.toggle('chosen',active);b.setAttribute('aria-pressed',String(active))});

renderWriting();requestAnimationFrame(frame);

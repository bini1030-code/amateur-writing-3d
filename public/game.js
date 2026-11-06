'use strict';
// Real perspective WebGL game, shared live movement, text, reactions and opt-in WebRTC voice.
const $=sel=>document.querySelector(sel), $$=sel=>[...document.querySelectorAll(sel)];
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const prompts=['어느 날 문득 나를 위로해 준 작은 말','지금 다시 만나고 싶은 한 사람','오늘 내가 지켜낸 작은 용기','말로는 꺼내지 못했던 마음 한 조각','내게 평안함을 주는 저녁의 풍경','지나온 계절에 전하고 싶은 편지','아무것도 특별하지 않았던 소중한 순간','내 삶에 남아 있는 누군가의 친절'];
let saved={};try{saved=JSON.parse(localStorage.getItem('amateur-writing-live-v2')||'{}')}catch(e){}
const state={name:saved.name||'',code:new URLSearchParams(location.search).get('room')||saved.code||'NIGHT',color:saved.color||0,gender:saved.gender==='female'?'female':'male',notes:saved.notes||'',topic:saved.topic||'',title:saved.title||'',story:saved.story||'',step:0,read:null,connected:false,me:null,mic:false,muted:false,room:'main',sitting:false,restSpot:null,timer:20*60,running:false};
function persist(){try{localStorage.setItem('amateur-writing-live-v2',JSON.stringify({name:state.name,code:state.code,color:state.color,gender:state.gender,notes:state.notes,topic:state.topic,title:state.title,story:state.story}))}catch(e){}}
let burstLight=null;let socket=null,peers=new Map(),audioContext=null,toastTimer,readingRequest=null,lastNet=0,route=[],particles=[],activeKey=new Set(),microphoneStream=null,rtc=new Map(),pointer={down:false,x:0,y:0,id:null,travel:0},stick={x:0,z:0};
const actor={x:.2,z:7.6,rot:Math.PI,action:'stand',moving:false};
const cam={yaw:0,pitch:.31,dist:4.7,followPos:null,first:false,eye:[0,0,0],center:[0,0,0],matrix:null};
const worldLights=[
 {x:-2.6,y:3.05,z:4.9,color:'#ffdca0',size:230,alpha:.48},{x:0,y:3.05,z:4.9,color:'#ffdca0',size:255,alpha:.52},{x:2.6,y:3.05,z:4.9,color:'#ffdca0',size:230,alpha:.48},
 {x:-2.4,y:3.05,z:6.4,color:'#ffd7a2',size:215,alpha:.45},{x:0,y:3.05,z:6.4,color:'#ffd7a2',size:245,alpha:.49},{x:2.4,y:3.05,z:6.4,color:'#ffd7a2',size:215,alpha:.45},
 {x:6.95,y:3.08,z:10.15,color:'#ffe0a7',size:230,alpha:.38},{x:-5.6,y:3.22,z:-0.9,color:'#f6deb2',size:145,alpha:.23},{x:5.6,y:3.22,z:-0.9,color:'#f6deb2',size:145,alpha:.23},
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
 src.buffer=buffer;low.type='lowpass';low.frequency.value=450;gain.gain.value=.18;
 src.connect(low);low.connect(gain);gain.connect(ctx.destination);src.start();src.stop(ctx.currentTime+length);
}
function send(o){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(o))}
function join(){const name=$('#nickname').value.trim()||'밤의 필자',code=($('#inviteCode').value||'NIGHT').trim().toUpperCase().replace(/[^A-Z0-9가-힣-]/g,'').slice(0,18)||'NIGHT';
  if(!state.muted)ensureAudio(); // entry click unlocks ambient playback on mobile browsers
  state.name=name;state.code=code;persist();$('#entryError').textContent='모임방에 연결하는 중입니다…';$('#enterBtn').disabled=true;
  try{socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){joinFail('서버 주소를 확인해 주세요.');return}
  socket.onopen=()=>send({t:'join',name,code,color:state.color,gender:state.gender});
  socket.onmessage=ev=>{let p;try{p=JSON.parse(ev.data)}catch(e){return}message(p)};
  socket.onerror=()=>joinFail('연결에 문제가 있어요. 서버가 실행 중인지 확인해 주세요.');
  socket.onclose=()=>{stopAmbient();if(!state.connected)joinFail('방에 들어가지 못했어요. 다시 시도해 주세요.');else{state.connected=false;toast('서버 연결이 끊어졌어요. 새로고침해 다시 들어와 주세요.');$('#count').textContent='—';$('#micState').textContent='서버 연결이 종료되었습니다.'}}
}
function joinFail(t){$('#entryError').textContent=t;$('#enterBtn').disabled=false}
function message(p){
 switch(p.t){
  case 'welcome':state.me=p.id;state.code=p.code;state.connected=true;startAmbient();actor.x=(p.people.find(x=>x.id===p.id)||{x:.2}).x;actor.z=(p.people.find(x=>x.id===p.id)||{z:7.6}).z;peers.clear();for(const person of p.people)peers.set(person.id,{...person,rx:person.x,rz:person.z,rr:person.rot});$('#roomCode').textContent=p.code;$('#entrance').classList.add('hidden');$('#enterBtn').disabled=false;try{history.replaceState(null,'','?room='+encodeURIComponent(p.code))}catch(e){};renderPeople();updateZone();playSound('enter');toast('어서 와요, '+state.name+' 님. 오늘도 한 문장씩 써 보아요.');restoreChatRoom(p.code,p.history||[]);if(p.reading)showReading(p.reading);break;
  case 'join':peers.set(p.person.id,{...p.person,rx:p.person.x,rz:p.person.z,rr:p.person.rot});renderPeople();addSystem(p.person.name+' 님이 모임방에 왔어요.');playSound('click');if(state.mic)offer(p.person.id);break;
  case 'leave':{let gone=peers.get(p.id);if(gone)addSystem(gone.name+' 님이 나갔어요.');peers.delete(p.id);const pc=rtc.get(p.id);if(pc){pc.close();rtc.delete(p.id)}document.getElementById('audio-'+p.id)?.remove();renderPeople();break;}
  case 'move':{const other=peers.get(p.id);if(other){other.moving=Math.hypot(other.x-p.x,other.z-p.z)>.02;other.lastMoved=performance.now();other.x=p.x;other.z=p.z;other.rot=p.rot;other.action=p.action;}break;}
  case 'chat':{receiveChat(p);bubble(p.id,p.text);break;}
  case 'react':{const other=peers.get(p.id);if(other){emote(p.kind,other.x,other.z);toast(p.name+' 님이 '+({heart:'마음을',clap:'박수를',spark:'반짝임을',wave:'인사를',tea:'차 한 잔을',cookie:'과자를',jelly:'젤리를'}[p.kind]||'온기를')+' 전했어요.');playSound(p.kind);}break;}
  case 'mood':{const mood={joy:'☀️ 기쁨',sad:'💧 슬픔',anger:'🔥 화',worry:'🌧️ 불안',peace:'🍃 평온',hope:'✨ 기대'}[p.kind];const other=peers.get(p.id);if(mood){toast(p.name+' 님이 오늘의 마음을 나눴어요 · '+mood);if(other)emote('spark',other.x,other.z);playSound('heart')}break;}

  case 'reading':showReading(p.reading);if(p.reading){toast(p.reading.mode==='request'?p.reading.name+' 님이 대신 읽기를 부탁했어요.':'함께 낭독하는 시간이 시작됐어요.');playSound('reading')}else toast('낭독을 마쳤어요. 따뜻한 박수를 보내요.');break;
  case 'signal':handleSignal(p.from,p.data);break;
  case 'error':toast(p.message);joinFail(p.message);break;
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
function emote(kind,x,z){const screen=screenAt([x,2.5,z]);if(screen){let p=document.createElement('div');p.className='floatEmoji';p.textContent=reactionEmoji[kind]||'✨';p.style.left=screen[0]+'px';p.style.top=screen[1]+'px';p.style.setProperty('--dx',(Math.random()*75-35)+'px');$('#fxlayer').append(p);setTimeout(()=>p.remove(),1950)}
 const pulseColors={heart:'#f6b8c8',clap:'#ffe1a0',spark:'#fff2b3',wave:'#cbe8ff',tea:'#d8ecc7',cookie:'#f1c48d',jelly:'#efb3df'};lightPulse(x,z,pulseColors[kind]||'#ffe2a8',kind==='clap'?150:132);burstLight={x,y:1.63,z,kind,end:performance.now()+1000};
 if(!$('#reading').classList.contains('hidden')){const card=$('.readCard');for(let j=0;j<4;j++){let e=document.createElement('span');e.className='readBurst';e.textContent=reactionEmoji[kind]||'✨';e.style.left=(20+Math.random()*60)+'%';e.style.top=(68+Math.random()*16)+'%';card.append(e);setTimeout(()=>e.remove(),1850)}}
 for(let i=0;i<13;i++){const colors=kind==='heart'?['#fad4d9','#fbd7b0']:kind==='tea'?['#cde2d0','#f9ecbe']:kind==='cookie'?['#d0a076','#f5dbb7']:kind==='jelly'?['#f4b0c9','#c9c1fa']:['#fbd7b0','#f9ecbe'];particles.push({x,y:1+Math.random()*1.1,z,vx:(Math.random()-.5)*1.7,vy:1.2+Math.random()*1.4,vz:(Math.random()-.5)*1.7,life:1.2+Math.random()*.6,color:colors[i%colors.length]})}}
function react(kind){if(!state.connected)return;send({t:'react',kind});emote(kind,actor.x,actor.z);playSound(kind)}
$$('[data-react]').forEach(b=>b.addEventListener('click',()=>react(b.dataset.react)));
$('#chatForm').addEventListener('submit',e=>{e.preventDefault();const el=$('#chatInput'),t=el.value.trim();if(!t||!state.connected)return;send({t:'chat',text:t.slice(0,200)});el.value='';setTab('chat')});
function setTab(t){$$('.tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===t));$$('.tabpane').forEach(p=>p.classList.toggle('active',p.id===t+'Pane'));}
$$('.tabs button').forEach(b=>b.onclick=()=>{setTab(b.dataset.tab);playSound()});
function renderWriting(){const s=state.step;let h='';
 if(s===0)h=`<div class="stagehead">마음의 서랍 열기</div><p class="stage-desc">지금 내 마음에 가장 오래 머무는 생각은 무엇일까요?</p><div class="stagequote">“오늘 내가 가장 많이 느낀 감정은 무엇이었나요?”</div><label class="lab">생각을 순서 없이 적어 보세요</label><textarea class="field" id="notes" placeholder="사건, 기억, 걱정, 감사… 무엇이든 좋아요.">${escapeHtml(state.notes)}</textarea><div class="rowbtn"><button class="button primary" data-action="next">글감 찾기 →</button></div>`;
 if(s===1)h=`<div class="stagehead">글감 찾기</div><p class="stage-desc">마음에 닿는 문장이 있다면 그곳에서 시작해 보세요.</p><div class="stagequote" id="topicQuote">${escapeHtml(state.topic||prompts[0])}</div><button class="button secondary" data-action="shuffle">↻ 다른 글감 보여주기</button><label class="lab">나만의 글감</label><input class="field" id="topic" placeholder="직접 떠올린 주제도 좋아요" value="${escapeHtml(state.topic)}"><div class="rowbtn"><button class="button primary" data-action="next">문장 쓰기 →</button><button class="button subtle" data-action="prev">← 돌아가기</button></div>`;
 if(s===2)h=`<div class="stagehead">나의 문장 만들기</div><p class="stage-desc">부담 없이 적고, 나누고 싶은 만큼만 나누어요. 글은 이 기기에 자동 저장돼요.</p><label class="lab">제목</label><input class="field" id="storyTitle" maxlength="80" placeholder="아직 제목 없는 이야기" value="${escapeHtml(state.title)}"><label class="lab">본문</label><textarea class="field big" id="story" placeholder="오늘 밤에는 이런 이야기를 남기고 싶어요…">${escapeHtml(state.story)}</textarea><div class="timer"><small class="muted" id="len">${state.story.length} 글자 · 기기에 자동 저장</small><strong id="time">${timeFormat(state.timer)}</strong></div><div class="rowbtn"><button class="button secondary" data-action="timer">${state.running?'Ⅱ 타이머 멈추기':'▷ 20분 글쓰기 타이머'}</button><button class="button secondary" data-action="download">↓ 나의 글 저장</button><button class="button primary" data-action="next">낭독하기 →</button></div>`;
 if(s===3)h=`<div class="stagehead">함께 읽는 밤</div><p class="stage-desc">글이 완벽하지 않아도 괜찮아요. 누군가의 마음을 듣는 것만으로 이 공간은 따뜻해져요.</p><div class="stagequote">“부끄러워도 괜찮아요. 당신의 문장을 소중하게 듣겠습니다.”</div><div class="rowbtn"><button class="button primary" data-action="self">📖 모두에게 내 글 나누기</button><button class="button secondary" data-action="request">♡ 진행자에게 대신 읽기 부탁하기</button></div><p class="muted">공유하면 다른 사람에게 책 도착 알림이 뜹니다. 각자 원할 때 책을 펼쳐 읽을 수 있어요. 음성 대화를 쓰려면 ‘함께’ 탭에서 마이크를 연결하세요. 마이크 없이도 기기 읽기 기능을 사용할 수 있어요.</p><div class="rowbtn"><button class="button subtle" data-action="prev">← 글 수정하기</button><button class="button secondary" data-action="download">↓ 내 글 저장</button></div>`;
 $('#writingContent').innerHTML=h;$$('.steps button').forEach(b=>b.classList.toggle('active',+b.dataset.step===s));}
function timeFormat(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function setStep(i){state.step=clamp(i,0,3);playSound();renderWriting()}
$$('[data-step]').forEach(b=>b.onclick=()=>setStep(+b.dataset.step));
$('#writingContent').addEventListener('input',e=>{if(e.target.id==='notes')state.notes=e.target.value;else if(e.target.id==='topic'){state.topic=e.target.value;$('#topicQuote').textContent=state.topic||prompts[0];}else if(e.target.id==='storyTitle')state.title=e.target.value;else if(e.target.id==='story'){state.story=e.target.value;$('#len').textContent=state.story.length+' 글자 · 기기에 자동 저장'}persist()});
$('#writingContent').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){
 case 'next':setStep(state.step+1);break;case 'prev':setStep(state.step-1);break;
 case 'shuffle':state.topic=prompts[Math.floor(Math.random()*prompts.length)];renderWriting();playSound('spark');break;
 case 'timer':state.running=!state.running;renderWriting();toast(state.running?'20분 글쓰기를 시작했어요.':'타이머를 멈췄어요.');break;
 case 'download':downloadWriting();break;
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
 {x:6.95,z:10.15,w:.95,h:.95},{x:-7.65,z:.25,w:.95,h:.95},{x:7.55,z:1.65,w:.92,h:.92},{x:-7.5,z:10.5,w:.80,h:.80},
 // tea room
 {x:-4.6,z:-9.15,w:7.95,h:1.45}, // back counter
 {x:-4.5,z:-5.1,w:3.95,h:1.86}, // standing snack table
 {x:-8.2,z:-2.7,w:.88,h:.88},{x:-4.45,z:-5.0,w:1.25,h:.82},
 // psychology room
 {x:4.5,z:-5.47,w:1.55,h:1.55}, // center journal stand
 {x:1.0,z:-3.75,w:.98,h:2.20},   // entry console
 {x:.72,z:-7.6,w:.76,h:.76},{x:.72,z:-3.0,w:.76,h:.76},
 {x:2.35,z:-7.05,w:1.00,h:.86},{x:6.10,z:-7.05,w:1.00,h:.86},
 {x:7.28,z:-5.38,w:1.70,h:2.48}
 ];
function inRect(x,z,r,margin=.14){return x>r.x-r.w/2-margin&&x<r.x+r.w/2+margin&&z>r.z-r.h/2-margin&&z<r.z+r.h/2+margin}
function traversable(x,z){
 if(x<-8.47||x>8.47||z>11.4||z<-9.45)return false;
 if(z<-1.18&&x>-.33&&x<.33)return false;
 if(z>-1.32&&z<-.68&&!((x>-6.58&&x<-4.62)||(x>4.62&&x<6.58)))return false;
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
const mindLounge=[
 {id:'beanbag-a',x:2.35,z:-7.05,rot:.28,type:'beanbag',action:'sit',label:'빈백'},
 {id:'beanbag-b',x:6.10,z:-7.05,rot:-.32,type:'beanbag',action:'sit',label:'빈백'},
 {id:'hammock',x:7.28,z:-5.38,rot:0,type:'hammock',action:'lie',label:'해먹'}
];
const mindTable={x:4.5,z:-5.47,w:1.9,h:1.9,label:'마음 테이블'};
function offsetByRot(x,z,rot,forward=0,side=0){return {x:x+Math.sin(rot)*forward+Math.cos(rot)*side,z:z+Math.cos(rot)*forward-Math.sin(rot)*side}}
function standUp(){
 if(!(state.sitting||actor.action==='sit'||actor.action==='lie'))return false;
 const base=state.restSpot||{x:actor.x,z:actor.z,rot:actor.rot,type:'chair'};
 const tries=[];
 if(base.type==='chair')tries.push(offsetByRot(base.x,base.z,base.rot,0,.82),offsetByRot(base.x,base.z,base.rot,0,-.82),offsetByRot(base.x,base.z,base.rot,-.78,0),offsetByRot(base.x,base.z,base.rot,.78,0));
 else if(base.type==='beanbag')tries.push(offsetByRot(base.x,base.z,base.rot,.95,0),offsetByRot(base.x,base.z,base.rot,-.95,0),offsetByRot(base.x,base.z,base.rot,0,.85),offsetByRot(base.x,base.z,base.rot,0,-.85));
 else tries.push(offsetByRot(base.x,base.z,base.rot,-1.02,0),offsetByRot(base.x,base.z,base.rot,1.02,0),offsetByRot(base.x,base.z,base.rot,0,.92),offsetByRot(base.x,base.z,base.rot,0,-.92));
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
function closestMindLounge(){
 let best=null,score=Infinity;
 for(const spot of mindLounge){
  const d=Math.hypot(actor.x-spot.x,actor.z-spot.z);
  const radius=spot.type==='hammock'?.91:.68;
  if(d>radius+.90)continue;
  const s=Math.abs(d-radius);if(s<score){score=s;best=spot}
 }
 return best
}
// Table uses the entire perimeter of its circular top rather than a narrow trigger spot.
function nearMindTable(){
 const d=Math.hypot(actor.x-mindTable.x,actor.z-mindTable.z);
 return d>=.70&&d<=2.12
}
const chairSeats=[...[-3.4,-1.5,.7,2.9].map(x=>({x,z:7.5,rot:Math.PI})),
 ...[-3.4,-1.5,.7,2.9].map(x=>({x,z:2.5,rot:0})),
 {x:-5.4,z:4.4,rot:Math.PI/2},{x:4.85,z:4.5,rot:-Math.PI/2}];
function nearbyInteraction(){
 if(!state.connected)return null;
 if(state.sitting||actor.action==='sit'||actor.action==='lie'){
  const kind=state.restSpot?.type;
  return {type:'stand',label:kind==='hammock'?'해먹에서 일어나기':kind==='beanbag'?'빈백에서 일어나기':'의자에서 일어나기',detail:'상호작용으로 안전한 바닥에 내려와요.'}
 }
 if(state.room==='main'){
  let seat=null,dist=Infinity;
  for(const p of chairSeats){const d=Math.hypot(actor.x-p.x,actor.z-p.z);if(d<dist){dist=d;seat=p}}
  return dist<1.21?{type:'chair',label:'의자에 앉기',detail:'상호작용을 누르면 자리에 앉습니다.'}:null
 }
 if(state.room==='tea'){
  const d1=nearestRectDistance(actor.x,actor.z,-4.5,-5.1,3.85,1.66);
  const d2=nearestRectDistance(actor.x,actor.z,-4.6,-9.15,7.8,1.35);
  return Math.min(d1,d2)<.83?{type:'snacks',label:'차 · 과자 · 젤리 고르기',detail:'상호작용으로 다과 메뉴를 엽니다.'}:null
 }
 if(state.room==='mind'){
  const lounge=closestMindLounge();
  const table=nearMindTable();
  // Proximity to the nearest furniture surface decides which *single* action is offered.
  if(lounge&&table){
   const ld=Math.abs(Math.hypot(actor.x-lounge.x,actor.z-lounge.z)-(lounge.type==='hammock'?.91:.68));
   const td=Math.abs(Math.hypot(actor.x-mindTable.x,actor.z-mindTable.z)-1.02);
   if(td+.06<ld)return {type:'mind',label:'내 마음 알아보기 · 몰라보기',detail:'중앙 테이블에서 마음 활동을 선택해요.'};
  }
  if(lounge)return {type:'lounge',spot:lounge,label:lounge.type==='hammock'?'해먹에 누워 하늘 보기':'빈백에 편하게 앉기',detail:'상호작용을 누르면 쉬는 자세로 바뀝니다.'};
  if(table)return {type:'mind',label:'내 마음 알아보기 · 몰라보기',detail:'중앙 테이블에서 마음 활동을 선택해요.'};
 }
 return null
}
function useMindLounge(spot){
 if(!spot)return;
 actor.x=spot.x;actor.z=spot.z;actor.rot=spot.rot;actor.action=spot.action;state.sitting=true;state.restSpot=spot;route=[];sendMove();
 emote('spark',actor.x,actor.z);playSound(spot.type==='hammock'?'wave':'click');
 toast(spot.type==='hammock'?'해먹에 하늘을 보고 누워 쉬어요.':'빈백에 편하게 앉았어요.');
 lightPulse(actor.x,actor.z,'#cbb8ed',155);
}
let lastHintKey='';
function updateProximityHint(){
 const hint=$('#proximityHint');if(!hint)return;
 const action=nearbyInteraction();
 const hidden=!!$('#entrance:not(.hidden)')||!!document.querySelector('.mindOverlay:not(.hidden)')||!!document.querySelector('.snackOverlay:not(.hidden)');
 if(!action||hidden){hint.hidden=true;lastHintKey='';return}
 const key=action.type+action.label;
 if(lastHintKey!==key){$('#proximityTitle').textContent=action.label;$('#proximityText').textContent=action.detail;lastHintKey=key}
 hint.hidden=false;
}

function roomGlow(zone){const label=zone==='tea'?'☕ 다과룸에 오셨어요':zone==='mind'?'✧ 여섯 얼굴의 방에 오셨어요':'✎ 글쓰기 모임방에 오셨어요';
 const el=document.createElement('div');el.className='arrival';el.textContent=label;$('#fxlayer').append(el);setTimeout(()=>el.remove(),1700);
 for(let i=0;i<8;i++){particles.push({x:actor.x+(Math.random()-.5)*.8,y:.6+Math.random(),z:actor.z+(Math.random()-.5)*.7,vx:(Math.random()-.5)*.45,vy:.6,vz:(Math.random()-.5)*.45,life:.65+Math.random()*.6,color:i%2?'#f9ecbe':'#cde2d0'})}lightPulse(actor.x,actor.z,zone==='tea'?'#ffe0aa':zone==='mind'?'#d1b4fa':'#ffd6ae',160);
}
function updateZone(){const zone=roomOf(actor.x,actor.z);if(zone===state.room&&$('#zoneTitle').dataset.ready)return;if(zone!=='tea')hideSnackMenu();if(zone!=='mind')hideMindModal();const o={main:['THE WRITING ROOM','밤의 문장들','모여서 쓰고, 서로의 이야기를 듣는 방'],tea:['THE SNACK ROOM','달콤한 다과 시간','서서 즐기는 차 · 과자 · 젤리'],mind:['THE SIX FACES ROOM','내 마음은 왜 여섯 얼굴일까?','감정 여섯 빛을 따라 마음을 비춰 보는 공간']};const t=o[zone];$('#zoneLabel').textContent=t[0];$('#zoneTitle').textContent=t[1];$('#zoneSub').textContent=t[2];$('#zoneTitle').dataset.ready=1;state.room=zone;renderPeople();if($('#zoneTitle').dataset.visited){playSound('door');roomGlow(zone)}$('#zoneTitle').dataset.visited='1'}
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
const emotions={joy:{name:'기쁨',color:'#f7c16f'},sad:{name:'슬픔',color:'#8bb6d5'},anger:{name:'화',color:'#d99a94'},worry:{name:'불안',color:'#ad9bda'},peace:{name:'평온',color:'#98bfa9'},hope:{name:'기대',color:'#e5cc83'}};
const mindQuestions=[
 '지금 마음에 창문이 있다면, 밖에는 어떤 풍경이 보일까요?',
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
$('#mindShare').onclick=()=>{if(!mindMood){toast('먼저 나누고 싶은 감정 얼굴을 골라 주세요.');return;}send({t:'mood',kind:mindMood});playSound('heart');lightPulse(actor.x,actor.z,emotions[mindMood].color,150);toast('오늘의 감정 이름만 다른 참가자에게 나눴어요. 개인 기록은 전송되지 않아요.');};
$('#mindWrite').onclick=()=>{const r=mindRecord();if(!r)return;
 state.topic='지금 내 마음 — '+emotions[r.mood].name;
 state.notes=[state.notes.trim(),`${r.day} / 나의 마음: ${emotions[r.mood].name}`,r.cause?'떠오르는 순간: '+r.cause:'',r.need?'내게 필요한 말: '+r.need:''].filter(Boolean).join('\n');persist();
 setStep(2);hideMindModal();openMobilePanel('write');setTab('write');toast('마음 기록을 나만의 글감으로 옮겼어요.');
};
$('#mindShuffle').onclick=()=>{mindPromptIndex=(mindPromptIndex+1+Math.floor(Math.random()*(mindQuestions.length-1)))%mindQuestions.length;$('#mindPrompt').textContent=mindQuestions[mindPromptIndex];playSound('spark')};
$('#mindUnknownWrite').onclick=()=>{state.topic='아직 이름 없는 마음';state.notes=[state.notes.trim(),mindQuestions[mindPromptIndex]].filter(Boolean).join('\n');persist();setStep(2);hideMindModal();openMobilePanel('write');setTab('write');toast('마음 질문이 나의 글감으로 옮겨졌어요.')};
function interact(){
 const choice=nearbyInteraction();
 if(!choice){toast('가구 가까이 가면 가능한 상호작용이 나타나요.');return}
 if(choice.type==='stand'){standUp();return}
 if(choice.type==='chair'){sit();return}
 if(choice.type==='snacks'){showSnackMenu();return}
 if(choice.type==='lounge'){useMindLounge(choice.spot);return}
 if(choice.type==='mind'){showMindModal();lightPulse(actor.x,actor.z,'#cbb8ed',155)}
}

function sendMove(){send({t:'move',x:actor.x,z:actor.z,rot:actor.rot,action:actor.action});const p=peers.get(state.me);if(p){p.x=actor.x;p.z=actor.z;p.rot=actor.rot;p.action=actor.action}}
const moveKeys=new Set(['w','a','s','d','arrowup','arrowleft','arrowright','arrowdown']);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#mindModal').classList.contains('hidden'))hideMindModal();else if(!$('#snackMenu').classList.contains('hidden'))hideSnackMenu();else if(bookState.open)closeBook();else document.activeElement?.blur();return}if(e.target.closest('input,textarea,button')||!state.connected)return;const k=e.key.toLowerCase();if(moveKeys.has(k)){e.preventDefault();activeKey.add(k);route=[];if(state.sitting||actor.action==='lie')standUp()}else if(k==='v'){toggleCam()}else if(k==='f'){interact()}else if(k==='e'){interact()}else if(k==='enter'){setTab('chat');$('#chatInput').focus()}});
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
function lightPulse(x,z,color='#ffe2a8',size=130){const pt=screenAt([x,1.8,z]);if(!pt)return;const el=document.createElement('div');el.className='lightPulse';el.style.left=pt[0]+'px';el.style.top=pt[1]+'px';el.style.setProperty('--pulse-color',color);el.style.setProperty('--pulse-size',size+'px');$('#fxlayer').append(el);setTimeout(()=>el.remove(),820)}
let lastLightPaint=0;function renderLightGlows(){const timestamp=performance.now();if(timestamp-lastLightPaint<65)return;lastLightPaint=timestamp;const layer=$('#lightlayer');if(!layer||!cam.matrix)return;const out=[];for(const l of worldLights){const pt=screenAt([l.x,l.y,l.z]);if(!pt)continue;const [sx,sy,w]=pt;if(sx<-120||sx>canvas.clientWidth+120||sy<-120||sy>canvas.clientHeight+120)continue;const dist=Math.hypot(cam.eye[0]-l.x,cam.eye[1]-l.y,cam.eye[2]-l.z);const size=Math.max(58,l.size*Math.min(1.75,8/Math.max(3,dist)));const alpha=(l.alpha||.2)*Math.max(.18,Math.min(1,.98-dist/24));out.push(`<div class="sceneGlow" style="left:${sx}px;top:${sy}px;--size:${size}px;--glow:${l.color};--alpha:${alpha}"></div>`)}layer.innerHTML=out.join('')}
function screenLabels(){if(!state.connected)return;const labels=[];for(const door of [{x:-5.6,z:-1.0,t:'☕ 다과룸'},{x:5.6,z:-1.0,t:'✧ 여섯 얼굴의 방'}]){
 if(Math.hypot(actor.x-door.x,actor.z-door.z)<8){const loc=screenAt([door.x,2.93,door.z]);if(loc&&loc[0]>20&&loc[0]<canvas.clientWidth-20&&loc[1]>90&&loc[1]<canvas.clientHeight-30)labels.push(`<div class="door-label" style="left:${loc[0]}px;top:${loc[1]}px">${door.t}</div>`)}}
 for(const p of peers.values()){if(p.id===state.me&&cam.first)continue;const x=p.id===state.me?actor.x:p.rx,z=p.id===state.me?actor.z:p.rz;const pt=screenAt([x,2.25,z]);if(!pt||pt[0]<-30||pt[0]>canvas.clientWidth+30||pt[1]<60||pt[1]>canvas.clientHeight)continue;const txt=p.bubble&&p.bubbleEnd>Date.now()?p.bubble:(p.id===state.me?'나 · '+p.name:p.name);labels.push(`<div class="world-label ${p.id===state.me?'me':''}" style="left:${pt[0]}px;top:${pt[1]}px">${escapeHtml(txt)}</div>`)}$('#worldlabels').innerHTML=labels.join('')}
let lastFrame=0,lastStepAt=0;
function frame(now){const dt=Math.min(.045,(now-lastFrame)/1000||.016);lastFrame=now;
 const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),dpr=Math.min(matchMedia('(max-width:700px)').matches?1.25:1.5,devicePixelRatio||1);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(gl)gl.viewport(0,0,canvas.width,canvas.height)}
 if(state.connected){const moving=move(dt);actor.moving=moving;if(moving&&now-lastStepAt>405){playFootstep();lastStepAt=now}if(moving&&now-lastNet>85){sendMove();lastNet=now}if(!moving&&now-lastNet>950){sendMove();lastNet=now}updateZone();}
 updateProximityHint();
 cameraUpdate(dt);
 if(gl){if(burstLight&&now<burstLight.end){const color=burstLight.kind==='heart'?[1,.38,.55]:burstLight.kind==='jelly'?[.93,.54,.94]:burstLight.kind==='tea'?[.68,1,.60]:[1,.84,.54];gl.uniform3f(uFxPos,burstLight.x,burstLight.y,burstLight.z);gl.uniform3fv(uFxColor,new Float32Array(color));gl.uniform1f(uFxPower,Math.max(0,(burstLight.end-now)/1000)*2.1);}else{gl.uniform1f(uFxPower,0);}gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);draw(staticBuffer,cam.matrix);if(state.connected){for(const p of peers.values()){if((cam.first||Math.hypot(cam.eye[0]-actor.x,cam.eye[2]-actor.z)<2.85)&&p.id===state.me)continue;
  if(p.id!==state.me){p.rx+=(p.x-p.rx)*Math.min(1,dt*11);p.rz+=(p.z-p.rz)*Math.min(1,dt*11);p.rr+=(p.rot-p.rr)*Math.min(1,dt*10)}
  const x=p.id===state.me?actor.x:p.rx,z=p.id===state.me?actor.z:p.rz,rot=p.id===state.me?actor.rot:p.rr;
  const isMe=p.id===state.me,action=(isMe?actor.action:p.action),isSitting=action==='sit',isLying=action==='lie';const isWalking=isMe?actor.moving:(p.moving&&now-p.lastMoved<280);const pose=isLying?5:isSitting?4:isWalking?1+(Math.floor(now/170)%3):0;const gender=(p.gender==='female'?'female':'male');const m=(avatars[gender][p.color]||avatars[gender][0])[pose],model=modelMat(x,isLying?.67:0,z,rot);draw(m,mul(cam.matrix,model),model)}
  for(const part of particles){part.life-=dt;part.x+=part.vx*dt;part.y+=part.vy*dt;part.z+=part.vz*dt;part.vy-=.7*dt;if(part.life>0)draw(particleMeshes[part.color],mul(cam.matrix,modelMat(part.x,part.y,part.z,0)),modelMat(part.x,part.y,part.z,0))}particles=particles.filter(p=>p.life>0);}
 }
 if(!gl && softCtx && state.connected){const players=[...peers.values()].map(p=>{const action=p.id===state.me?actor.action:p.action;return {self:p.id===state.me&&(cam.first||Math.hypot(cam.eye[0]-actor.x,cam.eye[2]-actor.z)<2.85),x:p.id===state.me?actor.x:p.rx,z:p.id===state.me?actor.z:p.rz,rot:p.id===state.me?actor.rot:p.rr,color:p.color,gender:p.gender,action,py:action==='lie'?.67:0,pose:(p.id===state.me?actor.moving:(p.moving&&now-p.lastMoved<280))?1+(Math.floor(now/170)%3):(action==='lie'?5:action==='sit'?4:0)}});drawSoftware(now,players,cam,particles)}
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

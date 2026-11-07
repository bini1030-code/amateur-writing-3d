'use strict';
// Small, server-authoritative animal companions. Everything is in process; no Supabase table changes.
const PET_DATA = Object.freeze([
  {id:'sani',name:'산이',species:'dog',x:-2.3,z:8.45,speed:.90},
  {id:'bori',name:'보리',species:'cat',x:2.10,z:-7.9,speed:.60},
  {id:'haetsal',name:'햇살이',species:'kitten',x:6.45,z:-2.25,speed:.80}
]);
const solids=[
 [-.25,5.0,9.25,3.8],...[-3.4,-1.5,.7,2.9].flatMap(x=>[[x,7.5,1,.96],[x,2.48,1,.96]]),
 [-5.4,4.4,.95,1],[4.85,4.5,.95,1],[-7.85,2.40,.62,2.27],
 [6.95,10.15,.95,.95],[-7.65,.25,.95,.95],[7.55,1.65,.92,.92],[-7.5,10.5,.8,.8],
 [-4.6,-9.15,7.95,1.45],[-4.5,-5.1,3.95,1.86],[-8.2,-2.7,.88,.88],[-4.45,-5.0,1.25,.82],
 ...Array.from({length:8},(_,i)=>[4.5+1.90*Math.cos(i*Math.PI/4),-5.42+1.90*Math.sin(i*Math.PI/4),.66,.66]),
 [7.61,-7.52,1.05,1.76],[8.24,-3.14,.62,2.27],[1,-3.75,.98,2.20],[.72,-7.6,.76,.76],[.72,-3,.76,.76]
];
function free(x,z){
 if(x<-8.37||x>8.37||z>11.35||z<-9.33)return false;
 if(z<-1.18&&x>-.40&&x<.40)return false;
 if(z>-1.32&&z<-.68&&!((x>-6.58&&x<-4.62)||(x>4.62&&x<6.58)))return false;
 if(x>.4&&z<-1.4&&Math.hypot(x-4.5,z+5.42)<.84)return false;
 for(const [cx,cz,w,h] of solids)if(Math.abs(x-cx)<w/2+.10&&Math.abs(z-cz)<h/2+.10)return false;
 return true;
}
const STEP=.36,MINX=-8.28,MINZ=-9.24,NX=47,NZ=58;
const nav=(i,j)=>i>=0&&j>=0&&i<NX&&j<NZ&&free(MINX+i*STEP,MINZ+j*STEP);
const xy=(i,j)=>({x:MINX+i*STEP,z:MINZ+j*STEP});
function nearestCell(x,z){
 const ix=Math.round((x-MINX)/STEP),iz=Math.round((z-MINZ)/STEP);
 for(let r=0;r<=11;r++){let best=null,d=Infinity;for(let i=ix-r;i<=ix+r;i++)for(let j=iz-r;j<=iz+r;j++){
  if(r&&i!==ix-r&&i!==ix+r&&j!==iz-r&&j!==iz+r)continue;
  if(!nav(i,j))continue;const p=xy(i,j),dd=Math.hypot(x-p.x,z-p.z);if(dd<d){d=dd;best=[i,j]}
 }if(best)return best}return null;
}
function segmentHitsRect(a,b,cx,cz,w,h,pad=.115){
  const x0=cx-w/2-pad,x1=cx+w/2+pad,z0=cz-h/2-pad,z1=cz+h/2+pad;
  const dx=b.x-a.x,dz=b.z-a.z;let t0=0,t1=1;
  for(const [p,q] of [[-dx,a.x-x0],[dx,x1-a.x],[-dz,a.z-z0],[dz,z1-a.z]]){
    if(Math.abs(p)<1e-10){if(q<0)return false;continue}
    const t=q/p;if(p<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);
    if(t0>t1)return false;
  }
  return true;
}
function clearSegment(a,b){
 // Detect even tangent collisions that sampling can miss around chair corners.
 if(!free(a.x,a.z)||!free(b.x,b.z))return false;
 for(const [cx,cz,w,h] of solids)if(segmentHitsRect(a,b,cx,cz,w,h))return false;
 // Refuse paths that cross the circular table.
 if(a.x>.4||b.x>.4){const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
  const t=den?Math.max(0,Math.min(1,((4.5-a.x)*dx+(-5.42-a.z)*dz)/den)):0;
  const qx=a.x+dx*t,qz=a.z+dz*t;
  if(Math.hypot(qx-4.5,qz+5.42)<.89&&qz<-1.4)return false;
 }
 // The room-partition geometry is broader than a few centimeters.
 const n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.035);
 for(let k=1;k<n;k++){
  const t=k/n;if(!free(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t))return false;
 }
 return true;
}
function route(a,b){
 if(!free(a.x,a.z))return [];
 let destination=b;if(!free(b.x,b.z)){const cell=nearestCell(b.x,b.z);if(!cell)return [];destination=xy(...cell)}
 if(clearSegment(a,destination))return [destination];
 const s=nearestCell(a.x,a.z),e=nearestCell(destination.x,destination.z);if(!s||!e)return [];
 const key=(i,j)=>i+j*NX,start=key(...s),goal=key(...e),dist=new Float32Array(NX*NZ).fill(Infinity),prev=new Int32Array(NX*NZ).fill(-1),used=new Uint8Array(NX*NZ),open=[start];
 dist[start]=0;let iterations=0;
 while(open.length&&++iterations<7000){
  let k=0,best=Infinity;for(let q=0;q<open.length;q++){const id=open[q],f=dist[id]+Math.hypot(id%NX-e[0],Math.floor(id/NX)-e[1]);if(f<best){best=f;k=q}}
  const curr=open.splice(k,1)[0];if(used[curr])continue;used[curr]=1;if(curr===goal)break;
  const i=curr%NX,j=Math.floor(curr/NX);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
   const ni=i+dx,nj=j+dz;if(!nav(ni,nj)||(dx&&dz&&(!nav(i+dx,j)||!nav(i,j+dz)))||!clearSegment(xy(i,j),xy(ni,nj)))continue;
   const nkey=key(ni,nj),v=dist[curr]+(dx&&dz?1.414:1);if(v<dist[nkey]){dist[nkey]=v;prev[nkey]=curr;open.push(nkey)}
  }
 }
 if(start!==goal&&prev[goal]===-1)return [];
 const steps=[];let cursor=goal;for(let n=0;n<400&&cursor!==start;n++){steps.unshift(xy(cursor%NX,Math.floor(cursor/NX)));cursor=prev[cursor];if(cursor<0)return []}
 if(clearSegment(steps.at(-1)||a,destination))steps.push(destination);
 // Straight-line smoothing: prevents grid-like animal gait and keeps segments obstacle-free.
 const smooth=[],all=[a,...steps];let at=0;while(at<all.length-1){let j=all.length-1;while(j>at+1&&!clearSegment(all[at],all[j]))j--;smooth.push(all[j]);at=j}
 return smooth;
}
const waypoints={
 sani:[[6.15,8.8],[-6.6,8.75],[-7.1,5.7],[6.6,5.8],[7.3,2.4],[-6.5,1.65],[-5.55,-2.15],[-7.35,-4.05],[-2.4,-3.15],[-2.5,-7.1],[-6.95,-7.6]],
 bori:[[2.1,-7.9],[4.1,-8.85],[6.1,-8.65],[2.05,-5.5],[7.25,-4.3],[5.6,-2.5],[6.2,1.5],[7.5,8.2]],
 haetsal:[[6.45,-2.25],[2.25,-2.5],[6.6,-4.0],[2.05,-5.65],[4.7,-8.82],[6.4,-8.75],[5.55,1.65],[6.55,5.8],[7.5,8.45]]
};
const validWaypoints=Object.fromEntries(Object.entries(waypoints).map(([id,pts])=>[id,pts.map(([x,z])=>({x,z})).filter(p=>free(p.x,p.z))]));
function makePets(){return PET_DATA.map(def=>({...def,rot:0,mode:'sit',path:[],until:Date.now()+1500,lastTick:Date.now(),nextThink:0,focusUntil:0}))}
function publicPets(room){return (room.pets||[]).map(p=>({id:p.id,name:p.name,species:p.species,x:+p.x.toFixed(3),z:+p.z.toFixed(3),rot:+p.rot.toFixed(3),mode:p.mode,until:p.until}))}
function pickRoam(p,now){
 if(Math.random()<.35){p.mode=['sit','lie','stretch','yawn'][Math.floor(Math.random()*4)];p.until=now+1800+Math.random()*4000;p.nextThink=p.until;return}
 const options=validWaypoints[p.id].filter(q=>Math.hypot(q.x-p.x,q.z-p.z)>1.1).sort(()=>Math.random()-.5);
 let path=[];for(const q of options.slice(0,5)){path=route(p,q);if(path.length)break}
 if(!path.length){p.mode='sit';p.nextThink=now+2000;return}
 p.path=path;p.mode=Math.random()<.2?'run':'walk';p.until=0;p.nextThink=now+6000;
}
function advance(p,now){
 const dt=Math.min(.25,Math.max(0,(now-p.lastTick)/1000));p.lastTick=now;
 if(p.until&&now<p.until)return;
 if(p.until&&now>=p.until){p.until=0;p.path=[];p.nextThink=now+400;}
 if(p.path.length){let left=dt*p.speed*(p.mode==='run'?1.75:1);
  while(p.path.length&&left>0){const target=p.path[0],dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);
   if(d<.035){p.path.shift();continue}
   p.rot=Math.atan2(dx,dz);
   if(d<=left){p.x=target.x;p.z=target.z;p.path.shift();left-=d}
   else{p.x+=dx/d*left;p.z+=dz/d*left;left=0}
  }
  if(!p.path.length){p.mode=p.focusUntil>now?'happy':'sit';p.until=now+(p.focusUntil>now?1200:600+Math.random()*1400);p.focusUntil=0}
 }else if(now>=p.nextThink)pickRoam(p,now);
}
function act(room,id,action,user){
 const p=room.pets?.find(p=>p.id===id);if(!p||!['pet','treat','call','play'].includes(action))return {error:'동물 또는 상호작용 종류를 찾지 못했습니다.'};
 const dist=Math.hypot(p.x-user.x,p.z-user.z);if(dist>2.7)return {error:`${p.name}와 거리가 멀어요. 조금 더 가까이 다가가 주세요. (${dist.toFixed(1)}m)`};
 const now=Date.now();p.path=[];p.until=0;p.nextThink=now+400;
 if(action==='pet'){p.mode=p.species==='dog'?'happy':'rub';p.until=now+1900;p.rot=Math.atan2(user.x-p.x,user.z-p.z)}
 if(action==='treat'){p.mode='eat';p.until=now+2600;p.rot=Math.atan2(user.x-p.x,user.z-p.z)}
 if(action==='call'){
  const d=Math.hypot(user.x-p.x,user.z-p.z),fraction=Math.max(0,(d-.65)/Math.max(d,.01));
  const target={x:p.x+(user.x-p.x)*fraction,z:p.z+(user.z-p.z)*fraction};const r=route(p,target);
  p.path=r;p.mode=r.length?(p.species==='dog'?'run':'walk'):'happy';p.until=r.length?0:now+1100;p.focusUntil=now+4300;
 }
 if(action==='play'){
  if(p.species==='dog'){
   const nearby=validWaypoints.sani.filter(q=>Math.hypot(q.x-p.x,q.z-p.z)<5&&Math.hypot(q.x-p.x,q.z-p.z)>1.3);
   const r=nearby.length?route(p,nearby[Math.floor(Math.random()*nearby.length)]):[];
   p.mode=r.length?'run':'happy';p.path=r;p.until=r.length?0:now+1800;p.focusUntil=now+4500;
  }else{p.mode='play';p.until=now+2600}
 }
 return {event:{t:'petEvent',petId:id,action,name:p.name,by:user.name,at:now,species:p.species},pet:p};
}
module.exports={makePets,publicPets,advance,act,free,route,validWaypoints};

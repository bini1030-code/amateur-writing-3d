// Hand-authored WebGL geometry, free perspective camera; no external rendering dependencies.
// Every mesh has actual xyz vertices, with depth testing, rotation and perspective projection.
const canvas=document.getElementById('world');
const gl=canvas.getContext('webgl',{antialias:true,alpha:false,depth:true});
const softCtx=gl?null:canvas.getContext('2d',{alpha:false});
if(!gl)console.info('WebGL unavailable; using perspective 3D software renderer.');
let rendererReady=!!gl;
const vert=`attribute vec3 aPos;attribute vec3 aColor;uniform mat4 uMatrix;uniform mat4 uModel;varying vec3 vBase;varying vec3 vWorld;varying float vFog;void main(){vec4 pos=uModel*vec4(aPos,1.);vWorld=pos.xyz;vec4 clip=uMatrix*vec4(aPos,1.);gl_Position=clip;vBase=aColor;vFog=clamp((clip.z/clip.w-.66)*.18,0.,.12);}`;
const frag=`precision mediump float;varying vec3 vBase;varying vec3 vWorld;varying float vFog;uniform float uAmbient;uniform vec3 uFxPos;uniform vec3 uFxColor;uniform float uFxPower;
vec3 lamp(vec3 pos,vec3 color,float intensity,float decay){vec3 d=vWorld-pos;return color*(intensity/(1.+dot(d,d)*decay));}
void main(){
 vec3 light=vec3(.95,.96,1.08)*uAmbient;
 light+=lamp(vec3(0.,3.05,5.0),vec3(1.0,.77,.49),1.15,.12);
 light+=lamp(vec3(-2.5,3.0,6.3),vec3(1.0,.82,.59),.67,.19);
 light+=lamp(vec3(2.7,3.0,4.6),vec3(1.0,.76,.47),.66,.19);
 light+=lamp(vec3(-4.5,3.10,-5.2),vec3(1.0,.71,.44),1.75,.14);
 light+=lamp(vec3(4.55,2.85,-5.45),vec3(.63,.64,1.0),1.85,.14);
 light+=lamp(vec3(6.9,3.1,10.1),vec3(1.0,.73,.52),1.0,.17);
 vec3 fxD=vWorld-uFxPos;light+=uFxColor*(uFxPower/(1.+dot(fxD,fxD)*.48));
 vec3 c=clamp(vBase*light,0.,1.0);
 gl_FragColor=vec4(mix(c,vec3(.055,.075,.108),vFog),1.);
}`;
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
let aPos,aColor,uMatrix,uAmbient,uModel,uFxPos,uFxColor,uFxPower;const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
if(gl){const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vert));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,frag));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);aPos=gl.getAttribLocation(program,'aPos');aColor=gl.getAttribLocation(program,'aColor');uMatrix=gl.getUniformLocation(program,'uMatrix');uModel=gl.getUniformLocation(program,'uModel');uAmbient=gl.getUniformLocation(program,'uAmbient');uFxPos=gl.getUniformLocation(program,'uFxPos');uFxColor=gl.getUniformLocation(program,'uFxColor');uFxPower=gl.getUniformLocation(program,'uFxPower');gl.uniformMatrix4fv(uModel,false,identity);gl.uniform3f(uFxPos,0,-50,0);gl.uniform3f(uFxColor,1,.8,.6);gl.uniform1f(uFxPower,0);gl.enableVertexAttribArray(aPos);gl.enableVertexAttribArray(aColor);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(.14,.16,.20,1);gl.uniform1f(uAmbient,.39);}
function mul(a,b){let r=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)r[j*4+i]+=a[k*4+i]*b[j*4+k];return r}
function persp(fov,aspect,near,far){let f=1/Math.tan(fov/2);let a=new Float32Array(16);a[0]=f/aspect;a[5]=f;a[10]=(far+near)/(near-far);a[11]=-1;a[14]=2*far*near/(near-far);return a}
function norm(a){let l=Math.hypot(...a)||1;return a.map(v=>v/l)}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function lookAt(e,c){let z=norm([e[0]-c[0],e[1]-c[1],e[2]-c[2]]),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]),1])}
function modelMat(x,y,z,rot){let c=Math.cos(rot||0),s=Math.sin(rot||0);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,x,y,z,1])}
function rgb(hex){let h=hex.replace('#','');let n=parseInt(h,16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}
function tint(c,f){return c.map(v=>Math.min(1,v*f))}
class Mesh{constructor(){this.data=[]}tri(a,b,c,color){for(const v of [a,b,c])this.data.push(v[0],v[1],v[2],...color)}triSmooth(a,b,c,ca,cb,cc){for(const [v,col] of [[a,ca],[b,cb],[c,cc]])this.data.push(v[0],v[1],v[2],...col)}quadSmooth(a,b,c,d,ca,cb,cc,cd){this.triSmooth(a,b,c,ca,cb,cc);this.triSmooth(a,c,d,ca,cc,cd)}quad(a,b,c,d,col){this.tri(a,b,c,col);this.tri(a,c,d,col)}box(x,y,z,w,h,d,hex,rot=0){let c=rgb(hex),a=w/2,b=h/2,k=d/2,si=Math.sin(rot),co=Math.cos(rot);let local=[[-a,-b,-k],[a,-b,-k],[a,b,-k],[-a,b,-k],[-a,-b,k],[a,-b,k],[a,b,k],[-a,b,k]];let v=local.map(p=>[x+p[0]*co+p[2]*si,y+p[1],z-p[0]*si+p[2]*co]);const faces=[[0,1,2,3,.69],[5,4,7,6,.96],[4,0,3,7,.79],[1,5,6,2,.82],[3,2,6,7,1.13],[4,5,1,0,.60]];faces.forEach(f=>this.quad(v[f[0]],v[f[1]],v[f[2]],v[f[3]],tint(c,f[4])))}
 sphere(x,y,z,r,hex,segments=10,rings=7){let c=rgb(hex);for(let j=0;j<rings;j++){let v0=-Math.PI/2+j*Math.PI/rings,v1=-Math.PI/2+(j+1)*Math.PI/rings;for(let i=0;i<segments;i++){let u0=i*2*Math.PI/segments,u1=(i+1)*2*Math.PI/segments;let p=(u,v)=>[x+r*Math.cos(v)*Math.cos(u),y+r*Math.sin(v),z+r*Math.cos(v)*Math.sin(u)];let shade=tint(c,.85+.19*Math.cos(v1));this.quad(p(u0,v0),p(u1,v0),p(u1,v1),p(u0,v1),shade)}}}
 cylinder(x,y,z,r,h,hex,segments=12){let c=rgb(hex);for(let i=0;i<segments;i++){let a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;let p=(u,j)=>[x+Math.cos(u)*r,y+(j? h/2:-h/2),z+Math.sin(u)*r];this.quad(p(a,0),p(b,0),p(b,1),p(a,1),tint(c,.75+.27*Math.sin(a+1)));this.tri([x,y+h/2,z],p(a,1),p(b,1),tint(c,1.07))}}
 ellipsoid(x,y,z,rx,ry,rz,hex,segments=14,rings=10){
  // Per-vertex color interpolation: adjacent polygons share the SAME color at their shared edges.
  // This removes the old polygon-by-polygon tint bands from faces, hair and clothes.
  const base=rgb(hex), pt=(u,v)=>[x+rx*Math.cos(v)*Math.cos(u),y+ry*Math.sin(v),z+rz*Math.cos(v)*Math.sin(u)];
  const shade=(u,v)=>tint(base,.95+.085*Math.cos(v)*Math.cos(u-.7)+.045*Math.sin(v));
  for(let j=0;j<rings;j++){const v0=-Math.PI/2+j*Math.PI/rings,v1=-Math.PI/2+(j+1)*Math.PI/rings;
   for(let i=0;i<segments;i++){const u0=i*2*Math.PI/segments,u1=(i+1)*2*Math.PI/segments;
    this.quadSmooth(pt(u0,v0),pt(u1,v0),pt(u1,v1),pt(u0,v1),shade(u0,v0),shade(u1,v0),shade(u1,v1),shade(u0,v1));}}
 }

 limb(a,b,r,hex,segments=10){
  const axis=norm([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
  const guide=Math.abs(axis[1])>.91?[1,0,0]:[0,1,0];const side=norm(cross(axis,guide)),other=cross(side,axis),col=rgb(hex);
  const circle=(point,u)=>point.map((v,i)=>v+r*(Math.cos(u)*side[i]+Math.sin(u)*other[i]));
  for(let i=0;i<segments;i++){const t=i*Math.PI*2/segments,n=(i+1)*Math.PI*2/segments;
   this.quad(circle(a,t),circle(a,n),circle(b,n),circle(b,t),tint(col,.85+.17*Math.cos(t-.7)))}
  this.ellipsoid(...a,r,r,r,hex,9,6);this.ellipsoid(...b,r,r,r,hex,9,6);
 }
 cone(x,y,z,r,h,hex,segments=10){let c=rgb(hex);for(let i=0;i<segments;i++){let a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;this.tri([x,y+h/2,z],[x+Math.cos(a)*r,y-h/2,z+Math.sin(a)*r],[x+Math.cos(b)*r,y-h/2,z+Math.sin(b)*r],tint(c,.85+.12*Math.sin(a)))}}
}
const world=new Mesh();const B=(...p)=>world.box(...p),S=(...p)=>world.sphere(...p),C=(...p)=>world.cylinder(...p),cone=(...p)=>world.cone(...p);
// Floor and board seams
B(0,-.16,5.6,18,.3,13.4,'#b49a7c');B(-4.5,-.16,-5.5,9,.3,9,'#866852');B(4.5,-.16,-5.5,9,.3,9,'#352f4f');
for(let z=-.7;z<12.4;z+=.53){B(0,.004,z,17.9,.009,.014,'#897259');for(let x=-8.8;x<9;x+=3.5)B(x,.008,z+(.53/2),.018,.012,.53,'#a88968')}
for(let z=-9.7;z<-1.1;z+=.53)B(-4.5,.006,z,8.88,.015,.014,'#604e43');
for(let z=-9.75;z<-1.2;z+=.62)B(4.5,.009,z,8.95,.006,.016,'#463b65');for(let x=.35;x<9;x+=.62)B(x,.012,-5.5,.016,.006,8.75,'#463b65');
// Warm cream walls, 2 doors in back partition
const wall='#d7c4a7'; // open roof for bird's-eye third-person camera
// upper ceiling layer drawn high and visible from below; no roof panel to preserve top-down view
// Cover roof box? use narrow beams instead of slab in real-time mesh: previous ceiling omitted by replacing geometry following line handled by geometry?? (above panel is high, at y4.22, opaque, camera is above roof and may hide scene) 
B(-9,1.9,5.5,.21,3.8,13.2,wall);B(9,1.9,5.5,.21,3.8,13.2,wall);
// Front wall left open, dollhouse style, so the writing table is fully visible.
B(-7.95,1.9,-1,2.1,3.8,.22,wall);B(-.02,1.9,-1,9.02,3.8,.22,wall);B(7.95,1.9,-1,2.1,3.8,.22,wall);
// Above and frame door openings
for(const x of [-5.6,5.6]){B(x,3.4,-1,2.5,.85,.22,'#d7c4a7');B(x-1.22,1.7,-.84,.14,3.4,.23,'#9f7655');B(x+1.22,1.7,-.84,.14,3.4,.23,'#9f7655');B(x,3.13,-.84,2.5,.12,.25,'#9f7655')}
// Tea back room and WC exterior
B(-9,1.9,-5.5,.22,3.8,9.1,'#cdb9a3');B(9,1.9,-5.5,.22,3.8,9.1,'#514568');B(-4.5,1.9,-10,9,3.8,.22,'#bca38c');B(4.5,1.9,-10,9,3.8,.22,'#473d60');B(0,1.9,-5.5,.2,3.8,9,'#69586e');
// baseboards
for(let z of [12,-1,-10]){B(-8.5,.11,z,1,.22,.08,'#856952');B(1,.11,z,1,.22,.08,'#856952')}
// Right wall windows, dark exterior glass panels and warm frames
for(const z of [3.65,6.55,9.45]){B(8.87,2.25,z,.035,2.18,2.5,'#30434a');B(8.82,3.40,z,.12,.09,2.68,'#806b57');B(8.82,1.12,z,.12,.09,2.68,'#806b57');B(8.82,2.25,z,.12,2.3,.08,'#806b57');B(8.80,2.26,z,.07,.09,2.52,'#806b57');for(let t=0;t<4;t++)S(8.83,2.7+(t%2)*.6,z-.8+Math.floor(t/2)*1.5,.045,'#fbecc5',6,5)}
// Oak rug, soft sections
B(-.15,.014,5.2,10.9,.023,6.4,'#c4b3a0');B(-.15,.036,5.2,10.25,.02,5.85,'#d8cbbb');
// Main desks: 2 broad meeting tables and center seam
B(-.25,.83,5.0,9.0,.19,3.55,'#f4eade');B(-.25,.94,5,8.65,.025,3.27,'#fff8ef');
for(let x of [-4.0,3.5])for(let z of [3.65,6.38])B(x,.43,z,.16,.79,.17,'#ae8f72');B(-.25,.43,5,7.5,.08,.13,'#ad8d6c');
// chairs with back rest
function chair(x,z,rot=0,seat='#90705c'){const c=Math.cos(rot),s=Math.sin(rot);let p=(dx,dz)=>[x+dx*c+dz*s,z-dx*s+dz*c];let [sx,sz]=p(0,0);B(sx,.46,sz,.85,.12,.8,seat,rot);let [bx,bz]=p(0,-.36);B(bx,1.05,bz,.85,1.05,.12,seat,rot);for(let dx of [-.31,.31])for(let dz of [-.28,.28]){let [lx,lz]=p(dx,dz);B(lx,.22,lz,.075,.48,.075,'#5e4e45')}}
for(const x of [-3.4,-1.5,.7,2.9]){chair(x,7.5,Math.PI,x===-.3?'#a78062':'#a58b7a');chair(x,2.48,0,['#5d7b79','#b88b67','#6e666a','#9d756a'][Math.floor((x+4)*.7)%4]||'#a58b7a')}
chair(-5.4,4.4,Math.PI/2,'#b8997b');chair(4.85,4.5,-Math.PI/2,'#6d7e72');
// Table decorations: paper stacks, notebooks, pencils and snacks
for(let i=0;i<11;i++){let x=-3.55+(i%6)*1.34,z=i<6?4.05:5.95;B(x,.98,z,.78,.018,.54,i%2?'#e0d5be':'#f9f4e8',i%3*.08);B(x+.17,1.002,z,.32,.012,.017,i%3?'#7a9da0':'#b77770',-.22);B(x-.23,.996,z+.19,.05,.02,.05,'#b58e49')}
for(const [x,z] of [[-1.2,5],[-3.1,5.2],[2.6,5.15]]){C(x,1.07,z,.16,.25,'#ebded0');C(x+.17,1.05,z,.075,.09,'#ae8870')}
B(-.2,.995,5,1.15,.07,.48,'#af8e65');for(let i=0;i<5;i++){B(-.66+i*.22,1.085,5,.055,.2,.055,'#dfbd64');S(-.66+i*.22,1.195,5,.038,'#b68a56',6,4)}
// Foliage behind desk and picture frame
function plant(x,z,size=1){C(x,.31*size,z,.38*size,.62*size,'#936c4e');C(x,.62*size,z,.24*size,.1*size,'#745741');for(let i=0;i<7;i++){let a=i*2*Math.PI/7;let off=.2+.4*(i%3)/2;S(x+Math.cos(a)*off*size,(.95+(i%3)*.24)*size,z+Math.sin(a)*off*size,.29*size,i%2?'#52795e':'#72916c',8,6)}}
plant(-7.65,.25,1.2);plant(7.55,1.65,1.08);plant(-7.5,10.5,.75);
// TV panel on center back wall (screen glows with decorative text shapes)
B(0,2.25,-.80,4.25,2.42,.12,'#2b2b35');B(0,2.25,-.725,4.00,2.17,.08,'#344950');B(-.5,2.5,-.674,2.3,.11,.03,'#d3b99a');B(-.6,2.24,-.674,1.8,.065,.03,'#a4beb4');B(-.55,1.94,-.674,1.9,.05,.03,'#d3b99a');S(1.25,2.34,-.63,.44,'#e2c59b',11,8);
// Warm standing lamp
B(6.95,.05,10.15,.62,.09,.62,'#716151');C(6.95,1.75,10.15,.035,3.4,'#624d3e');cone(6.95,3.2,10.15,.48,.85,'#fff1c7');S(6.95,2.95,10.15,.15,'#ffdc8d',10,6);
// Pendant lamps over meeting table - no ceiling slab over view
for(const x of [-2,1.7]){C(x,3.75,5.1,.019,.85,'#634d42');cone(x,3.15,5.1,.57,.55,'#d5ae7e');S(x,2.83,5.1,.18,'#ffe3a1',12,6)}
// Ceiling decoration as rails along side, no solid roof to see interiors
for(const x of [-8.7,8.7])B(x,4.04,5.5,.22,.15,13,'#76584d');
// Seats are intentionally empty: only connected humans appear as avatars.
// Tea room: an entirely standing-only snack bar. No chairs or sitting props.
B(-4.5,.027,-5.4,6.7,.03,6.2,'#9c7d67');B(-4.5,.05,-5.4,6.28,.012,5.83,'#bba08b');
// Rounded-looking standing counter: taller, narrower than the old seated table.
B(-4.5,.67,-5.1,3.60,1.34,1.43,'#9a7254');B(-4.5,1.38,-5.1,3.85,.12,1.66,'#ead4b7');
for(const x of [-5.85,-3.15])for(const z of [-5.56,-4.64])B(x,.28,z,.14,.48,.15,'#735948');
// Serving area: tea on the left, cookies in the middle, colorful jellies on the right.
function cookie(x,y,z,r=.13){world.ellipsoid(x,y,z,r,.062,r,'#ca9860',14,7);for(const [dx,dz] of [[-.047,-.035],[.042,.029],[.012,-.055]])S(x+dx,y+.057,z+dz,.017,'#715044',8,5)}
C(-5.70,1.51,-5.07,.31,.06,'#fff6e7');C(-5.96,1.57,-5.07,.13,.18,'#f4e7d6');C(-5.87,1.68,-5.07,.09,.012,'#ad795d');S(-5.75,1.64,-5.07,.043,'#e7d4bb',9,6);
C(-4.54,1.51,-5.07,.52,.07,'#f7eee5');for(const [dx,dz] of [[-.23,0],[.02,.09],[.25,-.045]])cookie(-4.54+dx,1.60,-5.07+dz,.145);
C(-3.32,1.49,-5.08,.46,.07,'#f8efe0');for(const [dx,dz,c] of [[-.18,0,'#e99ab1'],[.1,.11,'#e9c76b'],[.20,-.12,'#b5cfac'],[-.08,-.16,'#bdb2d7']])world.ellipsoid(-3.32+dx,1.62,-5.08+dz,.12,.115,.108,c,12,9);
// Floor standing markers are flat mats, not seats.
for(const x of [-5.75,-4.48,-3.2]){B(x,.062,-3.70,.55,.014,.36,'#e1c7aa');B(x,.075,-3.70,.40,.005,.025,'#c39f79');}

// counter against back wall
B(-4.6,.57,-9.15,7.6,1.15,1.2,'#b8a188');B(-4.6,1.21,-9.15,7.8,.13,1.35,'#e4d0b3');for(const x of [-7,-4.2,-1.6])B(x,.56,-8.49,.045,.85,.055,'#816b55');
for(const y of [2.0,2.65]){B(-4.6,y,-9.77,7.3,.12,.45,'#755d4f');for(let i=0;i<9;i++){let x=-7.85+i*.79;B(x,y+.26,-9.72,.12+i%3*.04,.39+i%3*.09,.3,i%3?'#c99c64':'#8a867b')}}
for(let i=0;i<4;i++)C(-6.8+i*.38,1.43,-9.08,.16,.24,['#e6d0aa','#a9c5ba','#e3baaa','#b7a0a3'][i]);
C(-3.9,1.34,-9.1,.44,.36,'#d8c0a7');S(-3.9,1.69,-9.1,.23,'#ecdabb',10,6);C(-2.5,1.45,-9.1,.17,.33,'#a07c65');
B(-4.45,1.3,-5.0,1.1,.06,.65,'#eee2ce');C(-4.5,1.47,-5,.14,.25,'#f6ede2');C(-4.1,1.47,-5.25,.14,.25,'#e5d4be');
plant(-8.2,-2.7,.9);B(-7.15,2.1,-.76,.88,.9,.09,'#826953');
// V14 refreshed six-faces psychology room: upgraded with clearer real 3D lounge props.
B(4.5,.035,-5.48,7.65,.045,7.3,'#3c365b');
C(4.5,.072,-5.47,3.0,.055,'#534568',30);C(4.5,.10,-5.47,2.58,.016,'#6e597c',30);
C(4.5,.128,-5.47,1.60,.015,'#b58d84',30);C(4.5,.14,-5.47,1.47,.018,'#463854',30);
// Activity table: this is the only place where the “내 마음 알아보기/몰라보기” interaction will open.
C(4.5,.52,-5.47,.86,.90,'#65556b',18);C(4.5,.98,-5.47,1.02,.10,'#b89a8d',24);
B(4.5,1.06,-5.47,.78,.042,.54,'#efe4d2',-.10);B(4.5,1.09,-5.47,.34,.012,.018,'#af8a75',-.10);
const moods3D=[['#e9bb7a',1.12],['#80a4cd',2.45],['#d58b8e',3.78],['#a798d2',5.10],['#9ebfa5',6.43],['#d7b978',7.76]];
for(let idx=0;idx<moods3D.length;idx++){
 const [tintColor,x]=moods3D[idx];
 B(x,2.36,-9.76,.87,1.03,.10,'#806b85');B(x,2.36,-9.68,.71,.88,.065,'#292a40');
 S(x,2.37,-9.58,.315,tintColor,15,10);
 S(x-.103,2.42,-9.29,.023,'#333044',8,6);S(x+.103,2.42,-9.29,.023,'#333044',8,6);
 B(x,2.285+(idx===2?-.025:0),-9.27,.132,.021,.020,'#524051');
 B(x,1.66,-9.68,.44,.055,.12,'#d9b7b4');
}
for(const x of [1.0,3.2,5.4,7.6]){C(x,3.54,-9.48,.03,.42,'#a588a0');S(x,3.30,-9.46,.12,'#f4d6df',9,6)}
for(const z of [-3.2,-5.6,-7.8]){B(8.75,1.9,z,.10,2.6,1.32,'#554768');B(8.67,2.24,z,.11,1.2,.67,'#817399');S(8.58,2.73,z,.13,'#d9c9ef',9,6)}
B(1.0,.78,-3.75,.53,1.24,1.8,'#67556c');B(1.0,1.47,-3.75,.81,.10,2.05,'#9c8397');
for(const z of [-7.6,-3.0]){C(.72,.35,z,.28,.55,'#756070');for(let i=0;i<5;i++)S(.72+Math.cos(i*1.25)*.22,.87+(i%2)*.18,z+Math.sin(i*1.25)*.23,.20,'#69877b',8,6)}
// Actual beanbag silhouettes: overlapping padded lobes instead of cylinders.
function beanbag(x,z,color,highlight){
 world.ellipsoid(x,.30,z,.64,.30,.59,color,32,22);
 world.ellipsoid(x,.50,z-.28,.51,.48,.32,color,32,22);
 world.ellipsoid(x,.34,z+.16,.52,.16,.36,highlight,28,20);
 world.ellipsoid(x,.53,z-.13,.43,.16,.27,highlight,24,16);
}
beanbag(2.35,-7.05,'#ac8b9d','#c19fae');beanbag(6.10,-7.05,'#9cad9d','#b7c4b6');
// V14: visible hammock with two wooden A-frame supports, rope stays and sagging fabric.
const hx=7.29,hz1=-4.25,hz2=-6.55,endsY=1.65;
for(const z of [hz1,hz2]){
 world.limb([6.94,.12,z],[7.23,2.05,z],.069,'#886958',12);
 world.limb([7.76,.12,z],[7.43,2.05,z],.069,'#886958',12);
 world.limb([6.86,.10,z],[7.82,.10,z],.042,'#745847',10);
 world.limb([7.23,2.05,z],[7.43,2.05,z],.050,'#a88a70',12);
}
for(let i=0;i<32;i++)for(let j=0;j<10;j++){
 const point=(t,u)=>{
   const z=hz1+(hz2-hz1)*t;
   const x=hx+(u-.5)*1.06;
   const y=endsY-.70*Math.sin(Math.PI*t)+.19*Math.pow(Math.abs(u-.5)*2,1.7);
   return [x,y,z];
 };
 const a=i/32,b=(i+1)/32,u=j/10,v=(j+1)/10;
 const col=rgb(j%3===0?'#d4c3d4':j%3===1?'#e6d9cb':'#cbb5cb');
 world.quadSmooth(point(a,u),point(b,u),point(b,v),point(a,v),col,col,col,col);
}
for(const z of [hz1,hz2])for(const side of [-1,1]){
 world.limb([hx+side*.13,2.03,z],[hx+side*.52,endsY+.19,z],.016,'#dfcdb6',8);
}
// Side rug so the lounge reads as a distinct rest zone.
C(5.55,.015,-6.35,3.25,.025,'#7e677f',30);

// V3 bespoke interior details: in-world art, book spines, warm fixtures, layered textiles.
function picture(x,y,z,w,h,frame,inside){B(x,y,z,w+.13,h+.13,.065,frame);B(x,y,z+.039,w,h,.018,inside)}
// Main room: framed prints, shelves, stationery and layered cushions.
picture(-6.65,2.25,-.78,1.1,.8,'#8d6a58','#b6b2a1');
for(let j=0;j<3;j++){B(-7.85,1.45+j*.68,2.4,.44,.085,2.25,'#846b51');for(let k=0;k<8;k++){
 const zz=1.45+k*.245;B(-7.78,1.68+j*.68,zz,.13,.29,.14,['#9ca9a0','#9b726d','#bdaf98','#7b8c91'][k%4]);}}
for(const [x,z] of [[-3.4,7.55],[-1.5,7.55],[.7,7.55],[2.9,7.55],[-3.4,2.5],[-1.5,2.5],[.7,2.5],[2.9,2.5]]){
 B(x,.56,z,.71,.095,.69,'#d3b59b');B(x,.61,z,.6,.017,.58,'#e6cdb7');}
for(const [x,z] of [[-2.9,3.98],[-.6,4.0],[1.7,4.05],[-2.6,6.0],[.2,6.05],[2.45,6.0]]){
 B(x,.992,z,.86,.02,.62,'#f6f1e6',-.08);B(x-.29,1.005,z+.12,.22,.007,.015,'#b0a7a0');
 B(x-.26,1.006,z+.03,.26,.007,.012,'#b0a7a0');B(x+.31,1.01,z-.08,.018,.022,.42,'#a7865b',.35);
}
// Hanging decorative strands along the side wall.
for(let i=0;i<13;i++){const z=.7+i*.79;S(-8.75,3.74,z,.065,i%2?'#e5c08f':'#ffe4b5',8,5);}
// Tea room: softly lit pastry counter and bowls, books, pottery and wall tapestry.
picture(-3.9,2.55,-9.7,1.9,.81,'#83685a','#9faca1');
for(let i=0;i<4;i++){const xx=-5.25+i*.50;C(xx,1.35,-9.05,.19,.12,'#f4eee5');S(xx,1.47,-9.05,.13,['#d1a579','#ceb79b','#c69a7f','#a98975'][i],10,6)}
for(let i=0;i<7;i++){const xx=-7.5+i*.68;B(xx,2.28,-9.67,.28,.25,.17,['#f5e2c3','#cdbba3','#778e79','#a88b78'][i%4]);}
// Tea table snacks are rendered above the standing counter at y=1.4 and stay clear of the walking path.
for(const [xx,zz] of [[-4.45,-5.15],[-5.2,-5.12]])C(xx,1.51,zz,.11,.075,'#f8ecdf');
for(const z of [-6.9,-5.4,-3.9]){B(-8.76,2.75,z,.1,.08,1.12,'#9c7862');S(-8.73,2.63,z,.21,'#e6ce9e',9,6)}
B(-4.5,.08,-3.5,3.9,.018,.06,'#d8c7ad');B(-4.5,.08,-7.3,3.9,.018,.06,'#d8c7ad');
// Six-faces room: more subdued wall trim and small glowing lanterns.
for(const x of [1.12,2.45,3.78,5.10,6.43,7.76]){B(x,.12,-9.30,.52,.08,.55,'#796783');C(x,1.29,-9.43,.023,1.88,'#72617d')}
for(const z of [-2.7,-4.5,-6.3,-8.1]){S(8.72,3.26,z,.10,'#e2d3f4',8,6)}
// Doorway thresholds + lights to indicate passage; thresholds never form collision geometry.
for(const x of [-5.6,5.6]){B(x,.018,-1,2.2,.016,.37,'#b89474');B(x,3.52,-1,.94,.13,.18,'#f6e8ce');
 S(x,3.20,-.9,.14,'#ffe6ab',12,7)}

// V8 additional visible light fixtures and star ornaments to give the room more depth.
function hangingLamp(x,z,drop=2.9){C(x,3.85,z,.022,.9,'#7e6757');C(x,drop,z,.24,.18,'#f7ecda');S(x,drop+.12,z,.16,'#ffe7b4',10,7)}
for(const [x,z] of [[-2.6,4.9],[0,4.9],[2.6,4.9],[-2.4,6.4],[0,6.4],[2.4,6.4]])hangingLamp(x,z,2.95);
for(let i=0;i<10;i++){const x=-7.2+i*1.6,z=1.1+Math.sin(i*.55)*.4;C(x,3.68,z,.018,.18,'#6f5a4f');S(x,3.57,z,.075,i%2?'#ffe8b6':'#fff2d0',8,6)}
for(const [x,z] of [[-7.1,-6.9],[-5.2,-6.25],[-3.2,-7.1],[-1.8,-6.35],[4.5,-5.4]]){C(x,3.75,z,.016,.24,'#705c52');S(x,3.58,z,.07,'#ffe5a8',8,6)}
for(const [x,z] of [[-7.45,9.6],[-6.8,10.25],[-6.1,9.85],[6.3,9.9],[7.0,10.35],[7.6,9.7]]){S(x,3.45,z,.08,'#fff0c8',8,6);S(x,3.45,z,.04,'#ffe1a0',6,5)}

function createBuffer(mesh){const array=new Float32Array(mesh.data);if(!gl)return {buf:null,count:0};let buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);return {buf,count:array.length/6}}
const staticBuffer=createBuffer(world);
function draw(mesh,mvp,model=identity){if(!gl)return;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buf);gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(aColor,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(uMatrix,false,mvp);gl.uniformMatrix4fv(uModel,false,model);gl.drawArrays(gl.TRIANGLES,0,mesh.count)}
const coatColors=['#b98e73','#7b9b8d','#839bb8','#b49ac8','#c8a56b','#cd8f92'];
const skinTones=['#f1cfb3','#f2d2bb','#edc9b0','#f4d0bd','#e3bba3','#ecc7b2'];
const hairTones=['#49382f','#40352f','#392e2e','#4d382f','#3a3136','#4a3834'];
const pantsColors=['#594638','#5b4b44','#51484b','#645048','#574638','#604a45'];
function avatarShade(hex,f=1){const c=rgb(hex).map(v=>Math.min(1,v*f));return '#'+c.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}
function smoothLoft(mesh,rings,hex,segments=20){
 const base=rgb(hex),point=(u,r)=>[r.x+Math.cos(u)*r.rx,r.y,r.z+Math.sin(u)*r.rz];
 const col=(u,r)=>tint(base,.91+.085*Math.cos(u-.85)+.035*(r.y-.9));
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){
  const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments,r0=rings[j],r1=rings[j+1];
  mesh.quadSmooth(point(a,r0),point(b,r0),point(b,r1),point(a,r1),col(a,r0),col(b,r0),col(b,r1),col(a,r1));
 }
}
function singleHairShell(mesh,hy,gender,hex,zOffset=0){
  const male=gender==='male',base=rgb(hex),seg=32;
  const rings=male?[
    {y:.255,rx:.025,rz:.025},{y:.215,rx:.132,rz:.12},
    {y:.12,rx:.191,rz:.184},{y:.045,rx:.195,rz:.187},
    {y:-.065,rx:.171,rz:.161}
  ]:[
    {y:.27,rx:.027,rz:.029},{y:.218,rx:.143,rz:.135},
    {y:.125,rx:.207,rz:.194},{y:.015,rx:.228,rz:.214},
    {y:-.17,rx:.214,rz:.201}
  ];
  function point(u,i){
    const r=rings[i],front=Math.max(0,Math.sin(u)),side=Math.pow(Math.abs(Math.cos(u)),1.1);
    const yoff=i===rings.length-1? (male ? .16*front+.055*side : .29*front+.015*side):0;
    const rx=r.rx*(1+(male?0:.028*Math.sin(2*u+.4))),rz=r.rz;
    return [Math.cos(u)*rx,hy+r.y+yoff,zOffset+Math.sin(u)*rz];
  }
  function shade(u,i){return tint(base,.88+.10*Math.cos(u-.42)+.025*i/rings.length)}
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<seg;i++){
    const u=i*2*Math.PI/seg,v=(i+1)*2*Math.PI/seg;
    mesh.quadSmooth(point(u,j),point(v,j),point(v,j+1),point(u,j+1),shade(u,j),shade(v,j),shade(v,j+1),shade(u,j+1));
  }
}
function makeAvatar(color,pose=0,gender='male'){
 const m=new Mesh(),male=gender==='male',walking=pose>=1&&pose<=3,sitting=pose===4,lying=pose===5;
 const stride=pose===1?1:pose===3?-1:0,down=sitting?-.28:lying?-.72:0;
 const wool=coatColors[color]||coatColors[0],darkWool=avatarShade(wool,.88);
 const skin=skinTones[color]||skinTones[0],hair=hairTones[color]||hairTones[0],pants=male?(pantsColors[color]||pantsColors[0]):'#f1cdb8';
 const ell=(...args)=>m.ellipsoid(...args);
 if(lying){
   // True supine pose: body faces upward (+Y), head toward +Z, feet toward -Z.
   // The elbows bend outward and the hands support the back of the head.
   const pantsColor=male?(pantsColors[color]||pantsColors[0]):'#ead5c7';
   ell(0,.36,0,.238,.115,.48,wool,30,20); // back and knit body
   ell(0,.43,.27,.21,.10,.23,wool,28,18); // shoulders / upper chest
   ell(0,.40,-.33,.198,.105,.18,pantsColor,26,18); // hips
   for(const side of [-1,1]){
     const legX=side*.105;
     ell(legX,.35,-.62,.082,.087,.29,pantsColor,24,16);
     ell(legX,.33,-.92,.081,.052,.15,'#eee7d9',18,12);
     // The arms go out, bend up, and finally go behind the head.
     m.limb([side*.205,.47,.29],[side*.38,.48,.55],.070,wool,16);
     m.limb([side*.38,.48,.55],[side*.18,.48,.83],.052,skin,14);
     ell(side*.18,.48,.83,.061,.041,.075,skin,16,10);
   }
   if(!male){
     // Laid-flat skirt fabric across hips and thighs.
     ell(0,.41,-.32,.272,.085,.30,'#eee1cd',26,18);
   }
   // Head and hair sit *above* the fabric; facial features point at the sky.
   ell(0,.44,.81,.183,.105,.208,hair,28,20); // back of hair as cushion
   ell(0,.54,.81,.182,.137,.195,skin,30,20);
   // Bob/short hair wraps along the head's sides rather than covering the face.
   for(const side of [-1,1])ell(side*.161,.535,.80,.048,.118,male?.141:.200,hair,20,14);
   ell(0,.555,.984,.150,.084,.052,hair,24,16); // forehead fringe
   for(const side of [-1,1]){
     ell(side*.076,.675,.86,.017,.010,.021,'#3c3230',12,8); // upturned eyes
     ell(side*.076,.671,.93,.038,.009,.010,'#725451',12,8);
   }
   ell(0,.674,.748,.034,.009,.010,'#ac7871',12,8); // calm smile
   return {...createBuffer(m),original:m};
 }
 for(const side of [-1,1]){
  const x=side*.112,step=walking?side*stride*.10:0;
  if(lying){
   ell(x,.31,-.30+side*.02,.085,.095,.24,pants,24,16);
   ell(x,.29,-.55+side*.02,.077,.091,.21,pants,22,14);
   ell(x,.29,-.78+side*.02,.087,.051,.15,'#e6ded4',14,8);
  }else if(sitting){
   ell(x,.47,.24,.105,.16,.20,pants,26,18);
   ell(x,.24,.43,.09,.19,.11,pants,26,18);
   ell(x,.105,.51,.112,.075,.168,'#e6ded4',14,8);
  }else{
   smoothLoft(m,[
    {x,y:.15,z:step,rx:.078,rz:.09},
    {x,y:.26,z:step*.8,rx:.084,rz:.095},
    {x,y:.55,z:step*.25,rx:.093,rz:.105},
    {x,y:.80,z:0,rx:.107,rz:.12}
   ],pants,18);
   ell(x,.10,step+.055,.116,.075,.155,'#e6ded4',14,8);
  }
 }
 if(lying){
  smoothLoft(m,[
   {x:0,y:.42,z:.00,rx:.18,rz:.11},
   {x:0,y:.40,z:.18,rx:.20,rz:.13},
   {x:0,y:.39,z:.38,rx:.21,rz:.13},
   {x:0,y:.37,z:.58,rx:.18,rz:.11},
   {x:0,y:.36,z:.69,rx:.11,rz:.09}
  ],wool,20);
  ell(0,.42,.02,.17,.03,.11,darkWool,14,8);
  ell(0,.36,.66,.09,.03,.07,darkWool,14,8);
 }else{
  smoothLoft(m,[
   {x:0,y:.73+down,z:0,rx:.213,rz:.146},
   {x:0,y:.82+down,z:0,rx:.217,rz:.145},
   {x:0,y:1.06+down,z:0,rx:.222,rz:.142},
   {x:0,y:1.30+down,z:0,rx:.239,rz:.146},
   {x:0,y:1.41+down,z:0,rx:.160,rz:.118},
   {x:0,y:1.44+down,z:0,rx:.085,rz:.082}
  ],wool,22);
  ell(0,.755+down,0,.211,.034,.146,darkWool,14,8);
  ell(0,1.427+down,.006,.108,.042,.082,darkWool,14,8);
 }
 if(!male&&!lying){
   smoothLoft(m,[
     {x:0,y:.57+down,z:0,rx:.332,rz:.273},
     {x:0,y:.63+down,z:0,rx:.324,rz:.265},
     {x:0,y:.77+down,z:0,rx:.278,rz:.225},
     {x:0,y:.94+down,z:0,rx:.230,rz:.172}
   ],'#eee1cd',28);
   ell(0,.59+down,0,.327,.026,.268,'#d9c9b7',26,10);
 }
 for(const side of [-1,1]){
  const x=side*.29,armz=walking?stride*side*.065:0;
  if(lying){
   ell(x*.72,.43,.28+side*.08,.064,.18,.070,wool,14,8);
   ell(x*.72,.38,.10+side*.08,.054,.060,.060,skin,10,6);
  }else{
   ell(x,1.105+down,armz,.082,.305,.092,wool,16,9);
   ell(x, .87+down,armz+.008,.092,.044,.096,darkWool,10,6);
   ell(x,.795+down,armz+.012,.068,.073,.068,skin,10,6);
  }
 }
 const hy=lying?.47:1.686+down;
 ell(0,hy,lying?.83:0,.185,.213,.169,skin,24,14);
 for(const side of [-1,1])ell(side*.182,hy-.024,lying?.824:-.006,.033,.055,.036,skin,10,6);
 singleHairShell(m,hy,gender,hair,lying?.83:0);
 const ink='#3c3230';
 for(const side of [-1,1]){
  ell(side*.069,hy+.003,lying?.988:.168,.013,.018,.006,ink,8,5);
  ell(side*.072,hy+.068,lying?.979:.159,.036,.007,.006,'#634944',8,5);
 }
 ell(0,hy-.087,lying?.988:.168,.031,.007,.006,'#a86d69',8,5);
 return {...createBuffer(m),original:m};
}
const avatars={male:Array.from({length:6},(_,color)=>Array.from({length:6},(_,pose)=>makeAvatar(color,pose,'male'))),female:Array.from({length:6},(_,color)=>Array.from({length:6},(_,pose)=>makeAvatar(color,pose,'female')))};
const particleMeshes={};for(const c of ['#fbd7b0','#fad4d9','#f9ecbe','#cde2d0','#d0a076','#f5dbb7','#f4b0c9','#c9c1fa']){const p=new Mesh();p.sphere(0,0,0,.10,c,8,5);particleMeshes[c]=createBuffer(p)}

// Perspective 3D CPU fallback, for browsers with GPU acceleration blocked. Same XYZ scene, lower FPS.
function triCache(mesh){let out=[],a=mesh.data;for(let i=0;i<a.length;i+=18){let c=[3,4,5].map(j=>Math.round(Math.min(1,(a[i+j]+a[i+j+6]+a[i+j+12])/3)*255));out.push([a[i],a[i+1],a[i+2],a[i+6],a[i+7],a[i+8],a[i+12],a[i+13],a[i+14],`rgb(${c.join(',')})`])}return out}
const softWorld=gl?null:triCache(world),softAvatars=gl?null:Object.fromEntries(Object.entries(avatars).map(([gender,colors])=>[gender,colors.map(set=>set.map(a=>triCache(a.original)))]));let lastSoftDraw=0;
function drawSoftware(ts,people,cam,particles){
 if(!softCtx||ts-lastSoftDraw<145)return;lastSoftDraw=ts;
 const w=canvas.width,h=canvas.height,m=cam.matrix;let op=[];const eye=cam.eye;
 function add(tris,px=0,py=0,pz=0,rot=0){const co=Math.cos(rot),si=Math.sin(rot);for(const a of tris){let coords=[],depth=0,valid=true;for(let i=0;i<9;i+=3){const x=a[i]*co+a[i+2]*si+px,y=a[i+1]+py,z=-a[i]*si+a[i+2]*co+pz;const clipW=m[3]*x+m[7]*y+m[11]*z+m[15];if(clipW<.09){valid=false;break}let vx=(m[0]*x+m[4]*y+m[8]*z+m[12])/clipW,vy=(m[1]*x+m[5]*y+m[9]*z+m[13])/clipW;coords.push((vx*.5+.5)*w,(.5-vy*.5)*h);depth+=Math.hypot(x-eye[0],y-eye[1],z-eye[2])}if(!valid)continue;if(Math.min(coords[0],coords[2],coords[4])>w||Math.max(coords[0],coords[2],coords[4])<0||Math.min(coords[1],coords[3],coords[5])>h||Math.max(coords[1],coords[3],coords[5])<0)continue;op.push([depth/3,...coords,a[9]])}}
 add(softWorld);for(const p of people){if(cam.first&&p.self)continue;add((softAvatars[p.gender==='female'?'female':'male'][p.color]||softAvatars.male[0])[p.pose||0],p.x,p.py||0,p.z,p.rot)}
 op.sort((a,b)=>b[0]-a[0]);softCtx.fillStyle='#141723';softCtx.fillRect(0,0,w,h);
 for(const a of op){softCtx.beginPath();softCtx.moveTo(a[1],a[2]);softCtx.lineTo(a[3],a[4]);softCtx.lineTo(a[5],a[6]);softCtx.closePath();softCtx.fillStyle=a[7];softCtx.fill()}
}

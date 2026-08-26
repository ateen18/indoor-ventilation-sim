// Node 无头测试台：mock DOM 后加载应用脚本，跑 LBM 检查稳定性与指标合理性
const fs=require('fs');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const js=html.match(/<script>([\s\S]*)<\/script>/)[1].replace('runSim(true);','/* auto demo disabled in test */');

function ctxStub(){ return { createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4), width:w, height:h}),
  putImageData(){}, drawImage(){}, clearRect(){}, fillRect(){}, strokeRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  fillText(){}, measureText:()=>({width:10}), save(){}, restore(){}, translate(){}, rotate(){}, arc(){}, closePath(){},
  set fillStyle(v){}, get fillStyle(){return '';}, set strokeStyle(v){}, set lineWidth(v){}, set font(v){}, set textAlign(v){}, set globalAlpha(v){},
  set imageSmoothingEnabled(v){}, }; }
function elStub(){ return {
  innerHTML:'', value:'0', textContent:'', style:{}, dataset:{}, width:1008, height:700, files:[],
  classList:{add(){},remove(){},contains:()=>false},
  getContext:()=>ctxStub(), toDataURL:()=>'', querySelectorAll:()=>[], querySelector:()=>null,
  addEventListener(){}, appendChild(){}, scrollIntoView(){}, onclick:null, onchange:null, oninput:null, click(){},
  getBoundingClientRect:()=>({left:0,top:0,width:1008,height:700}),
};}
global.document={
  getElementById:()=>elStub(), createElement:()=>elStub(),
  querySelectorAll:()=>[], querySelector:()=>elStub(),
  addEventListener(){},
};
global.window={addEventListener(){}, print(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.requestAnimationFrame=fn=>setTimeout(fn,16);
global.alert=()=>{}; global.prompt=()=>null; global.confirm=()=>true;
global.location={search:''};
global.Image=class{set src(v){ if(this.onload)this.onload(); }};
global.URL={createObjectURL:()=>'',revokeObjectURL(){}};

// 运行应用脚本（顶层初始化）
const wrapper=new Function(js+'\n;return {S,runSim,reclassify,buildDemo,nameDemoZones,lbmStep,initLBM,N,NX,NY,cell,C_INT,C_WIN,C_DOORO,C_FURN,computeMaxV,rebuildMasks,RHO,FLUID,UX,UY,winNormal};');
const app=wrapper.call(global);
(async()=>{
  // 阻止页面自带的自动演示定时器干扰（已有 600ms 延迟，先同步跑我们的测试）
  const {S,runSim,cell,N,C_INT,C_FURN,RHO}=app;
  console.log('启动: zones=',S.zones.length,'wins=',S.wins.length,'fans=',S.fans.length);
  console.log('wind=',S.windDir,S.windSpd);
  const massBefore=(()=>{let m=0;for(let i=0;i<N;i++)m+=RHO[i];return m;})();
  const t0=Date.now();
  await runSim(false);
  const dt=(Date.now()-t0)/1000;
  const s=S.sim;
  let mInt=0,mExt=0,rmin=9,rmax=0;
  for(let i=0;i<N;i++){ const r=RHO[i]; if(r<rmin)rmin=r; if(r>rmax)rmax=r;
    if(cell[i]===C_INT||cell[i]===C_FURN||cell[i]===3||cell[i]===4) mInt+=r; else mExt+=r; }
  console.log('总质量: 前',massBefore.toFixed(1),'后',(mInt+mExt).toFixed(1),' 室内',mInt.toFixed(1),'室外',mExt.toFixed(1),' ρ范围',rmin.toFixed(3),rmax.toFixed(3));
  let mx=0,mean=0,n=0,nan=0;
  for(let i=0;i<N;i++){ if(cell[i]===C_INT){ const v=Math.hypot(s.ux[i],s.uy[i]); if(!isFinite(v))nan++; else{if(v>mx)mx=v; mean+=v;n++;} } }
  console.log(JSON.stringify({耗时s:dt.toFixed(1), 室内最大风速:mx.toFixed(2), 室内平均风速:(mean/n).toFixed(2),
    Qin:Math.round(s.Qin), Qout:Math.round(s.Qout), ACH:s.ACH.toFixed(1), vol:Math.round(s.vol),
    t50:s.t50, t90:s.t90, nan},null,0));
  console.log('房间 t50/t90:',s.zoneT.map(z=>`${z.name}:${!isFinite(z.t50)?'>90m':Math.round(z.t50/60)+'m'}/${!isFinite(z.t90)?'>90m':Math.round(z.t90/60)+'m'}`).join(' '));
  console.log('窗口Q:',s.winQ.map(q=>Math.round(q)).join(', '));
  // 诊断：各窗逐单元毛进出 + 网格边缘通量 + 继续跑300步看质量变化
  const {lbmStep,NX,NY,winNormal}=app; const RHO2=app.RHO; const S2=app.S;
  const wnQ=S2.wins.map(w=>{
    const n=winNormal(w); let gin=0,gout=0;
    for(const c of w.cells){ if(app.cell[c]!==3&&app.cell[c]!==C_INT)continue;
      const x=c%NX,y=(c-x)/NX, ix=x-n[0], iy=y-n[1];
      if(ix>=0&&ix<NX&&iy>=0&&iy<NY&&app.cell[iy*NX+ix]===3) continue;   // 跳过靠室外层，计量靠室内层
      const f=-(s.ux[c]*n[0]+s.uy[c]*n[1])*0.1*1.2*3600;
      if(f>0)gin+=f; else gout-=f; }
    return {gin:Math.round(gin),gout:Math.round(gout)};
  });
  console.log('各窗 毛[进,排]:',JSON.stringify(wnQ));
  // 剖面：注意 idx(x,y)=y*NX+x；x=30 竖直剖面避开家具（沙发y78-86/茶几y68-74/电视柜y60-63/床y22-38）
  const prof=[];
  for(const y of [96,95,94,93,92,91,90,88,87,65,64,50,45,40,21,20,19,18,17]){
    const i=y*NX+30; prof.push(`y${y}:${(app.UY[i]*3.4/0.11).toFixed(2)}`);
  }
  console.log('x=30 竖直剖面 uy(m/s):',prof.join(' '));
  const prof2=[];
  for(let x=18;x<=62;x+=4){ const i=93*NX+x; prof2.push(`x${x}:${(app.UY[i]*3.4/0.11).toFixed(2)}`); }
  console.log('y=93(南窗内侧) 水平剖面 uy:',prof2.join(' '));
  const prof2b=[];
  for(let x=18;x<=62;x+=4){ const i=92*NX+x; prof2b.push(`x${x}:${(app.UY[i]*3.4/0.11).toFixed(2)}`); }
  console.log('y=92 水平剖面 uy:',prof2b.join(' '));
  const prof3=[];
  for(const y of [93,92,91,90,88,87,65,64,50,45,40,21,20]){ const i=y*NX+30; prof3.push(`y${y}:rho${RHO2[i].toFixed(3)},u${Math.hypot(app.UX[i],app.UY[i]).toFixed(4)}`); }
  console.log('x=30 密度/速度:',prof3.join(' '));
  // 北窗（主卧 y=19/18 层）出流剖面
  const prof4=[];
  for(let x=20;x<=44;x+=4){ const i=20*NX+x; prof4.push(`x${x}:${(app.UY[i]*3.4/0.11).toFixed(2)}`); }
  console.log('y=20(主卧北窗内侧) uy:',prof4.join(' '));
  let M0=0; for(let i=0;i<N;i++)M0+=RHO2[i];
  for(let k2=0;k2<300;k2++) lbmStep();
  let M1=0; for(let i=0;i<N;i++)M1+=RHO2[i];
  console.log('再跑300步: 质量',M0.toFixed(1),'->',M1.toFixed(1),' 每步增',(M1-M0)/300);
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});

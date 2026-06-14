import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { io } from "socket.io-client";

/* ═══════════════════════════════════════════════════════════
   CRUSHCASH v4
   - Bottom nav · Matchmaking animation · Bot opponents
   - 2-min games · 10% platform cut · Candy burst/fall + sounds
   - Profile (email/phone OTP + bank) · Withdraw everywhere
═══════════════════════════════════════════════════════════ */

const API_URL = "";
const G = 8, GT = 120, CD = 60;

const ROOMS = [
  {id:1,name:"Starter Arena",sub:"Begin your journey",entry:100,maxP:2,prize:180,cut:20,totalPot:200,tag:"1v1",tc:"#6B7280"},
  {id:2,name:"Bronze Arena",sub:"Test your skills",entry:200,maxP:2,prize:360,cut:40,totalPot:400,tag:"1v1",tc:"#CD7F32"},
  {id:3,name:"Silver Arena",sub:"Rising competition",entry:500,maxP:2,prize:900,cut:100,totalPot:1000,tag:"1v1",tc:"#9CA3AF"},
  {id:4,name:"Gold Arena",sub:"High stakes action",entry:1000,maxP:2,prize:1800,cut:200,totalPot:2000,tag:"1v1",tc:"#F59E0B"},
  {id:5,name:"Platinum Arena",sub:"Elite level battles",entry:2000,maxP:2,prize:3600,cut:400,totalPot:4000,tag:"1v1",tc:"#67E8F9"},
  {id:6,name:"Diamond Arena",sub:"Top tier showdowns",entry:5000,maxP:2,prize:9000,cut:1000,totalPot:10000,tag:"1v1",tc:"#818CF8"},
  {id:7,name:"Elite Arena",sub:"Champions only",entry:10000,maxP:2,prize:18000,cut:2000,totalPot:20000,tag:"1v1",tc:"#F43F5E"},
  {id:8,name:"Quad Bronze",sub:"4-player bronze war",entry:500,maxP:4,prize:1800,cut:200,totalPot:2000,tag:"QUAD",tc:"#CD7F32",q:true},
  {id:9,name:"Quad Gold",sub:"4-way gold battle",entry:2000,maxP:4,prize:7200,cut:800,totalPot:8000,tag:"QUAD",tc:"#F59E0B",q:true},
  {id:10,name:"Quad Elite",sub:"Ultimate 4-player war",entry:5000,maxP:4,prize:18000,cut:2000,totalPot:20000,tag:"QUAD",tc:"#C084FC",q:true},
];
const GAME_EMOJIS = ["🔥","😂","💀","👑","🎮","😤","🏆","😎","💪","🍬","😱","❤️","🤣","😈","🙌"];
const ADMIN_CREDS = { email:"godwinoloja4@gmail.com", pass:"@Westpablo1" };

const V = {
  bg:"#07071A", card:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.07)",
  pri:"#6D28D9", pri2:"#7C3AED", pri3:"#8B5CF6",
  acc:"#F59E0B", pink:"#EC4899", grn:"#10B981",
  red:"#EF4444", txt:"#F1F5F9", txt2:"#94A3B8", txt3:"#475569",
};

// ══ GAME ENGINE ═══════════════════════════════════════════
const mkBoard = () => {
  const b = Array.from({length:G}, ()=>Array(G).fill(0));
  for (let r=0;r<G;r++) for (let c=0;c<G;c++) {
    let v;
    do { v=Math.floor(Math.random()*6); }
    while ((c>=2&&b[r][c-1]===v&&b[r][c-2]===v)||(r>=2&&b[r-1][c]===v&&b[r-2][c]===v));
    b[r][c]=v;
  }
  return b;
};
const getM = b => {
  const m = Array.from({length:G},()=>Array(G).fill(false));
  for(let r=0;r<G;r++) for(let c=0;c<=G-3;c++)
    if(b[r][c]>=0&&b[r][c]===b[r][c+1]&&b[r][c]===b[r][c+2]) m[r][c]=m[r][c+1]=m[r][c+2]=true;
  for(let r=0;r<=G-3;r++) for(let c=0;c<G;c++)
    if(b[r][c]>=0&&b[r][c]===b[r+1][c]&&b[r][c]===b[r+2][c]) m[r][c]=m[r+1][c]=m[r+2][c]=true;
  return m;
};
const dropBoard = b => {
  const nb=b.map(r=>[...r]);
  for(let c=0;c<G;c++){
    let bot=G-1;
    for(let r=G-1;r>=0;r--) if(nb[r][c]>=0){nb[bot][c]=nb[r][c];if(bot!==r)nb[r][c]=-1;bot--;}
    while(bot>=0){nb[bot][c]=Math.floor(Math.random()*6);bot--;}
  }
  return nb;
};
const resolve = b0 => {
  let b=b0.map(r=>[...r]),pts=0,combo=0;
  for(;;){
    const m=getM(b),cnt=m.flat().filter(Boolean).length;
    if(!cnt)break;
    combo++;pts+=cnt*10*combo;
    for(let r=0;r<G;r++) for(let c=0;c<G;c++) if(m[r][c])b[r][c]=-1;
    b=dropBoard(b);
  }
  return{b,pts,combo};
};
const trySwap=(b,r1,c1,r2,c2)=>{
  const nb=b.map(r=>[...r]);
  [nb[r1][c1],nb[r2][c2]]=[nb[r2][c2],nb[r1][c1]];
  const m=getM(nb);
  return m.flat().some(Boolean)?{swapped:nb,mask:m}:null;
};
const isAdj=(r1,c1,r2,c2)=>(Math.abs(r1-r2)+Math.abs(c1-c2))===1;

// ══ HELPERS ═══════════════════════════════════════════════
const fmt  = n => `₦${Number(n).toLocaleString()}`;
const fmtT = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

const apiFetch = async (method, path, body, token) => {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(`/api${path}`, {
      method, signal: controller.signal,
      headers: { "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    clearTimeout(tid);
    return await res.json().catch(()=>({ success:false, error:`Server returned ${res.status}` }));
  } catch (err) {
    clearTimeout(tid);
    if (err.name==="AbortError") return { success:false, error:"Server is waking up, please try again in a moment." };
    return { success:false, error:"Cannot connect to server. Check your internet connection." };
  }
};

// ══ SOUND ENGINE (Web Audio API — no files needed) ════════
let audioCtx = null;
const getCtx = () => {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch { return null; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
};
const tone = (freq, dur=0.14, type="sine", vol=0.18, delay=0) => {
  const ctx = getCtx(); if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.value = vol;
  o.connect(g); g.connect(ctx.destination);
  o.start(t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.stop(t0+dur+0.02);
};
const sounds = {
  select:  () => tone(520, 0.07, "triangle", 0.12),
  swap:    () => tone(340, 0.09, "triangle", 0.12),
  burst:   (combo=1) => { for(let i=0;i<Math.min(combo,4);i++) tone(700+i*180, 0.16, "square", 0.10, i*0.05); },
  invalid: () => tone(160, 0.12, "sawtooth", 0.10),
  tick:    () => tone(880, 0.07, "square", 0.10),
  danger:  () => { tone(880,0.12,"square",0.16); tone(660,0.12,"square",0.16,0.12); },
  win:     () => { [523,659,784,1046].forEach((f,i)=>tone(f,0.28,"triangle",0.18,i*0.16)); },
  lose:    () => { [440,349,294].forEach((f,i)=>tone(f,0.32,"sine",0.16,i*0.18)); },
  start:   () => { [392,523,659].forEach((f,i)=>tone(f,0.18,"sine",0.14,i*0.1)); },
};
const speak = (text) => {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 1.05; u.volume = 0.9;
    window.speechSynthesis.speak(u);
  } catch {}
};

// ══ CONTEXT ══════════════════════════════════════════════
const Ctx = createContext({});
const useApp = () => useContext(Ctx);

// ══ CANDY SVG DEFS ════════════════════════════════════════
const CandyDefs = () => (
  <svg width="0" height="0" style={{position:"absolute",overflow:"hidden",pointerEvents:"none"}}>
    <defs>
      <radialGradient id="cg0" cx="35%" cy="28%" r="65%"><stop offset="0%" stopColor="#FF9999"/><stop offset="42%" stopColor="#FF1133"/><stop offset="100%" stopColor="#7A0000"/></radialGradient>
      <radialGradient id="cg1" cx="35%" cy="28%" r="65%"><stop offset="0%" stopColor="#FFD088"/><stop offset="42%" stopColor="#FF8800"/><stop offset="100%" stopColor="#BB3300"/></radialGradient>
      <radialGradient id="cg2" cx="38%" cy="30%" r="65%"><stop offset="0%" stopColor="#FFFFAA"/><stop offset="42%" stopColor="#FFDD00"/><stop offset="100%" stopColor="#997700"/></radialGradient>
      <radialGradient id="cg3" cx="35%" cy="28%" r="65%"><stop offset="0%" stopColor="#AAFFBB"/><stop offset="42%" stopColor="#11BB44"/><stop offset="100%" stopColor="#005520"/></radialGradient>
      <radialGradient id="cg4" cx="33%" cy="26%" r="65%"><stop offset="0%" stopColor="#BBDDFF"/><stop offset="42%" stopColor="#1155FF"/><stop offset="100%" stopColor="#000E99"/></radialGradient>
      <radialGradient id="cg5" cx="35%" cy="28%" r="65%"><stop offset="0%" stopColor="#EEBCFF"/><stop offset="42%" stopColor="#9911CC"/><stop offset="100%" stopColor="#3A0066"/></radialGradient>
      <radialGradient id="cg5c" cx="40%" cy="35%" r="58%"><stop offset="0%" stopColor="#DD99FF"/><stop offset="50%" stopColor="#7700BB"/><stop offset="100%" stopColor="#2D0050"/></radialGradient>
      <filter id="cshadow"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="rgba(0,0,0,0.55)"/></filter>
      <filter id="cselect"><feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="white" floodOpacity="0.9"/></filter>
    </defs>
  </svg>
);

// ══ CANDY CELL ═════════════════════════════════════════════
const CandyCell = ({ type, selected, bursting, size=44 }) => {
  const s=size, cx=s/2, cy=s/2, r=s/2-1.5;
  const filt = selected?"url(#cselect)":"url(#cshadow)";
  const wrapStyle = {
    position:"relative",width:s,height:s,display:"flex",alignItems:"center",justifyContent:"center",
    animation: bursting ? "candyBurst .22s ease-out forwards" : "candyDrop .26s ease-out",
  };
  if (type===5) {
    const pr=s*0.215, dist=s*0.175;
    const petals=[[cx,cy-dist],[cx+dist*0.866,cy-dist*0.5],[cx+dist*0.866,cy+dist*0.5],[cx,cy+dist],[cx-dist*0.866,cy+dist*0.5],[cx-dist*0.866,cy-dist*0.5]];
    return (<div style={wrapStyle}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}>{petals.map(([px,py],i)=><circle key={i} cx={px} cy={py} r={pr} fill="url(#cg5)"/>)}<circle cx={cx} cy={cy} r={s*0.235} fill="url(#cg5c)"/><ellipse cx={cx*0.72} cy={cy*0.65} rx={s*0.12} ry={s*0.09} fill="rgba(255,255,255,0.58)"/>{selected&&<circle cx={cx} cy={cy} r={s*0.48} fill="none" stroke="white" strokeWidth="2.5"/>}</svg></div>);
  }
  if (type===2) {
    const d=`M${cx},${s*0.04} C${s*0.6},${s*0.04} ${s*0.92},${s*0.42} ${s*0.92},${s*0.62} C${s*0.92},${s*0.83} ${s*0.7},${s*0.96} ${cx},${s*0.96} C${s*0.3},${s*0.96} ${s*0.08},${s*0.83} ${s*0.08},${s*0.62} C${s*0.08},${s*0.42} ${s*0.4},${s*0.04} ${cx},${s*0.04}Z`;
    return (<div style={wrapStyle}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}><path d={d} fill="url(#cg2)"/><ellipse cx={cx*0.76} cy={cy*0.78} rx={s*0.14} ry={s*0.19} fill="rgba(255,255,255,0.55)"/>{selected&&<path d={d} fill="none" stroke="white" strokeWidth="2.5"/>}</svg></div>);
  }
  return (<div style={wrapStyle}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}><circle cx={cx} cy={cy} r={r} fill={`url(#cg${type})`}/><ellipse cx={cx*0.63} cy={cy*0.54} rx={r*0.43} ry={r*0.31} fill="rgba(255,255,255,0.60)"/><ellipse cx={cx*0.44} cy={cy*0.38} rx={r*0.14} ry={r*0.1} fill="rgba(255,255,255,0.75)"/><ellipse cx={cx} cy={cy+r*0.58} rx={r*0.48} ry={r*0.18} fill="rgba(255,255,255,0.10)"/>{selected&&<circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.12)" stroke="white" strokeWidth="2.5"/>}</svg></div>);
};

const BoardCell = ({ children, onClick }) => (
  <div onClick={onClick} style={{width:"50px",height:"50px",borderRadius:"11px",background:"linear-gradient(160deg,#3D1257 0%,#270840 100%)",boxShadow:"inset 0 2px 5px rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden"}}>
    {children}
  </div>
);

// ══ SHARED UI (module-level) ══════════════════════════════
const Btn = ({ onClick, children, v="pri", dis=false, style={} }) => {
  const vs = {
    pri:  {background:`linear-gradient(135deg,${V.pri},${V.pri3})`,color:"#fff",boxShadow:`0 4px 18px rgba(109,40,217,.35)`},
    gold: {background:"linear-gradient(135deg,#B45309,#F59E0B)",color:"#000"},
    out:  {background:"transparent",color:V.txt,border:`1px solid ${V.border}`},
    grn:  {background:`linear-gradient(135deg,#065F46,${V.grn})`,color:"#fff"},
    red:  {background:`linear-gradient(135deg,#991B1B,${V.red})`,color:"#fff"},
    ghost:{background:"transparent",color:V.txt2,border:"none"},
  };
  return (
    <button onClick={dis?undefined:onClick}
      style={{padding:"10px 20px",border:"none",borderRadius:"10px",cursor:dis?"not-allowed":"pointer",fontWeight:"700",fontSize:"14px",transition:"all .2s",opacity:dis?.5:1,fontFamily:"inherit",...(vs[v]||vs.pri),...style}}>
      {children}
    </button>
  );
};
const Card = ({ children, style={} }) => (
  <div style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"18px",padding:"22px",...style}}>{children}</div>
);
const Field = ({ label, value, onChange, placeholder, type="text" }) => (
  <div>
    {label && <div style={{fontSize:"11px",color:V.txt2,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"7px"}}>{label}</div>}
    <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type}
      style={{width:"100%",background:"rgba(255,255,255,0.05)",border:`1px solid ${V.border}`,borderRadius:"10px",padding:"13px 15px",color:V.txt,fontSize:"15px",outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border .2s"}}
      onFocus={e=>e.target.style.borderColor=V.pri3} onBlur={e=>e.target.style.borderColor=V.border}/>
  </div>
);
const Select = ({ label, value, onChange, options, placeholder="Select..." }) => (
  <div>
    {label && <div style={{fontSize:"11px",color:V.txt2,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"7px"}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",background:"rgba(255,255,255,0.05)",border:`1px solid ${V.border}`,borderRadius:"10px",padding:"13px 15px",color:V.txt,fontSize:"15px",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}>
      <option value="" style={{background:"#1A1028"}}>{placeholder}</option>
      {options.map(o=><option key={o.code||o} value={o.code||o} style={{background:"#1A1028"}}>{o.name||o}</option>)}
    </select>
  </div>
);

// ══ TOP BAR (minimal — balance only) ═══════════════════════
const TopBar = () => {
  const { nav, user, bal, serverOk } = useApp();
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:300,background:"rgba(7,7,26,0.92)",backdropFilter:"blur(24px)",borderBottom:`1px solid ${V.border}`,padding:"0 20px",height:"60px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={()=>nav(user?"lobby":"landing")}>
        <div style={{width:"36px",height:"36px",borderRadius:"10px",background:`linear-gradient(135deg,${V.pri},${V.pink})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>🍬</div>
        <span style={{fontWeight:"900",fontSize:"20px",letterSpacing:"-0.5px",background:`linear-gradient(130deg,#fff 40%,${V.pink})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>CrushCash</span>
        <div title={serverOk?"Online":"Connecting..."} style={{width:"7px",height:"7px",borderRadius:"50%",background:serverOk?V.grn:V.acc}}/>
      </div>
      {user ? (
        <div onClick={()=>nav("wallet")} style={{background:"rgba(245,158,11,0.12)",border:`1px solid rgba(245,158,11,0.25)`,borderRadius:"20px",padding:"7px 16px",fontSize:"15px",color:V.acc,fontWeight:"800",cursor:"pointer"}}>💰 {fmt(bal)}</div>
      ) : (
        <div style={{display:"flex",gap:"10px"}}>
          <Btn v="ghost" onClick={()=>nav("auth")}>Sign In</Btn>
          <Btn onClick={()=>nav("auth")} style={{padding:"8px 18px"}}>Get Started →</Btn>
        </div>
      )}
    </div>
  );
};

// ══ BOTTOM NAV — bold, fixed below ═══════════════════════
const BottomNav = () => {
  const { pg, nav, user } = useApp();
  if (!user) return null;
  const items = [
    { id:"lobby",    icon:"🎮", label:"Lobby" },
    { id:"wallet",   icon:"💰", label:"Wallet" },
    { id:"referral", icon:"🎁", label:"Refer" },
    { id:"profile",  icon:"👤", label:"Profile" },
  ];
  const active = ["lobby","wallet","referral","profile"].includes(pg) ? pg : (pg==="game"||pg==="matchmaking" ? "lobby" : "");
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"rgba(7,7,26,0.97)",backdropFilter:"blur(24px)",borderTop:`1px solid ${V.border}`,display:"flex",padding:"8px 6px calc(8px + env(safe-area-inset-bottom))"}}>
      {items.map(it=>(
        <button key={it.id} onClick={()=>nav(it.id)}
          style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",padding:"8px 4px",border:"none",background:"transparent",cursor:"pointer",fontFamily:"inherit",
            color: active===it.id ? V.pri3 : V.txt2}}>
          <span style={{fontSize:"22px",filter: active===it.id ? `drop-shadow(0 0 8px ${V.pri})` : "none"}}>{it.icon}</span>
          <span style={{fontSize:"12px",fontWeight:"900",letterSpacing:"0.3px"}}>{it.label}</span>
        </button>
      ))}
    </div>
  );
};

// ══ TOAST (replaces alert()) ═══════════════════════════════
const Toast = () => {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div style={{position:"fixed",top:"70px",left:"50%",transform:"translateX(-50%)",zIndex:999,
      background: toast.type==="error" ? "rgba(239,68,68,0.16)" : "rgba(16,185,129,0.16)",
      border:`1px solid ${toast.type==="error"?V.red:V.grn}55`,color: toast.type==="error"?"#FCA5A5":"#6EE7B7",
      borderRadius:"12px",padding:"12px 22px",fontSize:"14px",fontWeight:"700",maxWidth:"90vw",textAlign:"center",
      boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
      {toast.msg}
    </div>
  );
};

// ══ PAGE: LANDING ═════════════════════════════════════════
const Landing = () => {
  const { nav, user } = useApp();
  return (
    <div style={{minHeight:"100vh",paddingTop:"60px"}}>
      <TopBar/>
      <section style={{padding:"70px 20px 60px",textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 90% 60% at 50% -5%,rgba(109,40,217,0.22),transparent)`,pointerEvents:"none"}}/>
        <div style={{display:"inline-flex",alignItems:"center",gap:"8px",background:"rgba(109,40,217,0.14)",border:`1px solid rgba(109,40,217,0.32)`,borderRadius:"24px",padding:"7px 18px",fontSize:"12px",color:V.pri3,fontWeight:"700",marginBottom:"24px",letterSpacing:"1.5px"}}>🔥 NIGERIA'S #1 COMPETITIVE GAMING PLATFORM</div>
        <h1 style={{fontSize:"clamp(38px,8vw,72px)",fontWeight:"900",lineHeight:"1.05",marginBottom:"20px",letterSpacing:"-2px",background:`linear-gradient(140deg,#fff 35%,${V.pink} 75%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Crush Candies.<br/>Win Real Cash.</h1>
        <p style={{fontSize:"17px",color:V.txt2,maxWidth:"480px",margin:"0 auto 36px",lineHeight:"1.75"}}>2-minute rounds. Instant matchmaking — never wait. Win up to <strong style={{color:V.acc}}>₦18,000</strong> per match.</p>
        <div style={{display:"flex",gap:"14px",justifyContent:"center",flexWrap:"wrap"}}>
          <Btn onClick={()=>nav("auth")} style={{padding:"16px 38px",fontSize:"16px",borderRadius:"14px"}}>🎮 Start Playing</Btn>
          <Btn v="out" onClick={()=>nav(user?"lobby":"auth")} style={{padding:"16px 34px",fontSize:"16px",borderRadius:"14px"}}>View Rooms →</Btn>
        </div>
        <div style={{display:"flex",gap:"36px",justifyContent:"center",flexWrap:"wrap",marginTop:"56px",paddingTop:"32px",borderTop:`1px solid ${V.border}`}}>
          {[["2 min","Per Match"],["10%","Platform Fee"],["10","Arenas"],["₦500","Sign-up Bonus"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}><div style={{fontSize:"28px",fontWeight:"900",color:V.acc,letterSpacing:"-1px"}}>{v}</div><div style={{fontSize:"11px",color:V.txt3,marginTop:"4px",letterSpacing:"1px",textTransform:"uppercase"}}>{l}</div></div>
          ))}
        </div>
      </section>
      <section style={{padding:"0 20px 60px",maxWidth:"1100px",margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}><div style={{fontSize:"11px",color:V.pri3,fontWeight:"700",letterSpacing:"3px",marginBottom:"8px"}}>GAME ROOMS</div><h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:"900",letterSpacing:"-1px"}}>10 Competitive Arenas · 90% Payout</h2></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"14px"}}>
          {ROOMS.slice(0,6).map(r=>(
            <div key={r.id} onClick={()=>nav(user?"lobby":"auth")} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"16px",padding:"20px",cursor:"pointer",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:r.tc}}/>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"14px"}}>
                <div style={{fontSize:"15px",fontWeight:"800"}}>{r.name}</div>
                <span style={{background:`${r.tc}22`,color:r.tc,borderRadius:"6px",padding:"3px 9px",fontSize:"11px",fontWeight:"800"}}>{r.tag}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"9px",padding:"10px"}}><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1px"}}>ENTRY</div><div style={{fontWeight:"900",fontSize:"18px",color:V.acc}}>{fmt(r.entry)}</div></div>
                <div style={{background:"rgba(16,185,129,0.07)",borderRadius:"9px",padding:"10px"}}><div style={{fontSize:"10px",color:V.grn,letterSpacing:"1px"}}>WIN</div><div style={{fontWeight:"900",fontSize:"18px",color:V.grn}}>{fmt(r.prize)}</div></div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <footer style={{borderTop:`1px solid ${V.border}`,padding:"32px 20px",textAlign:"center",paddingBottom:"40px"}}>
        <p style={{color:V.txt3,fontSize:"13px",marginBottom:"6px"}}>© 2025 CrushCash Nigeria Ltd. All rights reserved.</p>
        <p style={{color:V.txt3,fontSize:"12px"}}>18+ Only · Play Responsibly</p>
      </footer>
    </div>
  );
};

// ══ PAGE: AUTH ════════════════════════════════════════════
const AuthPage = () => {
  const { aMode, setAMode, aEmail, setAEmail, aPass, setAPass, aName, setAName, aRef, setARef, aErr, doAuth, authLoading } = useApp();
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:`radial-gradient(ellipse 80% 55% at 50% -5%,rgba(109,40,217,0.2),transparent)`}}>
      <TopBar/>
      <div style={{width:"100%",maxWidth:"420px",paddingTop:"60px"}}>
        <div style={{textAlign:"center",marginBottom:"28px"}}>
          <div style={{fontSize:"50px",marginBottom:"12px"}}>🍬</div>
          <h2 style={{fontSize:"28px",fontWeight:"900",marginBottom:"7px",letterSpacing:"-0.8px"}}>{aMode==="login"?"Welcome Back":"Join CrushCash"}</h2>
          <p style={{color:V.txt2,fontSize:"14px"}}>{aMode==="login"?"Sign in to play and win":"Get ₦500 free bonus on signup!"}</p>
        </div>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:"12px",padding:"4px",marginBottom:"22px",border:`1px solid ${V.border}`}}>
          {[["login","Sign In"],["register","Register"]].map(([m,l])=>(
            <button key={m} onClick={()=>setAMode(m)} style={{flex:1,padding:"10px",borderRadius:"10px",border:"none",cursor:"pointer",fontWeight:"700",fontSize:"14px",fontFamily:"inherit",background:aMode===m?`linear-gradient(135deg,${V.pri},${V.pri3})`:"transparent",color:aMode===m?"#fff":V.txt2}}>{l}</button>
          ))}
        </div>
        <Card style={{padding:"28px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {aMode==="register" && <Field label="FULL NAME" value={aName} onChange={setAName} placeholder="Your display name"/>}
            <Field label="EMAIL ADDRESS" value={aEmail} onChange={setAEmail} placeholder="you@example.com" type="email"/>
            <Field label="PASSWORD" value={aPass} onChange={setAPass} placeholder="Enter password" type="password"/>
            {aMode==="register" && <Field label="REFERRAL CODE (optional)" value={aRef} onChange={setARef} placeholder="Friend's referral code"/>}
            {aErr && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"9px",padding:"12px 14px",fontSize:"13px",color:V.red}}>⚠ {aErr}</div>}
            {aMode==="register" && !aErr && <div style={{background:"rgba(16,185,129,0.1)",border:`1px solid rgba(16,185,129,0.25)`,borderRadius:"9px",padding:"11px 14px",fontSize:"13px",color:V.grn}}>🎁 You'll receive ₦500 free credit on registration!</div>}
            <Btn onClick={doAuth} dis={authLoading} style={{padding:"14px",fontSize:"15px",borderRadius:"12px",marginTop:"4px"}}>
              {authLoading ? "Please wait..." : aMode==="login" ? "Sign In →" : "Create Account →"}
            </Btn>
          </div>
        </Card>
        <p style={{textAlign:"center",color:V.txt2,fontSize:"13px",marginTop:"18px"}}>
          {aMode==="login"?"New here? ":"Have an account? "}
          <span style={{color:V.pri3,cursor:"pointer",fontWeight:"700"}} onClick={()=>setAMode(aMode==="login"?"register":"login")}>{aMode==="login"?"Create Account":"Sign In"}</span>
        </p>
      </div>
    </div>
  );
};

// ══ PAGE: LOBBY ═══════════════════════════════════════════
const LobbyPage = () => {
  const { user, bal, lFilter, setLFilter, enterRoom, cdLeft } = useApp();
  const filtered = ROOMS.filter(r=>lFilter==="all"||(lFilter==="1v1"&&r.maxP===2)||(lFilter==="quad"&&r.maxP===4));
  return (
    <div style={{minHeight:"100vh",paddingTop:"60px",paddingBottom:"90px",background:V.bg}}>
      <TopBar/>
      <div style={{maxWidth:"1200px",margin:"0 auto",padding:"24px 16px"}}>
        <div style={{marginBottom:"20px"}}>
          <h1 style={{fontSize:"26px",fontWeight:"900",marginBottom:"4px",letterSpacing:"-1px"}}>Game Lobby</h1>
          <p style={{color:V.txt2,fontSize:"13px"}}>2-min matches · Instant matchmaking · 90% payout to winner</p>
        </div>
        <div style={{display:"flex",gap:"8px",marginBottom:"22px",overflowX:"auto"}}>
          {[["all","🎮 All Rooms"],["1v1","⚔️ 1v1 Duels"],["quad","👥 Quad Battles"]].map(([f,l])=>(
            <button key={f} onClick={()=>setLFilter(f)} style={{padding:"8px 18px",borderRadius:"20px",border:`1px solid ${lFilter===f?V.pri:V.border}`,cursor:"pointer",fontWeight:"700",fontSize:"13px",fontFamily:"inherit",whiteSpace:"nowrap",background:lFilter===f?`${V.pri}26`:"transparent",color:lFilter===f?V.pri3:V.txt2}}>{l}</button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"16px"}}>
          {filtered.map(r=>{
            const ok=bal>=r.entry&&cdLeft===0;
            return (
              <div key={r.id} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"18px",padding:"20px",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:"4px",background:r.tc,borderRadius:"18px 18px 0 0"}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}}>
                  <div><div style={{fontSize:"15px",fontWeight:"900",marginBottom:"3px"}}>{r.name}</div><div style={{fontSize:"12px",color:V.txt3}}>{r.sub}</div></div>
                  <div style={{display:"flex",flexDirection:"column",gap:"4px",alignItems:"flex-end"}}>
                    <span style={{background:`${r.tc}22`,color:r.tc,borderRadius:"6px",padding:"3px 9px",fontSize:"11px",fontWeight:"800"}}>{r.tag}</span>
                    <span style={{background:"rgba(255,255,255,0.05)",color:V.txt3,borderRadius:"5px",padding:"2px 7px",fontSize:"10px"}}>👥 {r.maxP} players</span>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
                  <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"10px",padding:"11px"}}><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"4px"}}>ENTRY</div><div style={{fontWeight:"900",fontSize:"20px",color:V.acc}}>{fmt(r.entry)}</div></div>
                  <div style={{background:"rgba(16,185,129,0.08)",border:`1px solid rgba(16,185,129,0.18)`,borderRadius:"10px",padding:"11px"}}><div style={{fontSize:"10px",color:V.grn,letterSpacing:"1.5px",marginBottom:"4px"}}>WIN (90%)</div><div style={{fontWeight:"900",fontSize:"20px",color:V.grn}}>{fmt(r.prize)}</div></div>
                </div>
                <div style={{fontSize:"11px",color:V.txt3,marginBottom:"14px"}}>Pot: {fmt(r.totalPot)} · Platform fee: {fmt(r.cut)} (10%)</div>
                <Btn onClick={()=>enterRoom(r)} dis={!ok} v={ok?"pri":"out"} style={{width:"100%",padding:"13px",borderRadius:"12px",fontSize:"14px"}}>
                  {cdLeft>0?`⏳ Cooldown ${fmtT(cdLeft)}`:ok?`⚔️ Enter for ${fmt(r.entry)}`:"💰 Insufficient Balance"}
                </Btn>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ══ PAGE: MATCHMAKING ═════════════════════════════════════
const MatchmakingPage = () => {
  const { room, nav, cancelMatchmaking } = useApp();
  const [dots, setDots] = useState(0);
  useEffect(()=>{ const iv=setInterval(()=>setDots(d=>(d+1)%4),400); return ()=>clearInterval(iv); },[]);
  if (!room) return null;
  return (
    <div style={{minHeight:"100vh",background:V.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",padding:"24px",position:"relative"}}>
      <TopBar/>
      <div style={{textAlign:"center"}}>
        <div style={{position:"relative",width:"160px",height:"160px",margin:"0 auto 32px"}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",border:`4px solid ${room.tc}33`,borderTopColor:room.tc,animation:"spin 1s linear infinite"}}/>
          <div style={{position:"absolute",inset:"18px",borderRadius:"50%",border:`4px solid ${V.pri}33`,borderTopColor:V.pri3,animation:"spin 1.6s linear infinite reverse"}}/>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"52px"}}>🍬</div>
        </div>
        <div style={{fontSize:"22px",fontWeight:"900",marginBottom:"8px",letterSpacing:"-0.5px"}}>
          Finding an opponent{".".repeat(dots)}
        </div>
        <div style={{fontSize:"14px",color:V.txt2,marginBottom:"24px"}}>
          <span style={{color:room.tc,fontWeight:"800"}}>{room.name}</span> · Entry {fmt(room.entry)} · Prize {fmt(room.prize)}
        </div>
        <div style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"14px",padding:"16px 24px",marginBottom:"28px",maxWidth:"320px"}}>
          <div style={{fontSize:"13px",color:V.txt2,lineHeight:1.7}}>
            🔎 Searching the {room.tag==="QUAD"?"4-player":"1v1"} pool...<br/>
            ⚡ Matchmaking is instant — you'll be paired automatically.
          </div>
        </div>
        <Btn v="out" onClick={cancelMatchmaking} style={{padding:"12px 28px"}}>Cancel & Refund</Btn>
      </div>
    </div>
  );
};

// ══ PAGE: GAME ════════════════════════════════════════════
const GamePage = () => {
  const {
    room, board, score, oppScores, sel, burstMask, tLeft, gameOn, gameOver, gResult, cdLeft, disqMsg,
    floatEmojis, emojiCd, handleCell, sendEmoji, nav,
  } = useApp();
  if (!room||!board) return null;
  const allP = [{name:"You",score,me:true},...oppScores.map(o=>({...o,me:false}))];
  const sorted = [...allP].sort((a,b)=>b.score-a.score);
  const myRank = sorted.findIndex(p=>p.me)+1;
  const winning = myRank===1;

  return (
    <div style={{minHeight:"100vh",background:"#07071A",paddingTop:"60px",paddingBottom:"90px",display:"flex",flexDirection:"column",position:"relative",overflow:"hidden"}}>
      <TopBar/>
      {floatEmojis.map(e=>(
        <div key={e.id} style={{position:"fixed",bottom:"32%",left:`${e.x}%`,zIndex:500,pointerEvents:"none",animation:"floatUp 3s ease-out forwards",textAlign:"center"}}>
          <div style={{fontSize:"40px"}}>{e.emoji}</div>
          <div style={{fontSize:"11px",color:"rgba(255,255,255,0.8)",fontWeight:"700",background:"rgba(0,0,0,0.5)",borderRadius:"10px",padding:"2px 6px",marginTop:"2px"}}>{e.fromName}</div>
        </div>
      ))}

      {/* Win celebration confetti */}
      {gameOver && gResult?.won && (
        <div style={{position:"fixed",inset:0,zIndex:600,pointerEvents:"none",overflow:"hidden"}}>
          {Array.from({length:36}).map((_,i)=>(
            <div key={i} style={{
              position:"absolute", top:"-20px", left:`${Math.random()*100}%`,
              width:"10px", height:"10px", borderRadius: i%2===0?"50%":"2px",
              background:[V.acc,V.pink,V.pri3,V.grn,"#fff"][i%5],
              animation:`confettiFall ${2+Math.random()*1.5}s linear ${Math.random()*0.6}s forwards`,
            }}/>
          ))}
        </div>
      )}

      <div style={{background:"rgba(7,7,26,0.97)",borderBottom:`1px solid ${V.border}`,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{background:`${room.tc}1A`,border:`1px solid ${room.tc}55`,borderRadius:"8px",padding:"6px 12px",fontSize:"12px",fontWeight:"800",color:room.tc}}>{room.name}</div>
          <div style={{fontSize:"12px",color:V.txt2}}>Prize: <span style={{color:V.grn,fontWeight:"800"}}>{fmt(room.prize)}</span></div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:"38px",fontWeight:"900",fontFamily:"monospace",letterSpacing:"3px",lineHeight:1,
            animation: tLeft<=10 && gameOn ? "timerPulse 1s infinite" : undefined,
            color:tLeft<=10?V.red:tLeft<=30?V.acc:"#fff"}}>{fmtT(tLeft)}</div>
          <div style={{fontSize:"9px",color:V.txt3,letterSpacing:"2px"}}>TIME REMAINING</div>
        </div>
        <Btn v="out" onClick={()=>nav("lobby")} style={{padding:"8px 14px",fontSize:"12px"}}>Exit</Btn>
      </div>

      <div style={{flex:1,display:"flex",padding:"14px 14px",gap:"14px",maxWidth:"1100px",margin:"0 auto",width:"100%",boxSizing:"border-box",flexWrap:"wrap",alignItems:"flex-start"}}>
        <div style={{width:"170px",flexShrink:0,display:"flex",flexDirection:"column",gap:"10px"}}>
          <Card style={{padding:"12px"}}>
            <div style={{fontSize:"10px",color:V.txt3,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"10px"}}>🏆 RANKINGS</div>
            {sorted.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 8px",borderRadius:"9px",marginBottom:"4px",background:p.me?`rgba(109,40,217,0.22)`:"transparent",border:p.me?`1px solid rgba(109,40,217,0.35)`:"1px solid transparent"}}>
                <div style={{width:"20px",height:"20px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:"800",background:i===0?V.acc:i===1?"#9CA3AF":i===2?"#CD7F32":"rgba(255,255,255,0.08)",color:i<3?"#000":V.txt2}}>{i+1}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"10px",fontWeight:"700",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:p.me?V.pri3:p.flagged?"#FF8888":V.txt}}>
                    {p.me?"You ✦":p.name}{p.isBot?" 🤖":""}
                  </div>
                  <div style={{fontSize:"14px",fontWeight:"900",color:p.me?V.pri3:V.txt}}>{p.score.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </Card>
          <Card style={{textAlign:"center",padding:"14px"}}>
            <div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"6px"}}>YOUR SCORE</div>
            <div style={{fontSize:"40px",fontWeight:"900",color:V.pri3,lineHeight:1,letterSpacing:"-2px"}}>{score.toLocaleString()}</div>
            <div style={{fontSize:"11px",color: winning?V.grn:V.txt3,marginTop:"6px",fontWeight:"700"}}>{winning?"🟢 Leading":"🔴 Behind"} · Rank #{myRank}</div>
          </Card>
          {cdLeft>0&&<Card style={{textAlign:"center",padding:"12px"}}><div style={{fontSize:"10px",color:V.acc,letterSpacing:"1.5px",marginBottom:"4px"}}>⏳ COOLDOWN</div><div style={{fontSize:"22px",fontWeight:"900",color:V.acc,fontFamily:"monospace"}}>{fmtT(cdLeft)}</div></Card>}
          {gameOn&&(
            <Card style={{padding:"10px"}}>
              <div style={{fontSize:"10px",color:V.txt3,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"8px"}}>SEND EMOJI</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                {GAME_EMOJIS.map(e=>(
                  <button key={e} onClick={()=>sendEmoji(e)} style={{fontSize:"18px",background:"rgba(255,255,255,0.07)",border:`1px solid ${V.border}`,borderRadius:"7px",width:"32px",height:"32px",cursor:emojiCd?"not-allowed":"pointer",opacity:emojiCd?.5:1,fontFamily:"inherit"}}>{e}</button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"12px"}}>
          {disqMsg&&(
            <div style={{width:"100%",background:"rgba(239,68,68,0.1)",border:`1px solid ${V.red}44`,borderRadius:"16px",padding:"22px",textAlign:"center"}}>
              <div style={{fontSize:"36px",marginBottom:"10px"}}>🚫</div>
              <div style={{fontSize:"20px",fontWeight:"900",color:V.red,marginBottom:"8px"}}>Disqualified</div>
              <div style={{fontSize:"13px",color:V.txt2,marginBottom:"16px"}}>{disqMsg}</div>
              <Btn v="out" onClick={()=>nav("lobby")}>← Back to Lobby</Btn>
            </div>
          )}
          {gameOver&&gResult&&!gResult.disqualified&&(
            <div style={{width:"100%",background:gResult.won?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.08)",border:`1px solid ${gResult.won?V.grn:V.red}44`,borderRadius:"16px",padding:"24px",textAlign:"center"}}>
              <div style={{fontSize:"50px",marginBottom:"10px"}}>{gResult.won?"🏆":"😔"}</div>
              <div style={{fontSize:"24px",fontWeight:"900",color:gResult.won?V.grn:V.red,marginBottom:"8px"}}>
                {gResult.won?`🎉 Congratulations! You Won ${fmt(gResult.prize)}!`:"Better Luck Next Time!"}
              </div>
              {gResult.winner?.isBot && !gResult.won && <div style={{fontSize:"12px",color:V.txt3,marginBottom:"10px"}}>Defeated by {gResult.winner.name} 🤖</div>}
              {cdLeft>0&&<div style={{fontSize:"13px",color:V.acc,marginBottom:"14px",fontWeight:"600"}}>⏳ Cooldown: {fmtT(cdLeft)}</div>}
              <div style={{display:"flex",gap:"10px",justifyContent:"center",flexWrap:"wrap"}}>
                <Btn v="out" onClick={()=>nav("lobby")} style={{padding:"10px 22px"}}>← Lobby</Btn>
                {cdLeft===0&&<Btn v="gold" onClick={()=>nav("lobby")} style={{padding:"10px 22px"}}>🔄 Play Again</Btn>}
                <Btn onClick={()=>nav("wallet")} style={{padding:"10px 22px"}}>💰 Wallet</Btn>
              </div>
            </div>
          )}

          <div style={{background:"linear-gradient(160deg,#1E0535 0%,#120225 100%)",borderRadius:"22px",padding:"12px",border:`2px solid rgba(150,50,220,0.35)`,boxShadow:"0 0 60px rgba(109,40,217,0.2)",opacity:gameOver?0.65:1,transition:"opacity .4s"}}>
            {board.map((row,r)=>(
              <div key={r} style={{display:"flex",gap:"5px",marginBottom:"5px"}}>
                {row.map((cv,c)=>(
                  <BoardCell key={c} onClick={()=>handleCell(r,c)}>
                    <CandyCell type={cv} selected={sel&&sel.r===r&&sel.c===c} bursting={burstMask?.[r]?.[c]} size={42}/>
                  </BoardCell>
                ))}
              </div>
            ))}
          </div>
          {gameOn&&<div style={{fontSize:"12px",color:V.txt3,letterSpacing:"0.5px"}}>Tap a candy → tap adjacent to swap · 3+ in a row scores</div>}
        </div>
      </div>
    </div>
  );
};

// ══ PAGE: WALLET (Deposit + Withdraw) ════════════════════
const WalletPage = () => {
  const { nav, user, bal, txns, depAmt, setDepAmt, witAmt, setWitAmt, wMsg, doDeposit, doWithdraw, loadTxns } = useApp();
  useEffect(()=>{ loadTxns(); },[]);
  const verified = user?.emailVerified && user?.phoneVerified;
  return (
    <div style={{minHeight:"100vh",paddingTop:"60px",paddingBottom:"90px",background:V.bg}}>
      <TopBar/>
      <div style={{maxWidth:"820px",margin:"0 auto",padding:"24px 16px"}}>
        <h1 style={{fontSize:"26px",fontWeight:"900",marginBottom:"4px",letterSpacing:"-1px"}}>My Wallet</h1>
        <p style={{color:V.txt2,fontSize:"13px",marginBottom:"22px"}}>Fund your account or withdraw your winnings</p>

        <div style={{background:`linear-gradient(135deg,${V.pri} 0%,${V.pink} 100%)`,borderRadius:"22px",padding:"30px",marginBottom:"20px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",right:"-40px",top:"-40px",width:"160px",height:"160px",borderRadius:"50%",background:"rgba(255,255,255,0.08)"}}/>
          <div style={{position:"relative"}}>
            <div style={{fontSize:"13px",opacity:.8,marginBottom:"5px"}}>💰 Available Balance</div>
            <div style={{fontSize:"48px",fontWeight:"900",letterSpacing:"-2px"}}>{fmt(bal)}</div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"16px",marginBottom:"20px"}}>
          {/* DEPOSIT */}
          <Card>
            <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"16px"}}>💳 Fund Account</div>
            <Field label="AMOUNT (MIN ₦100)" value={depAmt} onChange={setDepAmt} placeholder="Enter amount" type="number"/>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",margin:"12px 0"}}>
              {[500,1000,2000,5000].map(a=><button key={a} onClick={()=>setDepAmt(String(a))} style={{padding:"5px 12px",borderRadius:"7px",border:`1px solid ${depAmt==a?V.pri:V.border}`,background:depAmt==a?`${V.pri}28`:"transparent",color:depAmt==a?V.pri3:V.txt2,fontSize:"12px",cursor:"pointer",fontWeight:"700",fontFamily:"inherit"}}>{fmt(a)}</button>)}
            </div>
            <Btn onClick={doDeposit} style={{width:"100%",padding:"13px",borderRadius:"12px"}}>💳 Fund via SquadCo</Btn>
          </Card>

          {/* WITHDRAW */}
          <Card>
            <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"16px"}}>🏦 Withdraw Funds</div>
            {!verified ? (
              <div style={{background:"rgba(245,158,11,0.1)",border:`1px solid rgba(245,158,11,0.3)`,borderRadius:"10px",padding:"14px",fontSize:"13px",color:V.acc,lineHeight:1.7}}>
                ⚠ Verify your <strong>email & phone</strong> to enable withdrawals.
                <div style={{marginTop:"10px"}}><Btn v="gold" onClick={()=>nav("profile")} style={{padding:"9px 18px",fontSize:"13px"}}>Verify in Profile →</Btn></div>
              </div>
            ) : !user?.bankAccount?.accountNumber ? (
              <div style={{background:"rgba(245,158,11,0.1)",border:`1px solid rgba(245,158,11,0.3)`,borderRadius:"10px",padding:"14px",fontSize:"13px",color:V.acc,lineHeight:1.7}}>
                ⚠ Add a <strong>bank account</strong> first to withdraw.
                <div style={{marginTop:"10px"}}><Btn v="gold" onClick={()=>nav("profile")} style={{padding:"9px 18px",fontSize:"13px"}}>Add Bank in Profile →</Btn></div>
              </div>
            ) : (
              <>
                <Field label="AMOUNT (MIN ₦500)" value={witAmt} onChange={setWitAmt} placeholder="Enter amount" type="number"/>
                <div style={{margin:"12px 0",background:"rgba(255,255,255,0.03)",borderRadius:"9px",padding:"11px 13px",fontSize:"13px"}}>
                  <div style={{color:V.txt3,fontSize:"10px",letterSpacing:"1px",marginBottom:"3px"}}>WITHDRAW TO</div>
                  <div style={{fontWeight:"700"}}>{user.bankAccount.bankName} · ••••{user.bankAccount.accountNumber.slice(-4)}</div>
                </div>
                <Btn v="out" onClick={doWithdraw} style={{width:"100%",padding:"13px",borderRadius:"12px"}}>🏦 Withdraw Funds</Btn>
              </>
            )}
            <div style={{fontSize:"11px",color:V.txt3,marginTop:"10px",textAlign:"center"}}>Processing: 1–24 hours</div>
          </Card>
        </div>

        {wMsg&&<div style={{background:wMsg.startsWith("✅")?"rgba(16,185,129,0.12)":"rgba(239,68,68,0.12)",border:`1px solid ${wMsg.startsWith("✅")?V.grn:V.red}55`,borderRadius:"12px",padding:"14px 18px",marginBottom:"20px",textAlign:"center",fontSize:"14px",fontWeight:"700",color:wMsg.startsWith("✅")?V.grn:V.red}}>{wMsg}</div>}

        <Card>
          <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"16px"}}>📋 Transaction History</div>
          {txns.length===0?<div style={{color:V.txt3,textAlign:"center",padding:"24px",fontSize:"14px"}}>No transactions yet</div>:txns.map(t=>(
            <div key={t._id||t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:`1px solid ${V.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                <div style={{width:"38px",height:"38px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",background:["deposit","game_win","bonus","referral_reward"].includes(t.type)?"rgba(16,185,129,0.14)":"rgba(239,68,68,0.12)"}}>
                  {t.type==="game_win"?"🏆":t.type==="bonus"||t.type==="referral_reward"?"🎁":t.type==="deposit"?"↙":"↗"}
                </div>
                <div>
                  <div style={{fontSize:"13px",fontWeight:"600"}}>{t.description}</div>
                  <div style={{fontSize:"11px",color:V.txt3,marginTop:"2px"}}>{(t.createdAt||t.date||"").toString().split("T")[0]}</div>
                </div>
              </div>
              <div style={{fontWeight:"900",fontSize:"14px",color:["deposit","game_win","bonus","referral_reward"].includes(t.type)?V.grn:V.red}}>
                {["deposit","game_win","bonus","referral_reward"].includes(t.type)?"+":"-"}{fmt(t.amount)}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};

// ══ PAGE: PROFILE (email/phone verify + bank + withdraw) ══
const ProfilePage = () => {
  const {
    user, setUser, token, showToast, bal, witAmt, setWitAmt, doWithdraw, wMsg,
  } = useApp();
  const [name, setName]   = useState(user?.name||"");
  const [phone, setPhone] = useState(user?.phone||"");
  const [emailOtp, setEmailOtp] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [phoneSent, setPhoneSent] = useState(false);
  const [devEmailOtp, setDevEmailOtp] = useState("");
  const [devPhoneOtp, setDevPhoneOtp] = useState("");
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState(user?.bankAccount?.bankCode||"");
  const [accNum, setAccNum]     = useState(user?.bankAccount?.accountNumber||"");
  const [accName, setAccName]   = useState(user?.bankAccount?.accountName||"");
  const [saving, setSaving] = useState(false);

  useEffect(()=>{
    apiFetch("GET","/profile/banks",null,token).then(d=>{ if(d.success) setBanks(d.banks); });
  },[]);

  const saveProfile = async () => {
    const d = await apiFetch("PUT","/profile",{ name, phone },token);
    if (d.success) { setUser(d.user); showToast("✅ Profile updated","success"); }
    else showToast("❌ "+d.error,"error");
  };

  const sendEmailOtp = async () => {
    const d = await apiFetch("POST","/profile/email/send-otp",{},token);
    if (d.success) { setEmailSent(true); setDevEmailOtp(d.devOtp||""); showToast("📧 Code sent (check below for now)","success"); }
    else showToast("❌ "+d.error,"error");
  };
  const verifyEmailOtp = async () => {
    const d = await apiFetch("POST","/profile/email/verify",{ otp:emailOtp },token);
    if (d.success) { setUser(u=>({...u,emailVerified:true})); showToast("✅ Email verified!","success"); }
    else showToast("❌ "+d.error,"error");
  };
  const sendPhoneOtp = async () => {
    if (!phone) return showToast("❌ Enter your phone number first","error");
    const d = await apiFetch("POST","/profile/phone/send-otp",{ phone },token);
    if (d.success) { setPhoneSent(true); setDevPhoneOtp(d.devOtp||""); showToast("📱 Code sent (check below for now)","success"); }
    else showToast("❌ "+d.error,"error");
  };
  const verifyPhoneOtp = async () => {
    const d = await apiFetch("POST","/profile/phone/verify",{ otp:phoneOtp },token);
    if (d.success) { setUser(u=>({...u,phoneVerified:true,phone})); showToast("✅ Phone verified!","success"); }
    else showToast("❌ "+d.error,"error");
  };
  const saveBank = async () => {
    if (!bankCode||!accNum||!accName) return showToast("❌ Fill all bank fields","error");
    setSaving(true);
    const d = await apiFetch("PUT","/profile/bank",{ bankName: banks.find(b=>b.code===bankCode)?.name, bankCode, accountNumber:accNum, accountName:accName },token);
    setSaving(false);
    if (d.success) { setUser(d.user); showToast("✅ Bank account saved","success"); }
    else showToast("❌ "+d.error,"error");
  };

  const verified = user?.emailVerified && user?.phoneVerified;

  return (
    <div style={{minHeight:"100vh",paddingTop:"60px",paddingBottom:"90px",background:V.bg}}>
      <TopBar/>
      <div style={{maxWidth:"600px",margin:"0 auto",padding:"24px 16px"}}>
        <h1 style={{fontSize:"26px",fontWeight:"900",marginBottom:"4px",letterSpacing:"-1px"}}>My Profile</h1>
        <p style={{color:V.txt2,fontSize:"13px",marginBottom:"22px"}}>Verify your details to unlock withdrawals</p>

        {/* Basic info */}
        <Card style={{marginBottom:"16px"}}>
          <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"16px"}}>👤 Basic Information</div>
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <Field label="FULL NAME" value={name} onChange={setName} placeholder="Your name"/>
            <Btn onClick={saveProfile} v="out" style={{padding:"11px",fontSize:"13px"}}>Save Name</Btn>
          </div>
        </Card>

        {/* Email verification */}
        <Card style={{marginBottom:"16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
            <div style={{fontWeight:"800",fontSize:"16px"}}>📧 Email Verification</div>
            {user?.emailVerified
              ? <span style={{background:"rgba(16,185,129,0.15)",color:V.grn,borderRadius:"7px",padding:"4px 12px",fontSize:"12px",fontWeight:"800"}}>✅ Verified</span>
              : <span style={{background:"rgba(245,158,11,0.15)",color:V.acc,borderRadius:"7px",padding:"4px 12px",fontSize:"12px",fontWeight:"800"}}>Pending</span>}
          </div>
          <div style={{fontSize:"14px",color:V.txt2,marginBottom:"12px"}}>{user?.email}</div>
          {!user?.emailVerified && (
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {!emailSent ? (
                <Btn v="gold" onClick={sendEmailOtp} style={{padding:"11px",fontSize:"13px"}}>Send Verification Code</Btn>
              ) : (
                <>
                  {devEmailOtp && <div style={{background:"rgba(109,40,217,0.1)",border:`1px solid ${V.pri}44`,borderRadius:"9px",padding:"10px",fontSize:"12px",color:V.pri3}}>
                    📨 Demo mode — your code is <strong style={{fontSize:"16px",letterSpacing:"3px"}}>{devEmailOtp}</strong> (connect an email provider to send this for real)
                  </div>}
                  <Field label="ENTER 6-DIGIT CODE" value={emailOtp} onChange={v=>setEmailOtp(v.replace(/\D/g,"").slice(0,6))} placeholder="000000"/>
                  <Btn onClick={verifyEmailOtp} style={{padding:"11px",fontSize:"13px"}}>Verify Email</Btn>
                </>
              )}
            </div>
          )}
        </Card>

        {/* Phone verification */}
        <Card style={{marginBottom:"16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
            <div style={{fontWeight:"800",fontSize:"16px"}}>📱 Phone Verification</div>
            {user?.phoneVerified
              ? <span style={{background:"rgba(16,185,129,0.15)",color:V.grn,borderRadius:"7px",padding:"4px 12px",fontSize:"12px",fontWeight:"800"}}>✅ Verified</span>
              : <span style={{background:"rgba(245,158,11,0.15)",color:V.acc,borderRadius:"7px",padding:"4px 12px",fontSize:"12px",fontWeight:"800"}}>Pending</span>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <Field label="PHONE NUMBER" value={phone} onChange={setPhone} placeholder="08012345678"/>
            {!user?.phoneVerified && (
              !phoneSent ? (
                <Btn v="gold" onClick={sendPhoneOtp} style={{padding:"11px",fontSize:"13px"}}>Send Verification Code</Btn>
              ) : (
                <>
                  {devPhoneOtp && <div style={{background:"rgba(109,40,217,0.1)",border:`1px solid ${V.pri}44`,borderRadius:"9px",padding:"10px",fontSize:"12px",color:V.pri3}}>
                    📨 Demo mode — your code is <strong style={{fontSize:"16px",letterSpacing:"3px"}}>{devPhoneOtp}</strong> (connect an SMS provider to send this for real)
                  </div>}
                  <Field label="ENTER 6-DIGIT CODE" value={phoneOtp} onChange={v=>setPhoneOtp(v.replace(/\D/g,"").slice(0,6))} placeholder="000000"/>
                  <Btn onClick={verifyPhoneOtp} style={{padding:"11px",fontSize:"13px"}}>Verify Phone</Btn>
                </>
              )
            )}
          </div>
        </Card>

        {/* Bank account — all Nigerian banks */}
        <Card style={{marginBottom:"16px"}}>
          <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"14px"}}>🏦 Bank Account for Withdrawals</div>
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <Select label="SELECT YOUR BANK" value={bankCode} onChange={setBankCode} options={banks} placeholder="Choose your bank..."/>
            <Field label="ACCOUNT NUMBER (10 DIGITS)" value={accNum} onChange={v=>setAccNum(v.replace(/\D/g,"").slice(0,10))} placeholder="0123456789"/>
            <Field label="ACCOUNT NAME" value={accName} onChange={setAccName} placeholder="Name on the bank account"/>
            <Btn onClick={saveBank} dis={saving} v="gold" style={{padding:"12px",fontSize:"14px"}}>{saving?"Saving...":"💾 Save Bank Account"}</Btn>
          </div>
        </Card>

        {/* Withdraw right here too */}
        <Card>
          <div style={{fontWeight:"800",fontSize:"16px",marginBottom:"14px"}}>💸 Withdraw to Bank</div>
          <div style={{fontSize:"13px",color:V.txt2,marginBottom:"12px"}}>Available: <strong style={{color:V.acc}}>{fmt(bal)}</strong></div>
          {!verified ? (
            <div style={{background:"rgba(245,158,11,0.1)",border:`1px solid rgba(245,158,11,0.3)`,borderRadius:"9px",padding:"12px",fontSize:"13px",color:V.acc}}>
              ⚠ Complete email & phone verification above to enable withdrawals.
            </div>
          ) : !user?.bankAccount?.accountNumber ? (
            <div style={{background:"rgba(245,158,11,0.1)",border:`1px solid rgba(245,158,11,0.3)`,borderRadius:"9px",padding:"12px",fontSize:"13px",color:V.acc}}>
              ⚠ Save a bank account above to enable withdrawals.
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              <Field label="AMOUNT (MIN ₦500)" value={witAmt} onChange={setWitAmt} placeholder="Enter amount" type="number"/>
              <Btn onClick={doWithdraw} v="out" style={{padding:"12px",fontSize:"14px"}}>🏦 Withdraw Now</Btn>
            </div>
          )}
          {wMsg&&<div style={{marginTop:"12px",fontSize:"13px",fontWeight:"700",color:wMsg.startsWith("✅")?V.grn:V.red}}>{wMsg}</div>}
        </Card>
      </div>
    </div>
  );
};

// ══ PAGE: REFERRAL (bold redesign) ════════════════════════
const ReferralPage = () => {
  const { user, refData, loadReferral, showToast } = useApp();
  useEffect(()=>{ loadReferral(); },[]);
  const link = refData?.referralLink||`${window.location.origin}?ref=${user?.referralCode||""}`;
  const copy = (text,label) => { navigator.clipboard.writeText(text); showToast(`✅ ${label} copied!`,"success"); };

  return (
    <div style={{minHeight:"100vh",paddingTop:"60px",paddingBottom:"90px",background:V.bg}}>
      <TopBar/>
      <div style={{maxWidth:"640px",margin:"0 auto",padding:"24px 16px"}}>
        <div style={{textAlign:"center",marginBottom:"24px"}}>
          <div style={{fontSize:"48px",marginBottom:"10px"}}>🎁</div>
          <h1 style={{fontSize:"28px",fontWeight:"900",marginBottom:"6px",letterSpacing:"-0.8px"}}>Refer & Earn</h1>
          <p style={{color:V.txt2,fontSize:"14px",lineHeight:1.7}}>Earn <strong style={{color:V.acc,fontSize:"16px"}}>₦50</strong> instantly when your friend plays their first game!</p>
        </div>

        <Card style={{marginBottom:"16px",padding:"24px",border:`2px solid ${V.pri}44`}}>
          <div style={{textAlign:"center",marginBottom:"18px"}}>
            <div style={{fontSize:"12px",color:V.txt3,letterSpacing:"2px",marginBottom:"10px",fontWeight:"800"}}>YOUR REFERRAL CODE</div>
            <div onClick={()=>copy(user?.referralCode||"","Code")} style={{cursor:"pointer",fontSize:"42px",fontWeight:"900",letterSpacing:"8px",color:"#fff",background:`linear-gradient(135deg,${V.pri},${V.pink})`,borderRadius:"16px",padding:"20px",boxShadow:`0 8px 30px rgba(109,40,217,0.4)`}}>
              {user?.referralCode||"••••••••"}
            </div>
            <div style={{fontSize:"11px",color:V.txt3,marginTop:"8px"}}>Tap to copy</div>
          </div>

          <div style={{fontSize:"11px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"8px",fontWeight:"800"}}>SHAREABLE LINK</div>
          <div style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${V.border}`,borderRadius:"12px",padding:"14px",fontSize:"13px",color:V.txt,wordBreak:"break-all",fontWeight:"700",marginBottom:"10px",lineHeight:1.6}}>
            {link}
          </div>
          <Btn onClick={()=>copy(link,"Link")} style={{width:"100%",padding:"13px",fontSize:"15px",fontWeight:"900"}}>📋 Copy Referral Link</Btn>
        </Card>

        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"12px",marginBottom:"16px"}}>
          {[{icon:"👥",l:"Total Referred",v:refData?.totalReferrals||0,c:V.pri3},{icon:"🏆",l:"Rewarded",v:refData?.rewardedCount||0,c:V.grn},{icon:"⏳",l:"Pending",v:refData?.pendingCount||0,c:V.acc},{icon:"💰",l:"Total Earned",v:fmt(refData?.totalEarned||0),c:V.grn}].map(s=>(
            <Card key={s.l} style={{textAlign:"center",padding:"18px"}}>
              <div style={{fontSize:"26px",marginBottom:"8px"}}>{s.icon}</div>
              <div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"6px",fontWeight:"800"}}>{s.l.toUpperCase()}</div>
              <div style={{fontSize:"26px",fontWeight:"900",color:s.c}}>{s.v}</div>
            </Card>
          ))}
        </div>

        <Card>
          <div style={{fontWeight:"900",fontSize:"16px",marginBottom:"16px"}}>How It Works</div>
          {[["1","Share your code","Send your code or link to friends"],["2","Friend signs up","They get ₦500 free bonus instantly"],["3","Friend plays","You earn ₦50 the moment they finish their first game"]].map(([n,t,d])=>(
            <div key={n} style={{display:"flex",gap:"14px",alignItems:"flex-start",padding:"12px 0",borderBottom:`1px solid ${V.border}`}}>
              <div style={{width:"30px",height:"30px",borderRadius:"50%",background:`linear-gradient(135deg,${V.pri},${V.pri3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"900",fontSize:"14px",flexShrink:0}}>{n}</div>
              <div><div style={{fontWeight:"800",fontSize:"14px",marginBottom:"2px"}}>{t}</div><div style={{fontSize:"12px",color:V.txt2}}>{d}</div></div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};

// ══ ADMIN PAGES (hidden via #masteradmin) ════════════════
const AdminLoginPage = () => {
  const { aLE, setALE, aLP, setALP, adminErr, doAdminLogin, nav } = useApp();
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:`radial-gradient(ellipse 70% 55% at 50% -5%,rgba(109,40,217,0.18),transparent)`}}>
      <div style={{width:"100%",maxWidth:"400px"}}>
        <div style={{textAlign:"center",marginBottom:"36px"}}><div style={{fontSize:"52px",marginBottom:"12px"}}>🛡️</div><h2 style={{fontSize:"28px",fontWeight:"900",marginBottom:"6px"}}>Admin Portal</h2><p style={{color:V.txt2,fontSize:"13px"}}>Authorised Personnel Only</p></div>
        <Card style={{padding:"28px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            <Field label="ADMIN EMAIL" value={aLE} onChange={setALE} placeholder="admin email" type="email"/>
            <Field label="PASSWORD" value={aLP} onChange={setALP} placeholder="••••••••" type="password"/>
            {adminErr&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"9px",padding:"11px",fontSize:"13px",color:V.red}}>⚠ {adminErr}</div>}
            <Btn onClick={doAdminLogin} style={{padding:"14px",fontSize:"15px",borderRadius:"12px"}}>Access Dashboard →</Btn>
          </div>
        </Card>
        <p style={{textAlign:"center",marginTop:"16px",fontSize:"13px",color:V.txt3,cursor:"pointer"}} onClick={()=>nav("landing")}>← Back to site</p>
      </div>
    </div>
  );
};

const AdminDash = () => {
  const { nav, token, adminTab, setAdminTab, setAdminIn } = useApp();
  const [stats, setStats] = useState(null);
  useEffect(()=>{ apiFetch("GET","/admin/stats",null,token).then(d=>{ if(d.success) setStats(d.stats); }); },[]);
  const S = stats;
  return (
    <div style={{minHeight:"100vh",background:V.bg,display:"flex"}}>
      <div style={{width:"210px",flexShrink:0,background:"rgba(255,255,255,0.02)",borderRight:`1px solid ${V.border}`,display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh"}}>
        <div style={{padding:"20px 16px",borderBottom:`1px solid ${V.border}`,fontWeight:"900"}}>🍬 CrushCash Admin</div>
        <div style={{padding:"10px 8px",flex:1}}>
          {[["overview","📊","Overview"],["rooms","🏠","Rooms"]].map(([tab,icon,label])=>(
            <button key={tab} onClick={()=>setAdminTab(tab)} style={{display:"flex",alignItems:"center",gap:"10px",width:"100%",padding:"11px 14px",border:"none",cursor:"pointer",fontWeight:"700",fontSize:"14px",textAlign:"left",borderRadius:"9px",marginBottom:"2px",fontFamily:"inherit",background:adminTab===tab?`${V.pri}28`:"transparent",color:adminTab===tab?V.pri3:V.txt2}}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
        <div style={{padding:"14px 10px"}}><Btn v="out" onClick={()=>{setAdminIn(false);nav("landing");}} style={{width:"100%",padding:"10px",fontSize:"13px"}}>← Sign Out</Btn></div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"28px"}}>
        {adminTab==="overview"&&(<>
          <h1 style={{fontSize:"24px",fontWeight:"900",marginBottom:"18px"}}>Dashboard Overview</h1>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:"14px"}}>
            {[{l:"Platform Revenue (10%)",v:S?fmt(S.revenue.platform):"—",c:V.grn},{l:"Total Users",v:S?S.users.total:"—",c:V.pri3},{l:"Active Today",v:S?S.users.activeToday:"—",c:V.pink},{l:"Games Today",v:S?S.games.completedToday:"—",c:V.acc},{l:"Fraud Flags",v:S?S.fraud.flaggedUsers:"—",c:V.red}].map(s=>(
              <div key={s.l} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"14px",padding:"18px"}}><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"6px"}}>{s.l.toUpperCase()}</div><div style={{fontSize:"22px",fontWeight:"900",color:s.c}}>{s.v}</div></div>
            ))}
          </div>
        </>)}
        {adminTab==="rooms"&&(
          <div>
            <h1 style={{fontSize:"24px",fontWeight:"900",marginBottom:"18px"}}>Rooms (10% platform fee)</h1>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"12px"}}>
              {ROOMS.map(r=>(
                <div key={r.id} style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px",border:`1px solid ${V.border}`}}>
                  <div style={{fontWeight:"800",fontSize:"13px",marginBottom:"6px"}}>{r.name}</div>
                  <div style={{fontSize:"12px",color:V.txt2}}>Entry {fmt(r.entry)} · Win {fmt(r.prize)} · Cut {fmt(r.cut)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════
export default function App() {
  const [pg, setPg] = useState(()=> (window.location.hash.includes("masteradmin") ? "admin-login" : "landing"));
  const [user, setUser]   = useState(()=>{ try{ return JSON.parse(localStorage.getItem("cc_user")); }catch{ return null; } });
  const [token, setToken] = useState(()=>localStorage.getItem("cc_token")||"");
  const [serverOk, setServerOk] = useState(null);
  const [toast, setToastState] = useState(null);

  const [aMode, setAMode]   = useState("login");
  const [aEmail, setAEmail] = useState("");
  const [aPass, setAPass]   = useState("");
  const [aName, setAName]   = useState("");
  const [aRef, setARef]     = useState("");
  const [aErr, setAErr]     = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [bal, setBal]     = useState(()=>{ try{ const u=JSON.parse(localStorage.getItem("cc_user")); return u?.balance||0; }catch{ return 0; } });
  const [txns, setTxns]   = useState([]);
  const [depAmt, setDepAmt] = useState("");
  const [witAmt, setWitAmt] = useState("");
  const [wMsg, setWMsg]   = useState("");

  const [room, setRoom]       = useState(null);
  const [board, setBoard]     = useState(null);
  const [score, setScore]     = useState(0);
  const [oppScores, setOppScores] = useState([]);
  const [sel, setSel]         = useState(null);
  const [burstMask, setBurstMask] = useState(null);
  const [tLeft, setTLeft]     = useState(GT);
  const [gameOn, setGameOn]   = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [gResult, setGResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [cdLeft, setCdLeft]   = useState(0);
  const [disqMsg, setDisqMsg] = useState("");
  const [floatEmojis, setFloatEmojis] = useState([]);
  const [emojiCd, setEmojiCd] = useState(false);

  const [lFilter, setLFilter] = useState("all");
  const [refData, setRefData] = useState(null);

  const [adminIn, setAdminIn]   = useState(false);
  const [aLE, setALE]           = useState("");
  const [aLP, setALP]           = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [adminTab, setAdminTab] = useState("overview");

  const timerRef  = useRef(null);
  const cdRef     = useRef(null);
  const scoreRef  = useRef(0);
  const socketRef = useRef(null);
  const oppMaxRef = useRef(0);
  const lastVoiceAt = useRef(0);

  useEffect(()=>{ scoreRef.current=score; },[score]);

  const showToast = (msg, type="success") => {
    setToastState({ msg, type });
    setTimeout(()=>setToastState(null), 3500);
  };

  // referral code from URL
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) { setARef(ref.toUpperCase()); setPg("auth"); setAMode("register"); }
  },[]);

  useEffect(()=>{
    fetch(`/api/health`).then(r=>r.json()).then(()=>setServerOk(true)).catch(()=>setServerOk(false));
  },[]);

  useEffect(()=>{
    if (user && token) {
      localStorage.setItem("cc_user", JSON.stringify(user));
      localStorage.setItem("cc_token", token);
      setBal(user.balance||0);
    } else {
      localStorage.removeItem("cc_user");
      localStorage.removeItem("cc_token");
    }
  },[user,token]);

  // ── Socket ──
  useEffect(()=>{
    if (!token||!user) return;
    const s = io({ auth:{token}, transports:["websocket","polling"] });
    socketRef.current = s;

    s.on("room_joined", ()=>{});

    s.on("game_start", d => {
      setSessionId(d.sessionId);
      setBoard(mkBoard()); setScore(0); scoreRef.current=0; oppMaxRef.current=0;
      setSel(null); setBurstMask(null); setTLeft(GT); setGameOn(true); setGameOver(false); setGResult(null); setDisqMsg("");
      setRoom(r => r); // keep room
      setPg("game");
      sounds.start();
      speak("Game starting now. Crush as many candies as you can!");
      startTimer();
    });

    s.on("score_broadcast", d => {
      const opps = d.scoreboard.filter(p=>p.userId!==user._id).map(p=>({ name:p.name, score:p.score, flagged:p.flagged, isBot:p.isBot }));
      setOppScores(opps);
      const maxOpp = opps.length ? Math.max(...opps.map(o=>o.score)) : 0;
      oppMaxRef.current = maxOpp;

      const now = Date.now();
      if (now - lastVoiceAt.current > 22000) {
        lastVoiceAt.current = now;
        const my = scoreRef.current;
        if (my > maxOpp + 50) speak("You are in the lead. Keep going!");
        else if (maxOpp > my + 50) speak("Your opponent is ahead. Speed up!");
        else speak("It's a close match. Stay focused!");
      }
    });

    s.on("game_over", d => {
      clearInterval(timerRef.current);
      setGameOn(false); setGameOver(true);
      const won = !d.cancelled && d.winner?.userId === user._id;
      setGResult({ ...d, won });
      if (won) { setBal(b=>b+d.prize); sounds.win(); speak("Congratulations! You won this match!"); }
      else if (!d.cancelled) { sounds.lose(); }
      startCd();
    });

    s.on("emoji_received", d => {
      const id = Date.now()+Math.random();
      setFloatEmojis(p=>[...p,{...d,id,x:15+Math.random()*70}]);
      setTimeout(()=>setFloatEmojis(p=>p.filter(e=>e.id!==id)),3200);
    });

    s.on("disqualified", d => {
      clearInterval(timerRef.current);
      setGameOn(false); setGameOver(true); setDisqMsg(d.reason); setGResult({ disqualified:true });
    });

    s.on("refunded", d => { setBal(b=>b+d.amount); setRoom(null); setPg("lobby"); showToast(`✅ Refunded ${fmt(d.amount)}`,"success"); });

    s.on("error", d => {
      showToast(d.message || "Something went wrong","error");
      // If join failed, go back to lobby from matchmaking
      setRoom(r => { if (r) setPg("lobby"); return null; });
    });

    return ()=>{ s.disconnect(); socketRef.current=null; };
  },[token]);

  const startTimer = () => {
    clearInterval(timerRef.current);
    setTLeft(GT);
    timerRef.current = setInterval(()=>setTLeft(t=>{
      if (t<=11 && t>1) sounds.danger();
      else if (t>11) sounds.tick();
      if(t<=1){ clearInterval(timerRef.current); return 0; }
      return t-1;
    }),1000);
  };
  const startCd = () => {
    clearInterval(cdRef.current);
    setCdLeft(CD);
    cdRef.current = setInterval(()=>setCdLeft(t=>{ if(t<=1){ clearInterval(cdRef.current); return 0; } return t-1; }),1000);
  };

  useEffect(()=>{
    if (!gameOn || !sessionId) return;
    const iv = setInterval(()=>{ socketRef.current?.emit("score_update",{sessionId,score:scoreRef.current}); },2200);
    return ()=>clearInterval(iv);
  },[gameOn,sessionId]);

  const nav = useCallback(p=>{
    if (p==="admin-login"||p==="admin") window.location.hash="masteradmin";
    else if (window.location.hash.includes("masteradmin")) window.location.hash="";
    setPg(p);
  },[]);

  // ── AUTH ──
  const doAuth = async () => {
    setAErr(""); setAuthLoading(true);
    try {
      if (aMode==="login") {
        if (!aEmail||!aPass) return setAErr("Please fill all fields");
        const d = await apiFetch("POST","/auth/login",{ email:aEmail, password:aPass });
        if (!d.success) return setAErr(d.error||"Login failed");
        setUser(d.user); setToken(d.token); setBal(d.user.balance||0); nav("lobby");
      } else {
        if (!aName||!aEmail||!aPass) return setAErr("Please fill all fields");
        if (aPass.length<6) return setAErr("Password must be 6+ characters");
        const d = await apiFetch("POST","/auth/register",{ name:aName, email:aEmail, password:aPass, referralCode:aRef||undefined });
        if (!d.success) return setAErr(d.error||"Registration failed");
        setUser(d.user); setToken(d.token); setBal(d.user.balance||0); nav("lobby");
      }
    } finally { setAuthLoading(false); }
  };
  const doLogout = () => { setUser(null); setToken(""); socketRef.current?.disconnect(); nav("landing"); };

  // ── GAME ──
  const enterRoom = r => {
    if (!user) { nav("auth"); return; }
    if (bal<r.entry) { showToast(`You need ${fmt(r.entry)} to enter.`,"error"); return; }
    if (cdLeft>0) { showToast(`Cooldown active. Wait ${fmtT(cdLeft)}.`,"error"); return; }
    setRoom(r); setBoard(null); setScore(0); scoreRef.current=0; setSel(null); setBurstMask(null);
    setTLeft(GT); setGameOn(false); setGameOver(false); setGResult(null);
    setDisqMsg(""); setOppScores([]); setSessionId(null); setFloatEmojis([]);
    socketRef.current?.emit("join_room",{ roomId:r.id });
    nav("matchmaking");
  };
  const cancelMatchmaking = () => {
    if (sessionId) socketRef.current?.emit("leave_room",{ sessionId });
    setRoom(null); setSessionId(null); nav("lobby");
  };

  const handleCell = (r,c) => {
    if (!gameOn||gameOver||disqMsg||burstMask) return;
    if (!sel) { setSel({r,c}); sounds.select(); return; }
    if (sel.r===r&&sel.c===c) { setSel(null); return; }
    if (isAdj(sel.r,sel.c,r,c)) {
      const res = trySwap(board,sel.r,sel.c,r,c);
      if (res) {
        sounds.swap();
        setBoard(res.swapped);
        setBurstMask(res.mask);
        setSel(null);
        setTimeout(() => {
          const { b, pts, combo } = resolve(res.swapped);
          sounds.burst(combo);
          setBoard(b);
          setBurstMask(null);
          setScore(s=>{ const ns=s+pts; scoreRef.current=ns; return ns; });
        }, 220);
      } else {
        sounds.invalid();
        setSel({r,c});
      }
    } else { setSel({r,c}); sounds.select(); }
  };

  const sendEmoji = emoji => {
    if (!sessionId||emojiCd) return;
    socketRef.current?.emit("send_emoji",{sessionId,emoji});
    setEmojiCd(true); setTimeout(()=>setEmojiCd(false),2000);
  };

  // ── WALLET ──
  const showWMsg = msg => { setWMsg(msg); setTimeout(()=>setWMsg(""),4000); };
  const doDeposit = async () => {
    const amt=parseInt(depAmt);
    if(!amt||amt<100) return showWMsg("❌ Minimum deposit is ₦100");
    const d=await apiFetch("POST","/wallet/deposit/initiate",{amount:amt},token);
    if(!d.success) return showWMsg("❌ "+(d.error||"Failed"));
    window.open(d.checkoutUrl,"_blank");
    setDepAmt(""); showWMsg("✅ SquadCo checkout opened. Return after payment.");
  };
  const doWithdraw = async () => {
    const amt=parseInt(witAmt);
    if(!amt||amt<500) return showWMsg("❌ Minimum withdrawal is ₦500");
    if(amt>bal) return showWMsg("❌ Insufficient balance");
    const d=await apiFetch("POST","/wallet/withdraw",{amount:amt},token);
    if(!d.success) return showWMsg("❌ "+(d.error||"Failed"));
    setBal(d.newBalance); setWitAmt(""); showWMsg(`✅ ₦${amt.toLocaleString()} withdrawal initiated`);
  };
  const loadTxns = async () => { if(!token) return; const d=await apiFetch("GET","/wallet/transactions",null,token); if(d.success) setTxns(d.transactions); };
  const loadReferral = async () => { const d=await apiFetch("GET","/referral/my",null,token); if(d.success) setRefData(d); };

  const doAdminLogin = () => {
    if(aLE===ADMIN_CREDS.email&&aLP===ADMIN_CREDS.pass){ setAdminIn(true); setAdminErr(""); setPg("admin"); }
    else setAdminErr("Invalid credentials");
  };

  const ctxValue = {
    pg, nav, user, setUser, token, bal, setBal, serverOk, toast, showToast,
    aMode, setAMode, aEmail, setAEmail, aPass, setAPass, aName, setAName, aRef, setARef, aErr, doAuth, authLoading,
    txns, depAmt, setDepAmt, witAmt, setWitAmt, wMsg, doDeposit, doWithdraw, loadTxns,
    room, board, score, oppScores, sel, burstMask, tLeft, gameOn, gameOver, gResult, sessionId, cdLeft, disqMsg, floatEmojis, emojiCd,
    handleCell, enterRoom, sendEmoji, cancelMatchmaking,
    lFilter, setLFilter,
    refData, loadReferral,
    adminIn, setAdminIn, aLE, setALE, aLP, setALP, adminErr, setAdminErr, adminTab, setAdminTab, doAdminLogin,
    doLogout,
  };

  return (
    <Ctx.Provider value={ctxValue}>
      <CandyDefs/>
      <style>{`
        @keyframes floatUp{0%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-110px) scale(1.6)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes candyDrop{0%{transform:translateY(-22px) scale(0.7);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}
        @keyframes candyBurst{0%{transform:scale(1);opacity:1}60%{transform:scale(1.5);opacity:0.7}100%{transform:scale(0.2);opacity:0}}
        @keyframes timerPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
        @keyframes confettiFall{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(540deg);opacity:0}}
      `}</style>
      <Toast/>
      <div style={{minHeight:"100vh",background:V.bg,color:"#F1F5F9",fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif"}}>
        {pg==="landing"     && <Landing/>}
        {pg==="auth"        && <AuthPage/>}
        {pg==="lobby"       && (user?<LobbyPage/>:<AuthPage/>)}
        {pg==="matchmaking" && (user?<MatchmakingPage/>:<AuthPage/>)}
        {pg==="game"        && (user?<GamePage/>:<AuthPage/>)}
        {pg==="wallet"      && (user?<WalletPage/>:<AuthPage/>)}
        {pg==="profile"     && (user?<ProfilePage/>:<AuthPage/>)}
        {pg==="referral"    && (user?<ReferralPage/>:<AuthPage/>)}
        {pg==="admin-login" && <AdminLoginPage/>}
        {pg==="admin"       && (adminIn?<AdminDash/>:<AdminLoginPage/>)}
      </div>
      <BottomNav/>
    </Ctx.Provider>
  );
}

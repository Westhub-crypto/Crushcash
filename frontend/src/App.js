import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { io } from "socket.io-client";

/* ═══════════════════════════════════════════════════════════
   CRUSHCASH v2  — Fixed: network errors, hidden admin portal
   Admin access: yoursite.com/#masteradmin  (secret URL)
═══════════════════════════════════════════════════════════ */

const API_URL = ""; // same-origin: backend serves this frontend build
const G = 8, GT = 300, CD = 300;

// ── Constants ─────────────────────────────────────────────
const ROOMS = [
  {id:1,name:"Starter Arena",sub:"Begin your journey",entry:100,maxP:2,prize:160,cut:40,tag:"1v1",tc:"#6B7280"},
  {id:2,name:"Bronze Arena",sub:"Test your skills",entry:200,maxP:2,prize:320,cut:80,tag:"1v1",tc:"#CD7F32"},
  {id:3,name:"Silver Arena",sub:"Rising competition",entry:500,maxP:2,prize:800,cut:200,tag:"1v1",tc:"#9CA3AF"},
  {id:4,name:"Gold Arena",sub:"High stakes action",entry:1000,maxP:2,prize:1600,cut:400,tag:"1v1",tc:"#F59E0B"},
  {id:5,name:"Platinum Arena",sub:"Elite level battles",entry:2000,maxP:2,prize:3200,cut:800,tag:"1v1",tc:"#67E8F9"},
  {id:6,name:"Diamond Arena",sub:"Top tier showdowns",entry:5000,maxP:2,prize:8000,cut:2000,tag:"1v1",tc:"#818CF8"},
  {id:7,name:"Elite Arena",sub:"Champions only",entry:10000,maxP:2,prize:16000,cut:4000,tag:"1v1",tc:"#F43F5E"},
  {id:8,name:"Quad Bronze",sub:"4-player bronze war",entry:500,maxP:4,prize:1600,cut:400,tag:"QUAD",tc:"#CD7F32",q:true},
  {id:9,name:"Quad Gold",sub:"4-way gold battle",entry:2000,maxP:4,prize:6400,cut:1600,tag:"QUAD",tc:"#F59E0B",q:true},
  {id:10,name:"Quad Elite",sub:"Ultimate 4-player war",entry:5000,maxP:4,prize:16000,cut:4000,tag:"QUAD",tc:"#C084FC",q:true},
];
const GAME_EMOJIS = ["🔥","😂","💀","👑","🎮","😤","🏆","😎","💪","🍬","😱","❤️","🤣","😈","🙌"];
const ADMIN_CREDS = { email:"godwinoloja4@gmail.com", pass:"@Westpablo1" };

// ── Design tokens ─────────────────────────────────────────
const V = {
  bg:"#07071A", card:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.07)",
  pri:"#6D28D9", pri2:"#7C3AED", pri3:"#8B5CF6",
  acc:"#F59E0B", pink:"#EC4899", grn:"#10B981",
  red:"#EF4444", txt:"#F1F5F9", txt2:"#94A3B8", txt3:"#475569",
};

// ── Game engine ───────────────────────────────────────────
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
  return{b,pts};
};
const trySwap=(b,r1,c1,r2,c2)=>{
  const nb=b.map(r=>[...r]);
  [nb[r1][c1],nb[r2][c2]]=[nb[r2][c2],nb[r1][c1]];
  return getM(nb).flat().some(Boolean)?resolve(nb):null;
};
const isAdj=(r1,c1,r2,c2)=>(Math.abs(r1-r2)+Math.abs(c1-c2))===1;

// ── Helpers ───────────────────────────────────────────────
const fmt  = n => `₦${Number(n).toLocaleString()}`;
const fmtT = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

// ── apiFetch: robust with timeout + clear error messages ──
const apiFetch = async (method, path, body, token) => {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 35000); // 35s — allow for Render cold start
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization:`Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    clearTimeout(tid);
    // Try to parse JSON regardless of status
    const data = await res.json().catch(() => ({ success:false, error:`Server returned status ${res.status}` }));
    return data;
  } catch (err) {
    clearTimeout(tid);
    if (err.name === "AbortError") {
      return { success:false, error:"Server is waking up (this can take up to 60 seconds on Render free tier). Please wait a moment and try again." };
    }
    return { success:false, error:"Cannot connect to server. Please check your internet connection and try again." };
  }
};

// ── Wake backend on load ──────────────────────────────────
const wakeBackend = () => {
  fetch(`/api/health`).catch(() => {});
};

// ── Check if we're on the secret admin route ──────────────
const isAdminRoute = () =>
  window.location.hash.toLowerCase().includes("masteradmin") ||
  window.location.pathname.toLowerCase().includes("masteradmin");

// ══ CONTEXT ══════════════════════════════════════════════
const Ctx = createContext({});
const useApp = () => useContext(Ctx);

// ══ CANDY DEFS (module-level) ════════════════════════════
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

// ══ CANDY CELL (module-level) ════════════════════════════
const CandyCell = ({ type, selected, size=46 }) => {
  const s=size, cx=s/2, cy=s/2, r=s/2-1.5;
  const filt = selected?"url(#cselect)":"url(#cshadow)";
  if (type===5) {
    const pr=s*0.215, dist=s*0.175;
    const petals=[[cx,cy-dist],[cx+dist*0.866,cy-dist*0.5],[cx+dist*0.866,cy+dist*0.5],[cx,cy+dist],[cx-dist*0.866,cy+dist*0.5],[cx-dist*0.866,cy-dist*0.5]];
    return (<div style={{position:"relative",width:s,height:s,display:"flex",alignItems:"center",justifyContent:"center"}}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}>{petals.map(([px,py],i)=><circle key={i} cx={px} cy={py} r={pr} fill="url(#cg5)"/>)}<circle cx={cx} cy={cy} r={s*0.235} fill="url(#cg5c)"/><ellipse cx={cx*0.72} cy={cy*0.65} rx={s*0.12} ry={s*0.09} fill="rgba(255,255,255,0.58)"/>{selected&&<circle cx={cx} cy={cy} r={s*0.48} fill="none" stroke="white" strokeWidth="2.5"/>}</svg></div>);
  }
  if (type===2) {
    const d=`M${cx},${s*0.04} C${s*0.6},${s*0.04} ${s*0.92},${s*0.42} ${s*0.92},${s*0.62} C${s*0.92},${s*0.83} ${s*0.7},${s*0.96} ${cx},${s*0.96} C${s*0.3},${s*0.96} ${s*0.08},${s*0.83} ${s*0.08},${s*0.62} C${s*0.08},${s*0.42} ${s*0.4},${s*0.04} ${cx},${s*0.04}Z`;
    return (<div style={{position:"relative",width:s,height:s}}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}><path d={d} fill="url(#cg2)"/><ellipse cx={cx*0.76} cy={cy*0.78} rx={s*0.14} ry={s*0.19} fill="rgba(255,255,255,0.55)"/>{selected&&<path d={d} fill="none" stroke="white" strokeWidth="2.5"/>}</svg></div>);
  }
  return (<div style={{position:"relative",width:s,height:s}}><svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} filter={filt}><circle cx={cx} cy={cy} r={r} fill={`url(#cg${type})`}/><ellipse cx={cx*0.63} cy={cy*0.54} rx={r*0.43} ry={r*0.31} fill="rgba(255,255,255,0.60)"/><ellipse cx={cx*0.44} cy={cy*0.38} rx={r*0.14} ry={r*0.1} fill="rgba(255,255,255,0.75)"/><ellipse cx={cx} cy={cy+r*0.58} rx={r*0.48} ry={r*0.18} fill="rgba(255,255,255,0.10)"/>{selected&&<circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.12)" stroke="white" strokeWidth="2.5"/>}</svg></div>);
};

const BoardCell = ({ children, onClick }) => (
  <div onClick={onClick} style={{width:"52px",height:"52px",borderRadius:"11px",background:"linear-gradient(160deg,#3D1257 0%,#270840 100%)",boxShadow:"inset 0 2px 5px rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
    {children}
  </div>
);

// ══ SHARED UI (module-level — CRITICAL for input focus) ══
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

// ⚠ CRITICAL: Field MUST be outside App — prevents input losing focus on each keystroke
const Field = ({ label, value, onChange, placeholder, type="text" }) => (
  <div>
    {label && <div style={{fontSize:"11px",color:V.txt2,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"7px"}}>{label}</div>}
    <input
      value={value}
      onChange={e=>onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      autoComplete={type==="password"?"current-password":"on"}
      style={{width:"100%",background:"rgba(255,255,255,0.05)",border:`1px solid ${V.border}`,borderRadius:"10px",padding:"13px 15px",color:V.txt,fontSize:"15px",outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border .2s",WebkitTextFillColor:V.txt}}
      onFocus={e=>e.target.style.borderColor=V.pri3}
      onBlur={e=>e.target.style.borderColor=V.border}
    />
  </div>
);

// ══ NAVBAR ════════════════════════════════════════════════
const Navbar = ({ links=true }) => {
  const { nav, user, bal, doLogout, serverOk } = useApp();
  return (
    <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:300,background:"rgba(7,7,26,0.92)",backdropFilter:"blur(24px)",borderBottom:`1px solid ${V.border}`,padding:"0 24px",height:"64px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={()=>nav(user?"lobby":"landing")}>
        <div style={{width:"38px",height:"38px",borderRadius:"10px",background:`linear-gradient(135deg,${V.pri},${V.pink})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"22px"}}>🍬</div>
        <span style={{fontWeight:"900",fontSize:"21px",letterSpacing:"-0.5px",background:`linear-gradient(130deg,#fff 40%,${V.pink})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>CrushCash</span>
        {/* Server status dot */}
        <div title={serverOk===null?"Connecting...":serverOk?"Server online":"Server offline"} style={{width:"8px",height:"8px",borderRadius:"50%",background:serverOk===null?"#F59E0B":serverOk?V.grn:V.red,boxShadow:`0 0 6px ${serverOk===null?"#F59E0B":serverOk?V.grn:V.red}`,marginLeft:"2px"}}/>
      </div>
      {links && user && (
        <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
          <div style={{background:"rgba(245,158,11,0.12)",border:`1px solid rgba(245,158,11,0.25)`,borderRadius:"20px",padding:"6px 14px",fontSize:"14px",color:V.acc,fontWeight:"800",cursor:"pointer"}} onClick={()=>nav("wallet")}>💰 {fmt(bal)}</div>
          <Btn v="ghost" onClick={()=>nav("lobby")} style={{fontSize:"13px",padding:"6px 12px"}}>Lobby</Btn>
          <Btn v="ghost" onClick={()=>nav("referral")} style={{fontSize:"13px",padding:"6px 12px"}}>Refer 🎁</Btn>
          {user.kycStatus!=="verified"&&<Btn v="ghost" onClick={()=>nav("kyc")} style={{fontSize:"13px",padding:"6px 12px",color:V.acc}}>🔐 KYC</Btn>}
          <div style={{width:"34px",height:"34px",borderRadius:"50%",background:`linear-gradient(135deg,${V.pri},${V.pink})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"900",fontSize:"15px"}}>{user.name?.[0]?.toUpperCase()}</div>
          <Btn v="out" onClick={doLogout} style={{fontSize:"13px",padding:"6px 12px"}}>Sign Out</Btn>
        </div>
      )}
      {links && !user && (
        <div style={{display:"flex",gap:"10px"}}>
          <Btn v="ghost" onClick={()=>nav("auth")}>Sign In</Btn>
          <Btn onClick={()=>nav("auth")} style={{padding:"8px 18px"}}>Get Started →</Btn>
        </div>
      )}
    </nav>
  );
};

// ══ PAGE: LANDING ═════════════════════════════════════════
const Landing = () => {
  const { nav, user } = useApp();
  return (
    <div style={{minHeight:"100vh",paddingTop:"64px"}}>
      <Navbar/>
      <section style={{padding:"90px 24px 70px",textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 90% 60% at 50% -5%,rgba(109,40,217,0.22),transparent)`,pointerEvents:"none"}}/>
        <div style={{display:"inline-flex",alignItems:"center",gap:"8px",background:"rgba(109,40,217,0.14)",border:`1px solid rgba(109,40,217,0.32)`,borderRadius:"24px",padding:"7px 18px",fontSize:"12px",color:V.pri3,fontWeight:"700",marginBottom:"28px",letterSpacing:"1.5px"}}>🔥 NIGERIA'S #1 COMPETITIVE GAMING PLATFORM</div>
        <h1 style={{fontSize:"clamp(40px,7vw,80px)",fontWeight:"900",lineHeight:"1.05",marginBottom:"22px",maxWidth:"820px",margin:"0 auto 22px",letterSpacing:"-2px",background:`linear-gradient(140deg,#fff 35%,${V.pink} 75%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Crush Candies.<br/>Win Real Cash.</h1>
        <p style={{fontSize:"18px",color:V.txt2,maxWidth:"520px",margin:"0 auto 44px",lineHeight:"1.75"}}>Nigeria's premier competitive candy gaming platform. 5-minute rounds. Win up to <strong style={{color:V.acc}}>₦16,000</strong> per match.</p>
        <div style={{display:"flex",gap:"14px",justifyContent:"center",flexWrap:"wrap"}}>
          <Btn onClick={()=>nav("auth")} style={{padding:"16px 38px",fontSize:"16px",borderRadius:"14px"}}>🎮 Start Playing</Btn>
          <Btn v="out" onClick={()=>nav(user?"lobby":"auth")} style={{padding:"16px 34px",fontSize:"16px",borderRadius:"14px"}}>View Rooms →</Btn>
        </div>
        <div style={{display:"flex",gap:"44px",justifyContent:"center",flexWrap:"wrap",marginTop:"64px",paddingTop:"36px",borderTop:`1px solid ${V.border}`}}>
          {[["₦2.4M+","Paid Out"],["3,800+","Players"],["10","Arenas"],["₦500","Sign-up Bonus"],["₦50","Per Referral"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}><div style={{fontSize:"30px",fontWeight:"900",color:V.acc,letterSpacing:"-1px"}}>{v}</div><div style={{fontSize:"11px",color:V.txt3,marginTop:"4px",letterSpacing:"1px",textTransform:"uppercase"}}>{l}</div></div>
          ))}
        </div>
      </section>
      <section style={{padding:"60px 24px",maxWidth:"980px",margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:"48px"}}><div style={{fontSize:"11px",color:V.pri3,fontWeight:"700",letterSpacing:"3px",marginBottom:"12px"}}>HOW IT WORKS</div><h2 style={{fontSize:"clamp(26px,4vw,42px)",fontWeight:"900",letterSpacing:"-1px"}}>Win in 3 Simple Steps</h2></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:"20px"}}>
          {[{n:"01",icon:"💳",t:"Fund Wallet",d:"Deposit via SquadCo. Get ₦500 free on signup!"},{n:"02",icon:"🏠",t:"Pick Your Arena",d:"10 rooms from ₦100–₦10,000. Duels or 4-player battles."},{n:"03",icon:"🏆",t:"Crush & Collect",d:"Play 5 minutes. Highest score wins 80% of the pot instantly."}].map(s=>(
            <div key={s.n} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"20px",padding:"30px",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:"-14px",right:"-4px",fontSize:"85px",fontWeight:"900",opacity:0.04,lineHeight:1}}>{s.n}</div>
              <div style={{fontSize:"40px",marginBottom:"16px"}}>{s.icon}</div>
              <div style={{fontWeight:"800",fontSize:"18px",marginBottom:"8px"}}>{s.t}</div>
              <div style={{color:V.txt2,fontSize:"14px",lineHeight:"1.75"}}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={{padding:"0 24px 80px",maxWidth:"1200px",margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"32px",flexWrap:"wrap",gap:"12px"}}>
          <div><div style={{fontSize:"11px",color:V.pri3,fontWeight:"700",letterSpacing:"3px",marginBottom:"8px"}}>GAME ROOMS</div><h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:"900",letterSpacing:"-1px"}}>10 Competitive Arenas</h2></div>
          <Btn v="out" onClick={()=>nav(user?"lobby":"auth")} style={{fontSize:"13px"}}>See All 10 →</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(255px,1fr))",gap:"16px"}}>
          {ROOMS.slice(0,6).map(r=>(
            <div key={r.id} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"16px",padding:"22px",cursor:"pointer",transition:"all .25s",position:"relative",overflow:"hidden"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=r.tc;e.currentTarget.style.transform="translateY(-5px)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=V.border;e.currentTarget.style.transform="none";}}
              onClick={()=>nav(user?"lobby":"auth")}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:r.tc}}/>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"16px"}}>
                <div><div style={{fontSize:"15px",fontWeight:"800"}}>{r.name}</div><div style={{fontSize:"12px",color:V.txt3,marginTop:"3px"}}>{r.sub}</div></div>
                <span style={{background:`${r.tc}22`,color:r.tc,borderRadius:"6px",padding:"3px 9px",fontSize:"11px",fontWeight:"800"}}>{r.tag}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
                <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"10px",padding:"11px"}}><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"3px"}}>ENTRY</div><div style={{fontWeight:"900",fontSize:"19px",color:V.acc}}>{fmt(r.entry)}</div></div>
                <div style={{background:"rgba(16,185,129,0.07)",border:`1px solid rgba(16,185,129,0.15)`,borderRadius:"10px",padding:"11px"}}><div style={{fontSize:"10px",color:V.grn,letterSpacing:"1.5px",marginBottom:"3px"}}>WIN</div><div style={{fontWeight:"900",fontSize:"19px",color:V.grn}}>{fmt(r.prize)}</div></div>
              </div>
              <div style={{fontSize:"11px",color:V.txt3}}>{r.maxP} players · Platform: {fmt(r.cut)} (20%)</div>
            </div>
          ))}
        </div>
      </section>
      {/* Footer — NO admin link visible to users */}
      <footer style={{borderTop:`1px solid ${V.border}`,padding:"36px 24px",textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",marginBottom:"12px"}}>
          <div style={{width:"32px",height:"32px",borderRadius:"8px",background:`linear-gradient(135deg,${V.pri},${V.pink})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px"}}>🍬</div>
          <span style={{fontWeight:"900",fontSize:"19px"}}>CrushCash</span>
        </div>
        <p style={{color:V.txt3,fontSize:"13px",marginBottom:"6px"}}>© 2025 CrushCash Nigeria Ltd. All rights reserved.</p>
        <p style={{color:V.txt3,fontSize:"12px"}}>18+ Only · Play Responsibly · Powered by SquadCo & MongoDB</p>
      </footer>
    </div>
  );
};

// ══ PAGE: AUTH ════════════════════════════════════════════
const AuthPage = () => {
  const { nav, aMode, setAMode, aEmail, setAEmail, aPass, setAPass, aName, setAName, aRef, setARef, aErr, doAuth, authLoading } = useApp();
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:`radial-gradient(ellipse 80% 55% at 50% -5%,rgba(109,40,217,0.2),transparent)`}}>
      <Navbar links={false}/>
      <div style={{width:"100%",maxWidth:"420px",paddingTop:"64px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <div style={{fontSize:"50px",marginBottom:"12px"}}>🍬</div>
          <h2 style={{fontSize:"28px",fontWeight:"900",marginBottom:"7px",letterSpacing:"-0.8px"}}>{aMode==="login"?"Welcome Back":"Join CrushCash"}</h2>
          <p style={{color:V.txt2,fontSize:"14px"}}>{aMode==="login"?"Sign in to play and win":"Get ₦500 free bonus on signup!"}</p>
        </div>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:"12px",padding:"4px",marginBottom:"22px",border:`1px solid ${V.border}`}}>
          {[["login","Sign In"],["register","Register"]].map(([m,l])=>(
            <button key={m} onClick={()=>setAMode(m)}
              style={{flex:1,padding:"10px",borderRadius:"10px",border:"none",cursor:"pointer",fontWeight:"700",fontSize:"14px",transition:"all .2s",fontFamily:"inherit",background:aMode===m?`linear-gradient(135deg,${V.pri},${V.pri3})`:"transparent",color:aMode===m?"#fff":V.txt2}}>
              {l}
            </button>
          ))}
        </div>
        <Card style={{padding:"28px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {aMode==="register" && <Field label="FULL NAME" value={aName} onChange={setAName} placeholder="Your display name"/>}
            <Field label="EMAIL ADDRESS" value={aEmail} onChange={setAEmail} placeholder="you@example.com" type="email"/>
            <Field label="PASSWORD" value={aPass} onChange={setAPass} placeholder="Enter password" type="password"/>
            {aMode==="register" && <Field label="REFERRAL CODE (optional)" value={aRef} onChange={setARef} placeholder="Enter friend's referral code"/>}
            {aErr && (
              <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"9px",padding:"12px 14px",fontSize:"13px",color:V.red,lineHeight:1.6}}>⚠ {aErr}</div>
            )}
            {aMode==="register" && !aErr && (
              <div style={{background:"rgba(16,185,129,0.1)",border:`1px solid rgba(16,185,129,0.25)`,borderRadius:"9px",padding:"11px 14px",fontSize:"13px",color:V.grn}}>
                🎁 You'll receive ₦500 free credit on registration!
              </div>
            )}
            <Btn onClick={doAuth} dis={authLoading} style={{padding:"14px",fontSize:"15px",borderRadius:"12px",marginTop:"4px"}}>
              {authLoading
                ? <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
                    <span style={{width:"16px",height:"16px",border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.8s linear infinite"}}/>
                    Connecting to server...
                  </span>
                : aMode==="login" ? "Sign In →" : "Create Account →"
              }
            </Btn>
          </div>
        </Card>
        <p style={{textAlign:"center",color:V.txt2,fontSize:"13px",marginTop:"18px"}}>
          {aMode==="login"?"New here? ":"Have an account? "}
          <span style={{color:V.pri3,cursor:"pointer",fontWeight:"700"}} onClick={()=>setAMode(aMode==="login"?"register":"login")}>
            {aMode==="login"?"Create Account":"Sign In"}
          </span>
        </p>
        {/* NO admin portal link visible here */}
      </div>
    </div>
  );
};

// ══ PAGE: LOBBY ═══════════════════════════════════════════
const LobbyPage = () => {
  const { nav, user, bal, lFilter, setLFilter, enterRoom, cdLeft } = useApp();
  const filtered = ROOMS.filter(r=>lFilter==="all"||(lFilter==="1v1"&&r.maxP===2)||(lFilter==="quad"&&r.maxP===4));
  return (
    <div style={{minHeight:"100vh",paddingTop:"64px",background:V.bg}}>
      <Navbar/>
      <div style={{maxWidth:"1200px",margin:"0 auto",padding:"36px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"18px",marginBottom:"32px"}}>
          <div><h1 style={{fontSize:"30px",fontWeight:"900",marginBottom:"5px",letterSpacing:"-1px"}}>Game Lobby</h1><p style={{color:V.txt2,fontSize:"14px"}}>5-min matches · Highest score wins · Instant payouts</p></div>
          <div style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"14px",padding:"14px 20px",display:"flex",alignItems:"center",gap:"14px"}}>
            <div><div style={{fontSize:"11px",color:V.txt3,letterSpacing:"1.5px"}}>BALANCE</div><div style={{fontWeight:"900",fontSize:"24px",color:V.acc,letterSpacing:"-0.8px"}}>{fmt(bal)}</div></div>
            <Btn onClick={()=>nav("wallet")} style={{padding:"9px 16px",fontSize:"13px"}}>+ Add Funds</Btn>
          </div>
        </div>
        {user?.kycStatus!=="verified"&&(
          <div style={{background:"rgba(245,158,11,0.08)",border:`1px solid rgba(245,158,11,0.25)`,borderRadius:"12px",padding:"14px 18px",marginBottom:"22px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
            <span style={{fontSize:"20px"}}>🔐</span>
            <div style={{flex:1}}><div style={{fontWeight:"700",fontSize:"14px",color:V.acc}}>KYC Required for Withdrawals</div><div style={{fontSize:"13px",color:V.txt2}}>Verify your NIN to unlock withdrawals.</div></div>
            <Btn v="gold" onClick={()=>nav("kyc")} style={{padding:"8px 16px",fontSize:"13px"}}>Verify NIN →</Btn>
          </div>
        )}
        <div style={{display:"flex",gap:"8px",marginBottom:"28px"}}>
          {[["all","🎮 All Rooms"],["1v1","⚔️ 1v1 Duels"],["quad","👥 Quad Battles"]].map(([f,l])=>(
            <button key={f} onClick={()=>setLFilter(f)} style={{padding:"8px 20px",borderRadius:"20px",border:`1px solid ${lFilter===f?V.pri:V.border}`,cursor:"pointer",fontWeight:"700",fontSize:"13px",transition:"all .2s",fontFamily:"inherit",background:lFilter===f?`${V.pri}26`:"transparent",color:lFilter===f?V.pri3:V.txt2}}>{l}</button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:"18px"}}>
          {filtered.map(r=>{
            const ok=bal>=r.entry&&cdLeft===0;
            return (
              <div key={r.id} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"20px",padding:"24px",cursor:"pointer",transition:"all .3s",position:"relative",overflow:"hidden"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=r.tc;e.currentTarget.style.transform="translateY(-5px)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=V.border;e.currentTarget.style.transform="none";}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:"4px",background:r.tc,borderRadius:"20px 20px 0 0"}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"18px"}}>
                  <div><div style={{fontSize:"16px",fontWeight:"900",marginBottom:"3px"}}>{r.name}</div><div style={{fontSize:"12px",color:V.txt3}}>{r.sub}</div></div>
                  <div style={{display:"flex",flexDirection:"column",gap:"4px",alignItems:"flex-end"}}>
                    <span style={{background:`${r.tc}22`,color:r.tc,borderRadius:"6px",padding:"3px 9px",fontSize:"11px",fontWeight:"800"}}>{r.tag}</span>
                    <span style={{background:"rgba(255,255,255,0.05)",color:V.txt3,borderRadius:"5px",padding:"2px 7px",fontSize:"10px"}}>👥 {r.maxP} players</span>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"14px"}}>
                  <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"10px",padding:"12px"}}><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"4px"}}>ENTRY</div><div style={{fontWeight:"900",fontSize:"21px",color:V.acc}}>{fmt(r.entry)}</div></div>
                  <div style={{background:"rgba(16,185,129,0.08)",border:`1px solid rgba(16,185,129,0.18)`,borderRadius:"10px",padding:"12px"}}><div style={{fontSize:"10px",color:V.grn,letterSpacing:"1.5px",marginBottom:"4px"}}>WIN</div><div style={{fontWeight:"900",fontSize:"21px",color:V.grn}}>{fmt(r.prize)}</div></div>
                </div>
                <div style={{fontSize:"11px",color:V.txt3,marginBottom:"16px"}}>Pot: {fmt(r.entry*r.maxP)} · Platform cut: {fmt(r.cut)} (20%)</div>
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

// ══ PAGE: GAME ════════════════════════════════════════════
const GamePage = () => {
  const { nav, user, room, board, score, oppScores, sel, tLeft, gameOn, gameOver, gResult, cdLeft, disqMsg, floatEmojis, emojiCd, handleCell, sendEmoji } = useApp();
  if (!room||!board) return null;
  const allP = [{name:"You",score,me:true},...oppScores.map(o=>({...o,me:false}))];
  const sorted = [...allP].sort((a,b)=>b.score-a.score);
  const myRank = sorted.findIndex(p=>p.me)+1;
  return (
    <div style={{minHeight:"100vh",background:"#07071A",paddingTop:"64px",display:"flex",flexDirection:"column",position:"relative",overflow:"hidden"}}>
      <Navbar links={false}/>
      {floatEmojis.map(e=>(
        <div key={e.id} style={{position:"fixed",bottom:"30%",left:`${e.x}%`,zIndex:500,pointerEvents:"none",animation:"floatUp 3s ease-out forwards",textAlign:"center"}}>
          <div style={{fontSize:"42px"}}>{e.emoji}</div>
          <div style={{fontSize:"11px",color:"rgba(255,255,255,0.8)",fontWeight:"700",background:"rgba(0,0,0,0.5)",borderRadius:"10px",padding:"2px 6px",marginTop:"2px"}}>{e.fromName}</div>
        </div>
      ))}
      <div style={{background:"rgba(7,7,26,0.97)",borderBottom:`1px solid ${V.border}`,padding:"11px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{background:`${room.tc}1A`,border:`1px solid ${room.tc}55`,borderRadius:"8px",padding:"6px 14px",fontSize:"13px",fontWeight:"800",color:room.tc}}>{room.name}</div>
          <div style={{fontSize:"13px",color:V.txt2}}>Prize: <span style={{color:V.grn,fontWeight:"800"}}>{fmt(room.prize)}</span></div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:"42px",fontWeight:"900",fontFamily:"monospace",letterSpacing:"3px",lineHeight:1,color:tLeft<=30?V.red:tLeft<=60?V.acc:"#fff"}}>{fmtT(tLeft)}</div>
          <div style={{fontSize:"10px",color:V.txt3,letterSpacing:"2px",marginTop:"2px"}}>TIME REMAINING</div>
        </div>
        <div style={{display:"flex",gap:"8px"}}>
          {!gameOn&&!gameOver&&!disqMsg&&<div style={{fontSize:"13px",color:V.txt2,background:`${V.pri}22`,border:`1px solid ${V.pri}44`,borderRadius:"8px",padding:"8px 14px"}}>⏳ Waiting for opponent...</div>}
          <Btn v="out" onClick={()=>nav("lobby")} style={{padding:"9px 14px",fontSize:"13px"}}>Exit</Btn>
        </div>
      </div>
      <div style={{flex:1,display:"flex",padding:"18px 22px",gap:"18px",maxWidth:"1100px",margin:"0 auto",width:"100%",boxSizing:"border-box",flexWrap:"wrap",alignItems:"flex-start"}}>
        <div style={{width:"190px",flexShrink:0,display:"flex",flexDirection:"column",gap:"12px"}}>
          <Card style={{padding:"14px"}}>
            <div style={{fontSize:"11px",color:V.txt3,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"12px"}}>🏆 RANKINGS</div>
            {sorted.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"9px",padding:"8px 9px",borderRadius:"9px",marginBottom:"4px",background:p.me?`rgba(109,40,217,0.22)`:"transparent",border:p.me?`1px solid rgba(109,40,217,0.35)`:"1px solid transparent"}}>
                <div style={{width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"800",background:i===0?V.acc:i===1?"#9CA3AF":i===2?"#CD7F32":"rgba(255,255,255,0.08)",color:i<3?"#000":V.txt2}}>{i+1}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"11px",fontWeight:"700",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:p.me?V.pri3:p.flagged?"#FF8888":V.txt}}>{p.me?"You ✦":p.name}</div>
                  <div style={{fontSize:"15px",fontWeight:"900",color:p.me?V.pri3:V.txt}}>{p.score.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </Card>
          <Card style={{textAlign:"center",padding:"16px"}}>
            <div style={{fontSize:"11px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"6px"}}>YOUR SCORE</div>
            <div style={{fontSize:"46px",fontWeight:"900",color:V.pri3,lineHeight:1,letterSpacing:"-2px"}}>{score.toLocaleString()}</div>
            <div style={{fontSize:"12px",color:V.txt3,marginTop:"6px"}}>Rank #{myRank}</div>
          </Card>
          {cdLeft>0&&<Card style={{textAlign:"center",padding:"14px"}}><div style={{fontSize:"11px",color:V.acc,letterSpacing:"1.5px",marginBottom:"4px"}}>⏳ COOLDOWN</div><div style={{fontSize:"24px",fontWeight:"900",color:V.acc,fontFamily:"monospace"}}>{fmtT(cdLeft)}</div></Card>}
          {gameOn&&(
            <Card style={{padding:"12px"}}>
              <div style={{fontSize:"11px",color:V.txt3,fontWeight:"700",letterSpacing:"1.5px",marginBottom:"10px"}}>SEND EMOJI</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                {GAME_EMOJIS.map(e=>(
                  <button key={e} onClick={()=>sendEmoji(e)} style={{fontSize:"20px",background:"rgba(255,255,255,0.07)",border:`1px solid ${V.border}`,borderRadius:"7px",width:"34px",height:"34px",cursor:emojiCd?"not-allowed":"pointer",opacity:emojiCd?.5:1,fontFamily:"inherit"}}>{e}</button>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"14px"}}>
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
              <div style={{fontSize:"24px",fontWeight:"900",color:gResult.won?V.grn:V.red,marginBottom:"8px"}}>{gResult.won?`You Won ${fmt(gResult.prize)}! 🎉`:"Better Luck Next Time!"}</div>
              {cdLeft>0&&<div style={{fontSize:"13px",color:V.acc,marginBottom:"14px",fontWeight:"600"}}>⏳ Cooldown: {fmtT(cdLeft)}</div>}
              <div style={{display:"flex",gap:"10px",justifyContent:"center",flexWrap:"wrap"}}>
                <Btn v="out" onClick={()=>nav("lobby")} style={{padding:"10px 22px"}}>← Lobby</Btn>
                {cdLeft===0&&<Btn v="gold" onClick={()=>nav("lobby")} style={{padding:"10px 22px"}}>🔄 Play Again</Btn>}
                <Btn onClick={()=>nav("wallet")} style={{padding:"10px 22px"}}>💰 Wallet</Btn>
              </div>
            </div>
          )}
          <div style={{background:"linear-gradient(160deg,#1E0535 0%,#120225 100%)",borderRadius:"22px",padding:"14px",border:`2px solid rgba(150,50,220,0.35)`,boxShadow:"0 0 60px rgba(109,40,217,0.2)",opacity:gameOver?0.65:1,transition:"opacity .4s"}}>
            {board.map((row,r)=>(
              <div key={r} style={{display:"flex",gap:"5px",marginBottom:"5px"}}>
                {row.map((cv,c)=>(
                  <BoardCell key={c} onClick={()=>handleCell(r,c)}>
                    <CandyCell type={cv} selected={sel&&sel.r===r&&sel.c===c} size={44}/>
                  </BoardCell>
                ))}
              </div>
            ))}
          </div>
          {gameOn&&<div style={{fontSize:"12px",color:V.txt3,letterSpacing:"0.5px"}}>Tap a candy → tap adjacent to swap · 3+ in a row scores points</div>}
        </div>
      </div>
    </div>
  );
};

// ══ PAGE: WALLET ══════════════════════════════════════════
const WalletPage = () => {
  const { nav, user, bal, txns, depAmt, setDepAmt, witAmt, setWitAmt, wMsg, doDeposit, doWithdraw, loadTxns } = useApp();
  useEffect(()=>{ loadTxns(); },[]);
  return (
    <div style={{minHeight:"100vh",paddingTop:"64px",background:V.bg}}>
      <Navbar/>
      <div style={{maxWidth:"820px",margin:"0 auto",padding:"36px 24px"}}>
        <h1 style={{fontSize:"30px",fontWeight:"900",marginBottom:"4px",letterSpacing:"-1px"}}>My Wallet</h1>
        <p style={{color:V.txt2,fontSize:"14px",marginBottom:"30px"}}>Secured by SquadCo · KYC required for withdrawals</p>
        <div style={{background:`linear-gradient(135deg,${V.pri} 0%,${V.pink} 100%)`,borderRadius:"22px",padding:"36px",marginBottom:"24px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",right:"-40px",top:"-40px",width:"180px",height:"180px",borderRadius:"50%",background:"rgba(255,255,255,0.08)"}}/>
          <div style={{position:"relative"}}>
            <div style={{fontSize:"14px",opacity:.8,marginBottom:"5px"}}>💰 Available Balance</div>
            <div style={{fontSize:"54px",fontWeight:"900",letterSpacing:"-2px"}}>{fmt(bal)}</div>
            <div style={{fontSize:"13px",opacity:.7,marginTop:"4px"}}>KYC: <strong>{user?.kycStatus==="verified"?"✅ Verified":"⚠ Not verified"}</strong></div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"20px",marginBottom:"22px"}}>
          <Card>
            <div style={{fontWeight:"800",fontSize:"17px",marginBottom:"18px"}}>💳 Deposit Funds</div>
            <Field label="AMOUNT (MIN ₦100)" value={depAmt} onChange={setDepAmt} placeholder="Enter amount" type="number"/>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",margin:"12px 0"}}>
              {[500,1000,2000,5000].map(a=><button key={a} onClick={()=>setDepAmt(String(a))} style={{padding:"5px 12px",borderRadius:"7px",border:`1px solid ${depAmt==a?V.pri:V.border}`,background:depAmt==a?`${V.pri}28`:"transparent",color:depAmt==a?V.pri3:V.txt2,fontSize:"12px",cursor:"pointer",fontWeight:"700",fontFamily:"inherit"}}>{fmt(a)}</button>)}
            </div>
            <Btn onClick={doDeposit} style={{width:"100%",padding:"13px",borderRadius:"12px"}}>💳 Pay via SquadCo</Btn>
            <div style={{fontSize:"11px",color:V.txt3,marginTop:"9px",textAlign:"center"}}>🔒 Secured by SquadCo Payment Gateway</div>
          </Card>
          <Card>
            <div style={{fontWeight:"800",fontSize:"17px",marginBottom:"18px"}}>🏦 Withdraw Funds</div>
            {user?.kycStatus!=="verified"&&<div style={{background:"rgba(245,158,11,0.1)",border:`1px solid rgba(245,158,11,0.3)`,borderRadius:"9px",padding:"10px",fontSize:"13px",color:V.acc,marginBottom:"14px"}}>⚠ <strong>KYC Required.</strong> <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>nav("kyc")}>Verify NIN →</span></div>}
            <Field label="AMOUNT (MIN ₦500)" value={witAmt} onChange={setWitAmt} placeholder="Enter amount" type="number"/>
            <Btn v="out" onClick={doWithdraw} style={{width:"100%",padding:"13px",borderRadius:"12px",marginTop:"12px"}}>🏦 Withdraw Funds</Btn>
            <div style={{fontSize:"11px",color:V.txt3,marginTop:"9px",textAlign:"center"}}>Processing time: 1–24 hours</div>
          </Card>
        </div>
        {wMsg&&<div style={{background:wMsg.startsWith("✅")?"rgba(16,185,129,0.12)":"rgba(239,68,68,0.12)",border:`1px solid ${wMsg.startsWith("✅")?V.grn:V.red}55`,borderRadius:"12px",padding:"14px 18px",marginBottom:"20px",textAlign:"center",fontSize:"14px",fontWeight:"700",color:wMsg.startsWith("✅")?V.grn:V.red}}>{wMsg}</div>}
        <Card>
          <div style={{fontWeight:"800",fontSize:"17px",marginBottom:"18px"}}>📋 Transaction History</div>
          {txns.length===0?<div style={{color:V.txt3,textAlign:"center",padding:"30px",fontSize:"14px"}}>No transactions yet</div>:txns.map(t=>(
            <div key={t._id||t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 0",borderBottom:`1px solid ${V.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:"13px"}}>
                <div style={{width:"40px",height:"40px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px",background:["deposit","game_win","bonus","referral_reward"].includes(t.type)?"rgba(16,185,129,0.14)":"rgba(239,68,68,0.12)"}}>
                  {t.type==="game_win"?"🏆":t.type==="bonus"||t.type==="referral_reward"?"🎁":t.type==="deposit"?"↙":"↗"}
                </div>
                <div>
                  <div style={{fontSize:"13px",fontWeight:"600"}}>{t.description}</div>
                  <div style={{fontSize:"11px",color:V.txt3,marginTop:"2px"}}>{(t.createdAt||t.date||"").toString().split("T")[0]}</div>
                </div>
              </div>
              <div style={{fontWeight:"900",fontSize:"15px",color:["deposit","game_win","bonus","referral_reward"].includes(t.type)?V.grn:V.red}}>
                {["deposit","game_win","bonus","referral_reward"].includes(t.type)?"+":"-"}{fmt(t.amount)}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};

// ══ PAGE: KYC ═════════════════════════════════════════════
const KycPage = () => {
  const { nav, user, setUser, kycNin, setKycNin, kycMsg, setKycMsg, kycLoading, setKycLoading, token } = useApp();
  const doKYC = async () => {
    if (!kycNin||kycNin.replace(/\s/g,"").length!==11) return setKycMsg("❌ NIN must be exactly 11 digits");
    setKycLoading(true); setKycMsg("");
    const d = await apiFetch("POST","/kyc/submit",{nin:kycNin},token);
    setKycLoading(false);
    if (!d.success) return setKycMsg("❌ "+(d.error||"Verification failed"));
    setKycMsg("✅ "+d.message);
    setUser(u=>({...u,kycStatus:"verified"}));
  };
  return (
    <div style={{minHeight:"100vh",paddingTop:"64px",background:V.bg}}>
      <Navbar/>
      <div style={{maxWidth:"500px",margin:"0 auto",padding:"36px 24px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <div style={{fontSize:"52px",marginBottom:"12px"}}>🔐</div>
          <h1 style={{fontSize:"28px",fontWeight:"900",marginBottom:"6px",letterSpacing:"-0.8px"}}>KYC Verification</h1>
          <p style={{color:V.txt2,fontSize:"14px",lineHeight:1.7}}>Verify your NIN to unlock withdrawals. Required by Nigerian law.</p>
        </div>
        {user?.kycStatus==="verified"?(
          <Card style={{textAlign:"center",padding:"32px"}}>
            <div style={{fontSize:"52px",marginBottom:"12px"}}>✅</div>
            <div style={{fontWeight:"900",fontSize:"20px",color:V.grn,marginBottom:"8px"}}>KYC Verified!</div>
            <div style={{fontSize:"14px",color:V.txt2,marginBottom:"20px"}}>Your identity is verified. Withdrawals are unlocked.</div>
            <Btn onClick={()=>nav("wallet")} style={{padding:"12px 28px"}}>Go to Wallet →</Btn>
          </Card>
        ):(
          <Card style={{padding:"28px"}}>
            <div style={{display:"flex",flexDirection:"column",gap:"18px"}}>
              <div style={{background:"rgba(109,40,217,0.08)",border:`1px solid rgba(109,40,217,0.2)`,borderRadius:"10px",padding:"14px",fontSize:"13px",color:V.txt2,lineHeight:1.7}}>
                📋 <strong style={{color:V.txt}}>What is NIN?</strong> Your 11-digit National Identification Number from NIMC. Found on your National ID, Voter's card, or NIMC slip.
              </div>
              <Field label="YOUR NIN (11 DIGITS)" value={kycNin} onChange={v=>setKycNin(v.replace(/\D/g,"").slice(0,11))} placeholder="e.g. 12345678901"/>
              <div style={{fontSize:"12px",color:V.txt3}}>🔒 Your NIN is encrypted and stored securely. We do not share your data.</div>
              {kycMsg&&<div style={{background:kycMsg.startsWith("✅")?"rgba(16,185,129,0.12)":"rgba(239,68,68,0.12)",border:`1px solid ${kycMsg.startsWith("✅")?V.grn:V.red}44`,borderRadius:"9px",padding:"12px",fontSize:"13px",fontWeight:"600",color:kycMsg.startsWith("✅")?V.grn:V.red}}>{kycMsg}</div>}
              <Btn onClick={doKYC} dis={kycLoading||kycNin.length!==11} style={{padding:"14px",fontSize:"15px",borderRadius:"12px"}}>{kycLoading?"Verifying NIN...":"Verify NIN →"}</Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

// ══ PAGE: REFERRAL ════════════════════════════════════════
const ReferralPage = () => {
  const { user, refData, loadReferral } = useApp();
  useEffect(()=>{ loadReferral(); },[]);
  const link = refData?.referralLink||`${window.location.origin}?ref=${user?.referralCode||""}`;
  return (
    <div style={{minHeight:"100vh",paddingTop:"64px",background:V.bg}}>
      <Navbar/>
      <div style={{maxWidth:"640px",margin:"0 auto",padding:"36px 24px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <div style={{fontSize:"52px",marginBottom:"12px"}}>🎁</div>
          <h1 style={{fontSize:"28px",fontWeight:"900",marginBottom:"6px",letterSpacing:"-0.8px"}}>Refer & Earn</h1>
          <p style={{color:V.txt2,fontSize:"14px",lineHeight:1.7}}>Share your code. Earn <strong style={{color:V.acc}}>₦50</strong> when your friend plays their first game!</p>
        </div>
        <Card style={{marginBottom:"20px",padding:"26px"}}>
          <div style={{textAlign:"center",marginBottom:"20px"}}>
            <div style={{fontSize:"12px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"8px"}}>YOUR REFERRAL CODE</div>
            <div style={{fontSize:"38px",fontWeight:"900",letterSpacing:"6px",color:V.pri3,background:`${V.pri}18`,borderRadius:"14px",padding:"16px",border:`2px dashed ${V.pri}55`}}>{user?.referralCode||"LOADING"}</div>
          </div>
          <div style={{display:"flex",gap:"8px"}}>
            <div style={{flex:1,background:"rgba(255,255,255,0.04)",border:`1px solid ${V.border}`,borderRadius:"9px",padding:"10px 13px",fontSize:"12px",color:V.txt3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link}</div>
            <Btn onClick={()=>{navigator.clipboard.writeText(link);alert("Referral link copied!");}} style={{padding:"10px 16px",fontSize:"13px",flexShrink:0}}>Copy Link</Btn>
          </div>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"14px"}}>
          {[{icon:"👥",l:"Referred",v:refData?.totalReferrals||0,c:V.pri3},{icon:"🏆",l:"Rewarded",v:refData?.rewardedCount||0,c:V.grn},{icon:"⏳",l:"Pending",v:refData?.pendingCount||0,c:V.acc},{icon:"💰",l:"Earned",v:fmt(refData?.totalEarned||0),c:V.grn}].map(s=>(
            <Card key={s.l} style={{textAlign:"center",padding:"16px"}}><div style={{fontSize:"24px",marginBottom:"8px"}}>{s.icon}</div><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"5px"}}>{s.l.toUpperCase()}</div><div style={{fontSize:"22px",fontWeight:"900",color:s.c}}>{s.v}</div></Card>
          ))}
        </div>
      </div>
    </div>
  );
};

// ══ PAGE: ADMIN LOGIN (secret — no public link) ══════════
const AdminLoginPage = () => {
  const { aLE, setALE, aLP, setALP, adminErr, doAdminLogin, nav } = useApp();
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:`radial-gradient(ellipse 70% 55% at 50% -5%,rgba(109,40,217,0.18),transparent)`}}>
      <div style={{width:"100%",maxWidth:"400px"}}>
        <div style={{textAlign:"center",marginBottom:"36px"}}>
          <div style={{fontSize:"52px",marginBottom:"12px"}}>🛡️</div>
          <h2 style={{fontSize:"28px",fontWeight:"900",marginBottom:"6px",letterSpacing:"-0.8px"}}>Admin Portal</h2>
          <p style={{color:V.txt2,fontSize:"13px"}}>Authorised Personnel Only</p>
        </div>
        <Card style={{padding:"28px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            <Field label="ADMIN EMAIL" value={aLE} onChange={setALE} placeholder="admin email" type="email"/>
            <Field label="PASSWORD" value={aLP} onChange={setALP} placeholder="••••••••" type="password"/>
            {adminErr&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"9px",padding:"11px",fontSize:"13px",color:V.red}}>⚠ {adminErr}</div>}
            <Btn onClick={doAdminLogin} style={{padding:"14px",fontSize:"15px",borderRadius:"12px",marginTop:"4px"}}>Access Dashboard →</Btn>
          </div>
        </Card>
        <p style={{textAlign:"center",marginTop:"16px",fontSize:"13px",color:V.txt3,cursor:"pointer"}} onClick={()=>nav("landing")}>← Back to site</p>
      </div>
    </div>
  );
};

// ══ PAGE: ADMIN DASHBOARD ═════════════════════════════════
const AdminDash = () => {
  const { nav, token, adminTab, setAdminTab, setAdminIn } = useApp();
  const [stats, setStats] = useState(null);
  useEffect(()=>{
    apiFetch("GET","/admin/stats",null,token).then(d=>{ if(d.success) setStats(d.stats); });
  },[]);
  const S = stats;
  return (
    <div style={{minHeight:"100vh",background:V.bg,display:"flex"}}>
      <div style={{width:"220px",flexShrink:0,background:"rgba(255,255,255,0.02)",borderRight:`1px solid ${V.border}`,display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
        <div style={{padding:"22px 18px 18px",borderBottom:`1px solid ${V.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}><div style={{width:"36px",height:"36px",borderRadius:"9px",background:`linear-gradient(135deg,${V.pri},${V.pink})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>🍬</div><div><div style={{fontWeight:"900",fontSize:"16px"}}>CrushCash</div><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1px"}}>ADMIN PANEL</div></div></div>
        </div>
        <div style={{padding:"10px 8px",flex:1}}>
          {[["overview","📊","Overview"],["rooms","🏠","Rooms"],["fraud","🚨","Fraud"],["transactions","💳","Transactions"]].map(([tab,icon,label])=>(
            <button key={tab} onClick={()=>setAdminTab(tab)} style={{display:"flex",alignItems:"center",gap:"11px",width:"100%",padding:"11px 14px",border:"none",cursor:"pointer",fontWeight:"700",fontSize:"14px",textAlign:"left",borderRadius:"9px",marginBottom:"2px",fontFamily:"inherit",transition:"all .15s",background:adminTab===tab?`${V.pri}28`:"transparent",color:adminTab===tab?V.pri3:V.txt2,borderLeft:adminTab===tab?`3px solid ${V.pri}`:"3px solid transparent"}}>
              <span style={{fontSize:"17px"}}>{icon}</span>{label}
            </button>
          ))}
        </div>
        <div style={{padding:"14px 10px",borderTop:`1px solid ${V.border}`}}>
          <Btn v="out" onClick={()=>{setAdminIn(false);nav("landing");window.location.hash="";}} style={{width:"100%",padding:"10px",fontSize:"13px"}}>← Sign Out</Btn>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px"}}>
        {adminTab==="overview"&&(<>
          <div style={{marginBottom:"26px"}}><h1 style={{fontSize:"26px",fontWeight:"900",marginBottom:"4px",letterSpacing:"-0.8px"}}>Dashboard Overview</h1><p style={{color:V.txt2,fontSize:"13px"}}>Real-time platform stats</p></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"14px",marginBottom:"26px"}}>
            {[{icon:"💰",l:"Platform Revenue",v:S?fmt(S.revenue.platform):"—",c:V.grn},{icon:"📈",l:"Today Deposits",v:S?fmt(S.revenue.todayDeposits):"—",c:V.acc},{icon:"👥",l:"Total Users",v:S?S.users.total.toLocaleString():"—",c:V.pri3},{icon:"🟢",l:"Active Today",v:S?S.users.activeToday.toLocaleString():"—",c:V.pink},{icon:"🎮",l:"Games Today",v:S?S.games.completedToday.toLocaleString():"—",c:V.acc},{icon:"🚨",l:"Fraud Flags",v:S?S.fraud.flaggedUsers.toLocaleString():"—",c:V.red},{icon:"🏆",l:"Total Prizes",v:S?fmt(S.revenue.totalPrizes):"—",c:V.grn},{icon:"💳",l:"Total Entries",v:S?fmt(S.revenue.totalEntries):"—",c:V.pri3}].map(s=>(
              <div key={s.l} style={{background:V.card,border:`1px solid ${V.border}`,borderRadius:"14px",padding:"18px"}}><div style={{fontSize:"24px",marginBottom:"10px"}}>{s.icon}</div><div style={{fontSize:"10px",color:V.txt3,letterSpacing:"1.5px",marginBottom:"4px"}}>{s.l.toUpperCase()}</div><div style={{fontSize:"24px",fontWeight:"900",color:s.c}}>{s.v}</div></div>
            ))}
          </div>
          <Card>
            <div style={{fontWeight:"800",fontSize:"17px",marginBottom:"18px"}}>🏠 All 10 Rooms</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"12px"}}>
              {ROOMS.map(r=>(
                <div key={r.id} style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px",border:`1px solid ${V.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}><div style={{fontSize:"13px",fontWeight:"800"}}>{r.name}</div><span style={{background:`${r.tc}22`,color:r.tc,borderRadius:"5px",padding:"2px 8px",fontSize:"10px",fontWeight:"800"}}>{r.tag}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px"}}><span style={{color:V.acc,fontWeight:"700"}}>{fmt(r.entry)} entry</span><span style={{color:V.grn}}>Win {fmt(r.prize)}</span></div>
                </div>
              ))}
            </div>
          </Card>
        </>)}
        {(adminTab==="rooms"||adminTab==="transactions"||adminTab==="fraud")&&(
          <div style={{textAlign:"center",paddingTop:"60px"}}><div style={{fontSize:"36px",marginBottom:"12px"}}>📡</div><div style={{fontWeight:"800",fontSize:"18px",marginBottom:"8px"}}>Live MongoDB Data</div><div style={{color:V.txt2,fontSize:"14px",marginBottom:"20px"}}>Fetched live from your backend API.</div><Btn onClick={()=>nav("lobby")}>← Go to Lobby</Btn></div>
        )}
      </div>
    </div>
  );
};

// ══ MAIN APP ══════════════════════════════════════════════
export default function App() {
  // Routing — detect secret admin URL on load
  const [pg, setPg] = useState(()=>isAdminRoute()?"admin-login":"landing");
  const [user, setUser]   = useState(()=>{ try{ return JSON.parse(localStorage.getItem("cc_user")); }catch{ return null; } });
  const [token, setToken] = useState(()=>localStorage.getItem("cc_token")||"");
  const [serverOk, setServerOk] = useState(null); // null=checking, true=ok, false=down

  // Auth
  const [aMode, setAMode]   = useState("login");
  const [aEmail, setAEmail] = useState("");
  const [aPass, setAPass]   = useState("");
  const [aName, setAName]   = useState("");
  const [aRef, setARef]     = useState(""); // referral code from URL or manual
  const [aErr, setAErr]     = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Wallet
  const [bal, setBal]     = useState(()=>{ try{ const u=JSON.parse(localStorage.getItem("cc_user")); return u?.balance||0; }catch{ return 0; } });
  const [txns, setTxns]   = useState([]);
  const [depAmt, setDepAmt] = useState("");
  const [witAmt, setWitAmt] = useState("");
  const [wMsg, setWMsg]   = useState("");

  // Game
  const [room, setRoom]       = useState(null);
  const [board, setBoard]     = useState(null);
  const [score, setScore]     = useState(0);
  const [oppScores, setOppScores] = useState([]);
  const [sel, setSel]         = useState(null);
  const [tLeft, setTLeft]     = useState(GT);
  const [gameOn, setGameOn]   = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [gResult, setGResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [cdLeft, setCdLeft]   = useState(0);
  const [disqMsg, setDisqMsg] = useState("");
  const [floatEmojis, setFloatEmojis] = useState([]);
  const [emojiCd, setEmojiCd] = useState(false);

  // Lobby
  const [lFilter, setLFilter] = useState("all");

  // KYC
  const [kycNin, setKycNin]     = useState("");
  const [kycMsg, setKycMsg]     = useState("");
  const [kycLoading, setKycLoading] = useState(false);

  // Referral
  const [refData, setRefData] = useState(null);

  // Admin
  const [adminIn, setAdminIn]   = useState(false);
  const [aLE, setALE]           = useState("");
  const [aLP, setALP]           = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [adminTab, setAdminTab] = useState("overview");

  const timerRef  = useRef(null);
  const cdRef     = useRef(null);
  const scoreRef  = useRef(0);
  const socketRef = useRef(null);

  useEffect(()=>{ scoreRef.current=score; },[score]);

  // Read referral code from URL on load
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) { setARef(ref.toUpperCase()); setPg("auth"); setAMode("register"); }
  },[]);

  // Wake backend + check server status
  useEffect(()=>{
    wakeBackend();
    fetch(`/api/health`)
      .then(r=>r.json())
      .then(()=>setServerOk(true))
      .catch(()=>setServerOk(false));
  },[]);

  // Persist auth
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

  // Socket
  useEffect(()=>{
    if (!token||!user) return;
    const s = io({ auth:{token}, transports:["websocket","polling"] }); // same-origin socket
    socketRef.current = s;
    s.on("room_joined",    d=>{ setSessionId(d.sessionId); });
    s.on("game_start",     ()=>{ setBoard(mkBoard()); setScore(0); scoreRef.current=0; setSel(null); setTLeft(GT); setGameOn(true); setGameOver(false); setGResult(null); setDisqMsg(""); startTimer(); });
    s.on("score_broadcast",d=>{ setOppScores(d.scoreboard.filter(p=>p.userId!==user._id).map(p=>({name:p.name,score:p.score,flagged:p.flagged}))); });
    s.on("game_over",      d=>{ clearInterval(timerRef.current); setGameOn(false); setGameOver(true); setGResult(d); if(d.won)setBal(b=>b+d.prize); startCd(); });
    s.on("emoji_received", d=>{ const id=Date.now()+Math.random(); setFloatEmojis(p=>[...p,{...d,id,x:15+Math.random()*70}]); setTimeout(()=>setFloatEmojis(p=>p.filter(e=>e.id!==id)),3200); });
    s.on("disqualified",   d=>{ clearInterval(timerRef.current); setGameOn(false); setGameOver(true); setDisqMsg(d.reason); setGResult({disqualified:true}); });
    s.on("refunded",       d=>{ setBal(b=>b+d.amount); });
    s.on("error",          d=>{ alert(d.message); });
    return ()=>{ s.disconnect(); socketRef.current=null; };
  },[token]);

  const startTimer=()=>{ clearInterval(timerRef.current); setTLeft(GT); timerRef.current=setInterval(()=>setTLeft(t=>{if(t<=1){clearInterval(timerRef.current);return 0;}return t-1;}),1000); };
  const startCd=()=>{ clearInterval(cdRef.current); setCdLeft(CD); cdRef.current=setInterval(()=>setCdLeft(t=>{if(t<=1){clearInterval(cdRef.current);return 0;}return t-1;}),1000); };

  useEffect(()=>{
    if(!gameOn||!sessionId) return;
    const iv=setInterval(()=>{ socketRef.current?.emit("score_update",{sessionId,score:scoreRef.current}); },2500);
    return ()=>clearInterval(iv);
  },[gameOn,sessionId]);

  const nav = useCallback(p=>{
    // Update URL hash for admin routes
    if(p==="admin-login"||p==="admin") window.location.hash="masteradmin";
    else if(window.location.hash.includes("masteradmin")) window.location.hash="";
    setPg(p);
  },[]);

  // AUTH
  const doAuth = async()=>{
    setAErr(""); setAuthLoading(true);
    try {
      if(aMode==="login"){
        if(!aEmail||!aPass){ setAErr("Please fill all fields"); return; }
        const d = await apiFetch("POST","/auth/login",{email:aEmail,password:aPass});
        if(!d.success){ setAErr(d.error||"Login failed"); return; }
        setUser(d.user); setToken(d.token); setBal(d.user.balance||0); nav("lobby");
      } else {
        if(!aName||!aEmail||!aPass){ setAErr("Please fill all fields"); return; }
        if(aPass.length<6){ setAErr("Password must be at least 6 characters"); return; }
        const d = await apiFetch("POST","/auth/register",{name:aName,email:aEmail,password:aPass,referralCode:aRef||undefined});
        if(!d.success){ setAErr(d.error||"Registration failed"); return; }
        setUser(d.user); setToken(d.token); setBal(d.user.balance||0); nav("lobby");
      }
    } finally { setAuthLoading(false); }
  };

  const doLogout=()=>{ setUser(null); setToken(""); socketRef.current?.disconnect(); nav("landing"); };

  // GAME
  const enterRoom=r=>{
    if(!user){ nav("auth"); return; }
    if(bal<r.entry){ alert(`You need ${fmt(r.entry)} to enter.`); return; }
    if(cdLeft>0){ alert(`Cooldown active. Wait ${fmtT(cdLeft)}.`); return; }
    setRoom(r); setBoard(mkBoard()); setScore(0); scoreRef.current=0; setSel(null);
    setTLeft(GT); setGameOn(false); setGameOver(false); setGResult(null);
    setDisqMsg(""); setOppScores([]); setSessionId(null); setFloatEmojis([]);
    socketRef.current?.emit("join_room",{roomId:r.id});
    nav("game");
  };
  const handleCell=(r,c)=>{
    if(!gameOn||gameOver||disqMsg) return;
    if(!sel){ setSel({r,c}); return; }
    if(sel.r===r&&sel.c===c){ setSel(null); return; }
    if(isAdj(sel.r,sel.c,r,c)){
      const res=trySwap(board,sel.r,sel.c,r,c);
      if(res){ setBoard(res.b); setScore(s=>{const ns=s+res.pts;scoreRef.current=ns;return ns;}); }
      setSel(null);
    } else { setSel({r,c}); }
  };
  const sendEmoji=emoji=>{
    if(!sessionId||emojiCd) return;
    socketRef.current?.emit("send_emoji",{sessionId,emoji});
    setEmojiCd(true); setTimeout(()=>setEmojiCd(false),2000);
  };

  // WALLET
  const showWMsg=msg=>{ setWMsg(msg); setTimeout(()=>setWMsg(""),4000); };
  const doDeposit=async()=>{
    const amt=parseInt(depAmt);
    if(!amt||amt<100) return showWMsg("❌ Minimum deposit is ₦100");
    const d=await apiFetch("POST","/wallet/deposit/initiate",{amount:amt},token);
    if(!d.success) return showWMsg("❌ "+(d.error||"Failed"));
    window.open(d.checkoutUrl,"_blank");
    setDepAmt(""); showWMsg("✅ SquadCo checkout opened. Return here after payment.");
  };
  const doWithdraw=async()=>{
    const amt=parseInt(witAmt);
    if(!amt||amt<500) return showWMsg("❌ Minimum withdrawal is ₦500");
    if(amt>bal) return showWMsg("❌ Insufficient balance");
    if(user?.kycStatus!=="verified"){ showWMsg("❌ KYC verification required first."); nav("kyc"); return; }
    const d=await apiFetch("POST","/wallet/withdraw",{amount:amt},token);
    if(!d.success) return showWMsg("❌ "+(d.error||"Failed"));
    setBal(d.newBalance); setWitAmt(""); showWMsg(`✅ ₦${amt.toLocaleString()} withdrawal initiated`);
  };
  const loadTxns=async()=>{ if(!token)return; const d=await apiFetch("GET","/wallet/transactions",null,token); if(d.success)setTxns(d.transactions); };

  // REFERRAL
  const loadReferral=async()=>{ const d=await apiFetch("GET","/referral/my",null,token); if(d.success)setRefData(d); };

  // ADMIN
  const doAdminLogin=()=>{
    if(aLE===ADMIN_CREDS.email&&aLP===ADMIN_CREDS.pass){ setAdminIn(true); setAdminErr(""); setPg("admin"); }
    else setAdminErr("Invalid credentials");
  };

  // Context
  const ctxValue = {
    pg, nav, user, setUser, token, bal, setBal, serverOk,
    aMode, setAMode, aEmail, setAEmail, aPass, setAPass, aName, setAName, aRef, setARef, aErr, setAErr, doAuth, authLoading,
    txns, depAmt, setDepAmt, witAmt, setWitAmt, wMsg, doDeposit, doWithdraw, loadTxns,
    room, board, score, oppScores, sel, tLeft, gameOn, gameOver, gResult, sessionId, cdLeft, disqMsg, floatEmojis, emojiCd,
    handleCell, enterRoom, sendEmoji,
    lFilter, setLFilter,
    kycNin, setKycNin, kycMsg, setKycMsg, kycLoading, setKycLoading,
    refData, loadReferral,
    adminIn, setAdminIn, aLE, setALE, aLP, setALP, adminErr, setAdminErr, adminTab, setAdminTab, doAdminLogin,
    doLogout, fmt, fmtT,
  };

  return (
    <Ctx.Provider value={ctxValue}>
      <CandyDefs/>
      {/* Inject keyframe animations */}
      <style>{`
        @keyframes floatUp{0%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-110px) scale(1.6)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        input:-webkit-autofill{-webkit-box-shadow:0 0 0 30px #1A1028 inset !important;-webkit-text-fill-color:#F1F5F9 !important;}
      `}</style>

      {/* No-API-URL warning banner — helps with debugging */}

      <div style={{minHeight:"100vh",background:V.bg,color:"#F1F5F9",fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif"}}>
        {pg==="landing"     && <Landing/>}
        {pg==="auth"        && <AuthPage/>}
        {pg==="lobby"       && (user?<LobbyPage/>:<AuthPage/>)}
        {pg==="game"        && (user?<GamePage/>:<AuthPage/>)}
        {pg==="wallet"      && (user?<WalletPage/>:<AuthPage/>)}
        {pg==="kyc"         && (user?<KycPage/>:<AuthPage/>)}
        {pg==="referral"    && (user?<ReferralPage/>:<AuthPage/>)}
        {pg==="admin-login" && <AdminLoginPage/>}
        {pg==="admin"       && (adminIn?<AdminDash/>:<AdminLoginPage/>)}
      </div>
    </Ctx.Provider>
  );
}

"use strict";
const SUPABASE_URL = "https://letstuovdrfxihrtrwdy.supabase.co";
const SUPABASE_KEY = "sb_publishable_hY_4KuyHayNUk5vdu_kbrQ_jJXmeD6M";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let serverOffset = 0;
const now = () => Date.now() + serverOffset;
let S = { tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:15, checkin_open_min:15, late_hard_min:30, late_black_min:120, adherence_target:90, early_leave_min:5, break_edge_min:30, review_threshold:3, early_per_clear:3, late_allowance:2, max_clears:2, break_short_min:15, break_short_count:2, break_long_min:30, break_long_count:1, break_wc_min:5, break_wc_count:2, min_available:1, break_alert_after_min:15, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", radius_m:500 };
const fmts = {};
function parts(ms){
  let f = fmts[S.tz];
  if(!f) f = fmts[S.tz] = new Intl.DateTimeFormat("en-GB",{timeZone:S.tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const o = {}; for(const p of f.formatToParts(ms)) o[p.type] = p.value;
  return { y:o.year, m:o.month, d:o.day, h:(+o.hour)%24, mi:+o.minute, s:+o.second };
}
const dkey = ms => { const p = parts(ms); return `${p.y}-${p.m}-${p.d}`; };
const mins = ms => { const p = parts(ms); return p.h*60 + p.mi; };
const hm = m => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(Math.round(m%60)).padStart(2,"0")}`;
const ts = v => v ? Date.parse(v) : null;
const tstr = v => v ? hm(mins(ts(v))) : "";
const pHM = s => { const [a,b] = String(s||"0:0").split(":").map(Number); return (a||0)*60 + (b||0); };
const short = t => String(t||"").slice(0,5);
const wdOf = k => new Date(k+"T12:00:00Z").getUTCDay();
const ymOf = k => k.slice(0,7);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function monthKeys(ym){ const [y,m] = ym.split("-").map(Number); const n = new Date(Date.UTC(y,m,0)).getUTCDate(); return Array.from({length:n},(_,i)=>`${ym}-${String(i+1).padStart(2,"0")}`); }
const monthEnd = ym => monthKeys(ym).pop();
const prettyDate = k => new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});
const longDate = k => new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
const monthLabel = ym => new Date(ym+"-15T12:00:00Z").toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"});
function lastMonths(n){ const out=[]; let [y,m] = ymOf(dkey(now())).split("-").map(Number); for(let i=0;i<n;i++){ out.push(`${y}-${String(m).padStart(2,"0")}`); m--; if(!m){m=12;y--;} } return out; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),3200); }
const errMsg = e => (e && (e.message || e.error_description)) || "Something went wrong. Try again.";
function getPos(){ return new Promise((res,rej)=>{ if(!navigator.geolocation) return rej(new Error("Location is not available on this device.")); navigator.geolocation.getCurrentPosition(res,()=>rej(new Error("Location access was blocked. Allow it in your browser settings and try again.")),{enableHighAccuracy:true,timeout:15000,maximumAge:0}); }); }

/* ---------- data ---------- */
let me = null;                 // employees row for this user
let shifts = {};               // id -> {start,end}
let emps = [];                 // admin: all employees
const mine = { att:{}, sched:{}, adj:[] , ym:null };
const team = { ym:null, att:{}, sched:{}, adj:[], alerts:{}, loading:false };
const shiftLabel = id => shifts[id] ? `${shifts[id].start} to ${shifts[id].end}` : "No shift";

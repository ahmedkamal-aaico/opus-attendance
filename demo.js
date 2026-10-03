"use strict";
/* Preview mode: replaces Supabase with an in-browser sample database. Nothing is saved to the server. */
(function(){
  const KEY = "opus-demo-db-v4", AS = "opus-demo-as", SIM = "opus-demo-sim";
  const OFFICE = { lat:24.4290032, lng:54.4632417 };
  const fmt = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"});
  const dk = ms => fmt.format(ms);
  const at = (day, minutes) => { const [y,m,d] = day.split("-").map(Number); return new Date(Date.UTC(y,m-1,d,0,0) + (minutes-240)*60000).toISOString(); };
  const pHM = s => { const [a,b] = s.split(":").map(Number); return a*60+b; };
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;

  function build(){
    const shifts = [{id:"s08",start_time:"08:00:00",end_time:"17:00:00"},{id:"s09",start_time:"09:00:00",end_time:"18:00:00"},{id:"s14",start_time:"14:00:00",end_time:"23:00:00"}];
    const S = { id:1, tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:60, early_per_clear:3, office_lat:OFFICE.lat, office_lng:OFFICE.lng, radius_m:500, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", alerts_enabled:true, alert_from:"Opus Attendance <attendance@aaico.com>" };
    const people = [["Soufiane Douhaib","s08"],["Mahmoud Tharwat","s09"],["Moataz Noamani","s08"],["Minu Boban","s14"],["Asem Elsebaey","s09"]];
    const employees = people.map(([name,shift],i) => ({ id:"e"+(i+1), name, email:name.split(" ")[0].toLowerCase()+"@demo.aaico.com", shift_id:shift, tracked:true, is_admin:false, active:true, since:null }));
    employees.unshift({ id:"m1", name:"Manager (you)", email:"manager@demo.aaico.com", shift_id:"s08", tracked:false, is_admin:true, active:true, since:null });
    const today = dk(Date.now()), [ty,tm] = today.split("-").map(Number);
    const prev = tm===1 ? `${ty-1}-12` : `${ty}-${String(tm-1).padStart(2,"0")}`;
    const days = [];
    for(const ym of [prev, today.slice(0,7)]){
      const [y,m] = ym.split("-").map(Number), n = new Date(Date.UTC(y,m,0)).getUTCDate();
      for(let d=1; d<=n; d++){ const k = `${ym}-${String(d).padStart(2,"0")}`; if(k > today) break; days.push(k); }
    }
    const schedule = [], attendance = [], alerts_sent = [];
    const minu = employees.find(e=>e.name.startsWith("Minu"));
    for(const k of days) if(k.slice(0,7)===today.slice(0,7)){
      const wd = new Date(k+"T12:00:00Z").getUTCDay();
      schedule.push({ employee_id:minu.id, day:k, shift_id: wd===1 ? null : (wd===6 ? "s09" : "s14") });
    }
    // Preview always treats today as a working day so check-in can be tried
    if(!S.workdays.includes(new Date(today+"T12:00:00Z").getUTCDay())){
      for(const e of employees.filter(x=>x.tracked)){
        const ex = schedule.find(r=>r.employee_id===e.id && r.day===today);
        if(ex) ex.shift_id = e.shift_id; else schedule.push({ employee_id:e.id, day:today, shift_id:e.shift_id });
      }
    }
    const shiftOf = (e,k) => { const r = schedule.find(s=>s.employee_id===e.id && s.day===k); if(r) return r.shift_id; const wd = new Date(k+"T12:00:00Z").getUTCDay(); return S.workdays.includes(wd) ? e.shift_id : null; };
    const nowMin = (()=>{ const p = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dubai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(Date.now()); return +p.find(x=>x.type==="hour").value*60 + +p.find(x=>x.type==="minute").value; })();
    for(const e of employees.filter(x=>x.tracked)) for(const k of days){
      const sid = shiftOf(e,k); if(!sid) continue;
      const sh = shifts.find(s=>s.id===sid), start = pHM(sh.start_time.slice(0,5)), end = pHM(sh.end_time.slice(0,5));
      const r = rnd();
      if(k === today && nowMin < start) continue;
      if(r < 0.07){ if(k!==today) alerts_sent.push({ employee_id:e.id, day:k, sent_at:at(k,start+5) }); continue; }
      const remote = r < 0.27;
      const q = rnd();
      const off = q < 0.35 ? -(11 + Math.floor(rnd()*15)) : q < 0.8 ? Math.floor(rnd()*10) - 5 : 6 + Math.floor(rnd()*35);
      if(k === today && nowMin < start + off) continue;
      attendance.push({ employee_id:e.id, day:k, mode: remote ? "remote" : "office", check_in:at(k,start+off), check_out: k===today ? null : at(k,end+Math.floor(rnd()*20)), in_dist: remote ? null : 20 + Math.floor(rnd()*200), out_dist:null });
    }
    const adjustments = [{ id:1, employee_id:"e3", month:prev, type:"red", delta:-1, reason:"System outage, late check-in excused", created_by:"m1", created_at:new Date().toISOString() }];
    return { settings:[S], shifts, employees, schedule, attendance, adjustments, alerts_sent, schedule_files:[], files:{}, _seq:2 };
  }
  let DB;
  try{ DB = JSON.parse(sessionStorage.getItem(KEY)); }catch{}
  if(!DB) DB = build();
  const save = () => { try{ sessionStorage.setItem(KEY, JSON.stringify(DB)); }catch{} };
  save();
  const asId = () => sessionStorage.getItem(AS) || "m1";
  const meRow = () => DB.employees.find(e=>e.id===asId()) || DB.employees[0];
  const visible = (t, rows) => {
    const m = meRow(); if(m.is_admin) return rows;
    if(t==="employees") return rows.filter(r=>r.id===m.id);
    if(["attendance","schedule","adjustments"].includes(t)) return rows.filter(r=>r.employee_id===m.id);
    if(t==="alerts_sent") return [];
    return rows;
  };

  class Q {
    constructor(t){ this.t=t; this.f=[]; this.op="select"; this.ord=null; this.one=null; this.payload=null; }
    select(){ return this; }
    eq(c,v){ this.f.push(r=>String(r[c])===String(v)); return this; }
    gte(c,v){ this.f.push(r=>r[c]>=v); return this; }
    lte(c,v){ this.f.push(r=>r[c]<=v); return this; }
    order(c,o){ this.ord=[c, !(o && o.ascending===false)]; return this; }
    maybeSingle(){ this.one="maybe"; return this; }
    single(){ this.one="single"; return this; }
    insert(p){ this.op="insert"; this.payload=p; return this; }
    upsert(p){ this.op="upsert"; this.payload=p; return this; }
    update(p){ this.op="update"; this.payload=p; return this; }
    delete(){ this.op="delete"; return this; }
    then(res){ try{ res(this.run()); }catch(e){ res({ data:null, error:{ message:e.message, code:e.code } }); } }
    run(){
      const rows = DB[this.t]; const match = r => this.f.every(f=>f(r));
      const admin = meRow().is_admin;
      if(this.op !== "select" && !admin) throw new Error("Only managers can change this.");
      if(this.op==="select"){
        let out = visible(this.t, rows.filter(match)).map(r=>({...r}));
        if(this.ord){ const [c,asc] = this.ord; out.sort((a,b)=> (a[c]>b[c]?1:a[c]<b[c]?-1:0) * (asc?1:-1)); }
        return { data: this.one ? (out[0]||null) : out, error:null };
      }
      if(this.op==="upsert"){
        const k = this.t==="schedule_files" ? "month" : "id";
        const ex = rows.find(r=>r[k]===this.payload[k]);
        if(ex) Object.assign(ex, this.payload); else rows.push({...this.payload});
        save(); return { data:null, error:null };
      }
      if(this.op==="insert" && Array.isArray(this.payload)){ rows.push(...this.payload.map(r=>({...r}))); save(); return { data:null, error:null }; }
      if(this.op==="insert"){
        const r = { ...this.payload };
        if(this.t==="employees"){ r.id = "e"+(DB._seq++); r.email = r.email||null; r.active = r.active ?? true; r.is_admin = r.is_admin ?? false; r.since = r.since ?? null; }
        if(this.t==="adjustments"){ r.id = DB._seq++; r.created_at = new Date().toISOString(); }
        rows.push(r); save(); return { data:{...r}, error:null };
      }
      if(this.op==="update"){
        if(this.t==="employees" && this.payload.email){
          const clash = rows.find(r => !match(r) && (r.email||"").toLowerCase()===this.payload.email.toLowerCase());
          if(clash){ const e = new Error("duplicate"); e.code="23505"; throw e; }
        }
        rows.filter(match).forEach(r=>Object.assign(r,this.payload)); save(); return { data:null, error:null };
      }
      if(this.op==="delete"){ DB[this.t] = rows.filter(r=>!match(r)); save(); return { data:null, error:null }; }
    }
  }
  const dist = (a,b,c,d) => { const R=6371000, r=x=>x*Math.PI/180; const h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  async function rpc(name, a){
    const S = DB.settings[0], m = meRow(), today = dk(Date.now());
    if(name==="server_now") return { data:new Date().toISOString(), error:null };
    const fail = message => ({ data:null, error:{ message } });
    if(name==="check_in"){
      if(!m.tracked) return fail("This account is not registered for attendance.");
      if(DB.attendance.some(r=>r.employee_id===m.id && r.day===today)) return fail("You already checked in today.");
      let d = null;
      if(a.p_mode==="office"){
        if(a.p_lat==null) return fail("Office check-in needs your location. Allow location access and try again.");
        d = Math.round(dist(a.p_lat,a.p_lng,S.office_lat,S.office_lng));
        if(d > S.radius_m) return fail(`You are ${d} m from the office. Office check-in works within ${S.radius_m} m.`);
      }
      const r = { employee_id:m.id, day:today, mode:a.p_mode, check_in:new Date().toISOString(), check_out:null, in_dist:d, out_dist:null };
      DB.attendance.push(r); save(); return { data:{...r}, error:null };
    }
    if(name==="check_out"){
      const r = DB.attendance.find(x=>x.employee_id===m.id && x.day===today && !x.check_out);
      if(!r) return fail("No open check-in for today.");
      r.check_out = new Date().toISOString(); save(); return { data:{...r}, error:null };
    }
    return fail("Unknown action");
  }

  // Simulated office location
  if(sessionStorage.getItem(SIM)==="1" && navigator.geolocation){
    const jitter = () => (Math.random()-0.5)*0.0006;
    navigator.geolocation.getCurrentPosition = ok => setTimeout(()=>ok({ coords:{ latitude:OFFICE.lat+jitter(), longitude:OFFICE.lng+jitter(), accuracy:10 } }), 300);
  }

  const storage = { from: () => ({
    upload: (path, blob) => new Promise(res => { const f = new FileReader(); f.onload = () => { DB.files = {}; DB.files[path] = f.result; save(); res({ data:{ path }, error:null }); }; f.readAsDataURL(blob); }),
    createSignedUrl: async path => ({ data:{ signedUrl: DB.files[path] || null }, error:null })
  }) };
  const functions = { invoke: async () => ({ data:null, error:{ message:"Reading shifts from the image works on the live system once the API key is added. In the preview, use Set shifts for a period below." } }) };
  window.supabase = { createClient: () => ({
    from: t => new Q(t),
    rpc, storage, functions,
    auth: {
      getUser: async () => ({ data:{ user:{ email: meRow().email } } }),
      getSession: async () => ({ data:{ session:{ demo:true } } }),
      onAuthStateChange(cb){ setTimeout(()=>cb("SIGNED_IN",{ demo:true }),0); return { data:{ subscription:{ unsubscribe(){} } } }; },
      signOut: async () => ({ error:null }),
      signInWithOtp: async () => ({ error:null }),
      verifyOtp: async () => ({ error:null })
    }
  }) };

  // Preview bar
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    const opts = DB.employees.map(e=>`<option value="${e.id}" ${e.id===asId()?"selected":""}>${e.is_admin ? "Manager view" : e.name}</option>`).join("");
    bar.innerHTML = `<b>Preview with sample data.</b><span>Nothing is saved to the server.</span>
      <label>View as <select id="dAs">${opts}</select></label>
      <label class="chk"><input type="checkbox" id="dSim" ${sessionStorage.getItem(SIM)==="1"?"checked":""}>Pretend I'm at the office</label>
      <button class="btn small" id="dReset">Reset sample data</button>`;
    document.body.prepend(bar);
    document.getElementById("dAs").onchange = e => { sessionStorage.setItem(AS, e.target.value); location.reload(); };
    document.getElementById("dSim").onchange = e => { sessionStorage.setItem(SIM, e.target.checked ? "1" : "0"); location.reload(); };
    document.getElementById("dReset").onclick = () => { sessionStorage.removeItem(KEY); location.reload(); };
    const so = document.getElementById("signout"); if(so) so.style.display = "none";
  });
})();

"use strict";
/* Preview mode: replaces Supabase with an in-browser sample database. Nothing is saved to the server. */
(function(){
  const KEY = "opus-demo-db-v17", AS = "opus-demo-as", SIM = "opus-demo-sim";
  const OFFICE = { lat:24.4290032, lng:54.4632417 };
  const fmt = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"});
  const dk = ms => fmt.format(ms);
  const at = (day, minutes) => { const [y,m,d] = day.split("-").map(Number); return new Date(Date.UTC(y,m-1,d,0,0) + (minutes-240)*60000).toISOString(); };
  const pHM = s => { const [a,b] = s.split(":").map(Number); return a*60+b; };
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;

  function build(){
    const shifts = [{id:"s08",start_time:"08:00:00",end_time:"17:00:00"},{id:"s09",start_time:"09:00:00",end_time:"18:00:00"},{id:"s14",start_time:"14:00:00",end_time:"23:00:00"}];
    const S = { id:1, tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:15, checkin_open_min:15, late_hard_min:30, late_black_min:120, adherence_target:90, early_leave_min:5, break_edge_min:30, review_threshold:3, early_per_clear:3, late_allowance:2, max_clears:2, break_short_min:15, break_short_count:2, break_long_min:30, break_long_count:1, break_wc_min:5, break_wc_count:2, min_available:1, break_alert_after_min:15, office_lat:OFFICE.lat, office_lng:OFFICE.lng, radius_m:500, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", rules:{ min_senior_office:1, night_needs_morning_office:true, no_consecutive_remote:true, remote_pairs:[["e8","e4"]] } };
    // [name, shift, title, senior, manager, tracked, remote weekday (1=Mon..5=Fri)]
    const people = [["Soufiane Douhaib","s08","Operations",false,false,true,1],["Mahmoud Abdelrahman","s09","Operations",false,false,true,2],["Moataz Elnoamani","s08","Operations",false,false,true,3],["Minu Boban","s14","Operations",false,false,true,4],["Asem Elsebaey","s09","Operations",false,false,true,5],
      ["Jaber Al Naimi","s08","Operations Senior",true,true,true,2],["Arsany Adel","s09","Operations Senior",true,true,true,3],["Ahmed Kamal","s08","Quality & Training Senior",true,true,true,4],["Rini Najimudheen","s09","Supervisor",false,true,true,1],
      ["Nada Elaraby","s08","Customer Care Manager",false,true,false,0],["Ibrahim Taha","s08","Customer Care Head",false,true,false,0]];
    const employees = people.map(([name,shift,title,senior,adm,tr,rd],i) => ({ id:"e"+(i+1), name, title, senior, email:name.split(" ")[0].toLowerCase()+"@demo.aaico.com", shift_id:shift, default_mode:"office", tracked: tr && !adm, scheduled: tr, is_admin:adm, active:true, since:null, _rd:rd }));
    const today = dk(Date.now()), [ty,tm] = today.split("-").map(Number);
    const prev = tm===1 ? `${ty-1}-12` : `${ty}-${String(tm-1).padStart(2,"0")}`;
    const days = [];
    for(const ym of [prev, today.slice(0,7)]){
      const [y,m] = ym.split("-").map(Number), n = new Date(Date.UTC(y,m,0)).getUTCDate();
      for(let d=1; d<=n; d++){ const k = `${ym}-${String(d).padStart(2,"0")}`; if(k > today) break; days.push(k); }
    }
    const schedule = [], attendance = [];
    const [cy, cm] = today.split("-").map(Number), nd = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
    for(const e of employees.filter(x=>x.scheduled)) for(let dd = 1; dd <= nd; dd++){
      const k = `${today.slice(0,7)}-${String(dd).padStart(2,"0")}`, wd = new Date(k+"T12:00:00Z").getUTCDay();
      const work = wd >= 1 && wd <= 5;
      schedule.push({ employee_id:e.id, day:k, shift_id: work ? e.shift_id : null, work_mode: work ? (wd===e._rd ? "remote" : "office") : null });
    }
    // one rule break on purpose so the schedule check has something to show: Asem remote on a Monday after his remote Friday
    const fri = schedule.find(r=>r.employee_id==="e5" && r.work_mode==="remote" && r.day > today);
    if(fri){ const mon = new Date(Date.parse(fri.day+"T12:00:00Z") + 3*864e5).toISOString().slice(0,10); const r = schedule.find(x=>x.employee_id==="e5" && x.day===mon); if(r) r.work_mode = "remote"; }
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
      if(r < 0.03) continue;
      const remote = e.default_mode==="remote" || (r < 0.2 && new Date(k+"T12:00:00Z").getUTCDay()===4);
      const q = rnd();
      const off = q < 0.35 ? -(11 + Math.floor(rnd()*15)) : q < 0.8 ? Math.floor(rnd()*10) - 5 : 6 + Math.floor(rnd()*35);
      if(k === today && nowMin < start + off) continue;
      const sev = rnd() < 0.025 ? 45 + Math.floor(rnd()*60) : 0;
      const early = rnd() < 0.08 ? 20 + Math.floor(rnd()*60) : 0;
      attendance.push({ employee_id:e.id, day:k, mode: remote ? "remote" : "office", check_in:at(k,start+(sev||off)), check_out: k===today ? null : early ? at(k,end-early) : at(k,end+1), auto_out: k!==today && !early, in_dist: remote ? null : 20 + Math.floor(rnd()*200), out_dist:null });
    }

    // Live state for today: everyone except Mahmoud is already in, one on lunch, one over a short break
    const nowIso = m => new Date(Date.now() - m*60000).toISOString();
    const breaks = [];
    for(const e of employees.filter(x=>x.tracked && x.id!=="e2")){
      const i = attendance.findIndex(r=>r.employee_id===e.id && r.day===today); if(i>=0) attendance.splice(i,1);
      const st0 = pHM(shifts.find(x=>x.id===e.shift_id).start_time.slice(0,5));
      attendance.push({ employee_id:e.id, day:today, mode: e.default_mode, check_in:at(today, Math.max(0, Math.min(st0-5, nowMin-40))), check_out:null, in_dist: e.id==="e5" ? null : 60, out_dist:null });
    }
    breaks.push({ id:1, employee_id:"e4", day:today, kind:"long", started_at:nowIso(12), ended_at:null });
    breaks.push({ id:2, employee_id:"e3", day:today, kind:"short", started_at:nowIso(33), ended_at:null });
    let bid = 100;
    for(const r0 of attendance) if(r0.day!==today && rnd() < 0.5){ const st = Date.parse(r0.check_in) + 3*3600000; const over = rnd() < 0.2 ? 6 + Math.floor(rnd()*15) : 0;
      breaks.push({ id:bid++, employee_id:r0.employee_id, day:r0.day, kind:"long", started_at:new Date(st).toISOString(), ended_at:new Date(st + (30+over)*60000).toISOString() }); }
    breaks.push({ id:4, employee_id:"e5", day:today, kind:"meeting", started_at:nowIso(48), ended_at:null });
    breaks.push({ id:3, employee_id:"e1", day:today, kind:"short", started_at:nowIso(100), ended_at:nowIso(86) });
    const adjustments = [{ id:1, employee_id:"e3", month:prev, type:"red", delta:-1, reason:"System outage, late check-in excused", created_by:"m1", created_at:new Date().toISOString() }];
    const excused = [{ employee_id:"e3", day: days.find(k=>k.slice(0,7)===prev && new Date(k+"T12:00:00Z").getUTCDay()===3) || days[0], reason:"Doctor appointment", created_at:new Date().toISOString() }];
    const audit_log = [
      { id:1, at:new Date(Date.now()-86400000*2).toISOString(), actor_name:"Ahmed Kamal", actor_email:"ahmed@demo.aaico.com", action:"Changed schedule", target:"Minu Boban", details:"01 Oct to 16 Oct 2026: 14:00 to 23:00 (working days)" },
      { id:2, at:new Date(Date.now()-86400000).toISOString(), actor_name:"Ahmed Kamal", actor_email:"ahmed@demo.aaico.com", action:"Adjusted points", target:"Moataz Noamani", details:prev+": -1 red. Reason: System outage, late check-in excused" },
      { id:3, at:new Date(Date.now()-3600000*5).toISOString(), actor_name:"System", actor_email:null, action:"Auto check-out", target:"Asem Elsebaey", details:"yesterday at 18:01" }
    ];
    return { settings:[S], shifts, employees, schedule, attendance, adjustments, breaks, excused, audit_log, issues:[], files:{}, _seq:10 };
  }
  let DB;
  try{ DB = JSON.parse(sessionStorage.getItem(KEY)); }catch{}
  if(!DB) DB = build();
  const save = () => { try{ sessionStorage.setItem(KEY, JSON.stringify(DB)); }catch{} };
  save();
  const asId = () => sessionStorage.getItem(AS) || "e8";
  const meRow = () => DB.employees.find(e=>e.id===asId()) || DB.employees[0];
  const visible = (t, rows) => {
    const m = meRow(); if(m.is_admin) return rows;
    if(t==="employees") return rows.filter(r=>r.id===m.id);
    if(["attendance","schedule","adjustments","excused","issues"].includes(t)) return rows.filter(r=>r.employee_id===m.id);
    if(t==="audit_log") return [];
    return rows;
  };

  const nameOf = id => (DB.employees.find(e=>e.id===id)||{}).name || "";
  function audit(action, target, details){ const m = meRow(); DB.audit_log.unshift({ id:DB._seq++, at:new Date().toISOString(), actor_name:m.name, actor_email:m.email, action, target, details }); }
  class Q {
    constructor(t){ this.t=t; this.f=[]; this.op="select"; this.ord=null; this.one=null; this.payload=null; }
    select(){ return this; }
    eq(c,v){ this.f.push(r=>String(r[c])===String(v)); return this; }
    gte(c,v){ this.f.push(r=>r[c]>=v); return this; }
    lte(c,v){ this.f.push(r=>r[c]<=v); return this; }
    order(c,o){ this.ord=[c, !(o && o.ascending===false)]; return this; }
    limit(n){ this.lim=n; return this; }
    range(a,b){ this.rng=[a,b]; return this; }
    in(c,v){ this.f.push(r=>v.map(String).includes(String(r[c]))); return this; }
    maybeSingle(){ this.one="maybe"; return this; }
    single(){ this.one="single"; return this; }
    insert(p){ this.op="insert"; this.payload=p; return this; }
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
        if(this.lim) out = out.slice(0, this.lim);
        if(this.rng) out = out.slice(this.rng[0], this.rng[1]+1);
        return { data: this.one ? (out[0]||null) : out, error:null };
      }
      if(this.op==="insert"){
        const r = { ...this.payload };
        if(this.t==="employees"){ r.id = "e"+(DB._seq++); r.email = r.email||null; r.active = r.active ?? true; r.is_admin = r.is_admin ?? false; r.since = r.since ?? null; }
        if(this.t==="adjustments"){ r.id = DB._seq++; r.created_at = new Date().toISOString(); audit("Adjusted points", nameOf(r.employee_id), `${r.month}: ${r.delta>0?"+1":"-1"} ${r.type}. Reason: ${r.reason}`); }
        if(this.t==="employees") audit("Added employee", r.name, "");
        rows.push(r); save(); return { data:{...r}, error:null };
      }
      if(this.op==="update"){
        if(this.t==="employees" && this.payload.email){
          const clash = rows.find(r => !match(r) && (r.email||"").toLowerCase()===this.payload.email.toLowerCase());
          if(clash){ const e = new Error("duplicate"); e.code="23505"; throw e; }
        }
        rows.filter(match).forEach(r=>{
          const ch = Object.entries(this.payload).filter(([k,v]) => JSON.stringify(r[k]) !== JSON.stringify(v)).map(([k,v]) => `${k}: ${r[k] ?? "none"} to ${v ?? "none"}`);
          if(ch.length) audit(this.t==="settings" ? "Changed settings" : "Edited employee", this.t==="settings" ? "" : r.name, ch.join("; "));
          Object.assign(r,this.payload);
        }); save(); return { data:null, error:null };
      }
      if(this.op==="delete"){ if(this.t==="adjustments") rows.filter(match).forEach(r=>audit("Deleted adjustment", nameOf(r.employee_id), `${r.month}: ${r.delta>0?"+1":"-1"} ${r.type}. Reason was: ${r.reason}`)); DB[this.t] = rows.filter(r=>!match(r)); save(); return { data:null, error:null }; }
    }
  }
  const dist = (a,b,c,d) => { const R=6371000, r=x=>x*Math.PI/180; const h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  const nowMinD = () => { const p = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dubai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(Date.now()); return +p.find(x=>x.type==="hour").value*60 + +p.find(x=>x.type==="minute").value; };
  function shiftForD(e, k){
    const S = DB.settings[0], sc = DB.schedule.find(r=>r.employee_id===e.id && r.day===k), wd = new Date(k+"T12:00:00Z").getUTCDay();
    const sid = (sc && sc.shift_id) || e.shift_id, sh = DB.shifts.find(x=>x.id===sid);
    return { sh, start: pHM(sh.start_time.slice(0,5)), end: pHM(sh.end_time.slice(0,5)), off: sc ? !sc.shift_id : !S.workdays.includes(wd), mode: (sc && sc.work_mode) || e.default_mode || "office" };
  }
  async function rpc(name, a){
    const S = DB.settings[0], m = meRow(), today = dk(Date.now());
    if(name==="server_now") return { data:new Date().toISOString(), error:null };
    const fail = message => ({ data:null, error:{ message } });
    if(name==="check_in"){
      if(!m.tracked) return fail("This account is not registered for attendance.");
      if(DB.attendance.some(r=>r.employee_id===m.id && r.day===today)) return fail("You already checked in today.");
      const sf = shiftForD(m, today), nm = nowMinD();
      if(sf.off) return fail("You have no shift today.");
      if(nm < sf.start - S.checkin_open_min) return fail(`Check-in opens at ${String(Math.floor((sf.start-S.checkin_open_min)/60)).padStart(2,"0")}:${String((sf.start-S.checkin_open_min)%60).padStart(2,"0")}.`);
      if(nm >= sf.end) return fail("Your shift has ended.");
      a.p_mode = sf.mode;
      let d = null;
      if(a.p_mode==="office"){
        if(a.p_lat==null) return fail("Office check-in needs your location. Allow location access and try again.");
        d = Math.round(dist(a.p_lat,a.p_lng,S.office_lat,S.office_lng));
        if(d > S.radius_m) return fail(`You are ${d} m from the office. Office check-in works within ${S.radius_m} m.`);
      }
      const r = { employee_id:m.id, day:today, mode:a.p_mode, check_in:new Date().toISOString(), check_out:null, in_dist:d, out_dist:null };
      DB.attendance.push(r); save(); return { data:{...r}, error:null };
    }
    if(name==="set_schedule"){
      if(!m.is_admin) return fail("Only managers can change the schedule.");
      let t = Date.parse(a.p_from+"T12:00:00Z"); const e = Date.parse(a.p_to+"T12:00:00Z");
      while(t <= e){ const k = new Date(t).toISOString().slice(0,10), wd = new Date(t).getUTCDay();
        const emp = DB.employees.find(x=>x.id===a.p_employee), ex = DB.schedule.find(r=>r.employee_id===a.p_employee && r.day===k);
        if(a.p_shift==="keep"){ const cur = shiftForD(emp, k); if(!cur.off){ if(ex){ if(a.p_mode) ex.work_mode = a.p_mode; } else DB.schedule.push({ employee_id:a.p_employee, day:k, shift_id:cur.sh.id, work_mode:a.p_mode||null }); } }
        else { const v = a.p_shift==="off" ? null : (a.p_working_only && !S.workdays.includes(wd)) ? null : a.p_shift;
          if(ex){ ex.shift_id = v; if(a.p_mode) ex.work_mode = a.p_mode; } else DB.schedule.push({ employee_id:a.p_employee, day:k, shift_id:v, work_mode:a.p_mode||null }); }
        t += 864e5; }
      const sh = DB.shifts.find(x=>x.id===a.p_shift);
      audit("Changed schedule", nameOf(a.p_employee), `${a.p_from===a.p_to ? a.p_from : a.p_from+" to "+a.p_to}: ${sh ? sh.start_time.slice(0,5)+" to "+sh.end_time.slice(0,5) : a.p_shift==="keep" ? "shift unchanged" : "Day off"}${a.p_mode ? ", "+a.p_mode[0].toUpperCase()+a.p_mode.slice(1) : ""}`);
      save(); return { data:1, error:null };
    }
    if(name==="apply_pattern"){
      if(!m.is_admin) return fail("Only managers can change the schedule.");
      let t = Date.parse(a.p_from+"T12:00:00Z"); const e2 = Date.parse(a.p_to+"T12:00:00Z");
      while(t <= e2){ const k = new Date(t).toISOString().slice(0,10), wd = new Date(t).getUTCDay(), work = S.workdays.includes(wd) && !S.holidays.includes(k);
        const row = { employee_id:a.p_employee, day:k, shift_id: work ? a.p_shift : null, work_mode: work ? ((a.p_remote_dows||[]).includes(wd) ? "remote" : "office") : null };
        const ex = DB.schedule.find(r=>r.employee_id===a.p_employee && r.day===k); if(ex) Object.assign(ex, row); else DB.schedule.push(row); t += 864e5; }
      audit("Applied weekly plan", nameOf(a.p_employee), `${a.p_from} to ${a.p_to}`); save(); return { data:1, error:null };
    }
    if(name==="set_excused"){
      if(!m.is_admin) return fail("Only managers can excuse days.");
      DB.excused = DB.excused.filter(r=>!(r.employee_id===a.p_employee && r.day===a.p_day));
      const LBL = { holiday:"Public holiday", paid:"Paid leave", sick:"Sick leave", half:"Half day, paid", unpaid:"Unpaid day", excused:"Excused" };
      if(a.p_excused){ DB.excused.push({ employee_id:a.p_employee, day:a.p_day, reason:a.p_reason||null, leave_type:a.p_type||"excused" }); audit(LBL[a.p_type||"excused"], nameOf(a.p_employee), a.p_day + (a.p_reason ? ": "+a.p_reason : "")); }
      else audit("Set back to working day", nameOf(a.p_employee), a.p_day);
      save(); return { data:null, error:null };
    }
    if(name==="team_status"){
      const tr = DB.employees.filter(e=>e.active && e.tracked).sort((a,b)=>a.name.localeCompare(b.name)).map(e => {
        const sc = DB.schedule.find(r=>r.employee_id===e.id && r.day===today);
        const wd = new Date(today+"T12:00:00Z").getUTCDay();
        const sid = sc ? (sc.shift_id || e.shift_id) : e.shift_id, sh = DB.shifts.find(x=>x.id===sid);
        const a2 = DB.attendance.find(r=>r.employee_id===e.id && r.day===today);
        const ob = DB.breaks.find(b=>b.employee_id===e.id && !b.ended_at);
        const used = k => DB.breaks.filter(b=>b.employee_id===e.id && b.day===today && b.kind===k).length;
        return { employee_id:e.id, name:e.name, title:e.title||null, avatar_url:e.avatar_url||null, shift_start:sh.start_time, shift_end:sh.end_time, is_off: sc ? !sc.shift_id : !S.workdays.includes(wd),
          check_in:a2?.check_in||null, check_out:a2?.check_out||null, auto_out:!!a2?.auto_out, mode:a2?.mode||null, work_mode:(sc&&sc.work_mode)||e.default_mode, break_kind:ob?.kind||null, break_started:ob?.started_at||null,
          break_allowed: ob ? (ob.kind==="long" ? S.break_long_min : ob.kind==="wc" ? S.break_wc_min : ob.kind==="short" ? S.break_short_min : null) : null, short_used:used("short"), long_used:used("long"), wc_used:used("wc") };
      });
      return { data:tr, error:null };
    }
    if(name==="start_break"){
      if(!DB.attendance.some(r=>r.employee_id===m.id && r.day===today && !r.check_out)) return fail("Check in before starting a break.");
      if(DB.breaks.some(b=>b.employee_id===m.id && !b.ended_at)) return fail("End your current status first.");
      if(["short","long","wc"].includes(a.p_kind)){
        const sf = shiftForD(m, today), nm = nowMinD();
        if(nm < sf.start + S.break_edge_min || nm > sf.end - S.break_edge_min) return fail(`Breaks are not allowed in the first or last ${S.break_edge_min} minutes of your shift.`);
        const used = DB.breaks.filter(b=>b.employee_id===m.id && b.day===today && b.kind===a.p_kind).length;
        if(used >= (a.p_kind==="short" ? S.break_short_count : a.p_kind==="wc" ? S.break_wc_count : S.break_long_count)) return fail("No breaks of that type left today.");
      }
      const avail = DB.attendance.filter(r=>r.day===today && !r.check_out && r.employee_id!==m.id && !DB.breaks.some(b=>b.employee_id===r.employee_id && !b.ended_at)).length;
      if(avail < S.min_available) return fail(`At least ${S.min_available} teammate(s) must stay available. Wait until someone is back.`);
      const r = { id:DB._seq++, employee_id:m.id, day:today, kind:a.p_kind, started_at:new Date().toISOString(), ended_at:null };
      DB.breaks.push(r); save(); return { data:{...r}, error:null };
    }
    if(name==="end_break"){
      const b = DB.breaks.find(x=>x.employee_id===m.id && !x.ended_at); if(!b) return fail("You are not on a break.");
      b.ended_at = new Date().toISOString(); save(); return { data:{...b}, error:null };
    }
    if(name==="admin_set_status"){
      if(!m.is_admin) return fail("Only managers can change someone's status.");
      if(!["available","meeting","task"].includes(a.p_status)) return fail("Invalid status.");
      if(!DB.attendance.some(r=>r.employee_id===a.p_employee && r.day===today && !r.check_out)) return fail("This person is not checked in right now.");
      DB.breaks.filter(b=>b.employee_id===a.p_employee && !b.ended_at).forEach(b=>b.ended_at=new Date().toISOString());
      let r = null;
      if(a.p_status !== "available"){ r = { id:DB._seq++, employee_id:a.p_employee, day:today, kind:a.p_status, started_at:new Date().toISOString(), ended_at:null }; DB.breaks.push(r); }
      audit("Changed status", nameOf(a.p_employee), "Set to "+a.p_status); save(); return { data:r && {...r}, error:null };
    }
    if(name==="set_my_avatar"){ const e = DB.employees.find(x=>x.id===m.id); e.avatar_url = a.p_url; save(); return { data:null, error:null }; }
    if(name==="report_issue"){
      DB.issues = DB.issues || [];
      const r = { id:DB._seq++, employee_id:m.id, category:a.p_category, message:a.p_message, page:a.p_page, user_agent:a.p_user_agent, created_at:new Date().toISOString() };
      DB.issues.push(r); save(); return { data:{...r}, error:null };
    }
    if(name==="check_out"){
      DB.breaks.filter(b=>b.employee_id===m.id && !b.ended_at).forEach(b=>b.ended_at=new Date().toISOString());
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
    upload: (path, blob) => new Promise(res => { const f = new FileReader(); f.onload = () => { DB.files = DB.files || {}; DB.files[path] = f.result; save(); res({ data:{ path }, error:null }); }; f.readAsDataURL(blob); }),
    getPublicUrl: path => ({ data:{ publicUrl: (DB.files||{})[path] || "" } })
  }) };
  window.supabase = { createClient: () => ({
    from: t => new Q(t),
    rpc, storage,
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
    const opts = DB.employees.map(e=>`<option value="${e.id}" ${e.id===asId()?"selected":""}>${e.name}${e.title ? " ("+e.title+")" : ""}</option>`).join("");
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

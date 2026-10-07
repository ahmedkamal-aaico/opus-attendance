"use strict";
async function loadBase(){
  const [st, sh, em] = await Promise.all([
    sb.from("settings").select("*").eq("id",1).maybeSingle(),
    sb.from("shifts").select("*").order("start_time"),
    sb.from("employees").select("*").order("name")
  ]);
  if(st.error) throw st.error; if(sh.error) throw sh.error; if(em.error) throw em.error;
  if(st.data) S = { ...S, ...st.data };
  shifts = {}; for(const r of sh.data) shifts[r.id] = { start:short(r.start_time), end:short(r.end_time) };
  const email = (await sb.auth.getUser()).data.user?.email?.toLowerCase();
  me = em.data.find(e => (e.email||"").toLowerCase() === email && e.active) || null;
  emps = em.data;
  for(const e of emps) if(e.avatar_url) photos[e.id] = e.avatar_url;
}
const toMap = (rows, val) => { const o = {}; for(const r of rows) o[`${r.employee_id}|${r.day}`] = val(r); return o; };
const histStart = ym => new Date(Date.parse(ym+"-01T12:00:00Z") - 45*864e5).toISOString().slice(0,10);
async function loadMine(ym){
  if(!me) return;
  const a = histStart(ym), b = monthEnd(ym);
  const [att, sc, ex, adj] = await Promise.all([
    sb.from("attendance").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("schedule").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("excused").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("employee_id",me.id).eq("month",ym),
    sb.from("overtime").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("breaks").select("*").eq("employee_id",me.id).gte("day",`${ym}-01`).lte("day",b)
  ]).then(r => { mine.ot = r[4].data || []; mine.brk = r[5].data || []; return r; });
  mine.ym = ym;
  mine.att = toMap(att.data||[], r=>r);
  mine.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) mine.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]){ mine.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; mine.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  mine.adj = adj.data||[];
  if(typeof paintSideShift==="function") paintSideShift();
}
async function loadTeam(ym){
  team.loading = true; update();
  const a = histStart(ym), b = monthEnd(ym);
  const [att, sc, ex, adj] = await Promise.all([
    sb.from("attendance").select("*").gte("day",a).lte("day",b),
    sb.from("schedule").select("*").gte("day",a).lte("day",b),
    sb.from("excused").select("*").gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("month",ym).order("created_at",{ascending:false}),
    sb.from("overtime").select("*").gte("day",`${ym}-01`).lte("day",b).order("id",{ascending:false}),
    sb.from("breaks").select("*").gte("day",`${ym}-01`).lte("day",b)
  ]).then(r => { team.ot = r[4].data || []; team.brk = r[5].data || []; return r; });
  team.ym = ym;
  team.att = toMap(att.data||[], r=>r);
  team.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) team.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]){ team.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; team.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  team.adj = adj.data||[];
  team.loading = false; update();
}
const tracked = () => emps.filter(e => e.active && e.tracked);
const schedPeople = () => emps.filter(e => e.active && (e.tracked || e.scheduled)).sort((a,b) => (a.tracked?0:1) - (b.tracked?0:1) || a.name.localeCompare(b.name));


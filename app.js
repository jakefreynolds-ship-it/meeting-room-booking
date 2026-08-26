const SLOT_LABELS = {
  day: "Day (09:00–17:00)",
  evening: "Evening (17:00–22:00)",
  full_day: "Full day (Day + Evening)"
};
let client = null;
let cursor = new Date(); cursor.setDate(1);
let selected = null;
let monthBookings = [];
const $ = id => document.getElementById(id);
const dateKey = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const fmt = d => new Date(d+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function setStatus(text,kind=""){ $("status").textContent=text; $("status").className="status "+kind; }

async function init(){
  const cfg=window.APP_CONFIG||{};
  if(!cfg.SUPABASE_URL||cfg.SUPABASE_URL.includes("PASTE_")||!cfg.SUPABASE_ANON_KEY||cfg.SUPABASE_ANON_KEY.includes("PASTE_")){
    setStatus("Setup required","bad"); renderCalendar(); return;
  }
  client=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false}});
  setStatus("Connected","ok");
  $("statsMonth").value=dateKey(new Date()).slice(0,7);
  await refresh();
}

async function refresh(){ await Promise.all([loadCalendar(),loadStats()]); }

async function loadCalendar(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),start=`${y}-${String(m+1).padStart(2,"0")}-01`,end=dateKey(new Date(y,m+1,0));
  const {data,error}=await client.from("public_bookings").select("*").gte("booking_date",start).lte("booking_date",end);
  if(error){ setStatus("Database error","bad"); console.error(error); return; }
  monthBookings=data||[]; renderCalendar();
}

function renderCalendar(){
  const y=cursor.getFullYear(),m=cursor.getMonth();
  $("monthLabel").textContent=cursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const cal=$("calendar"); cal.innerHTML="";
  ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(x=>cal.insertAdjacentHTML("beforeend",`<div class="dow">${x}</div>`));
  const first=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();
  for(let i=0;i<first;i++) cal.insertAdjacentHTML("beforeend",'<div class="day out"></div>');

  for(let d=1;d<=days;d++){
    const date=dateKey(new Date(y,m,d));
    const div=document.createElement("div");
    div.className="day"+(date===dateKey(new Date())?" today":"");
    div.innerHTML=`<span class="num">${d}</span><div class="slots"></div>`;
    const slots=div.querySelector(".slots");
    const past=date<dateKey(new Date());
    const dayBooking=monthBookings.find(b=>b.booking_date===date&&b.slot==="day");
    const eveBooking=monthBookings.find(b=>b.booking_date===date&&b.slot==="evening");

    ["day","evening"].forEach(slot=>{
      const found=slot==="day"?dayBooking:eveBooking;
      const btn=document.createElement("button");
      btn.className="slot "+(found?"booked":past?"past":"free");
      btn.disabled=!!found||past||!client;
      btn.innerHTML=found?`${slot==="day"?"☀":"🌙"} ${esc(found.name)}`:past?"Unavailable":`${slot==="day"?"☀ Day":"🌙 Evening"}`;
      if(!btn.disabled) btn.onclick=()=>openForm(date,slot);
      slots.appendChild(btn);
    });

    const full=document.createElement("button");
    const fullUnavailable=!!dayBooking||!!eveBooking||past||!client;
    full.className="slot "+(fullUnavailable?(past?"past":"booked"):"free");
    full.disabled=fullUnavailable;
    full.textContent=past?"Full day unavailable":(dayBooking||eveBooking)?"Full day unavailable":"◉ Full day";
    if(!full.disabled) full.onclick=()=>openForm(date,"full_day");
    slots.appendChild(full);
    cal.appendChild(div);
  }
}

function openForm(date,slot){
  selected={date,slot};
  $("formCard").classList.remove("hidden");
  $("selectedSummary").textContent=`${fmt(date)} · ${SLOT_LABELS[slot]}`;
  $("formMessage").textContent="";
  $("weekly").checked=false;
  $("endDateWrap").classList.add("hidden");
  $("endDate").value="";
  $("endDate").min=date;
  $("name").focus();
  $("formCard").scrollIntoView({behavior:"smooth",block:"start"});
}

$("weekly").onchange=e=>{
  $("endDateWrap").classList.toggle("hidden",!e.target.checked);
  if(e.target.checked&&!$("endDate").value){ const d=new Date(selected.date+"T12:00:00"); d.setMonth(d.getMonth()+3); $("endDate").value=dateKey(d); }
};

$("bookingForm").onsubmit=async e=>{
  e.preventDefault(); if(!client||!selected)return;
  const weekly=$("weekly").checked,end=weekly?$("endDate").value:selected.date;
  if(weekly&&!end){ $("formMessage").className="message error"; $("formMessage").textContent="Choose an end date."; return; }
  const submit=e.target.querySelector('button[type="submit"]'); submit.disabled=true;
  $("formMessage").className="message"; $("formMessage").textContent="Saving…";
  const {data,error}=await client.rpc("create_booking_series",{p_name:$("name").value.trim(),p_email:$("email").value.trim(),p_purpose:$("purpose").value.trim()||null,p_start_date:selected.date,p_slot:selected.slot,p_repeat_weekly:weekly,p_end_date:end});
  submit.disabled=false;
  if(error){ $("formMessage").className="message error"; $("formMessage").textContent=error.message; return; }
  $("formMessage").className="message ok";
  $("formMessage").textContent=`Booked ${data} date${data===1?"":"s"}${selected.slot==="full_day"?" as full day":""}.`;
  e.target.reset(); $("endDateWrap").classList.add("hidden"); setTimeout(()=>$("formCard").classList.add("hidden"),700); await refresh();
};

async function loadStats(){
  if(!client)return;
  const month=$("statsMonth").value||dateKey(new Date()).slice(0,7),start=month+"-01",d=new Date(start+"T12:00:00"),end=dateKey(new Date(d.getFullYear(),d.getMonth()+1,0));
  const {data,error}=await client.from("public_bookings").select("name,slot,booking_date").gte("booking_date",start).lte("booking_date",end);
  const body=$("statsBody"); body.innerHTML="";
  if(error){ body.innerHTML='<tr><td colspan="4">Could not load statistics.</td></tr>'; return; }
  const map={};
  (data||[]).forEach(b=>{ const k=b.name.trim(); map[k]??={day:0,evening:0}; if(b.slot==="day")map[k].day+=0.5; if(b.slot==="evening")map[k].evening+=0.5; });
  const rows=Object.entries(map).map(([name,x])=>({name,...x,total:x.day+x.evening})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  if(!rows.length){ body.innerHTML='<tr><td colspan="4">No bookings this month.</td></tr>'; return; }
  rows.forEach(r=>body.insertAdjacentHTML("beforeend",`<tr><td>${esc(r.name)}</td><td>${r.day}</td><td>${r.evening}</td><td><b>${r.total}</b></td></tr>`));
}

$("statsMonth").onchange=loadStats;
$("cancel").onclick=()=>$("formCard").classList.add("hidden");
$("prev").onclick=async()=>{cursor.setMonth(cursor.getMonth()-1);if(client)await loadCalendar();else renderCalendar();};
$("next").onclick=async()=>{cursor.setMonth(cursor.getMonth()+1);if(client)await loadCalendar();else renderCalendar();};
$("todayBtn").onclick=async()=>{cursor=new Date();cursor.setDate(1);if(client)await loadCalendar();else renderCalendar();};
init();

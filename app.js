const SLOT_LABELS = {
  day: "Day (09:00–17:00)",
  evening: "Evening (17:00–22:00)",
  full_day: "Full day (Day + Evening)"
};

let client = null;
let cursor = new Date(); cursor.setDate(1);
let selected = null;
let editing = null;
let mode = "create";
let monthBookings = [];

const $ = id => document.getElementById(id);
const dateKey = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const fmt = d => new Date(d+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const nameColorClass = name => {
  switch(String(name||"").trim().toLowerCase()){
    case "lewis": return "person-lewis";
    case "jack": return "person-jack";
    case "jake": return "person-jake";
    case "jonah": return "person-jonah";
    default: return "person-other";
  }
};
function setStatus(text,kind=""){ $("status").textContent=text; $("status").className="status "+kind; }

async function init(){
  const cfg=window.APP_CONFIG||{};
  if(!cfg.SUPABASE_URL||cfg.SUPABASE_URL.includes("PASTE_")||!cfg.SUPABASE_ANON_KEY||cfg.SUPABASE_ANON_KEY.includes("PASTE_")){
    setStatus("Setup required","bad"); renderCalendar(); renderStats(); return;
  }
  client=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false}});
  setStatus("Connected","ok");
  await refresh();
}

async function refresh(){ await loadMonth(); }

async function loadMonth(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),start=`${y}-${String(m+1).padStart(2,"0")}-01`,end=dateKey(new Date(y,m+1,0));
  const {data,error}=await client.from("public_bookings").select("*").gte("booking_date",start).lte("booking_date",end);
  if(error){ setStatus("Database error","bad"); console.error(error); return; }
  monthBookings=data||[];
  renderCalendar();
  renderStats();
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
    const pairedFullDay=!!(dayBooking&&eveBooking&&dayBooking.series_id&&dayBooking.series_id===eveBooking.series_id);

    if(pairedFullDay){
      const full=document.createElement("button");
      full.className=`slot booked editable ${nameColorClass(dayBooking.name)}`;
      full.disabled=!client;
      full.textContent=`◉ Full day · ${dayBooking.name} · Edit`;
      if(client) full.onclick=()=>openEditForm(dayBooking,true);
      slots.appendChild(full);
      cal.appendChild(div);
      continue;
    }

    ["day","evening"].forEach(slot=>{
      const found=slot==="day"?dayBooking:eveBooking;
      if(found){
        const btn=document.createElement("button");
        btn.className=`slot booked editable ${nameColorClass(found.name)}`;
        btn.disabled=!client;
        btn.innerHTML=`${slot==="day"?"☀":"🌙"} ${esc(found.name)} · Edit`;
        if(client) btn.onclick=()=>openEditForm(found,false);
        slots.appendChild(btn);
      } else if(!past && client){
        const btn=document.createElement("button");
        btn.className="slot free";
        btn.textContent=slot==="day"?"☀ Day":"🌙 Evening";
        btn.onclick=()=>openCreateForm(date,slot);
        slots.appendChild(btn);
      }
    });

    if(!past && client && !dayBooking && !eveBooking){
      const full=document.createElement("button");
      full.className="slot free";
      full.textContent="◉ Full day";
      full.onclick=()=>openCreateForm(date,"full_day");
      slots.appendChild(full);
    }
    cal.appendChild(div);
  }
}

function renderStats(){
  const monthName=cursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  $("statsMonthLabel").textContent=monthName;
  const daysInMonth=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate();
  const body=$("statsBody"); body.innerHTML="";
  const map={};
  let bookedDaySlots=0;
  let bookedEveningSlots=0;

  (monthBookings||[]).forEach(b=>{
    const k=b.name.trim();
    map[k]??={day:0,evening:0};
    if(b.slot==="day"){
      map[k].day+=0.5;
      bookedDaySlots++;
    }
    if(b.slot==="evening"){
      map[k].evening+=0.5;
      bookedEveningSlots++;
    }
  });

  const rows=Object.entries(map)
    .map(([name,x])=>({name,...x,total:x.day+x.evening}))
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));

  rows.forEach(r=>{
    body.insertAdjacentHTML("beforeend",`<tr><td><span class="person-chip ${nameColorClass(r.name)}">${esc(r.name)}</span></td><td>${r.day}</td><td>${r.evening}</td><td><b>${r.total}</b></td></tr>`);
  });

  const unusedDay=(daysInMonth-bookedDaySlots)*0.5;
  const unusedEvening=(daysInMonth-bookedEveningSlots)*0.5;
  const unusedTotal=unusedDay+unusedEvening;
  body.insertAdjacentHTML("beforeend",`<tr><td><span class="person-chip person-unused">Unused</span></td><td>${unusedDay}</td><td>${unusedEvening}</td><td><b>${unusedTotal}</b></td></tr>`);
}

function resetFormMode(){
  $("bookingForm").reset();
  $("formMessage").textContent="";
  $("formMessage").className="message";
  $("endDateWrap").classList.add("hidden");
  $("deleteBox").classList.add("hidden");
  $("deleteSeriesRow").classList.add("hidden");
  $("deleteThis").checked=true;
}

function openCreateForm(date,slot){
  mode="create"; editing=null; selected={date,slot}; resetFormMode();
  $("formHeading").textContent="Book the room";
  $("submitBtn").textContent="Confirm booking";
  $("emailLabel").textContent="Email / contact";
  $("editFields").classList.add("hidden");
  $("repeatBox").classList.remove("hidden");
  $("selectedSummary").textContent=`${fmt(date)} · ${SLOT_LABELS[slot]}`;
  $("endDate").min=date;
  $("formCard").classList.remove("hidden");
  $("name").focus();
  $("formCard").scrollIntoView({behavior:"smooth",block:"start"});
}

async function openEditForm(booking,isFullDay=false){
  mode="edit"; selected=null;
  editing={id:booking.id,date:booking.booking_date,slot:isFullDay?"full_day":booking.slot,seriesId:booking.series_id||null,isRecurring:false};
  resetFormMode();
  $("formHeading").textContent="Edit booking";
  $("submitBtn").textContent="Save changes";
  $("emailLabel").textContent="Original booking email (required to edit or delete)";
  $("repeatBox").classList.add("hidden");
  $("editFields").classList.remove("hidden");
  $("deleteBox").classList.remove("hidden");
  $("editDate").value=booking.booking_date;
  $("editDate").min=dateKey(new Date());
  $("editSlot").value=editing.slot;
  $("name").value=booking.name||"";
  $("purpose").value=booking.purpose||"";
  $("email").value="";
  $("selectedSummary").textContent=`Editing ${fmt(booking.booking_date)} · ${SLOT_LABELS[editing.slot]}. Enter the original email to save or delete.`;
  $("formCard").classList.remove("hidden");
  $("email").focus();
  $("formCard").scrollIntoView({behavior:"smooth",block:"start"});

  if(client && editing.seriesId){
    const {data}=await client.from("public_bookings").select("booking_date").eq("series_id",editing.seriesId);
    const distinctDates=new Set((data||[]).map(x=>x.booking_date));
    editing.isRecurring=distinctDates.size>1;
    if(editing.isRecurring) $("deleteSeriesRow").classList.remove("hidden");
  }
}

$("weekly").onchange=e=>{
  $("endDateWrap").classList.toggle("hidden",!e.target.checked);
  if(e.target.checked&&!$("endDate").value){ const d=new Date(selected.date+"T12:00:00"); d.setMonth(d.getMonth()+3); $("endDate").value=dateKey(d); }
};

$("bookingForm").onsubmit=async e=>{
  e.preventDefault(); if(!client)return;
  const submit=$("submitBtn"); submit.disabled=true;
  $("formMessage").className="message"; $("formMessage").textContent="Saving…";

  if(mode==="edit"){
    const {error}=await client.rpc("edit_booking",{
      p_booking_id:editing.id,
      p_email:$("email").value.trim(),
      p_new_name:$("name").value.trim(),
      p_new_purpose:$("purpose").value.trim()||null,
      p_new_date:$("editDate").value,
      p_new_slot:$("editSlot").value
    });
    submit.disabled=false;
    if(error){
      $("formMessage").className="message error";
      $("formMessage").textContent=error.message.includes("Email does not match")?"That email does not match the original booking.":error.message;
      return;
    }
    $("formMessage").className="message ok"; $("formMessage").textContent="Booking updated.";
    setTimeout(()=>$("formCard").classList.add("hidden"),700);
    await refresh(); return;
  }

  if(!selected){ submit.disabled=false; return; }
  const weekly=$("weekly").checked,end=weekly?$("endDate").value:selected.date;
  if(weekly&&!end){ submit.disabled=false; $("formMessage").className="message error"; $("formMessage").textContent="Choose an end date."; return; }
  const {data,error}=await client.rpc("create_booking_series",{
    p_name:$("name").value.trim(),p_email:$("email").value.trim(),p_purpose:$("purpose").value.trim()||null,
    p_start_date:selected.date,p_slot:selected.slot,p_repeat_weekly:weekly,p_end_date:end
  });
  submit.disabled=false;
  if(error){ $("formMessage").className="message error"; $("formMessage").textContent=error.message; return; }
  $("formMessage").className="message ok";
  $("formMessage").textContent=`Booked ${data} date${data===1?"":"s"}${selected.slot==="full_day"?" as full day":""}.`;
  setTimeout(()=>$("formCard").classList.add("hidden"),700); await refresh();
};

$("deleteBtn").onclick=async()=>{
  if(!client||mode!=="edit"||!editing)return;
  const email=$("email").value.trim();
  if(!email){ $("formMessage").className="message error"; $("formMessage").textContent="Enter the original booking email first."; return; }
  const deleteSeries=$("deleteSeries").checked && editing.isRecurring;
  const wording=deleteSeries?"all dates in this recurring series":"this booking date";
  if(!window.confirm(`Delete ${wording}? This cannot be undone.`)) return;
  const btn=$("deleteBtn"); btn.disabled=true;
  $("formMessage").className="message"; $("formMessage").textContent="Deleting…";
  const {error}=await client.rpc("delete_booking",{p_booking_id:editing.id,p_email:email,p_delete_series:deleteSeries});
  btn.disabled=false;
  if(error){
    $("formMessage").className="message error";
    $("formMessage").textContent=error.message.includes("Email does not match")?"That email does not match the original booking.":error.message;
    return;
  }
  $("formMessage").className="message ok"; $("formMessage").textContent=deleteSeries?"Recurring series deleted.":"Booking deleted.";
  setTimeout(()=>$("formCard").classList.add("hidden"),700);
  await refresh();
};

$("cancel").onclick=()=>$("formCard").classList.add("hidden");
$("prev").onclick=async()=>{cursor.setMonth(cursor.getMonth()-1);if(client)await refresh();else{renderCalendar();renderStats();}};
$("next").onclick=async()=>{cursor.setMonth(cursor.getMonth()+1);if(client)await refresh();else{renderCalendar();renderStats();}};
$("todayBtn").onclick=async()=>{cursor=new Date();cursor.setDate(1);if(client)await refresh();else{renderCalendar();renderStats();}};
init();

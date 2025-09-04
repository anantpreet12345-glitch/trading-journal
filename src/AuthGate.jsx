import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/** Weekly Trading Journal (multi-user, cloud-synced)
 * - Centered white card on dark background
 * - Safe date handling
 * - Notes, checklist, tags, screenshots, MT5 CSV import
 * - LocalStorage cache + Supabase sync (weeks + custom checks)
 */

function debounce(fn, ms = 800) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export default function TradingJournalApp({ user }) {
  // ---------- Helpers ----------
  const toLocalDate = (d) => { const dt = new Date(d); dt.setHours(0,0,0,0); return dt; };
  const startOfISOWeek = (date) => { const d = toLocalDate(date); const day=(d.getDay()+6)%7; const s=new Date(d); s.setDate(d.getDate()-day); return s; };
  const endOfISOWeek = (date) => { const s=startOfISOWeek(date); const e=new Date(s); e.setDate(s.getDate()+6); return e; };
  const fmt = (d) => new Date(d).toISOString().slice(0,10);
  const safeDate = (value) => { const d=new Date(value); return isNaN(d.getTime()) ? new Date() : d; };
  const weekKey = (d) => `${fmt(startOfISOWeek(d))}_${fmt(endOfISOWeek(d))}`;

  // ---------- State ----------
  const [selectedDate, setSelectedDate] = useState(() => fmt(new Date()));
  const [entries, setEntries] = useState({});          // { "YYYY-MM-DD_YYYY-MM-DD": entry }
  const [customChecks, setCustomChecks] = useState([]); // [{id,label}]
  const [filter, setFilter] = useState("");
  const [showPrintView, setShowPrintView] = useState(false);
  const STORAGE_KEY = "trading_journal_v2";

  // defaults
  const defaultAnswers = { stopLossPlaced:false, revengeTradeAfterOneSL:false, followedRiskManagement:false };
  const emptyEntry = {
    context:"", answers:{...defaultAnswers}, customAnswers:{},
    stats:{ numberOfTrades:0, pnl:0 },
    tags:[], screenshots:[], trades:[],
    createdAt:null, updatedAt:null,
  };

  // Load from LocalStorage (cache)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setEntries(p.entries || {});
        setCustomChecks(p.customChecks || []);
      }
    } catch (e) { console.error(e); }
  }, []);

  // Save to LocalStorage (cache)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, customChecks }));
  }, [entries, customChecks]);

  // Current week
  const sDate = useMemo(()=>startOfISOWeek(safeDate(selectedDate)),[selectedDate]);
  const eDate = useMemo(()=>endOfISOWeek(safeDate(selectedDate)),[selectedDate]);
  const currentKey = useMemo(()=>weekKey(safeDate(selectedDate)),[selectedDate]);
  const current = entries[currentKey] || emptyEntry;

  const updateCurrent = (upd) => {
    const now = new Date().toISOString();
    setEntries((prev)=>({
      ...prev,
      [currentKey]: {
        ...emptyEntry,
        ...(prev[currentKey]||{}),
        ...upd,
        createdAt: prev[currentKey]?.createdAt || now,
        updatedAt: now,
      }
    }));
  };

  // ---------- CLOUD LOAD (on sign-in) ----------
  // Load user custom checks
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("journal_settings")
        .select("custom_checks")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && !error) {
        setCustomChecks((Array.isArray(data?.custom_checks) ? data.custom_checks : []) || []);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Load all weeks for user (for Past Weeks + current hydration)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("journal_weeks")
        .select("week_start, payload, updated_at")
        .order("week_start", { ascending: false });
      if (error || cancelled) return;

      const mapped = {};
      for (const row of data || []) {
        const s = fmt(row.week_start);
        const e = fmt(endOfISOWeek(new Date(row.week_start)));
        const key = `${s}_${e}`;
        mapped[key] = {
          ...emptyEntry,
          ...(row.payload || {}),
          updatedAt: row.payload?.updatedAt || row.updated_at || null,
          createdAt: row.payload?.createdAt || null,
        };
      }
      setEntries((prev) => ({ ...prev, ...mapped }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---------- CLOUD SAVE (debounced) ----------
  const saveWeekToCloud = useMemo(() =>
    debounce(async (weekKeyStr, payload) => {
      if (!user) return;
      const weekStartISO = weekKeyStr.split("_")[0]; // YYYY-MM-DD
      await supabase.from("journal_weeks").upsert(
        { user_id: user.id, week_start: weekStartISO, payload, updated_at: new Date().toISOString() },
        { onConflict: "user_id,week_start" }
      );
    }, 800), [user]);

  useEffect(() => {
    if (!user) return;
    saveWeekToCloud(currentKey, current);
    return () => saveWeekToCloud.cancel?.();
  }, [user, currentKey, current, saveWeekToCloud]);

  // Save custom checks to cloud when they change
  const saveChecksToCloud = useMemo(() =>
    debounce(async (checks) => {
      if (!user) return;
      await supabase.from("journal_settings").upsert(
        { user_id: user.id, custom_checks: checks, updated_at: new Date().toISOString() }
      );
    }, 800), [user]);

  useEffect(() => {
    if (!user) return;
    saveChecksToCloud(customChecks);
    return () => saveChecksToCloud.cancel?.();
  }, [user, customChecks, saveChecksToCloud]);

  // ---------- Derived ----------
  const yesCount =
    Object.values(current.answers).filter(Boolean).length +
    Object.values(current.customAnswers || {}).filter(Boolean).length;
  const totalChecks =
    Object.keys(current.answers).length + (customChecks?.length || 0);
  const scorePct = totalChecks ? Math.round((yesCount / totalChecks) * 100) : 0;

  const allWeeks = useMemo(() => {
    const rows = Object.keys(entries).map((k) => {
      const [s, e] = k.split("_");
      const item = entries[k];
      const y = Object.values(item.answers||{}).filter(Boolean).length +
                Object.values(item.customAnswers||{}).filter(Boolean).length;
      const t = Object.keys(item.answers||{}).length + (customChecks?.length||0);
      const p = t ? Math.round((y/t)*100) : 0;
      const trades = item.stats?.numberOfTrades ?? 0;
      const pnl = item.stats?.pnl ?? 0;
      return { key:k, start:s, end:e, score:p, updatedAt:item.updatedAt, trades, pnl };
    });
    rows.sort((a,b)=> a.start < b.start ? 1 : -1);
    return rows.filter(r=>!filter || r.start.includes(filter) || r.end.includes(filter));
  }, [entries, customChecks, filter]);

  // ---------- Screenshots ----------
  const fileToDataUrl = (file) => new Promise((res, rej) => {
    const reader = new FileReader(); reader.onload=()=>res(reader.result);
    reader.onerror=rej; reader.readAsDataURL(file);
  });
  const handleAddScreenshots = async (files) => {
    if (!files?.length) return;
    const maxEachMB = 2;
    const newShots = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > maxEachMB*1024*1024) { alert(`${f.name} > ${maxEachMB} MB; skipped.`); continue; }
      const dataUrl = await fileToDataUrl(f);
      newShots.push({ id:`shot_${Date.now()}_${Math.random().toString(36).slice(2)}`, name:f.name, dataUrl });
    }
    updateCurrent({ screenshots: [...(current.screenshots||[]), ...newShots] });
  };
  const removeScreenshot = (id) =>
    updateCurrent({ screenshots: (current.screenshots||[]).filter(s=>s.id!==id) });

  // ---------- Tags ----------
  const addTag = (raw) => {
    const t = (raw||"").trim(); if (!t) return;
    updateCurrent({ tags: Array.from(new Set([...(current.tags||[]), t])) });
  };
  const removeTag = (t) =>
    updateCurrent({ tags: (current.tags||[]).filter(x=>x!==t) });

  // ---------- MT5 CSV import ----------
  const round2 = (n) => Math.round((Number(n)+Number.EPSILON)*100)/100;
  const isWithinWeek = (d,s,e) => { const t=toLocalDate(d); return t>=s && t<=e; };
  const splitCSVLine = (line) => {
    const res=[]; let cur="", inQ=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (ch === '"'){ if (inQ && line[i+1]==='"'){cur+='"';i++;} else inQ=!inQ; }
      else if (ch === "," && !inQ){ res.push(cur); cur=""; }
      else { cur+=ch; }
    }
    res.push(cur); return res;
  };
  const parseMT5Date = (s) => {
    const trimmed=(s||"").trim();
    let m=trimmed.match(/^(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));
    m=trimmed.match(/^(\d{2})[.](\d{2})[.](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5],+(m[6]||0));
    const dt=new Date(trimmed); return isNaN(dt.getTime())?null:dt;
  };
  const parseMT5CSV = (text) => {
    const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
    if (!lines.length) return [];
    const header=splitCSVLine(lines[0]).map(h=>h.trim().toLowerCase());
    const idx=(names)=>header.findIndex(h=>names.includes(h));
    const timeIdx=idx(["time","open time","time open","date"]);
    const symbolIdx=idx(["symbol","instrument"]);
    const typeIdx=idx(["type","side"]);
    const lotsIdx=idx(["volume","lots","size"]);
    const profitIdx=idx(["profit","p/l","pl","pnl"]);
    if (timeIdx===-1) throw new Error("CSV missing 'Time' column");

    const out=[];
    for (let i=1;i<lines.length;i++){
      const cells=splitCSVLine(lines[i]);
      if (!cells.length || cells.every((c)=>c==="")) continue;
      const get=(ix)=> (ix>=0 && ix<cells.length ? cells[ix] : "");
      const dt=parseMT5Date(get(timeIdx)); if (!dt) continue;
      out.push({
        time:dt,
        symbol:get(symbolIdx)||"",
        type:get(typeIdx)||"",
        lots: parseFloat((get(lotsIdx)||"").replace(/,/g,"")) || 0,
        profit: parseFloat((get(profitIdx)||"").replace(/,/g,"")) || 0,
      });
    }
    return out;
  };
  const handleImportMT5 = (e) => {
    const file=e.target.files?.[0]; if (!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const trades=parseMT5CSV(String(reader.result));
        const within=trades.filter(tr=>isWithinWeek(tr.time,sDate,eDate));
        const numberOfTrades=within.length;
        const pnl=round2(within.reduce((a,t)=>a+(t.profit||0),0));
        updateCurrent({ trades: within, stats:{ numberOfTrades, pnl } });
        alert(`Imported ${within.length} trades for this week. PnL: ${pnl}`);
      }catch(err){ alert("MT5 import failed: "+err.message); }
    };
    reader.readAsText(file);
  };

  // ---------- Styles ----------
  const pageStyle = { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:showPrintView?"#fff":"#0f172a", color:"#0f172a", padding:20 };
  const cardStyle = { width:"100%", maxWidth:960, background:"#fff", borderRadius:16, boxShadow:"0 20px 60px rgba(0,0,0,0.25)", padding:32 };
  const sectionStyle = { border:"1px solid #e5e7eb", borderRadius:16, background:"#fff", padding:16, marginBottom:24, boxShadow:"0 1px 2px rgba(0,0,0,0.04)" };
  const buttonStyle = { padding:"8px 12px", borderRadius:12, border:"1px solid #e5e7eb", background:"#fff", cursor:"pointer", marginRight:8 };
  const inputStyle = { padding:"8px 10px", borderRadius:10, border:"1px solid #e5e7eb" };

  // ---------- UI ----------
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <header style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
          <h1 style={{ fontSize:28, fontWeight:800, margin:0 }}>Weekly Trading Journal</h1>
          <div>
            <button style={buttonStyle} onClick={()=>setSelectedDate(fmt(new Date()))}>Use This Week</button>
            <button style={buttonStyle} onClick={()=>setShowPrintView(v=>!v)}>{showPrintView?"Exit Print View":"Print View"}</button>
            <button style={buttonStyle}
              onClick={()=>{
                const payload={ entries, customChecks, exportedAt:new Date().toISOString(), version:2 };
                const blob=new Blob([JSON.stringify(payload,null,2)],{ type:"application/json" });
                const url=URL.createObjectURL(blob);
                const a=document.createElement("a"); a.href=url; a.download="trading_journal_backup_v2.json"; a.click();
                URL.revokeObjectURL(url);
              }}>Export</button>
            <label style={{ ...buttonStyle }}>
              Import JSON
              <input type="file" accept="application/json" style={{ display:"none" }}
                onChange={(e)=>{
                  const f=e.target.files?.[0]; if (!f) return;
                  const reader=new FileReader();
                  reader.onload=async ()=>{
                    try{
                      const data=JSON.parse(reader.result);
                      if (data.entries && data.customChecks){
                        setEntries(data.entries);
                        setCustomChecks(data.customChecks);
                        alert("Import successful ✔");
                      } else {
                        alert("Invalid file. Expected keys: entries, customChecks");
                      }
                    } catch(err){ alert("Import failed: "+err.message); }
                  };
                  reader.readAsText(f);
                }}/>
            </label>
          </div>
        </header>

        {/* Week picker & filter */}
        <section style={{ display:"grid", gap:16, marginBottom:24 }}>
          <div style={sectionStyle}>
            <div style={{ fontSize:12, color:"#6b7280", marginBottom:8 }}>Pick any date within the week you want to journal</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:10, alignItems:"center" }}>
              <input type="date" value={selectedDate} onChange={(e)=>setSelectedDate(e.target.value || fmt(new Date()))} style={{ ...inputStyle, width:180 }}/>
              <span style={{ display:"inline-flex", gap:8, fontSize:12, padding:"6px 10px", border:"1px solid #e5e7eb", borderRadius:999, background:"#fff" }}>
                <strong>Week:</strong> {fmt(sDate)} → {fmt(eDate)}
              </span>
              <span style={{ display:"inline-flex", gap:8, fontSize:12, padding:"6px 10px", border:"1px solid #e5e7eb", borderRadius:999, background:"#fff" }}>
                <strong>Score:</strong> {scorePct}%
              </span>
              <span style={{ display:"inline-flex", gap:8, fontSize:12, padding:"6px 10px", border:"1px solid #e5e7eb", borderRadius:999, background:"#fff" }}>
                <strong>Trades:</strong> {current.stats?.numberOfTrades ?? 0}
              </span>
              <span style={{ display:"inline-flex", gap:8, fontSize:12, padding:"6px 10px", border:"1px solid #e5e7eb", borderRadius:999, background:"#fff" }}>
                <strong>PnL:</strong> {(current.stats?.pnl ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontSize:12, color:"#6b7280", marginBottom:8 }}>Find past weeks</div>
            <input type="text" placeholder="Filter by YYYY-MM-DD" value={filter} onChange={(e)=>setFilter(e.target.value)} style={{ ...inputStyle, width:"100%" }}/>
          </div>
        </section>

        {/* Current week editor */}
        <section style={sectionStyle}>
          <div style={{ display:"flex", gap:12, alignItems:"flex-end", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap" }}>
            <h2 style={{ fontSize:20, fontWeight:700, margin:0 }}>Edit Week: {fmt(sDate)} – {fmt(eDate)}</h2>
            <div style={{ fontSize:12, color:"#6b7280" }}>
              {current.updatedAt ? `Last updated: ${new Date(current.updatedAt).toLocaleString()}` : "Not saved yet"}
            </div>
          </div>

          {/* Context */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:14, fontWeight:600, marginBottom:8 }}>Context / Notes</label>
            <textarea placeholder="What happened this week? setups taken, market context, emotions, lessons..."
              style={{ ...inputStyle, width:"100%", height:120 }} value={current.context}
              onChange={(e)=>updateCurrent({ context:e.target.value })}/>
          </div>

          {/* Grid: checks + stats */}
          <div style={{ display:"grid", gap:16, gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))" }}>
            {/* Core checks */}
            <div>
              <h3 style={{ fontWeight:700, marginBottom:8 }}>Core Checklist</h3>
              <div style={{ display:"grid", gap:8 }}>
                <Toggle label="Did you put the stop-loss where it was supposed to be?"
                  hint="Per your plan / invalidation" checked={current.answers.stopLossPlaced}
                  onChange={(v)=>updateCurrent({ answers:{...current.answers, stopLossPlaced:v} })}/>
                <Toggle label="Did you revenge trade after one SL?"
                  hint="Instant re-entry without a valid setup is revenge trading."
                  checked={current.answers.revengeTradeAfterOneSL}
                  onChange={(v)=>updateCurrent({ answers:{...current.answers, revengeTradeAfterOneSL:v} })}/>
                <Toggle label="Did you follow the risk management?"
                  hint="Position size, 1R, max daily loss, no over-leverage."
                  checked={current.answers.followedRiskManagement}
                  onChange={(v)=>updateCurrent({ answers:{...current.answers, followedRiskManagement:v} })}/>
              </div>
            </div>

            {/* Stats & MT5 import */}
            <div>
              <h3 style={{ fontWeight:700, marginBottom:8 }}>Trades & PnL</h3>
              <div style={{ display:"grid", gap:12, gridTemplateColumns:"1fr 1fr", marginBottom:8 }}>
                <div>
                  <label style={{ display:"block", fontSize:12, marginBottom:6 }}>Number of trades</label>
                  <input type="number" min={0} value={current.stats?.numberOfTrades ?? 0}
                    onChange={(e)=>updateCurrent({ stats:{ ...current.stats, numberOfTrades: Math.max(0, parseInt(e.target.value||0,10)) } })}
                    style={{ ...inputStyle, width:"100%" }}/>
                </div>
                <div>
                  <label style={{ display:"block", fontSize:12, marginBottom:6 }}>PnL (account currency)</label>
                  <input type="number" step="0.01" value={current.stats?.pnl ?? 0}
                    onChange={(e)=>updateCurrent({ stats:{ ...current.stats, pnl: Number(e.target.value||0) } })}
                    style={{ ...inputStyle, width:"100%" }}/>
                </div>
              </div>

              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <label style={{ ...buttonStyle }}>
                  Import MT5 CSV for this week
                  <input type="file" accept=".csv,text/csv" style={{ display:"none" }} onChange={handleImportMT5}/>
                </label>
                <div style={{ fontSize:12, color:"#6b7280" }}>
                  We auto-sum PnL and count trades within {fmt(sDate)}–{fmt(eDate)}.
                </div>
              </div>

              {current.trades?.length>0 && (
                <div style={{ border:"1px solid #e5e7eb", borderRadius:12, padding:12, marginTop:12, fontSize:13 }}>
                  <div style={{ fontWeight:600, marginBottom:8 }}>
                    Imported trades ({current.trades.length})
                  </div>
                  <div style={{ maxHeight:180, overflow:"auto" }}>
                    <table style={{ width:"100%", fontSize:12, borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ textAlign:"left", borderBottom:"1px solid #e5e7eb" }}>
                          <th style={{ padding:"6px 8px" }}>Time</th>
                          <th style={{ padding:"6px 8px" }}>Symbol</th>
                          <th style={{ padding:"6px 8px" }}>Type</th>
                          <th style={{ padding:"6px 8px" }}>Lots</th>
                          <th style={{ padding:"6px 8px" }}>Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.trades.map((t,i)=>(
                          <tr key={i} style={{ borderBottom:"1px solid #f3f4f6" }}>
                            <td style={{ padding:"6px 8px" }}>{new Date(t.time).toLocaleString()}</td>
                            <td style={{ padding:"6px 8px" }}>{t.symbol}</td>
                            <td style={{ padding:"6px 8px" }}>{t.type}</td>
                            <td style={{ padding:"6px 8px" }}>{t.lots}</td>
                            <td style={{ padding:"6px 8px" }}>{(t.profit||0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div style={{ marginTop:16 }}>
            <h3 style={{ fontWeight:700, marginBottom:8 }}>Tags</h3>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
              <input type="text" placeholder="Type a tag and press Enter (e.g., XAUUSD, London, OB)"
                style={{ ...inputStyle, width:320 }}
                onKeyDown={(e)=>{ if (e.key==="Enter" || e.key === ","){ e.preventDefault(); addTag(e.currentTarget.value); e.currentTarget.value=""; } }}/>
              {!!(current.tags?.length) && <div style={{ fontSize:12, color:"#6b7280" }}>Click a tag to remove</div>}
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {(current.tags||[]).map((t)=>(
                <button key={t} onClick={()=>removeTag(t)}
                  style={{ padding:"6px 10px", borderRadius:999, border:"1px solid #e5e7eb", background:"#fff", fontSize:12, cursor:"pointer" }}>
                  #{t}
                </button>
              ))}
            </div>
          </div>

          {/* Screenshots */}
          <div style={{ marginTop:16 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <h3 style={{ fontWeight:700, margin:0 }}>Screenshots</h3>
              <label style={{ ...buttonStyle }}>
                Add images
                <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={(e)=>handleAddScreenshots(e.target.files)}/>
              </label>
            </div>
            <div style={{ fontSize:12, color:"#6b7280", marginBottom:8 }}>
              Tip: keep each image under ~2 MB to avoid hitting browser storage limits.
            </div>
            {(!current.screenshots || current.screenshots.length===0) && (
              <div style={{ fontSize:13, color:"#6b7280" }}>No screenshots yet.</div>
            )}
            <div style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))" }}>
              {(current.screenshots||[]).map((s)=>(
                <div key={s.id} style={{ border:"1px solid #e5e7eb", borderRadius:12, padding:8, display:"flex", flexDirection:"column", gap:8 }}>
                  <img src={s.dataUrl} alt={s.name} style={{ width:"100%", height:140, objectFit:"cover", borderRadius:10 }}/>
                  <div style={{ fontSize:12, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }} title={s.name}>{s.name}</div>
                  <button onClick={()=>removeScreenshot(s.id)} style={{ ...buttonStyle, padding:"6px 8px", alignSelf:"start" }}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop:16, fontSize:13, color:"#6b7280" }}>
            Changes save automatically (cloud + local cache).
          </div>
        </section>

        {/* Past weeks */}
        <section style={sectionStyle}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <h2 style={{ fontSize:20, fontWeight:700, margin:0 }}>Past Weeks</h2>
            <div style={{ fontSize:12, color:"#6b7280" }}>Click a row to open that week</div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", fontSize:13, borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ textAlign:"left", borderBottom:"1px solid #e5e7eb" }}>
                  <th style={{ padding:"10px 12px" }}>Start</th>
                  <th style={{ padding:"10px 12px" }}>End</th>
                  <th style={{ padding:"10px 12px" }}>Score</th>
                  <th style={{ padding:"10px 12px" }}>Trades</th>
                  <th style={{ padding:"10px 12px" }}>PnL</th>
                  <th style={{ padding:"10px 12px" }}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(entries).length===0 && (
                  <tr>
                    <td colSpan={6} style={{ padding:18, textAlign:"center", color:"#6b7280" }}>
                      No entries yet. Start with “Use This Week”.
                    </td>
                  </tr>
                )}
                {allWeeks.map((w)=>(
                  <tr key={w.key} onClick={()=>setSelectedDate(w.start)} style={{ borderBottom:"1px solid #f3f4f6", cursor:"pointer" }}>
                    <td style={{ padding:"10px 12px", fontWeight:600 }}>{w.start}</td>
                    <td style={{ padding:"10px 12px" }}>{w.end}</td>
                    <td style={{ padding:"10px 12px" }}>{w.score}%</td>
                    <td style={{ padding:"10px 12px" }}>{w.trades}</td>
                    <td style={{ padding:"10px 12px" }}>{(w.pnl ?? 0).toFixed(2)}</td>
                    <td style={{ padding:"10px 12px" }}>{w.updatedAt ? new Date(w.updatedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer style={{ textAlign:"center", fontSize:12, color:"#6b7280", marginTop:16 }}>
          Built for your trading routine • ISO week (Mon–Sun) • Cloud synced via Supabase
        </footer>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          textarea { border: none !important; }
          header, footer { box-shadow: none !important; }
          body { background: #ffffff !important; }
        }
      `}</style>
    </div>
  );
}

/* ----- Small presentational toggle component ----- */
function Toggle({ label, checked, onChange, hint }) {
  return (
    <label style={{
      display:"flex", gap:12, justifyContent:"space-between", alignItems:"flex-start",
      padding:12, borderRadius:12, border:"1px solid #e5e7eb", boxShadow:"0 1px 2px rgba(0,0,0,0.04)", cursor:"pointer"
    }}>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:600 }}>{label}</div>
        {hint && <div style={{ fontSize:12, color:"#6b7280", marginTop:6 }}>{hint}</div>}
      </div>
      <input type="checkbox" style={{ width:18, height:18, marginTop:4 }} checked={!!checked} onChange={(e)=>onChange(e.target.checked)}/>
    </label>
  );
}


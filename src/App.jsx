import { useState, useRef, useCallback } from "react";
import { Briefcase, RefreshCw, UploadCloud, TrendingUp, TrendingDown, AlertCircle, Clock, Plus, Trash2 } from "lucide-react";

const POLYGON_API_KEY = import.meta.env.VITE_POLYGON_API_KEY;
const GEMINI_API_KEY  = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_ENDPOINT  = "/api/gemini/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
const POLYGON_ENDPOINT = (ticker) => "/api/polygon/v2/snapshot/locale/us/markets/stocks/tickers/" + encodeURIComponent(ticker) + "?apiKey=" + POLYGON_API_KEY;

const RATE_DELAY_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = { IDLE:"idle", UPLOADING:"uploading", SYNCING:"syncing", LIVE:"live", ERROR:"error" };

function StatusBadge({ status }) {
  const map = {
    idle:      { label:"Idle",             cls:"bg-slate-800 text-slate-400" },
    uploading: { label:"Analyzing image...", cls:"bg-violet-900/60 text-violet-300 animate-pulse" },
    syncing:   { label:"Syncing prices...",  cls:"bg-amber-900/60 text-amber-300 animate-pulse" },
    live:      { label:"Live",             cls:"bg-emerald-900/60 text-emerald-300" },
    error:     { label:"Error",            cls:"bg-rose-900/60 text-rose-300" },
  };
  const { label, cls } = map[status] ?? map.idle;
  return (
    <span className={"inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium " + cls}>
      <span className={"w-1.5 h-1.5 rounded-full " + (status==="live" ? "bg-emerald-400 animate-pulse" : "bg-current opacity-60")} />
      {label}
    </span>
  );
}

const f2 = (n) => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fP = (n) => n==null ? "—" : "$" + f2(n);
const fDollar = (n) => {
  if (n==null||isNaN(n)) return "—";
  return (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
};

async function extractStocksFromImage(base64, mediaType) {
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mediaType, data: base64 } },
        { text: "You are a financial data extraction engine. This is a brokerage portfolio screenshot. Extract every stock/ETF position: ticker symbol, number of shares, and previous close price. Return ONLY raw JSON, no markdown, no explanation. Format: {\"stocks\":[{\"ticker\":\"AAPL\",\"shares\":10,\"closePrice\":182.50}]}. If none found: {\"stocks\":[]}" }
      ]}],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error("Gemini " + res.status + ": " + err.slice(0,300)); }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini empty response");
  return text.trim();
}

async function fetchSnapshot(ticker, log) {
  try {
    const res  = await fetch(POLYGON_ENDPOINT(ticker.toUpperCase()));
    const json = await res.json();
    // Surface API-level errors (auth, rate limit, plan restrictions) instead of silently dropping them.
    if (json?.status === "ERROR" || json?.error) {
      log?.(ticker + " Polygon error: " + (json.error || json.message || json.status));
    }
    const snap = json?.ticker;
    if (!snap) { log?.(ticker + " no snapshot. raw=" + JSON.stringify(json).slice(0, 300)); return {}; }
    log?.(ticker + " raw: lastTrade=" + JSON.stringify(snap.lastTrade) + " min.c=" + (snap.min?.c) + " day.c=" + (snap.day?.c) + " prevDay.c=" + (snap.prevDay?.c) + " updated=" + snap.updated);
    return {
      closePrice:      snap.prevDay?.c       ?? null,
      currentPrice:    snap.lastTrade?.p     ?? snap.min?.c ?? snap.day?.c ?? null,
      todaysChange:    snap.todaysChange     ?? null,
      todaysChangePct: snap.todaysChangePerc ?? null,
    };
  } catch (e) { log?.(ticker + " fetch failed: " + e.message); return {}; }
}

export default function App() {
  const [stocks,       setStocks]       = useState([]);
  const [status,       setStatus]       = useState(S.IDLE);
  const [errorMsg,     setErrorMsg]     = useState("");
  const [debugLog,     setDebugLog]     = useState([]);
  const [showDebug,    setShowDebug]    = useState(false);
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [manualTicker, setManualTicker] = useState("");
  const [manualShares, setManualShares] = useState("");
  const [manualClose,  setManualClose]  = useState("");
  const fileRef = useRef(null);

  const log = (msg) => { const ts = new Date().toLocaleTimeString(); setDebugLog((d) => [...d, "[" + ts + "] " + msg]); };

  function addManual() {
    const t = manualTicker.trim().toUpperCase();
    if (!t) return;
    setStocks((prev) => [...prev, { ticker:t, shares:parseFloat(manualShares)||0, closePrice:parseFloat(manualClose)||null, currentPrice:null, todaysChange:null, todaysChangePct:null, gain:null }]);
    setManualTicker(""); setManualShares(""); setManualClose("");
  }

  function removeStock(i) { setStocks((p) => p.filter((_,idx) => idx!==i)); }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStatus(S.UPLOADING); setErrorMsg(""); setDebugLog([]); setShowDebug(true);
    try {
      const base64 = await new Promise((res,rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result.split(",")[1]);
        reader.onerror = () => rej(new Error("FileReader failed"));
        reader.readAsDataURL(file);
      });
      const mediaType = file.type?.startsWith("image/") ? file.type : "image/jpeg";
      log("Read: " + file.name + " · " + mediaType + " · ~" + Math.round(base64.length*0.75/1024) + "KB");
      log("Sending to Gemini 2.0 Flash...");
      const rawText = await extractStocksFromImage(base64, mediaType);
      log("Gemini: " + rawText.slice(0,200));
      const clean = rawText.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
      let parsed;
      try { parsed = JSON.parse(clean); } catch { throw new Error("Not valid JSON: " + rawText.slice(0,300)); }
      const extracted = (parsed.stocks ?? []).map((s) => ({ ticker:String(s.ticker||"").toUpperCase().replace(/[^A-Z0-9.]/g,""), shares:parseFloat(s.shares)||0, closePrice:parseFloat(s.closePrice)||null, currentPrice:null, todaysChange:null, todaysChangePct:null, gain:null })).filter((s) => s.ticker.length > 0);
      log("Extracted " + extracted.length + ": " + extracted.map(s=>s.ticker).join(", "));
      if (!extracted.length) { setStatus(S.ERROR); setErrorMsg("No positions found. Try a clearer screenshot or add manually."); return; }
      setStocks(extracted);
      await runRefresh(extracted);
    } catch(err) { log("ERROR: " + err.message); setStatus(S.ERROR); setErrorMsg(err.message); }
  }

  const runRefresh = useCallback(async (list) => {
    const src = list ?? stocks;
    if (!src.length) return;
    setStatus(S.SYNCING);
    const updated = [];
    for (let i=0; i<src.length; i++) {
      if (i>0) await sleep(RATE_DELAY_MS);
      const s = src[i];
      const snap = await fetchSnapshot(s.ticker, log);
      const eff = snap.closePrice ?? s.closePrice ?? null;
      const gain = snap.currentPrice!=null && eff!=null ? (snap.currentPrice-eff)*s.shares : null;
      updated.push({ ...s, ...snap, closePrice:eff, gain });
      log(s.ticker + ": close=" + eff + " live=" + snap.currentPrice + " gain=" + gain?.toFixed(2));
    }
    setStocks(updated); setLastUpdated(new Date()); setStatus(S.LIVE);
  }, [stocks]);

  const hasData   = stocks.some((s) => s.gain!=null);
  const totalGain = stocks.reduce((a,s) => a+(s.gain??0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{fontFamily:"'DM Mono','Fira Code',monospace"}}>
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-5 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg border border-violet-700/50 bg-violet-950/60"><Briefcase size={18} className="text-violet-400" /></div>
            <div><p className="text-sm font-semibold text-white">Premarket Gain Calculator</p><p className="text-[10px] text-slate-500">Polygon.io · Gemini 2.0 Flash Vision</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {lastUpdated && <span className="text-[10px] text-slate-600 hidden sm:inline">Updated {lastUpdated.toLocaleTimeString()}</span>}
            <button onClick={()=>runRefresh()} disabled={!stocks.length||status===S.SYNCING} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <RefreshCw size={12} className={status===S.SYNCING?"animate-spin":""} /> Refresh
            </button>
            <button onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 transition-colors">
              <UploadCloud size={12} /> Upload Screenshot
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>
        </div>
      </header>

      {debugLog.length > 0 && (
        <div className="max-w-7xl mx-auto px-5 pt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Debug Log</span>
            <button onClick={()=>setShowDebug(v=>!v)} className="text-[10px] text-slate-600 underline">{showDebug?"Hide":"Show"}</button>
          </div>
          {showDebug && <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap">{debugLog.join("\n")}</pre>}
        </div>
      )}

      {status===S.ERROR && errorMsg && (
        <div className="max-w-7xl mx-auto px-5 pt-3">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
            <AlertCircle size={13} className="mt-0.5 shrink-0" /><p className="whitespace-pre-wrap break-words">{errorMsg}</p>
          </div>
        </div>
      )}

      {stocks.length > 0 && (
        <div className="max-w-7xl mx-auto px-5 pt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:"Positions",    value: stocks.length },
            { label:"Total Shares", value: stocks.reduce((a,s)=>a+(s.shares||0),0).toLocaleString() },
            { label:"Loaded",       value: stocks.filter(s=>s.currentPrice!=null).length + " / " + stocks.length },
            { label:"Portfolio P&L", value: hasData?fDollar(totalGain):"Pending...", accent: hasData?(totalGain>=0?"text-emerald-400":"text-rose-400"):"text-slate-500", icon: hasData?(totalGain>=0?<TrendingUp size={16} className="text-emerald-400"/>:<TrendingDown size={16} className="text-rose-400"/>):<Clock size={16} className="text-slate-600"/> },
          ].map(({label,value,accent,icon})=>(
            <div key={label} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{label}</p>
              <div className="flex items-center gap-2">{icon}<p className={"text-xl font-semibold " + (accent||"text-white")}>{value}</p></div>
            </div>
          ))}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-5 py-5 space-y-4">
        <div className="flex flex-wrap gap-2 items-end p-4 rounded-xl bg-slate-900 border border-slate-800">
          <p className="w-full text-[10px] text-slate-500 uppercase tracking-widest -mb-1">Add position manually</p>
          {[
            {label:"Ticker",  val:manualTicker, set:(v)=>setManualTicker(v.toUpperCase()), ph:"AAPL",   w:"w-24", type:"text",   max:8},
            {label:"Shares",  val:manualShares, set:setManualShares,                       ph:"100",    w:"w-24", type:"number"},
            {label:"Close $", val:manualClose,  set:setManualClose,                        ph:"182.50", w:"w-28", type:"number"},
          ].map(({label,val,set,ph,w,type,max})=>(
            <div key={label} className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500">{label}</label>
              <input value={val} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addManual()} placeholder={ph} type={type} maxLength={max} className={w + " px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"} />
            </div>
          ))}
          <button onClick={addManual} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors self-end"><Plus size={12}/> Add</button>
          {stocks.length>0 && <button onClick={()=>runRefresh()} disabled={status===S.SYNCING} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-900/60 hover:bg-emerald-800/60 border border-emerald-700/50 text-emerald-300 transition-colors self-end ml-auto disabled:opacity-40"><RefreshCw size={12}/> Fetch Prices</button>}
        </div>

        {stocks.length===0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800"><UploadCloud size={36} className="text-slate-700"/></div>
            <div><p className="text-slate-300 text-sm font-medium">No positions loaded</p><p className="text-slate-600 text-xs mt-1 max-w-xs">Upload a Lightyear screenshot or add tickers manually above.</p></div>
            <button onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 transition-colors"><UploadCloud size={15}/> Upload Screenshot</button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-800 bg-slate-900/80">{["Ticker","Shares","Prev Close","Live / Premarket","Change","% Chg","Gain / Loss",""].map((h,i)=><th key={i} className="px-4 py-3 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {stocks.map((s,i)=>{
                  const gainCls = s.gain==null?"text-slate-600":s.gain>=0?"text-emerald-400":"text-rose-400";
                  const chgCls  = s.todaysChange==null?"text-slate-600":s.todaysChange>=0?"text-emerald-400":"text-rose-400";
                  const pend    = status===S.SYNCING?<span className="text-slate-600 animate-pulse">syncing...</span>:<span className="text-slate-700">—</span>;
                  return (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-900/30 transition-colors">
                      <td className="px-4 py-3.5 font-bold text-white text-sm tracking-widest">{s.ticker}</td>
                      <td className="px-4 py-3.5 text-slate-300">{s.shares?.toLocaleString()||"—"}</td>
                      <td className="px-4 py-3.5 text-slate-400">{fP(s.closePrice)}</td>
                      <td className="px-4 py-3.5 text-slate-100 font-semibold">{s.currentPrice!=null?fP(s.currentPrice):pend}</td>
                      <td className={"px-4 py-3.5 font-medium " + chgCls}>{s.todaysChange!=null?(s.todaysChange>=0?"+":"")+f2(s.todaysChange):pend}</td>
                      <td className={"px-4 py-3.5 font-medium " + chgCls}>{s.todaysChangePct!=null?(s.todaysChangePct>=0?"+":"")+f2(s.todaysChangePct)+"%":pend}</td>
                      <td className={"px-4 py-3.5 font-bold " + gainCls}>{s.gain!=null?fDollar(s.gain):pend}</td>
                      <td className="px-4 py-3.5"><button onClick={()=>removeStock(i)} className="text-slate-700 hover:text-rose-400 transition-colors"><Trash2 size={12}/></button></td>
                    </tr>
                  );
                })}
              </tbody>
              {hasData && <tfoot><tr className="border-t border-slate-700 bg-slate-900/60"><td colSpan={6} className="px-4 py-3 text-[10px] font-medium text-slate-500 uppercase tracking-widest">Portfolio Total</td><td colSpan={2} className={"px-4 py-3 font-bold text-sm " + (totalGain>=0?"text-emerald-400":"text-rose-400")}>{fDollar(totalGain)}</td></tr></tfoot>}
            </table>
          </div>
        )}
      </main>
      <footer className="border-t border-slate-800/60 py-3 px-5 text-center text-[10px] text-slate-700">Polygon.io (Massive) · Gemini 2.0 Flash Vision · Lightyear compatible</footer>
    </div>
  );
}
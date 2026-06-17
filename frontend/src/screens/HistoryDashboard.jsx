// Historical Dashboard — placeholder data. FormIQ has no session-history
// backend yet, so these are mock sessions to show the layout. Wire to a real
// persistence layer later (see scope note in the chat).

const SESSIONS = [
  { name: "Standard Pushups", date: "Jun 16, 2026 · 09:12", duration: "12:40", reps: 38, stability: 91, tag: "Elite Accuracy", tagCls: "primary", icon: "verified" },
  { name: "Diamond Pushups", date: "Jun 14, 2026 · 18:05", duration: "08:22", reps: 24, stability: 72, tag: "Review Needed", tagCls: "error", icon: "report" },
  { name: "Wide Pushups", date: "Jun 12, 2026 · 07:48", duration: "15:10", reps: 45, stability: 88, tag: "High Volume", tagCls: "primary", icon: "bolt" },
];

function Stat({ label, value, unit, children }) {
  return (
    <div className="glass-pane p-pane-padding">
      <div className="font-label-sm text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60 mb-4">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-data-lg text-headline-lg text-primary">{value}</span>
        {unit && <span className="font-label-sm text-on-surface-variant/40">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

export default function HistoryDashboard({ onOpenSummary }) {
  return (
    <div className="p-margin-lg space-y-8 relative z-10">
      <div className="text-[10px] font-label-sm uppercase tracking-[0.3em] text-on-surface-variant/40">
        ⚠ Placeholder data — session history persistence not yet wired to the backend
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter bg-white/5">
        <Stat label="30-Day Form Accuracy" value="89.4" unit="%">
          <div className="mt-4 h-[2px] bg-white/5 w-full"><div className="h-full bg-primary" style={{ width: "89.4%" }} /></div>
        </Stat>
        <Stat label="Cumulative Reps" value="1,284">
          <div className="mt-4 text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/30">+12% vs previous period</div>
        </Stat>
        <Stat label="Form Streak" value="6" unit="DAYS">
          <div className="mt-4 flex gap-[2px]">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className={`w-2 h-4 ${i < 6 ? "bg-primary" : "bg-white/5"}`} />
            ))}
          </div>
        </Stat>
      </div>

      {/* Session grid */}
      <section>
        <div className="flex justify-between items-end mb-6">
          <div className="space-y-1">
            <h2 className="font-headline-md text-headline-md text-on-surface uppercase tracking-tighter">Recent Activity</h2>
            <p className="font-label-sm text-[10px] uppercase tracking-[0.3em] text-on-surface-variant/30">Historical Biomechanical Data</p>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-1 btn-technical text-on-surface-variant/60 font-label-sm uppercase tracking-widest text-[10px]">Filter</button>
            <button className="px-4 py-1 btn-technical text-on-surface-variant/60 font-label-sm uppercase tracking-widest text-[10px]">Sort</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter bg-white/5">
          {SESSIONS.map((s) => (
            <button
              key={s.name}
              onClick={onOpenSummary}
              className="glass-pane flex flex-col h-full group cursor-pointer text-left"
            >
              <div className="h-40 bg-black relative overflow-hidden flex items-center justify-center">
                <span className="material-symbols-outlined text-6xl text-primary/10 group-hover:text-primary/20 transition-all">accessibility_new</span>
                <div className="absolute inset-0 bg-gradient-to-t from-[#131313] to-transparent" />
                <div className={`absolute top-4 right-4 px-2 py-0.5 border ${s.tagCls === "error" ? "bg-error/10 border-error/30" : "bg-primary/10 border-primary/30"}`}>
                  <span className={`font-label-sm text-[9px] uppercase tracking-[0.2em] ${s.tagCls === "error" ? "text-error" : "text-primary"}`}>{s.tag}</span>
                </div>
              </div>
              <div className="p-pane-padding flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-data-md text-on-surface uppercase tracking-tight">{s.name}</h3>
                    <p className="font-label-sm text-[9px] text-on-surface-variant/40 uppercase tracking-widest mt-0.5">{s.date}</p>
                  </div>
                  <span className={`material-symbols-outlined text-lg ${s.tagCls === "error" ? "text-error" : "text-primary"}`}>{s.icon}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
                  <Cell label="Duration" value={s.duration} />
                  <Cell label="Total Reps" value={s.reps} />
                  <Cell label="Stability" value={`${s.stability}%`} accent={s.tagCls === "error" ? "text-error" : "text-primary"} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-white/10 py-8">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(161,161,170,0.6)]" />
          <p className="font-data-md text-[10px] text-on-surface uppercase">ALL_SYSTEMS_GO</p>
        </div>
        <button className="btn-technical px-6 py-2.5 font-label-sm text-[10px] uppercase tracking-[0.3em] text-primary">
          Download Full Report (.CSV)
        </button>
      </footer>
    </div>
  );
}

function Cell({ label, value, accent = "text-on-surface" }) {
  return (
    <div>
      <p className="font-label-sm text-[9px] text-on-surface-variant/30 uppercase tracking-tighter">{label}</p>
      <p className={`font-data-md text-sm ${accent}`}>{value}</p>
    </div>
  );
}

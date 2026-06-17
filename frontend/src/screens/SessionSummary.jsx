import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Derive AI diagnostics from real rep metrics, with severity tiers.
function diagnose(reps) {
  if (!reps.length) return [];
  const depth = avg(reps.map((r) => r.bottom_elbow_angle));
  const sym = avg(reps.map((r) => r.elbow_symmetry));
  const plane = avg(reps.map((r) => r.body_planarity_deviation));
  const tier = (v, ok, minor) => (v <= ok ? ["OPTIMAL", "text-primary"] : v <= minor ? ["MINOR", "text-primary/60"] : ["CRITICAL", "text-error"]);
  const [dT, dC] = tier(depth, 90, 100);
  const [sT, sC] = tier(sym, 8, 15);
  const [pT, pC] = tier(plane, 0.04, 0.07);
  return [
    { name: "Rep Depth", status: dT, cls: dC, note: `Mean bottom elbow angle ${depth.toFixed(1)}°. Target <90° for full range of motion.` },
    { name: "Elbow Symmetry", status: sT, cls: sC, note: `Avg L/R divergence ${sym.toFixed(1)}°. Uneven press loads one side more than the other.` },
    { name: "Body Planarity", status: pT, cls: pC, note: `Avg torso deviation ${plane.toFixed(3)}. Hips sagging or piking off the head→ankle line.` },
  ];
}

function fmtDuration(reps) {
  if (reps.length < 2) return "—";
  const s = Math.max(0, reps[reps.length - 1].timestamp - reps[0].timestamp);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function GlassTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0e0e0e]/90 border border-primary/40 px-3 py-1.5 font-mono text-xs">
      <div className="text-on-surface/50">REP {payload[0].payload.rep}</div>
      <div className="text-primary text-base">{payload[0].value}</div>
    </div>
  );
}

export default function SessionSummary({ summary, reps }) {
  if (!summary) {
    return (
      <div className="p-margin-lg flex items-center justify-center h-[60vh]">
        <div className="glass-pane p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-primary/40">monitoring</span>
          <p className="font-label-sm uppercase tracking-widest text-on-surface/50 mt-3">
            No session data — finish a session to generate a summary
          </p>
        </div>
      </div>
    );
  }

  const diagnostics = diagnose(reps);
  const best = reps.reduce((a, b) => (b.form_score > (a?.form_score ?? -1) ? b : a), null);
  const data = reps.map((r) => ({ rep: r.rep_number, score: r.form_score }));
  const symBars = (() => {
    const s = avg(reps.map((r) => r.elbow_symmetry));
    const lean = Math.min(20, s) / 2; // visual L/R imbalance
    return [50 + lean, 50 - lean];
  })();

  return (
    <div className="p-margin-md md:p-margin-lg space-y-gutter relative z-10">
      {/* Key stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
        <div className="glass-pane p-pane-padding md:col-span-2 relative overflow-hidden">
          <div className="scanline" />
          <div className="font-label-sm uppercase text-on-surface-variant mb-2">Average Form Score</div>
          <div className="flex items-baseline gap-2">
            <span className="font-data-lg text-headline-lg text-primary">{summary.avg_score}</span>
            <span className="font-data-md text-on-surface-variant">/ 100</span>
          </div>
          <div className="mt-4 h-1 w-full bg-white/10">
            <div className="h-full bg-primary transition-all duration-700" style={{ width: `${summary.avg_score}%` }} />
          </div>
          <div className="mt-2 font-label-sm uppercase text-primary">Optimal Range: 85-95</div>
        </div>
        <div className="glass-pane p-pane-padding">
          <div className="font-label-sm uppercase text-on-surface-variant mb-2">Total Reps</div>
          <div className="font-data-lg text-headline-lg text-primary">{summary.rep_count}</div>
          <div className="font-label-sm text-on-surface-variant mt-2 uppercase">Best: Rep #{summary.best_rep}</div>
        </div>
        <div className="glass-pane p-pane-padding">
          <div className="font-label-sm uppercase text-on-surface-variant mb-2">Session Duration</div>
          <div className="font-data-lg text-headline-lg text-primary">{fmtDuration(reps)}</div>
          <div className="font-label-sm text-on-surface-variant mt-2 uppercase">{summary.focus_next_session || "—"}</div>
        </div>
      </div>

      {/* Curve + diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter md:h-96">
        <div className="glass-pane p-pane-padding md:col-span-8 flex flex-col relative">
          <div className="flex justify-between items-center mb-4">
            <div className="font-label-sm uppercase text-on-surface-variant tracking-widest">
              Improvement Curve / Rep Performance
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-primary" />
              <span className="font-label-sm text-on-surface-variant uppercase">Form Score</span>
            </div>
          </div>
          <div className="flex-1 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a1a1aa" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#a1a1aa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#3b494b" strokeWidth={0.5} vertical={false} />
                <XAxis dataKey="rep" stroke="#849495" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} tickLine={false} />
                <YAxis domain={[0, 100]} stroke="#849495" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} tickLine={false} />
                <Tooltip content={<GlassTooltip />} cursor={{ stroke: "#a1a1aa", strokeWidth: 0.5 }} />
                <ReferenceLine y={85} stroke="#a1a1aa" strokeDasharray="3 3" strokeOpacity={0.4} />
                <Area type="monotone" dataKey="score" stroke="#a1a1aa" strokeWidth={1.5} fill="url(#curveFill)"
                  dot={{ r: 2, fill: "#a1a1aa" }} activeDot={{ r: 4, fill: "#e5e2e1" }} isAnimationActive animationDuration={600} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-pane md:col-span-4 flex flex-col">
          <div className="p-pane-padding border-b border-white/10 flex justify-between items-center bg-white/5">
            <span className="font-label-sm uppercase tracking-widest">AI Diagnostics</span>
            <span className="font-label-sm text-[10px] text-primary px-2 py-0.5 border border-primary/40">AI</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {diagnostics.map((d) => (
              <div key={d.name} className="p-4 border-b border-white/10 hover:bg-white/5 transition-all cursor-default">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-on-surface uppercase font-label-sm">{d.name}</span>
                  <span className={`${d.cls} font-data-md text-sm`}>{d.status}</span>
                </div>
                <p className="text-[10px] text-on-surface-variant leading-relaxed">{d.note}</p>
              </div>
            ))}
          </div>
          {summary.most_common_error && (
            <div className="p-4 bg-white/5 flex items-center gap-2 text-primary font-label-sm uppercase">
              <span className="material-symbols-outlined text-sm">target</span>
              <span className="truncate">Focus: {summary.most_common_error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Biometrics + best rep */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
        <div className="md:col-span-4 space-y-gutter">
          <div className="glass-pane p-pane-padding">
            <div className="font-label-sm uppercase text-on-surface-variant mb-4 flex justify-between">
              <span>Elbow Symmetry</span>
              <span className="text-primary">{(100 - avg(reps.map((r) => r.elbow_symmetry))).toFixed(1)}%</span>
            </div>
            <div className="flex justify-center items-end gap-3 h-16">
              {["L", "R"].map((side, i) => (
                <div key={side} className="w-8 bg-white/10 relative h-full">
                  <div className={`absolute bottom-0 w-full ${i ? "bg-primary" : "bg-primary/40"}`} style={{ height: `${symBars[i]}%` }} />
                  <span className="absolute -top-5 left-0 w-full text-center text-[9px] uppercase">{side}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-pane p-pane-padding">
            <div className="font-label-sm uppercase text-on-surface-variant mb-4">Body Planarity Deviation</div>
            <div className="relative h-20 w-full border border-white/10 flex items-center justify-center">
              <div className="absolute w-full h-px bg-white/10" />
              <div className="absolute h-full w-px bg-white/10" />
              <div className="w-12 h-12 border border-primary/30 rounded-full animate-pulse" />
              <div className="absolute top-1/4 right-1/4 w-1 h-1 bg-primary rounded-full" />
              <span className="absolute bottom-1 right-1 text-[8px] font-data-md text-primary">
                Δ {avg(reps.map((r) => r.body_planarity_deviation)).toFixed(3)}
              </span>
            </div>
          </div>
        </div>

        {/* Best rep panel (no video — real metrics in the technical frame) */}
        <div className="glass-pane md:col-span-8 p-pane-padding relative min-h-[280px]">
          <div className="z-10 relative">
            <div className="font-label-sm uppercase tracking-widest text-on-surface-variant">
              Best Rep Analysis / Rep #{summary.best_rep}
            </div>
            <div className="mt-2 flex gap-2">
              <span className="px-2 py-0.5 bg-primary/10 border border-primary/40 text-[9px] text-primary font-data-md uppercase">PEAK_FORM</span>
              <span className="px-2 py-0.5 bg-white/10 border border-white/20 text-[9px] text-on-surface-variant font-data-md uppercase">
                SCORE {best?.form_score ?? "--"}
              </span>
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="absolute top-1/2 left-0 w-full h-px bg-primary" />
            <div className="absolute top-0 left-1/2 w-px h-full bg-primary" />
            <div className="w-24 h-24 border border-primary" />
          </div>
          <div className="absolute bottom-4 left-4 grid grid-cols-3 gap-6">
            <BestMetric label="Bottom Elbow" value={best ? `${best.bottom_elbow_angle}°` : "—"} />
            <BestMetric label="Elbow Sym" value={best ? `${best.elbow_symmetry}°` : "—"} />
            <BestMetric label="Latency" value={best ? `${Math.round(best.latency_ms)}ms` : "—"} />
          </div>
        </div>
      </div>

      {/* Coach takeaway + footer */}
      <div className="glass-pane p-pane-padding">
        <div className="font-label-sm uppercase tracking-widest text-on-surface-variant mb-2">Session Takeaway</div>
        <p className="font-body-md text-on-surface/80 leading-relaxed italic">{summary.summary}</p>
      </div>
      <footer className="glass-pane p-pane-padding flex justify-between items-center">
        <button className="flex items-center gap-2 px-6 py-2 btn-technical text-on-surface-variant font-label-sm uppercase">
          <span className="material-symbols-outlined text-sm">ios_share</span> Export Data
        </button>
        <div className="font-label-sm text-[10px] text-on-surface-variant/40 flex gap-4 uppercase">
          <span>FormIQ v1.0</span>
          <span>Powered by AI</span>
        </div>
      </footer>
    </div>
  );
}

function BestMetric({ label, value }) {
  return (
    <div>
      <div className="text-[9px] text-on-surface-variant uppercase mb-1">{label}</div>
      <div className="font-data-md text-primary">{value}</div>
    </div>
  );
}

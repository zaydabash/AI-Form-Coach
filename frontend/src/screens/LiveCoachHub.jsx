function fmt(v, unit = "", dp = 1) {
  if (v === null || v === undefined) return "-";
  return `${v.toFixed(dp)}${unit}`;
}
const pct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));

// A single telemetry metric with a thin technical bar.
function Metric({ label, value, fill }) {
  return (
    <div className="border border-white/5 p-4 bg-white/[0.02]">
      <div className="flex justify-between items-center mb-3">
        <span className="font-label-sm text-on-surface/60 uppercase">{label}</span>
        <span className="font-data-md text-primary">{value}</span>
      </div>
      <div className="h-0.5 bg-white/5 w-full">
        <div
          className="h-full bg-primary shadow-[0_0_8px_rgba(161,161,170,0.5)] transition-all duration-300"
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}

export default function LiveCoachHub({ running, state, reps, videoRef, canvasRef }) {
  const meanElbow =
    state.left_elbow != null && state.right_elbow != null
      ? (state.left_elbow + state.right_elbow) / 2
      : state.left_elbow ?? null;
  const latest = reps.length ? reps[reps.length - 1] : null;
  const phaseLabel = state.pose_found ? (state.phase || "-").toUpperCase() : "NO POSE";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* Central feed pane */}
        <section className="flex-1 relative bg-black/40 overflow-hidden flex items-center justify-center">
          {running && <div className="scanline" />}
          <div className="relative w-full h-full">
            {/* Browser webcam + skeleton overlay (mirrored selfie view). */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover grayscale brightness-[0.5] -scale-x-100 ${running ? "" : "opacity-0"}`}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover -scale-x-100 pointer-events-none" />
            {!running && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-on-surface/40">
                <span className="material-symbols-outlined text-5xl text-primary/50">videocam</span>
                <span className="font-label-sm uppercase tracking-widest">Feed offline - start a session</span>
              </div>
            )}

            {/* Technical HUD */}
            <div className="absolute top-6 left-6 font-label-sm text-primary space-y-1">
              <div className="opacity-80">STREAM: {running ? "1280 // 15FPS" : "-"}</div>
              <div className="opacity-80">LATENCY: {latest ? `${Math.round(latest.latency_ms)}ms` : "-"}</div>
              <div className="opacity-80">POSE: {state.pose_found ? "LOCKED" : "SEARCHING"}</div>
            </div>
            <div className="absolute top-6 right-6">
              <div
                className={`px-3 py-1 flex items-center gap-2 border ${
                  running ? "bg-red-900/20 text-red-500 border-red-500/30" : "bg-white/5 text-on-surface/40 border-white/10"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${running ? "bg-red-500 animate-pulse" : "bg-on-surface/30"}`} />
                <span className="font-label-sm tracking-widest uppercase">{running ? "Recording" : "Idle"}</span>
              </div>
            </div>

            {/* Phase + focus reticle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 border-[0.5px] border-primary/20 pointer-events-none">
              <div className="absolute top-0 left-0 w-6 h-6 border-t border-l border-primary" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t border-r border-primary" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b border-l border-primary" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b border-r border-primary" />
              {running && (
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 font-data-md text-sm text-primary uppercase tracking-widest">
                  {phaseLabel}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Telemetry stream */}
        <aside className="w-80 border-l border-white/5 flex flex-col bg-[#131313]/60 backdrop-blur-xl">
          <div className="p-4 border-b border-white/5">
            <div className="font-label-sm uppercase tracking-widest text-on-surface/40 mb-4">Telemetry Stream</div>
            <div className="space-y-3">
              <Metric label="Elbow Angle" value={fmt(meanElbow, "°")} fill={pct(meanElbow ?? 0, 180)} />
              <Metric
                label="Hip Plane Δ"
                value={fmt(state.body_planarity_deviation, "", 3)}
                fill={pct((state.body_planarity_deviation ?? 0) * 1000, 100)}
              />
              <Metric label="Elbow Symmetry" value={fmt(state.elbow_symmetry, "°")} fill={100 - pct(state.elbow_symmetry ?? 0, 40)} />

              {/* Rep counter block */}
              <div className="border border-white/5 p-4 bg-white/[0.02] flex items-center justify-between">
                <span className="font-label-sm text-on-surface/60 uppercase">Valid Reps</span>
                <span className="font-data-lg text-headline-lg text-primary leading-none">{state.rep_count ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Live log from completed reps */}
          <div className="flex-1 overflow-y-auto p-4 font-data-md text-[11px] leading-tight space-y-2 opacity-80">
            <LogLine ts="boot" msg="SKELETON_TRACKER ONLINE" />
            {reps.map((r) => (
              <LogLine
                key={r.rep_number}
                ts={`rep_${String(r.rep_number).padStart(2, "0")}`}
                msg={`SCORE ${r.form_score} // DEPTH ${r.bottom_elbow_angle}°`}
                highlight={r.form_score >= 85}
              />
            ))}
            {running && reps.length === 0 && <LogLine ts="live" msg="AWAITING FIRST REP..." />}
          </div>
        </aside>
      </div>

      {/* Coaching feedback bar */}
      <footer className="min-h-[8rem] bg-[#131313]/80 backdrop-blur-xl border-t border-white/5 p-margin-md flex items-center gap-margin-lg">
        <div className="flex flex-col items-center justify-center border border-primary/20 bg-primary/5 px-8 self-stretch min-w-[160px]">
          <div className="font-label-sm uppercase text-primary/60 tracking-tighter mb-1">Form Score</div>
          <div className="font-data-lg text-headline-lg text-primary">{latest ? latest.form_score : "--"}</div>
        </div>
        <div className="flex-1 flex flex-col justify-center self-stretch border-l border-white/5 pl-margin-lg py-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
            <span className="font-label-sm text-primary tracking-widest uppercase">AI Coach</span>
          </div>
          <div className="font-body-md text-on-surface/80 leading-relaxed max-w-4xl italic">
            {latest
              ? `${latest.corrections.join(" · ")} - ${latest.encouragement}`
              : running
                ? "Get into a pushup position. I'll score each rep and call out corrections in real time."
                : "Start a session to begin live coaching."}
          </div>
        </div>
      </footer>
    </div>
  );
}

function LogLine({ ts, msg, highlight }) {
  return (
    <div className="flex gap-3">
      <span className="text-on-surface/30">{ts}</span>
      <span className={highlight ? "text-primary font-bold" : "text-on-surface/70"}>{msg}</span>
    </div>
  );
}

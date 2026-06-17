import { useCallback, useEffect, useState } from "react";
import EtherealShadow from "./components/EtherealShadow.jsx";
import Shell from "./components/Shell.jsx";
import LiveCoachHub from "./screens/LiveCoachHub.jsx";
import HistoryDashboard from "./screens/HistoryDashboard.jsx";
import SessionSummary from "./screens/SessionSummary.jsx";
import { useFormSession } from "./hooks/useFormSession.js";
import { setAccessCode, getAccessCode } from "./api.js";

export default function App() {
  const [view, setView] = useState("live"); // which screen renders
  const [nav, setNav] = useState("skeleton"); // active nav item id
  const [needCode, setNeedCode] = useState(false);

  const session = useFormSession({ onNeedCode: () => setNeedCode(true) });
  const { running, busy, state, reps, summary, error, start, stop, videoRef, canvasRef } = session;

  const navigate = useCallback((targetView, navId) => {
    setView(targetView);
    setNav(navId);
  }, []);

  const onToggleSession = useCallback(async () => {
    if (running) {
      const s = await stop();
      if (s) navigate("summary", "load");
    } else {
      navigate("live", "skeleton");
      await start();
    }
  }, [running, start, stop, navigate]);

  // Dev/offline preview: ?demo=1 seeds mock data for all three screens.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!new URLSearchParams(window.location.search).get("demo")) return;
    const now = Date.now() / 1000;
    session.setState({
      rep_count: 7, phase: "down", pose_found: true,
      left_elbow: 84, right_elbow: 91, left_shoulder: 96, right_shoulder: 101,
      left_hip: 168, elbow_symmetry: 7, body_planarity_deviation: 0.042,
    });
    session.setReps([
      { rep_number: 1, form_score: 58, corrections: ["Go deeper - stop at 90°"], encouragement: "Good start!", bottom_elbow_angle: 104, elbow_symmetry: 14, body_planarity_deviation: 0.071, latency_ms: 2100, timestamp: now - 300 },
      { rep_number: 2, form_score: 66, corrections: ["Level your hips"], encouragement: "Better depth.", bottom_elbow_angle: 95, elbow_symmetry: 11, body_planarity_deviation: 0.058, latency_ms: 1980, timestamp: now - 250 },
      { rep_number: 3, form_score: 71, corrections: ["Tuck elbows ~45°"], encouragement: "Nice control.", bottom_elbow_angle: 90, elbow_symmetry: 9, body_planarity_deviation: 0.05, latency_ms: 2050, timestamp: now - 180 },
      { rep_number: 4, form_score: 79, corrections: ["Keep core tight"], encouragement: "Strong!", bottom_elbow_angle: 86, elbow_symmetry: 7, body_planarity_deviation: 0.041, latency_ms: 1890, timestamp: now - 90 },
      { rep_number: 5, form_score: 88, corrections: ["Hold the bottom briefly"], encouragement: "Excellent rep!", bottom_elbow_angle: 84, elbow_symmetry: 5, body_planarity_deviation: 0.033, latency_ms: 1960, timestamp: now },
    ]);
    session.setSummary({ avg_score: 72.4, rep_count: 5, best_rep: 5, summary: "Steady improvement across the set - depth and symmetry both tightened up rep over rep. Keep your hips locked in line from the first rep, not just once you've warmed in.", most_common_error: "Shallow depth early", focus_next_session: "Consistent depth" });
  }, []); // eslint-disable-line

  return (
    <>
      <EtherealShadow />
      <Shell view={view} nav={nav} onNavigate={navigate} running={running} busy={busy} onToggleSession={onToggleSession}>
        {error && (
          <div className="mx-margin-lg mt-margin-md px-4 py-3 border border-error/40 bg-error/10 text-[#fecdd3] font-label-sm uppercase tracking-wide flex items-center gap-2">
            <span className="material-symbols-outlined text-base">warning</span>
            {error}
          </div>
        )}
        {view === "live" && (
          <LiveCoachHub running={running} state={state} reps={reps} videoRef={videoRef} canvasRef={canvasRef} />
        )}
        {view === "history" && <HistoryDashboard onOpenSummary={() => navigate("summary", "load")} />}
        {view === "summary" && <SessionSummary summary={summary} reps={reps} />}
      </Shell>

      {needCode && <AccessGate onClose={() => setNeedCode(false)} />}
    </>
  );
}

function AccessGate({ onClose }) {
  const [code, setCode] = useState(getAccessCode());
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-pane p-8 max-w-sm w-full">
        <div className="font-label-sm uppercase tracking-widest text-on-surface-variant mb-2">Access Required</div>
        <p className="font-body-md text-on-surface/70 mb-4">
          This FormIQ instance is gated. Enter the access code to enable coaching.
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ACCESS CODE"
          className="w-full bg-black/40 border border-white/15 px-3 py-2 font-mono text-on-surface focus:border-primary outline-none mb-4"
          onKeyDown={(e) => { if (e.key === "Enter") { setAccessCode(code); onClose(); } }}
        />
        <button
          onClick={() => { setAccessCode(code); onClose(); }}
          className="w-full bg-primary text-on-primary py-3 font-label-sm uppercase tracking-widest technical-glow"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );
}

import { useCallback, useRef, useState } from "react";
import { createPoseEngine, drawSkeleton } from "../pose/poseEngine.js";
import { computeAngles } from "../pose/angles.js";
import { RepCounter } from "../pose/repCounter.js";
import { coachRep, fetchSummary, speak } from "../api.js";

const CAPTURE_EDGE = 512; // downscaled long edge for the coach image

// Drives a live FormIQ session entirely in the browser: webcam -> MediaPipe
// pose -> angles -> rep detection -> cloud coach call. Returns refs to attach
// to a <video> and overlay <canvas>, plus live session state.
export function useFormSession({ onNeedCode } = {}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const repCounterRef = useRef(null);
  const rafRef = useRef(0);
  const streamRef = useRef(null);
  const lastTsRef = useRef(0);
  const captureRef = useRef(null); // offscreen canvas

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({});
  const [reps, setReps] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [ttsOn, setTtsOn] = useState(false);

  const repsRef = useRef([]);

  const captureFrame = useCallback((landmarks) => {
    const video = videoRef.current;
    if (!video) return null;
    if (!captureRef.current) captureRef.current = document.createElement("canvas");
    const cv = captureRef.current;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const scale = CAPTURE_EDGE / Math.max(vw, vh);
    cv.width = Math.round(vw * scale);
    cv.height = Math.round(vh * scale);
    const ctx = cv.getContext("2d");
    // Mirror to match the on-screen selfie view.
    ctx.save();
    ctx.translate(cv.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, cv.width, cv.height);
    if (landmarks) drawSkeleton(ctx, landmarks, cv.width, cv.height);
    ctx.restore();
    return cv.toDataURL("image/jpeg", 0.7).split(",")[1];
  }, []);

  const handleRep = useCallback(
    async (event, angles, frameB64) => {
      try {
        const fb = await coachRep({
          image_b64: frameB64,
          angles: { ...angles, bottom_elbow_angle: event.bottom_elbow_angle },
          rep_number: event.rep_number,
          phase: event.phase,
        });
        const rep = {
          rep_number: event.rep_number,
          form_score: fb.form_score,
          corrections: fb.corrections,
          encouragement: fb.encouragement,
          elbow_symmetry: event.worst_elbow_symmetry,
          body_planarity_deviation: event.worst_planarity_deviation,
          bottom_elbow_angle: event.bottom_elbow_angle,
          latency_ms: fb.latency_ms,
          timestamp: Date.now() / 1000,
        };
        repsRef.current = [...repsRef.current, rep].sort((a, b) => a.rep_number - b.rep_number);
        setReps(repsRef.current);
        if (ttsOn) {
          speak(`${fb.corrections[0] || ""} ${fb.encouragement}`)
            .then((blob) => new Audio(URL.createObjectURL(blob)).play())
            .catch(() => {});
        }
      } catch (e) {
        if (e.code === 401) onNeedCode?.();
        else setError(e.message);
      }
    },
    [ttsOn, onNeedCode]
  );

  const loop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !engineRef.current) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    if (video.readyState >= 2) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const landmarks = engineRef.current.detect(video, ts);
      const ctx = canvas.getContext("2d");
      drawSkeleton(ctx, landmarks, w, h);

      if (landmarks) {
        const angles = computeAngles(landmarks, w, h);
        const counter = repCounterRef.current;
        const event = counter.update(angles.mean_elbow, {
          planarity: angles.body_planarity_deviation,
          symmetry: angles.elbow_symmetry,
        });
        setState({ ...angles, rep_count: counter.count, phase: counter.phase, pose_found: true });
        if (event) {
          const frameB64 = captureFrame(landmarks);
          if (frameB64) handleRep(event, angles, frameB64);
        }
      } else {
        setState((s) => ({ ...s, pose_found: false }));
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [captureFrame, handleRep]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    setReps([]);
    repsRef.current = [];
    repCounterRef.current = new RepCounter();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280 }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (!engineRef.current) engineRef.current = await createPoseEngine();
      setRunning(true);
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setError(
        e.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : `Could not start camera: ${e.message}`
      );
    } finally {
      setBusy(false);
    }
  }, [loop]);

  const stop = useCallback(async () => {
    setBusy(true);
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    try {
      if (repsRef.current.length) {
        const history = repsRef.current.map((r) => ({
          rep_number: r.rep_number, form_score: r.form_score, corrections: r.corrections,
          elbow_symmetry: r.elbow_symmetry, body_planarity_deviation: r.body_planarity_deviation,
          bottom_elbow_angle: r.bottom_elbow_angle,
        }));
        const s = await fetchSummary(history);
        setSummary(s);
        return s;
      }
    } catch (e) {
      if (e.code === 401) onNeedCode?.();
      else setError(e.message);
    } finally {
      setBusy(false);
    }
    return null;
  }, [onNeedCode]);

  return {
    videoRef, canvasRef, running, busy, state, reps, summary, error,
    ttsOn, setTtsOn, start, stop, setReps, setSummary, setState, setError,
  };
}

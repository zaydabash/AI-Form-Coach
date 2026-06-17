// Client for the FormIQ cloud API. The browser does all vision work; this only
// talks to the stateless coaching service. Access code (if the server is gated)
// is stored in localStorage and sent as the x-formiq-code header.
// In production the backend serves this app, so the API is same-origin ("").
// In dev the API runs separately on :8009 (override with VITE_API_BASE).
export const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8009" : "");

export const getAccessCode = () => localStorage.getItem("formiq_code") || import.meta.env.VITE_ACCESS_CODE || "";
export const setAccessCode = (c) => localStorage.setItem("formiq_code", c || "");

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-formiq-code": getAccessCode() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const e = new Error("Access code required or invalid.");
    e.code = 401;
    throw e;
  }
  if (res.status === 429) {
    const e = new Error("Rate limit — slow down a moment.");
    e.code = 429;
    throw e;
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res;
}

export const coachRep = (body) => post("/coach", body).then((r) => r.json());
export const fetchSummary = (rep_history) => post("/summary", { rep_history }).then((r) => r.json());
export const speak = (text) => post("/speak", { text }).then((r) => r.blob());

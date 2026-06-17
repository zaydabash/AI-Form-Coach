// App shell: sticky top nav + fixed left sidebar, shared by every screen.
// Ported from the Stitch "Restored Technical" layout.

const TOP_LINKS = [
  ["live", "Live Coach"],
  ["history", "Session History"],
  ["summary", "Session Summary"],
];

const SIDE_LINKS = [
  ["dashboard", "Dashboard"],
  ["accessibility_new", "Skeleton Tracking"],
  ["architecture", "Joint Angles"],
  ["fitness_center", "Load Analysis"],
];

function Icon({ name, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export default function Shell({ view, setView, running, busy, onToggleSession, children }) {
  return (
    <div className="min-h-screen bg-transparent text-on-surface">
      {/* Top nav */}
      <nav className="flex justify-between items-center w-full px-margin-lg h-16 sticky top-0 z-50 bg-[#131313]/60 backdrop-blur-xl border-b border-white/5">
        <div className="font-headline-md text-headline-md font-bold text-primary tracking-tighter uppercase">
          FormIQ
        </div>
        <div className="hidden md:flex items-center gap-8 h-full">
          {TOP_LINKS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`font-body-md text-body-md transition-all duration-300 px-2 ${
                view === id
                  ? "text-primary border-b border-primary pb-1"
                  : "text-on-surface/60 hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <Icon name="analytics" className="text-on-surface/60 hover:text-primary cursor-pointer p-1 transition-all" />
          <Icon name="account_circle" className="text-on-surface/60 hover:text-primary cursor-pointer p-1 transition-all" />
        </div>
      </nav>

      <div className="flex min-h-[calc(100vh-64px)]">
        {/* Sidebar */}
        <aside className="hidden md:flex flex-col w-64 border-r border-white/5 bg-[#131313]/40 backdrop-blur-xl">
          <div className="p-6">
            <div className="font-headline-sm text-headline-sm font-black text-primary">FormIQ Pro</div>
            <div className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface/40 mt-1">
              {running ? "Telemetry Active" : "Standby"}
            </div>
          </div>

          <nav className="flex-1">
            {SIDE_LINKS.map(([icon, label], i) => (
              <a
                key={label}
                href="#"
                onClick={(e) => e.preventDefault()}
                className={`flex items-center gap-3 px-6 py-3.5 transition-all duration-300 font-label-sm uppercase tracking-widest ${
                  i === 1 && view === "live"
                    ? "bg-white/5 text-primary border-r-2 border-primary"
                    : "text-on-surface/60 hover:bg-white/5"
                }`}
              >
                <Icon name={icon} className="text-lg" />
                {label}
              </a>
            ))}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setView("history");
              }}
              className={`flex items-center gap-3 px-6 py-3.5 transition-all duration-300 font-label-sm uppercase tracking-widest ${
                view === "history"
                  ? "bg-white/5 text-primary border-r-2 border-primary"
                  : "text-on-surface/60 hover:bg-white/5"
              }`}
            >
              <Icon name="history" className="text-lg" />
              History
            </a>
          </nav>

          <div className="p-4 border-t border-white/5">
            <button
              onClick={onToggleSession}
              disabled={busy}
              className={`w-full py-3.5 font-label-sm uppercase tracking-widest transition-all duration-300 disabled:opacity-50 ${
                running
                  ? "btn-technical text-error"
                  : "bg-primary text-on-primary technical-glow"
              }`}
            >
              {busy ? "···" : running ? "End Session" : "Start Session"}
            </button>
          </div>

          <footer className="p-4 flex flex-col gap-1">
            <span className="text-on-surface/40 flex items-center gap-3 px-2 py-2 hover:text-on-surface transition-all cursor-pointer font-label-sm">
              <Icon name="help_outline" className="text-sm" /> Support
            </span>
            <span className="text-on-surface/40 flex items-center gap-3 px-2 py-2 hover:text-on-surface transition-all cursor-pointer font-label-sm">
              <Icon name="terminal" className="text-sm" /> Logs
            </span>
          </footer>
        </aside>

        {/* Main workspace */}
        <main className="flex-1 min-w-0 bg-transparent">{children}</main>
      </div>
    </div>
  );
}

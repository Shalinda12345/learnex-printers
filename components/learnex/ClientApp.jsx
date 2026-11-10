"use client";

import dynamic from "next/dynamic";

// The ERP runs entirely in the browser (it uses browser-only APIs such as
// localStorage and the File System Access API), so it is never prerendered
// on the server. What is shown while it loads is rendered on the server, so it
// must not import anything browser-only.
const BootGate = dynamic(() => import("@/components/learnex/BootGate"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 text-slate-500 font-sans" role="status">
      <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/20">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      </div>
      <p className="text-sm">Loading LEARNEX ERP...</p>
    </div>
  ),
});

export default function ClientApp() {
  return <BootGate />;
}

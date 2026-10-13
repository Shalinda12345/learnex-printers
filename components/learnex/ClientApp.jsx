"use client";

import dynamic from "next/dynamic";

// The ERP is a browser-only app (localStorage, IndexedDB, File System Access
// API), so it is never prerendered on the server.
const BootGate = dynamic(() => import("@/components/learnex/BootGate"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter,system-ui,sans-serif",
        color: "#64748b",
      }}
    >
      Loading LEARNEX ERP...
    </div>
  ),
});

export default function ClientApp() {
  return <BootGate />;
}

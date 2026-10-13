/* Shared look of the full-screen cards shown before the app opens
   (loading, sign in, setup, import). */

export const shellStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  fontFamily: "Inter,system-ui,sans-serif",
  background: "#0f172a",
  padding: 24,
};
const cardStyle = {
  maxWidth: 420,
  width: "100%",
  background: "#ffffff",
  borderRadius: 20,
  padding: 32,
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};
export const buttonStyle = {
  width: "100%",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  padding: "12px 16px",
  borderRadius: 12,
  cursor: "pointer",
  marginTop: 8,
};
export const secondaryButtonStyle = { ...buttonStyle, background: "#eff6ff", color: "#1d4ed8" };
export const linkStyle = {
  width: "100%",
  background: "transparent",
  color: "#64748b",
  border: "none",
  fontSize: 13,
  padding: 10,
  cursor: "pointer",
  marginTop: 4,
  textDecoration: "underline",
};
export const headingStyle = { margin: "0 0 8px", fontSize: 18, color: "#0f172a" };
export const bodyStyle = { color: "#64748b", fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" };
export const errorStyle = { color: "#dc2626", fontSize: 12, margin: "0 0 12px", whiteSpace: "pre-wrap" };
const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", margin: "0 0 4px" };
const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  fontSize: 14,
  color: "#0f172a",
  background: "#fff",
  margin: "0 0 12px",
  fontFamily: "inherit",
};

export function GateShell({ children }) {
  return (
    <div style={shellStyle}>
      <div style={cardStyle}>{children}</div>
    </div>
  );
}

export function GateField({ label, hint, ...inputProps }) {
  return (
    <div>
      <label style={{ display: "block" }}>
        <span style={labelStyle}>{label}</span>
        <input style={inputStyle} {...inputProps} />
      </label>
      {hint && <p style={{ ...bodyStyle, margin: "-8px 0 12px", fontSize: 12 }}>{hint}</p>}
    </div>
  );
}

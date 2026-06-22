// app/unauthorized/page.tsx

export default function UnauthorizedPage() {
  return (
    <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Access denied</h1>
      <p style={{ color: "#555" }}>
        Your account role doesn&apos;t have permission to view this page.
      </p>
    </div>
  );
}
import { useState } from "react";
import { API } from "./api";

export default function Login({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" or "register"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onAuth(data.user);
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "Cannot reach the server. Is the backend running?" : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      {/* LEFT: branding panel — edit the text here to customize */}
      <div className="auth-side">
        <h1>💸 SpendSense</h1>
        <p>Your money, understood by AI.</p>
        <ul>
          <li>🏷️ Auto-categorizes every expense</li>
          <li>🚨 Catches unusual and duplicate charges</li>
          <li>🔮 Forecasts next month's spending</li>
          <li>🔁 Finds your hidden subscriptions</li>
        </ul>
      </div>

      {/* RIGHT: form */}
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === "login" ? "Welcome back 👋" : "Create your account"}</h2>
          <p className="muted">{mode === "login" ? "Log in to see your dashboard" : "It takes less than a minute"}</p>

          {mode === "register" && (
            <input placeholder="Full name" value={form.name} onChange={set("name")} required />
          )}
          <input type="email" placeholder="Email" value={form.email} onChange={set("email")} required />
          <div className="pw">
            <input type={show ? "text" : "password"} placeholder="Password (6+ characters)"
              value={form.password} onChange={set("password")} required minLength={6} />
            <span onClick={() => setShow(!show)}>{show ? "🙈" : "👁️"}</span>
          </div>

          {error && <div className="alert">{error}</div>}

          <button disabled={loading}>{loading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}</button>

          <p className="switch">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <a onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Log in"}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
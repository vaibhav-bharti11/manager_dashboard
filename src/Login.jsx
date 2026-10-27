import React, { useState } from "react";
import { UtensilsCrossed, ArrowRight, Lock } from "lucide-react";
import { supabase } from "./api.mjs";
export default function Login({ onLogin }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <section className="login-panel glass">
        <span className="wordmark">
          <UtensilsCrossed size={25} />
          service.
        </span>
        <span className="login-eyebrow">THE DAILY STANDARD</span>
        <h1>
          Good service starts
          <br />
          with the details.
        </h1>
        <p>
          Sign in to your restaurant workspace.
          <br />
          Every check, handover and service in one place.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              await onLogin(email, password);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email address
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your account email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!supabase && (
            <div className="error" role="alert">
              The database connection is not configured. Contact your
              administrator.
            </div>
          )}
          <button className="button dark" disabled={busy || !supabase}>
            {busy ? "Signing in…" : "Sign in to your workspace"}
            <ArrowRight size={16} />
          </button>
        </form>
        <small className="login-footer">
          <Lock size={11} />
          Your account opens only your assigned workspace.
        </small>
      </section>
    </div>
  );
}

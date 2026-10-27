import React, { useState } from "react";
import { Lock, Check } from "lucide-react";
import { supabase } from "./api.mjs";
export default function PasswordSettings() {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <form
      className="password-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");
        if (password !== confirm) {
          setError("The passwords do not match.");
          return;
        }
        setBusy(true);
        try {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
          setPassword("");
          setConfirm("");
          setMessage("Your password has been updated.");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Change your password</h3>
      <div className="field-grid">
        <label>
          New password
          <input
            type="password"
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="evidence-message" role="status">
          <Check size={13} />
          {message}
        </p>
      )}
      <button className="button outline" disabled={busy}>
        <Lock size={13} />
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

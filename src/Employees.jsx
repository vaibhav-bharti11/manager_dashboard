import React, { useState } from "react";
import { Plus, Users, Lock, Check } from "lucide-react";
export default function Employees({ users, restaurants, onCreate }) {
  const [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    restaurant_id: restaurants[0]?.id || "",
    password: "",
  });
  const set = (key, value) =>
    setForm((p) => ({
      ...p,
      [key]: value,
    }));
  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await onCreate(form);
      setSuccess(
        `Employee created. ${form.name} can now sign in to their assigned restaurant.`,
      );
      setForm({
        ...form,
        name: "",
        email: "",
        password: "",
      });
      setAdding(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Your people</h2>
          <p className="employee-intro">
            Individual logins. The right restaurant, every time.
          </p>
        </div>
        <button
          className="button dark"
          onClick={() => {
            setAdding(!adding);
            setError("");
            setSuccess("");
          }}
        >
          <Plus size={15} />
          {adding ? "Close form" : "Add employee"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="employee-success" role="status">
          <Check size={16} />
          {success}
        </div>
      )}
      {adding && (
        <section className="surface employee-create">
          <div className="panel-heading">
            <div>
              <h3>Add a restaurant manager</h3>
              <p>Their login opens only their assigned restaurant.</p>
            </div>
            <Users size={22} />
          </div>
          <form onSubmit={submit}>
            <div className="field-grid">
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Restaurant
                <select
                  required
                  value={form.restaurant_id}
                  onChange={(e) => set("restaurant_id", e.target.value)}
                >
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Initial password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={72}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                />
              </label>
            </div>
            <p className="employee-help">
              <Lock size={13} />
              Passwords are handled securely and never shown in the employee
              register. No invitation email is sent.
            </p>
            <button className="button dark" disabled={busy}>
              {busy ? "Creating employee…" : "Create employee"}
              <Plus size={14} />
            </button>
          </form>
        </section>
      )}
      <section className="surface log-panel">
        <div className="panel-heading">
          <div>
            <h3>Employee register</h3>
            <p>
              {`${users.filter((u) => u.role === "manager").length} restaurant managers · Admin access is separate`}
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Restaurant</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email || "Not recorded"}</td>
                  <td>{u.role === "admin" ? "Administrator" : "Manager"}</td>
                  <td>
                    {u.role === "admin"
                      ? "All restaurants"
                      : restaurants.find((r) => r.id === u.restaurant_id)?.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.length && (
            <div className="empty">
              <Users size={24} />
              <p>No employees added yet.</p>
              <small>
                Add each manager with their individual email and restaurant.
              </small>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

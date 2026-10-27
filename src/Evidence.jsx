import React, { useState, useEffect, useRef } from "react";
import { Upload, Download, FileText, Lock } from "lucide-react";
import { supabase } from "./api.mjs";
export default function Evidence({ occurrence, locked, onBusy }) {
  const [files, setFiles] = useState([]),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const input = useRef(null);
  async function refresh() {
    if (!occurrence?.id) return;
    const { data, error } = await supabase
      .from("evidence")
      .select("*")
      .eq("occurrence_id", occurrence.id)
      .order("created_at");
    if (error) setError(error.message);
    else setFiles(data || []);
  }
  useEffect(() => {
    refresh();
  }, [occurrence?.id]);
  async function upload() {
    if (!selected) return;
    setError("");
    setMessage("");
    if (
      !["image/png", "image/jpeg", "application/pdf"].includes(selected.type)
    ) {
      setError("Choose a PNG, JPEG or PDF file.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("The file must be 10 MB or smaller.");
      return;
    }
    setBusy(true);
    onBusy?.(true);
    try {
      const form = new FormData();
      form.append("file", selected);
      form.append("occurrence_id", occurrence.id);
      const { data, error } = await supabase.functions.invoke(
        "report-evidence",
        { body: form },
      );
      if (error) {
        let text = error.message;
        try {
          text = (await error.context.json()).error || text;
        } catch {}
        throw new Error(text);
      }
      if (data?.error) throw new Error(data.error);
      await refresh();
      setSelected(null);
      if (input.current) input.current.value = "";
      setMessage(
        "File uploaded securely. It will be visible with this report to the administrator.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  async function download(file) {
    setError("");
    try {
      const { data, error } = await supabase.storage
        .from("incident-evidence")
        .createSignedUrl(file.object_path, 60, { download: file.file_name });
      if (error) throw error;
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error("Download failed. Please retry.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = file.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="evidence-panel">
      <div className="panel-heading">
        <div>
          <h3>Evidence & attachments</h3>
          <p>Private files · PNG, JPEG or PDF · up to 10 MB</p>
        </div>
        <Lock size={17} />
      </div>
      {!locked && occurrence?.id && (
        <div className="evidence-upload">
          <label className="evidence-choose">
            Select evidence file
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              aria-label="Select evidence file"
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.files?.[0] || null);
                setError("");
                setMessage("");
              }}
            />
          </label>
          <button
            className="button outline"
            type="button"
            disabled={!selected || busy}
            onClick={upload}
          >
            <Upload size={14} />
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="evidence-message" role="status">
          {message}
        </p>
      )}
      {files.map((file) => (
        <div className="evidence-file" key={file.id}>
          <FileText size={18} />
          <div>
            <strong>{file.file_name}</strong>
            <small>
              {Math.ceil(file.byte_size / 1024)} KB · uploaded{" "}
              {new Date(file.created_at).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}
            </small>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => download(file)}
            aria-label={`Download ${file.file_name}`}
          >
            <Download size={14} />
            Download
          </button>
        </div>
      ))}
      {!files.length && (
        <p className="evidence-empty">
          {locked
            ? "No evidence was attached to this report."
            : "Upload a supporting file before submitting. Uploading a file does not submit the report."}
        </p>
      )}
    </section>
  );
}

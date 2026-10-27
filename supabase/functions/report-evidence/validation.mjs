export function validateEvidence(bytes, mime, size) {
  if (size === 0) throw new Error("The file is empty.");
  if (size > 10 * 1024 * 1024)
    throw new Error("The file must be 10 MB or smaller.");
  const signatures = {
    "image/png": { ext: "png", head: [137, 80, 78, 71, 13, 10, 26, 10] },
    "image/jpeg": { ext: "jpg", head: [255, 216, 255] },
    "application/pdf": { ext: "pdf", head: [37, 80, 68, 70, 45] },
  };
  const rule = signatures[mime];
  if (!rule) throw new Error("Upload a PNG, JPEG or PDF file.");
  if (rule.head.some((b, i) => bytes[i] !== b))
    throw new Error("The file content does not match its declared type.");
  return rule.ext;
}

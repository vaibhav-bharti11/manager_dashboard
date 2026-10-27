import { readFile, writeFile } from "node:fs/promises";
for (const name of ["employee-admin", "report-evidence"]) {
  const folder = `supabase/functions/${name}/`;
  const validation = (
    await readFile(folder + "validation.mjs", "utf8")
  ).replaceAll("export function", "function");
  const index = (await readFile(folder + "index.ts", "utf8")).replace(
    /import\s*\{[^}]*\}\s*from\s*["']\.\/validation\.mjs["'];?\s*/,
    "",
  );
  await writeFile(`docs/${name}-deploy.ts`, validation + "\n" + index);
}
console.log("Single-file Edge Function prepared from the tested source.");

import fs from "node:fs";
import { performance } from "node:perf_hooks";
import Papa from "papaparse";

const count = Number(process.argv[2] ?? 10000);
const malformed = process.argv.includes("--malformed");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const rows = ["Title,DOI,EID,Year,Abstract,Author Keywords,Cited by"];
for (let index = 0; index < count; index++) {
  if (malformed && index % 100 === 99) {
    rows.push(`,10.1000/${index},2-s2.0-${index},not-a-year,"Missing title","graph",0`);
  } else {
    rows.push(`"Paper ${index}",10.1000/${index},2-s2.0-${index},${2000 + index % 26},"Abstract ${index} about graph discovery","graph; discovery",${index % 100}`);
  }
}
const csv = rows.join("\n");
const started = performance.now();
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
const elapsed = performance.now() - started;
const invalidRows = parsed.data.filter((row) => !String(row.Title ?? "").trim()).length;
console.log(JSON.stringify({
  rows: parsed.data.length,
  parserErrors: parsed.errors.length,
  invalidRows,
  malformed,
  milliseconds: elapsed
}, null, 2));
if (outputArgument) fs.writeFileSync(outputArgument.slice("--output=".length), csv);

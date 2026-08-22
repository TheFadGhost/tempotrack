// CLI: print a synthetic sample database to stdout (Node >= 22).
//   node scripts/generate-sample-data.ts
import { pathToFileURL } from "node:url";
import { buildSampleDatabase } from "../src/data/sample.ts";

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  process.stdout.write(JSON.stringify(buildSampleDatabase(Date.now()), null, 2));
}

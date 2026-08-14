import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Turbopack weigert modules buiten de project-root, en die leidt Next af uit de
// plek van de lockfile — dus `web/`. Maar `lib/training-load.ts` importeert
// `../../tm_sync/training_load_model.json`: één belastingsmodel dat de web-kant
// en de Python-kant delen. Zonder deze regel bouwt `next dev` nog wel, maar
// faalt `next build` met "Module not found" — lokaal én in Docker.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    root: repoRoot,
  },
  // De tracing-root moet meeschuiven, anders zoekt de standalone-build zijn
  // bestanden nog steeds vanaf web/.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;

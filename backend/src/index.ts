import { env } from "./config/env";
import { run } from "./bootstrap";

// Single-process mode: API + (optionally) worker. Use server.ts / workerMain.ts to scale them separately.
run({ api: true, worker: env.RUN_WORKER_IN_API });

import { run } from "./bootstrap";

// API only (pair with one or more `workerMain` processes).
run({ api: true, worker: false });

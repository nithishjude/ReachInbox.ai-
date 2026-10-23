import { run } from "./bootstrap";

// Worker only. Start as many of these as you like; rate limits live in Redis, so they stay global.
run({ api: false, worker: true });

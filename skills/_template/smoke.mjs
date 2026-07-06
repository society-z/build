// Deterministic smoke test. Exits 0 on pass, non-zero on fail. No private keys, no paid calls.
import { run } from "./index.mjs";

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
}

const out = await run({ example_param: "hello" });
assert(typeof out === "object", "run returns an object");
assert(out.result === "HELLO", "result is uppercased input");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: _template");
process.exit(failed ? 1 : 0);

// _template skill. Copy this folder to skills/<your-skill>/ and replace the body.
// Contract: export an async `run(inputs)` that returns the outputs object in skill.json.

export async function run(inputs) {
  const { example_param } = inputs;
  if (typeof example_param !== "string") {
    throw new Error("example_param (string) is required");
  }
  // ...do the real work here...
  return { result: example_param.toUpperCase() };
}

// Allow direct invocation: `node index.mjs '{"example_param":"hi"}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2)));
}

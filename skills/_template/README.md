# _template

Copy this folder to start a new skill: `cp -r skills/_template skills/my-skill`.

Replace this README, fill in `skill.json`, write `index.mjs`, and make `smoke.mjs` pass.

## What it does

One paragraph. What does an agent get by calling this?

## Call it

```bash
node index.mjs '{"example_param":"hello"}'
# => { "result": "HELLO" }
```

Or import it:

```js
import { run } from "./index.mjs";
const out = await run({ example_param: "hello" });
```

## Inputs / outputs

See `skill.json`. Inputs: `example_param` (string). Outputs: `result` (string).

## Smoke test

```bash
node smoke.mjs   # prints SMOKE PASS / SMOKE FAIL, exits 0 on pass
```

## Author

Fill in `author` in `skill.json` with your `member_id`, `github_id`, and `wallet`. Your
`member_id` is assigned automatically when you link your wallet to GitHub — nothing to mint.

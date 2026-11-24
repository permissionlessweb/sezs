# Walkthrough tooling — raw model output

- Provider: `nous` (Nous Portal)
- Endpoint: `https://inference-api.nousresearch.com/v1`
- Model requested: `qwen/qwen4-max:free` (prefer; labelled “Qwen: Qwen4 Max” on the Portal)
- Fallback model (not used): `tencent/hy4-flash:free` (labelled “Tencent: Hy4 flash”)
- Timestamp: 2026-11-19 22:40 Africa/Dakar (UTC+0)
- Command:

```
hermes chat --query-file /tmp/t43u/query.txt --oneshot -Q --format text \
  -m qwen/qwen4-max:free --provider nous --max-turns 1 \
  --image /tmp/t43u/contact-sheet.jpg
```

- Result: **the call did not work.** Hermes exited 1 with:

  `No access token found for Nous Portal login. Run \`hermes model\` to re-authenticate.`

  The same session reported `hermes portal info` → Auth: not logged in, and `hermes auth status nous` → logged out. The configured default provider is already `nous`, but there is no Portal access token in this CLI. The fallback model was not attempted: it uses the same `nous` provider and would fail the same way. No API keys or tokens were read or supplied.

## Exact model ids listed (not guessed)

Live `GET https://inference-api.nousresearch.com/v1/models` (HTTP 200, no auth) and `https://portal.nousresearch.com/models` both list these free routes, among others:

| Portal label | Model id |
| --- | --- |
| Qwen: Qwen4 Max | `qwen/qwen4-max:free` |
| Tencent: Hy4 flash | `tencent/hy4-flash:free` |
| LongCat-2.5:Free | `meituan/longcat-2.5:free` |
| StepFun: Step 3.7 Flash | `stepfun/step-3.7-flash:free` |
| Upstage: Solar Mini 4 | `upstage/solar-mini4:free` |

The same catalogue also lists paid routes `qwen/qwen4-max` and `tencent/hy4-flash` (no `:free` suffix). Hermes `config get model` shows provider `nous` and a default of `ornith/ornith-1.5-122b:free`.

## Query that was sent

See `/tmp/t43u/query.txt` (also reproduced below). A contact sheet of the Ficus reference clip was attached as `--image`.

```
Suggest known open-source tooling that powers the curation of polished product walkthrough videos of people interacting with web products (and mobile), in the style of modern crypto/web3 product demo videos on X: smooth zoom-and-pan following the cursor, cursor smoothing and highlight, click ripples, auto-zoom on interactions, clean device frames, background gradients, captions, step callouts, voiceover sync, programmatic rendering from scripts or recorded sessions.

A concrete style reference is the Ficus product demo at https://x.com/noahsaso/status/2123525936805294328 (a 79-second 1080p clip). A contact-sheet image of that video is attached if you can see images. First, identify the key visual primitives that make that video elegant (composition, typography, device frames, zoom/blur/callouts, cursor, scene rhythm, end card, and anything else you notice). Then recommend tools.

For each tool give:
- name
- official repo URL
- license
- what it does
- how it would fit a pipeline that already has Playwright/Trailblaze recordings, per-step narration YAML, and mermaid flow SVGs

Only name real tools you are confident exist. Prefer official GitHub or GitLab URLs. Do not invent repos or licenses. It is better to list fewer verified tools than to guess.
```

## Model output

_(none — the request never reached the model.)_

The verified survey, including a first-person analysis of the reference video, is in `walkthrough-tooling.md`.

# Walkthrough tooling (verified)

- Written: 2026-11-19 22:43 Africa/Dakar (UTC+0)
- Style reference: [Noah Saso, Ficus demo](https://x.com/noahsaso/status/2123525936805294328) (79s, 1920×1080, 30 fps). The public 1080p MP4 variant has **no audio track**; the elegance is typographic and motion-led, not a talk track.
- Hermes: a one-shot of `qwen/qwen4-max:free` on `--provider nous` was attempted and failed (no Nous Portal access token in the CLI). There is therefore **no model-suggested list to mark as hallucinated**. The table below was researched against the GitHub API (`gh api` / `gh search repos`) on this date. Tools that could not be verified are called out, not invented.

## Primitives that make the Ficus clip elegant

These are observed from the 79-second video, not inferred from marketing copy.

1. **A designed stage, not a raw desktop.** Soft dark olive/brown vignette. No dock, menu bar, or browser chrome.
2. **A floating macOS window as the device frame.** Traffic-light chrome, rounded corners, drop shadow. The product sits in the window, not full-bleed in the frame.
3. **Left-rail typography.** A short display headline plus one supporting line, held across a scene, then cross-faded to the next line (for example “The squad’s workspace, in the app.” dissolving into “Just ask.”).
4. **Punch-in on the thing that matters.** The rest of the UI goes soft and slightly blurred; the active card, row, or modal stays sharp and often slightly enlarged.
5. **Green pill callouts** laid over the zoomed region (“Everything that needs you, in one place.”, “Approved. Work continues.”). These are designed badges, not YouTube-style captions.
6. **A visible, simple pointer.** Sometimes parked in the lower-right of the stage; sometimes inside the window at the control being used (tabs, the Approved button, the terminal). Motion is restrained.
7. **Multi-device composition.** A phone frame slides over the desktop window for the “your phone too” beat.
8. **Theme / instance stacks.** A closing beat fans three windows (light, dark, purple) rather than cutting.
9. **Bookends.** A quiet logo title card (“OPEN SOURCE · SELF-HOSTED”) and a clean end card (name, feature pills, CTA, platform list).
10. **One idea per scene, short copy.** The UI is real, but the shot never asks the viewer to read a whole page.

A walkthrough pipeline should treat these as layers: stage (gradient + typography) + framed recording + focus (zoom/blur) + callout + cursor + optional phone mock + end card. Voiceover and mermaid diagrams can sit on the same stage without breaking the look.

## Verified shortlist (top 8)

Stars, licenses, and last-commit timestamps are from GitHub as of 2026-11-19 22:43 Africa/Dakar (UTC+0). Commit times below are UTC (same clock as Africa/Dakar).

| Tool | Repo | License | Stars | Last commit (UTC) | Fit for this pipeline |
| --- | --- | --- | --- | --- | --- |
| [OpenScreen](https://github.com/getopenscreen/openscreen) | https://github.com/getopenscreen/openscreen | MIT | 7,589 | 2026-11-19 | Closest open-source “Screen Studio” editor: record, auto-zoom on clicks, restyle, cut from a transcript. A published agent skill can turn a feature walk into a demo. Use it to polish Trailblaze/Playwright captures, or as the interactive editor. |
| [Remotion](https://github.com/remotion-dev/remotion) | https://github.com/remotion-dev/remotion | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) (source available; free for individuals and smaller companies, paid company license above a size threshold — not OSI MIT) | 74,344 | 2026-11-19 | Best programmatic compositor: map each narration YAML step to a scene, lay mermaid SVGs and typography on a dark stage, time zooms to Playwright click points, and sync the existing `say` TTS beds. |
| [Cap](https://github.com/CapSoftware/Cap) | https://github.com/CapSoftware/Cap | AGPL-3.0 (MIT only for some `cap-camera*` / `scap-*` crates; see the repo LICENSE) | 25,297 | 2026-11-19 | Open-source Screen Studio–like desktop recorder and editor. Strong as a human polish pass on usher/check-in and ticket-purchase takes. |
| [Recordly](https://github.com/webadderallorg/Recordly) | https://github.com/webadderallorg/Recordly | AGPL-3.0 | 37,100 | 2026-11-19 | Desktop recorder/editor (macOS/Windows/Linux) with auto-zoom suggestions, cursor smoothing, and styled frames (gradients, padding, shadows) — the same primitives as the Ficus clip. |
| [Playwright](https://github.com/microsoft/playwright) | https://github.com/microsoft/playwright | Apache-2.0 | 100,608 | 2026-11-19 | Already in the stack. Use its video, traces, and locator/click metadata as the source of truth for what to zoom, rather than only the finished MP4. |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | https://github.com/FFmpeg/FFmpeg | LGPL-2.1 (some components GPL) | 67,646 | 2026-11-19 | Headless grade, `zoompan`/crop follow, blur underlays, gradient stage, window shadow, caption overlay, and concat of per-step clips against YAML timings. Lowest-dependency path if a JS compositor is too heavy. |
| [Revideo](https://github.com/midrender/revideo) | https://github.com/midrender/revideo (moved from `redotvideo/revideo`) | MIT | 4,219 | 2026-07-15 | Remotion-like, programmatic web-to-video with a more conventional MIT license. A good compositor option if the Remotion company license is a poor fit. Last commit mid-July 2026 — alive, but quieter than Remotion. |
| [rrweb](https://github.com/rrweb-io/rrweb) | https://github.com/rrweb-io/rrweb | MIT | 20,397 | 2026-11-15 | Record DOM sessions (not just pixels) from the app or from Playwright. Replay, then re-render with a clean cursor and scripted zooms, which is closer to “product footage” than a desktop grab. |

## Also verified (useful, not in the top 8)

| Tool | Repo | License | Stars | Last commit (UTC) | Notes |
| --- | --- | --- | --- | --- | --- |
| Motion Canvas | https://github.com/motion-canvas/motion-canvas | MIT | 20,070 | 2026-07-02 | Code-driven motion graphics; excellent for typography, mermaid-driven diagrams, and callout choreography. Weaker as a raw screen-recording host. |
| Screenity | https://github.com/alyssaxuu/screenity | GPL-3.0 | 19,001 | 2026-11-08 | Browser-extension recorder with annotations. Handy for a single-tab product pass; not a compositor. |
| Screenize | https://github.com/syi0808/screenize | Apache-2.0 | 621 | 2026-05-22 | macOS Screen Studio alternative with auto-zoom and a timeline. **Development is paused** (author points at Recordly). Still a real, inspectable codebase. |
| Reelbird | https://github.com/btahir/reelbird | MIT | 52 | 2026-11-16 | Smaller macOS recorder with auto-zoom and cursor smoothing. Early but recently maintained. |
| screenstudio-alt | https://github.com/connerkward/screenstudio-alt-skill | MIT | 11 | 2026-06-23 | Headless auto-zoom / idle-speed skill over existing recordings — close in spirit to “Playwright video + ffmpeg zoompan”, but a small project. |
| whisper.cpp | https://github.com/ggml-org/whisper.cpp | MIT | 55,342 | 2026-11-19 | Local transcription / timing. Canonical repo moved from `ggerganov/whisper.cpp`. Use with existing draft TTS or a later human voice. |
| Whisper | https://github.com/openai/whisper | MIT | 113,119 | 2026-08-31 | Upstream Python Whisper. |
| stable-ts | https://github.com/jianfch/stable-ts | MIT | 2,284 | (verified repo; use for tighter word timing) | Forced alignment on Whisper — better caption sync than raw segment timestamps. |
| whisper-timestamped | https://github.com/linto-ai/whisper-timestamped | AGPL-3.0 | 2,863 | (verified) | Word-level timestamps. |
| aeneas | https://github.com/readbeyond/aeneas | AGPL-3.0 | 2,880 | 2026-11-16 | Forced alignment of a known script (the narration YAML) to an audio bed. Strong when the text is already written. |
| mermaid-cli | https://github.com/mermaid-js/mermaid-cli | MIT | 5,178 | 2026-11-16 | Already in spirit in the repo (`make diagrams`). Keep using it to produce the SVG layers Remotion/FFmpeg/Motion Canvas composite. |
| mermaid | https://github.com/mermaid-js/mermaid | MIT | 91,164 | 2026-11-19 | Upstream library. |
| Theatre.js | https://github.com/theatre-js/theatre | Apache-2.0 | 13,066 | (verified) | Web motion-design editor; a possible authoring UI on top of a Remotion/Canvas pipeline, not a recorder. |
| KeyCastr | https://github.com/keycastr/keycastr | BSD-3-Clause | 15,214 | 2026-09-07 | Shows keystrokes, not cursor trails. Useful only for “type to search / sign in” beats. |
| OBS Studio | https://github.com/obsproject/obs-studio | GPL-2.0 | 79,775 | 2026-11-19 | Capture, not cinematic auto-zoom. A source if a take must be live rather than Playwright. |
| Kap | https://github.com/wulkano/Kap | MIT | 19,430 | 2024-11-12 | macOS recorder. Last commit Nov 2024; treat as quiet. |
| Editly | https://github.com/mifi/editly | MIT | 5,633 | 2025-05-12 | Declarative FFmpeg editing (clips, clips from JSON). Last commit May 2025; still a reasonable YAML-to-edit bridge, but quieter than Remotion. |
| Kooha | https://github.com/SeaDve/Kooha | GPL-3.0 | 3,562 | 2026-11-06 | Polished Linux recorder. Not a cursor-zoom compositor. |
| ShareX | https://github.com/ShareX/ShareX | GPL-3.0 | 41,217 | (verified) | Windows capture/annotate. Not the Ficus look. |
| ScreenToGif | https://github.com/NickeManarin/ScreenToGif | MS-PL | 27,971 | (verified) | Region record + GIF/video edit on Windows. |
| auto-editor | https://github.com/WyattBlue/auto-editor | Unlicense | 6,009 | (verified) | Silence/idle cutting. Helpful if a take is too long; it will not invent zooms or frames. |
| fastlane | https://github.com/fastlane/fastlane | MIT | 42,409 | (verified) | `frameit` / screenshot framing for mobile store art. A source of phone bezels for the “your phone too” beat, not a video editor. |

## Checked, weak, or not what the name suggests

- **FocuSee** is a commercial auto-zoom recorder. GitHub hits under that name were coupon/affiliate stubs or empty repos, not a credible open-source implementation. Do not treat FocuSee as OSS.
- **OpenScreen namesakes:** the maintained product is [`getopenscreen/openscreen`](https://github.com/getopenscreen/openscreen). Other repos reuse the name and should not be confused with it: `Aldazou/openscreen` (3 stars, Aug 2026, also a Screen Studio–style app), `MrKonstantinSh/OpenScreen` (screen *sharing*), `Misfits-Rebels-Outcasts/OpenScreenRecorder` (UWP recorder, last commit 2020-06-15 — stale). `MinhOmega/Capturia` is an MIT fork of OpenScreen (LICENSE cites `getopenscreen/openscreen` v1.10.0).
- **Recordly namesakes:** the substantial project is [`webadderallorg/Recordly`](https://github.com/webadderallorg/Recordly) (site: https://www.recordly.dev). `devcxl/recordly` is a separate small PyQt5+FFmpeg tool (5 stars) with mouse effects; real, but not the well-known one.
- **`stefanzweifel/cursor-highlight`** does not exist (GitHub API 404). No substitute of that exact name was added.
- **`sevon/kooha`** does not exist; the real Kooha repo is `SeaDve/Kooha`.

## A practical pipeline (no new invented tools)

1. **Capture** with the existing Playwright / Trailblaze sessions (clean theme, no desktop clutter). Optionally also record an rrweb session for DOM-accurate replay.
2. **Keep step timing in the narration YAML** (and the `say` TTS already rendered for usher check-in and ticket purchase). Align captions to that script with aeneas or stable-ts only if a human voiceover replaces `say`.
3. **Compose** either:
   - *Programmatic (closer to repeatable guides):* Remotion or Revideo (or Motion Canvas for typography/diagrams) reads YAML + mermaid SVGs + click timestamps, draws the dark stage, window frame, left headlines, zoom/blur, green pills, and end card; or
   - *Editor (closer to a one-off hero film):* drop the same takes into OpenScreen, Cap, or Recordly and use auto-zoom + styled frames.
4. **Fallback / finish** in FFmpeg: concat, color, `zoompan`, overlay the mermaid stills and TTS, export 1920×1080.

The Ficus clip’s look is mostly **stage + frame + punch-in + pill + type**. Those can be reused on Speak-Ez Session guides without copying Ficus’s product UI.

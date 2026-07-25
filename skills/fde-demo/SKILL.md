---
name: fde-demo
description: "Build a customer demo live while the FDE talks with the customer on-site. Use when starting a customer demo session (scaffold a branded workspace), during the meeting (turn-based increments driven by conversation notes or transcript), or wrapping up (sign-off spec, walkthrough script, decision log). Inputs are customer system screenshots, API specs/samples, and conversation increments. Core rules: open-source-first ladder (reuse > assemble > generate), spec-first (never code directly from transcript), and 3-minute turns with screenshot self-check."
---

# FDE Demo — 边聊边出 Demo

You are running a live customer meeting workflow. The FDE is talking to a
customer face-to-face; your job is to turn conversation increments into visible
demo changes, fast, without ever breaking what is on the projector.

Read the matching reference before each phase:
- `references/elicit.md` — what the FDE should ask（现场提问清单）
- `references/spec-format.md` — DEMO_SPEC.md structure
- `references/oss-first.md` — the reuse ladder, GitHub search recipe, license rules
- `references/demo-kit.md` — template base, theming, mock-data contract
- `references/scenarios.md` — 10 worked scenarios（现场剧本，用于会前推演）

## Hard rules (never violate)

1. **Spec first.** Every change goes through `DEMO_SPEC.md` before any code.
   Transcript text NEVER drives code directly — it is noisy and customers
   reverse themselves. Update spec, show the diff, then implement.
2. **Reuse > assemble > generate.** Before building anything, check
   `gallery/` for a pre-vetted open-source base; else assemble from
   `templates/base` modules; only generate from scratch as a last resort.
   NEVER clone an unvetted repo during the meeting — a failed build burns the
   whole turn budget. Unknown repos go to `CANDIDATES.md` for later.
3. **Turn budget ≤3 minutes.** If an increment won't fit, ship a placeholder
   (fake data / static page), record it under 暂缓项 in the spec, move on.
4. **Screenshot self-check.** After every code change, screenshot the affected
   page (Playwright or the browser) and verify it renders before reporting
   done. What the customer sees must never be broken.
5. **Customer's language.** UI copy, terminology, and field names come from the
   customer's screenshots and speech — keep their exact terms（客户的术语就是
   界面的术语）. Spec and all customer-facing output are written in Chinese.
6. **Honesty markers.** Mock data and deferred items are explicitly labeled in
   the spec. The demo must never be mistaken for a delivery commitment.

## Phase 1 — start（会前，预算 10 分钟）

Trigger: "start a demo session for <customer>" / `/fde-demo start <customer>`.

1. Create workspace `demos/<customer>-<YYYYMMDD>/` with:
   `DEMO_SPEC.md`（from `references/spec-format.md`）, `TRANSCRIPT.md`,
   `CANDIDATES.md`, `inputs/`, `decisions.jsonl`.
2. Pick the base by the reuse ladder: check `gallery/README.md` for a matching
   pre-vetted project; otherwise copy `templates/base` into `app/`.
3. Ingest whatever is already in `inputs/`:
   - screenshots → extract brand color, logo text, terminology, page layout
     into `app/theme.json` and the spec;
   - API spec → run `scripts/ingest-api.ts` to generate `mock-data.json` +
     client (mock-first; real API only if creds AND connectivity confirmed).
4. `npm install && npm run dev` in `app/` (background), open the browser.
5. Verify with a screenshot; write the initial spec (目标场景 guess, 页面清单).
   Report: what the customer will see on first projection.

## Phase 2 — turn（现场循环，每回合 ≤3 分钟）

Trigger: console [▶], `/fde-demo turn`, or any pasted conversation note.

Every turn, exactly five steps:

1. **摄取** — read the new part of `TRANSCRIPT.md` (or the note) and any new
   files in `inputs/`.
2. **查阶梯** — for each new requirement: gallery hit? → reuse path. No hit →
   note candidates in `CANDIDATES.md` (repo/★/license/跑通成本/匹配度, spawn a
   background search subagent if useful), and cover this turn with module
   assembly or a placeholder.
3. **改 spec** — merge into `DEMO_SPEC.md` (页面清单 / 打动点 / 暂缓项 /
   已确认已否决). Show the diff.
4. **最小变更 + 自检** — smallest code change that makes the increment visible;
   screenshot; fix or fall back to placeholder if broken. Only fix what the
   customer can see on the projector — tooling improvements discovered during
   the check go to 暂缓项, not into this turn (rehearsal lesson: that is how
   a 3-minute turn becomes 4.5).
5. **一行总结** — output ONE Chinese sentence the FDE can read aloud to the
   customer, e.g. 「工单列表已按贵方的优先级字段着色，数据结构就是你们 API
   的字段」.

Also log judgment moments to `decisions.jsonl` as they happen
(`customer_signal | rejection | fde_call | oss_pick` — see DESIGN.md §10):
when the customer's eyes light up, when they kill an idea and why, why you
picked a base. One JSON line each, in the moment, not retroactively.

## Phase 3 — wrap（收尾，预算 5 分钟）

Trigger: `/fde-demo wrap`.

1. Finalize `DEMO_SPEC.md`: mark every 页面清单 item done/占位; make sure
   已确认/已否决 and 暂缓项 reflect the meeting. This is the sign-off artifact
   — the customer nods at it before you leave.
2. Generate `WALKTHROUGH.md`: a 演示台词稿 in Chinese — the order to click
   through pages, one sentence per screen, leading with the 打动点.
3. Ensure `decisions.jsonl` is complete; it feeds the FDE Loop (INDUCE) later.
4. If a gallery base was used or a new base was proven, append the experience
   back to `gallery/` (回填).
5. Optional (explicit ask only): deploy a preview link.

## Checklists（现场纪律）

Before the meeting: 手机热点备好（模型 API 是唯一硬依赖）· 双屏就位，投屏只投
Demo 和 spec · 录音已获客户同意，转写走本地 · 画廊底座会前已跑通。

Degradation path: console broken → keep working in this TUI with typed notes;
ASR broken → FDE types key points; dev server broken → walk the customer
through the spec while fixing. The workflow never stops.

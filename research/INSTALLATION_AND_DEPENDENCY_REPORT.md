# CareSpeak — Installation & Dependency Report

**Date:** 2026-11-24 · **HEAD:** `1b2940c` · Platform audited: Windows (PowerShell),
Node v24.16.0, npm 11.13.0, Python 3.10.11 (backend venv).

**No new package was installed in this pass.** The only lockfile change is a
patch-level update (`npm audit fix`) recorded below.

---

## 1. Frontend — exact versions

Source of truth: `package.json` + `package-lock.json`.

### Runtime dependencies
| Package | Declared | Installed |
|---|---|---|
| `next` | `^15.2.0` | **15.5.29** (was 15.5.20) |
| `react` / `react-dom` | `^19.1.0` | 19.x |
| `@mediapipe/tasks-vision` | `^0.10.18` | 0.10.x |
| `minisearch` | `^7.2.0` | 7.x |
| `@upstash/redis` | `^1.34.3` | 1.x |
| `framer-motion` | `^12.0.0` | 12.x |
| `lucide-react` | `^1.23.0` | 1.x |
| `qrcode` | `^1.5.4` | 1.x |
| `recharts` | `^3.9.2` | 3.x |
| `http-proxy` | `^1.18.1` | 1.x |

### Dev dependencies
`@tailwindcss/postcss` 4.3.2, `tailwindcss` 4.x, `typescript` 5.8.x,
`vitest` 3.2.7, `vite` 7.3.6, `@types/*`.

Transitive items that show up in `npm ls`: `sharp@0.34.5` (under `next`, image
optimization — unused because `next.config.js` sets `images.unoptimized: true`),
`postcss@8.5.16` (root) and `postcss@8.4.31` (bundled by `next`), `nanoid@3.3.15`.

### Install / verify commands
```powershell
npm ci            # reproducible install from package-lock.json (used by CI)
npm run typecheck # tsc --noEmit
npm test          # vitest run  -> 52 files / 817 tests
npm run eval:rag  # retrieval harness -> recall@5 0.957, MRR 0.891
npm run build     # next build (production)
```
All four were executed and passed at HEAD.

## 2. `npm audit` — before and after

Command: `npm audit --json` (advisory, no external service required).

| | Total | Critical | High | Moderate |
|---|---|---|---|---|
| Before `npm audit fix` | 9 | 3 | 5 | 1 |
| After `npm audit fix` | 5 | 2 | 1 | 2 |

What changed: `next` **15.5.20 → 15.5.29** (within `^15.2.0`), which clears the
App Router / Server Actions / Image-Optimization RCE and cache-confusion
advisories. No source change was required and the build stayed green.

What remains, and why it is acceptable *for now*:

| Package | Severity | Shipped? | Why left |
|---|---|---|---|
| `vitest`, `tinypool`, `@vitest/mocker` | critical/moderate | **no — dev only** | Fix requires `vitest@5` (a **major** from 3.x). It is a test-only dependency and is never deployed. Upgrading 52 test files' toolchain is a separate, deliberate task. |
| `vite` (via vitest) | high | **no — dev only** | Same toolchain; dev-server-only attack surface. |
| `postcss@8.4.31` (bundled by `next`) | moderate | build-time only | The only fix is `next@16` (**major**). `next` pins this copy internally; it processes CSS at build time, not attacker input at runtime. Documented, not overridden. |

Rationale: production-relevant advisories were fixed; the rest are a dev-toolchain
major upgrade and a build-time transitive pin. `npm audit` is wired into CI as
**advisory, non-blocking** (`.github/workflows/ci.yml`) so a pre-existing advisory
cannot mask a real regression.

## 3. Backend — exact versions

Source: `backend/requirements.txt`.

```
fastapi==0.162.0
uvicorn[standard]==0.54.0
httpx==0.28.1
numpy==2.2.6
sherpa-onnx==2.0.1
onnxruntime==1.23.2
python-multipart==0.0.32
python-dotenv==1.2.4
websockets==16.1.1
pytest==9.2.0
```

- **No PyTorch, no transformers** — this is a deliberate property. Every Indic
  option evaluated in `OPEN_SOURCE_TECHNOLOGY_EVALUATION.md` would break it.
- `sherpa-onnx` / `onnxruntime` install from manylinux/win wheels; the unit tests
  stub the engines, so **CI needs neither GPU nor model files**.
- Noted by the speech research: `sherpa-onnx==2.0.1` is pinned while `v2.0.3`
  exists. Not bumped here (would need a re-run of the 534 backend tests to justify).

### Install / verify commands
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q   # -> 534 passed, 1 deprecation warning
```

## 4. Model files (not committed)

`.gitignore` excludes `backend/models/`, `backend/data/`, `backend/logs/`,
`backend/runtime/`, `*.wav`, `*.pid`, `*.log`. Models present **locally** (per the
speech research, measured): whisper `ggml-base.en.bin` (141.1 MB, English-only),
sherpa VITS LJSpeech (108.8 MB), Kokoro `model.onnx` (329.5 MB, unreachable through
the current `tts.py`), a Piper voice file (74.9 MB, unused), Silero VAD (2.2 MB).
None of these are in the repository and none are required by CI.

## 5. Reproducibility gaps (honest)

- `npm ci` was **not** re-run from scratch in this environment (node_modules was
  already present and `npm audit fix` used the existing tree); the lockfile diff
  was reviewed with `git diff --stat` instead.
- The backend was verified against the existing `.venv`; a clean-room venv rebuild
  was not performed here.
- No install was attempted on Linux/macOS; CI pins `ubuntu-latest` + Node 20 +
  Python 3.10, which is the environment that will actually run.

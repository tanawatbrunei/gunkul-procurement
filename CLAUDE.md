# CLAUDE.md — gunkul-procurement

Architecture + working-conventions reference for this repo. Read this first.
It is also the template/starter reference for the sibling project
**gunkul-warehouse** (see `docs/gunkul-warehouse-kickoff.md`).

---

## 1. What this app is

Internal web app for GUNKUL's **central procurement department**. Read-mostly
dashboards + a few data-entry flows. Deployed at **gunkul-procurement.vercel.app**
(reflects the `main` branch only — the live site is whatever is on `main`).

## 2. Tech stack

- **React 19 + TypeScript**, bundled with **Vite 8**. No CSS framework — styling
  is inline styles + CSS custom properties (design tokens).
- **Firebase** (`firebase` v12): Firestore (data), Auth (email/password login),
  Storage (uploaded files/images). Config lives in `src/firebase.ts`
  (project id `gunkul-internship`).
- **recharts** for all charts. **xlsx** (SheetJS) for Excel import/export.
- **@tabler/icons-react** for icons.
- **Hosting:** Vercel, auto-deploys on push to `main`.
- **Google Sheets ↔ Firestore sync** via a Google Apps Script (`google-apps-script/`).

## 3. Commands

```bash
npm run dev       # local dev server (Vite)
npm run build     # tsc -b && vite build  — MUST pass before shipping
npm run lint      # eslint
npx tsc --noEmit  # type-check only
```

Before committing, always run `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit && npm run build`.
(The stale `tsconfig.tsbuildinfo` cache has hidden real errors before — delete it first.)

## 4. Project structure

```
src/
  App.tsx              # shell: auth gate + sidebar + page router (state-based, no react-router)
  Sidebar.tsx          # left nav; Page type union lives here
  LoginPage.tsx        # email/password auth
  HomePage.tsx         # landing: hero, "who we serve", EPC vs PPA, workflow, stakeholders
  Dashboard.tsx        # KPI dashboard
  ProjectPage.tsx      # project list + charts + add/edit modal
  ItemMasterPage.tsx   # item price comparison across vendors (Excel import)
  VendorPage.tsx       # vendor directory
  TrackingPage.tsx     # PR/PA/PO tracking — read-only mirror of the Google Sheet
  TrackingOverview.tsx
  KnowledgePage.tsx    # knowledge base (kick-off checklist, incoterms, workflow)
  ESGPage.tsx, OrgChartPage.tsx
  ThemeContext.tsx / ThemeToggle.tsx   # light/dark theme
  components/
    PageKit.tsx        # shared UI: Reveal, Section, HoverCard, IconBadge, grid(), tint()
    ImportModal.tsx    # Excel upload modal
    CompanyUpdates.tsx # glass panel: last-updated date per company
  data/
    procurement.ts     # Excel parsing + Firestore import (PO_HEADERS mapping, importPurchaseOrders)
    projectSeed.ts
  styles/
    tokens.css         # DESIGN SYSTEM: colors, spacing (--sp-*), radius, fonts, sidebar width
    orgchart.css
  firebase.ts          # Firebase init + exports: auth, db, storage
google-apps-script/
  Code.gs, SETUP.md, appsscript.json   # Sheets→Firestore sync (see section 7)
```

## 5. Design system (reuse this in new projects)

- **Tokens** in `src/styles/tokens.css`: spacing scale `--sp-1..8`
  (0.25→4rem), `--bg`, `--bg-elevated`, `--surface`, `--border`, `--accent`
  (gold), `--primary` (navy), `--text`/`--text-strong`/`--text-muted`/`--text-faint`,
  `--radius-*`, `--sidebar-w` (232px), `--header-h` (64px). Light + dark variants.
- **Look:** editorial, warm sand background, navy + gold accents, serif headings
  (Cormorant Garamond), glass panels (`rgba(255,255,255,0.08)` + `backdrop-filter: blur`).
- **PageKit.tsx** has the reusable primitives — prefer these over re-building.

## 6. Data-entry vs display conventions

- Several pages are **read-only mirrors**; data entry happens elsewhere (Google
  Sheet or import). Do NOT add edit UI to those without asking.
- **Excel import** (`data/procurement.ts`) maps **by header name** (`PO_HEADERS` +
  `normalizeHeader`), so column ORDER in the uploaded file does not matter — only
  header text must match.

## 7. Google Sheets → Firestore sync (Apps Script)

- Master sheet: one tab per person (except `_Config`). Each tab → a
  `trackingTabs/{tabId}` Firestore doc; its rows → `trackingTabs/{tabId}/rows/*`.
- **Reads by POSITION**: each tab's columns must match `HEADERS` order exactly.
  Hiding rows/columns or filtering is SAFE (getValues reads hidden cells too);
  moving/deleting/inserting columns or renaming headers BREAKS it.
- Triggers (`setupTriggers`): `onEditInstallable` (instant, per-edited-row) +
  `fullResync` **every 6 hours** (safety net + prunes deleted rows).
- A row **hash** stored in a hidden sheet cell means unchanged rows write nothing
  to Firestore → an idle resync stays well within the free (Spark) quota.
- Header row uses **warning-only** protection so the team can still filter/sort.
- **IMPORTANT:** this `.gs` runs inside the Google Sheet, NOT on Vercel. Editing
  `Code.gs` in the repo does NOT deploy it — the owner must paste it into the
  sheet's Apps Script editor and (for trigger/protection changes) re-run the
  relevant setup function. Keep the repo copy as the source of truth.

## 8. Firestore data shapes (quick reference)

- `trackingTabs/{tabId}` `{ name, order }`, subcollection `rows/{rowId}` (PR/PA/PO fields).
- `meta/companyUpdates` `{ updates: { [companyCode]: "YYYY-MM-DD" } }` (stamped on import).
- `allowedUsers/{email}` `{ email, role, addedBy, addedAt }` — the access allowlist (closed system, see docs/SECURITY.md).
- Item/vendor aggregates + project docs written by the import + project flows.

## 9. Working conventions (how changes ship here)

This repo runs under a standing instruction: **every change is committed, pushed,
PR'd, and squash-merged into `main` automatically** (no confirmation needed),
because the live Vercel site reflects `main` only.

Per change:
1. Make the edit (UI/layout changes must NOT alter data/content unless asked).
2. `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit && npm run build` — must pass.
3. **Verify visually when it's a UI change** — the sandbox can't reach Firebase,
   so temporarily bypass the auth gate in `App.tsx` (set logged-in true) + inject
   mock data locally, screenshot with Playwright (Chromium at
   `/opt/pw-browsers/chromium`), then REVERT the temporary bypass/mocks before committing.
4. Commit → `git fetch origin main && git merge origin/main` (resolve conflicts;
   working branch is usually the intended state) → push → open PR → squash-merge.
5. Communicate with the user in **Thai**.

## 10. Gotchas

- Bundle is large (~1.6 MB / gzip ~490 KB); build warns about chunk size. Consider
  lazy-loading pages (code-splitting) if load time matters.
- The sandbox has NO Firebase network access — pages load empty; use mock data to verify.
- Always grep for leftover `<<<<<<<`/`>>>>>>>` conflict markers after a merge.

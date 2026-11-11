# Cineverse — Portfolio Demo Guide

Prepare a **local 2–3 minute** walkthrough for a Frontend or Junior Full-stack portfolio. This guide does not deploy the app, create a public test account, or enable a production database policy.

The UI is Vietnamese; English narration/captions can explain it to recruiters. Record the real application. Do not replace API responses, change UI content in DevTools, or present synthetic browser-test captures as live TMDB/account behavior.

## 1. Prepare the local environment

1. Follow [Getting Started](../README.md#getting-started): install root/frontend dependencies, generate Prisma Client, and preserve existing private backend configuration.
2. Verify real movie data loads with your privately configured TMDB token. Keep the token and API settings page out of the recording.
3. Account features need the dedicated local `cineverse_dev` database and the project's guarded migration flow. Do not use Neon, production settings, another person's account, or another database for this demo. Review the target and existing objects before any migration.
4. Run `npm run dev` (`npm.cmd run dev` on Windows) from the root. Use Vite's printed URL, normally `http://localhost:5173`. Authentication origins must match the actual frontend origin.
5. Rehearse the exact route/data once, then record with the existing design unchanged.

No live TMDB, email delivery, or real-account walkthrough was performed while writing this guide. Verify these prerequisites on the recording machine before filming.

## 2. Prepare a dedicated test account

Use the application's real **Register / Đăng ký** page. There is no automatic account seed or public demo password.

| Item | Safe preparation |
| --- | --- |
| Initial display name | `Cineverse Demo` |
| Edited display name | `Cinema Explorer` |
| Local-only email | A synthetic address such as `cineverse.demo@example.test` when Internet delivery is unnecessary |
| Password | A unique private password from a password manager; current policy is 12–128 Unicode characters. Never publish it. |
| Favorites | Save 2–3 actual movies through the UI, then remove one during filming. |
| Personal data | Use only the disposable account; never show another user's information. |

Register before filming and demonstrate Login during the clip. Use a recording-browser profile without personal autofill, stored passwords, extensions, or unrelated tabs. Do not distribute the test account's credentials to recruiters.

For an optional password-change clip, generate a second unique private password beforehand. A successful change revokes sessions and returns to Login. Finish other account captures first, then log in with the new password off-camera if needed. Do not reset the database or edit session rows to repeat a take.

### Optional recovery rehearsal

- Recovery needs an email transport. If disabled, demonstrate the honest unavailable state or omit the flow; do not claim a link was sent.
- A local Mailpit catcher with no forwarding/relay can exercise recovery without Internet delivery. Configure it privately using the [existing setup](phase-6.2e-auth-refinement.md). A synthetic `.test` address works with a catcher, not an Internet inbox.
- Real SMTP/Resend delivery needs an address you control and separately configured sending credentials. This documentation task configures neither.
- Exclude the inbox, email source, reset URL/fragment, and password fields from public footage. Cut to the reset form with the address bar out of frame. Never export the message, link, or network HAR.

Keep recovery out of the main clip unless it has been rehearsed successfully.

## 3. Choose demo movies and filters

The homepage loads the **first page** of popular, now-playing, and top-rated TMDB lists. These change over time.

1. Pick a movie actually present in the loaded catalog on recording day. Note its displayed/original title privately.
2. Search for part of that title, then change letter case. Clearing the input should restore results.
3. Choose a genre/year/minimum rating supported by the current data and confirm that at least one movie remains. Avoid a fixed combination that might return nothing on recording day.
4. An unmatched term such as `zzzz-no-demo-match` can demonstrate the empty state; clear it afterwards.
5. `/movies/27205` is a candidate direct-route example, but verify its actual TMDB response before filming. Its movie is not guaranteed to appear in the current homepage pages; do not promise a homepage search result for it.
6. Pick a detail page with artwork, credits, and a trailer. If metadata/trailer is absent, keep the real fallback or choose another movie. Do not substitute full-film playback.

Do not insert artificial movie records or alter ratings/counts for presentation. Preserve TMDB attribution and describe trailers as trailers.

## 4. Recording script: approximately 2 minutes 50 seconds

| Time | Actions | Suggested English narration |
| --- | --- | --- |
| 0:00–0:15 | Show Home, the editorial hero and a populated collection. | “Cineverse is a React and TypeScript movie discovery app with a Node.js API and PostgreSQL.” |
| 0:15–0:40 | Search a loaded title, combine valid filters, change sorting, then reset. Briefly show an empty result if time permits. | “Search and filters combine on the currently loaded TMDB catalog, with clear empty states and reset controls.” |
| 0:40–1:05 | Open a card; show its URL, metadata, director/cast and related movies. Optionally open the trailer. | “Dynamic detail routes use validated API data and handle missing images or metadata.” |
| 1:05–1:25 | Open Login, enter the prepared credentials privately with passwords masked, and sign in. | “Authentication uses server-side sessions and an HttpOnly cookie. Protected pages preserve the return destination.” |
| 1:25–1:50 | Save a movie, open Favorites, refresh to show persistence, and remove a saved item. | “Favorites are stored per user and synchronized between cards, details and the saved list.” |
| 1:50–2:15 | Open Profile, show synthetic-account statistics, edit the name, save, and point out the Header update. | “Profile updates are validated on the server and reflected without reloading the page.” |
| 2:15–2:35 | Switch to a prepared 375px mobile viewport; demonstrate the menu/grid and a visible keyboard focus state. | “The layout adapts to mobile widths and supports keyboard navigation.” |
| 2:35–2:50 | Return to a clean screen or repository view and close. | “The project includes unit, browser, accessibility and isolated PostgreSQL tests. This recording is local; cloud deployment is still pending.” |

Keep passwords masked. Pause or cut credential entry if the recorder exposes keystrokes/autofill. Never fake account state with test harness APIs or DevTools. Omit trailer playback if narration would push the clip over three minutes.

### Optional separate clips

- **Change password:** keep secrets hidden, submit, then show the successful return-to-login notice. This changes the disposable account.
- **Multi-tab:** log out in one of two tabs using the same test account and show revalidation in the other. A visual demo does not prove every race condition.
- **Recovery:** show only a real rehearsed local-catcher flow, keeping all reset URLs private.
- **Error/retry:** briefly use browser Offline, restore connectivity, and activate an existing Retry control where shown. Label it an offline demo, not a measured timeout or genuine TMDB outage.

## 5. Desktop and mobile recording

### Desktop

- Capture at 1440×900 or 1920×1080, 100% browser zoom, with text readable after scaling.
- Record a clean application window/tab rather than the full desktop. Close DevTools, terminals, password managers and cloud dashboards.
- Wait for loading to finish and move the pointer deliberately. Do not edit timings and present them as a performance measurement.
- Include TMDB attribution in a full-page screenshot or a brief footer shot.

### Mobile

- Use a 375px responsive browser viewport for the video; inspect 320, 375, 768, 1024 and 1440px before exporting captures.
- Label footage as **browser emulation**. It does not prove physical-device touch behavior, virtual-keyboard overlap, screen-reader support or device performance.
- Hide debugging/device overlays from exported images while preserving real app rendering.
- Check menu open/close, visible focus, poster proportions, form scrolling and unintended horizontal overflow.
- If physical-device footage is unavailable, say so. Do not expose the backend publicly or change its loopback binding solely to obtain a phone recording.

## 6. Screenshots

The [screenshot inventory](screenshots/README.md) lists the fourteen supplied Desktop/Mobile PNGs, their exact filenames, dimensions, before/after sizes and review notes. They are embedded in the root README and losslessly optimized. Preserve their filenames, dimensions, pixel content and color metadata; the guidance below applies to future replacement/additional captures.

For each capture:

1. Render the real app, using actual available movie data and the disposable account where applicable.
2. Wait for the intended state; avoid skeleton/error overlays unless that is the subject of the image.
3. Exclude personal browser details and notifications. Use synthetic profile data, not your normal email/account.
4. Export a real PNG. Cropping/redaction may hide private information; do not alter scores, counts, success messages or layout.
5. Inspect the final image and remove identifying metadata if the capture tool added any.
6. Embed it in README only after the file exists, with descriptive alt text and privacy review completed.

The gallery uses separate real captures, `cineverse-desktop-login.png` and `cineverse-desktop-register.png`. Do not fabricate a combined screen or rename these files to the older planned filenames.

## 7. Privacy and publication checklist

- [ ] Only synthetic/local account information is visible.
- [ ] No `.env`, key, database URL/password, bearer header, cookie, session/reset token/hash, recovery link or operator profile is exposed.
- [ ] No SQL Editor history, database inspector, mail inbox, clipboard history, terminal output, Network/Application panels or cloud dashboard is exposed.
- [ ] Password visibility stays off; keystroke overlays and password-manager popups are disabled.
- [ ] Personal tabs, bookmarks, paths, notifications and unrelated accounts are out of frame.
- [ ] Artwork retains TMDB attribution; no full-film playback is presented.
- [ ] Mobile emulation and local deployment status are labeled honestly.
- [ ] No disabled navigation or catalog-wide search is presented as a completed feature.
- [ ] The complete export is reviewed, including transitions, address bar and final frame.
- [ ] No database dump, email file, logs or browser-storage export is included in Git.

## 8. Add media to README after review

1. Export the video as MP4 and upload it manually to your chosen platform with the intended visibility. This task does not upload anything.
2. Test playback in a signed-out/private browser. Recruiters should not need your account; avoid expiring or credential-bearing URLs.
3. Replace **Recording pending** in the root README with a descriptive Markdown link to the real video. No invented URL is supplied here.
4. The fourteen existing PNGs are already linked in the README. For future captures, preserve approved filenames, check exact case and real file existence, and use meaningful alt text. See the inventory before replacing any image.
5. A local recording does not change project status to live or production-ready.
6. Recheck links, paths, diff and secrets before requesting a documentation commit. Exclude `.agents/`, `skills-lock.json`, unrelated drafts, caches and build output.

## 9. Verification record

- Source reviewed: router, components/pages, providers/services, Node server, Prisma schema/migrations, startup scripts, tests and CI workflow.
- Local checks on **2026-11-10**: **443 tests passed** (331 backend, 112 frontend); production build passed, including TypeScript.
- Documentation checks: 28 internal link/image-path/anchor references resolved; the existing TMDB logo and required notice were checked against the app and official TMDB guidance. No credential patterns were detected in the three changed documents.
- The GitHub Actions URL matches the verified repository origin, but the public page could not be fetched in this session. No current remote CI result is claimed.
- Browser/native suites were inspected but not rerun for this documentation-only update. Their synthetic fixtures are not portfolio screenshots or live-provider evidence.
- No public app URL, video or portfolio PNG was verified/published here. Live TMDB, real-account flows, email delivery and real-device footage still require rehearsal.
- No application logic, security guards, database, cloud configuration, real `.env` or unrelated draft was changed. No commit/push was performed.

### Screenshot follow-up — 2026-11-11

The fourteen supplied PNGs were decoded, inspected for corruption, duplicate hashes and visible credentials, and grouped in the README. Screenshot status is complete for this set; the preceding verification record describes the earlier 2026-11-10 documentation pass. Video recording is still pending. No fresh application/browser/native test result or public deployment is claimed.

### Lossless publication update — 2026-11-11

All fourteen PNGs were optimized without changing filenames, dimensions, decoded RGBA values or rendering metadata. Independent Windows decoder comparisons also matched every image. Total size decreased from 26,789,085 to 20,921,554 bytes (21.90%). See the inventory for per-file results and remaining size advisories. This documentation/image release does not change application logic, configuration or deployment status.

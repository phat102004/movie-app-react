# Cineverse Screenshot Inventory

Fourteen supplied application screenshots are included in the [root README gallery](../../README.md#screenshots). Lossless PNG optimization preserves filenames, capitalization, original resolutions, pixel content, and color/physical-resolution metadata. Encoded file bytes are smaller. `Cineverse_Mobile_Favorites.png` intentionally retains its mixed-case name.

## Actual Files

Desktop/Mobile labels follow the supplied filenames and visible layouts. Dimensions below are **PNG pixels**, not verified CSS viewport sizes, device models, or evidence of physical-device testing.

| Exact filename | Layout | Dimensions (px) | Before (MiB) | After (MiB) | Saved | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| [cineverse-desktop-homepage.png](cineverse-desktop-homepage.png) | Desktop | 2880 × 1800 | 1.527 | 1.254 | 17.89% | Main preview: editorial hero, navigation and discovery controls. |
| [cineverse-mobile-homepage.png](cineverse-mobile-homepage.png) | Mobile / responsive | 2048 × 2576 | 1.997 | 1.376 | 31.13% | Responsive homepage, compact navigation and adaptive filters. |
| [cineverse-desktop-movie-explore.png](cineverse-desktop-movie-explore.png) | Desktop | 2880 × 1800 | 0.745 | 0.635 | 14.77% | Genre, year, rating and sort controls with a matching result. |
| [cineverse-desktop-movie-collections.png](cineverse-desktop-movie-collections.png) | Desktop | 1864 × 1796 | 2.801 | 2.352 | 16.01% | Popular and now-playing movie rows with expand controls. |
| [cineverse-desktop-movie-details.png](cineverse-desktop-movie-details.png) | Desktop | 2880 × 1800 | 0.732 | 0.619 | 15.41% | Poster, rating, genres, director, release metadata and favorite action. |
| [cineverse-desktop-cast-trailer.png](cineverse-desktop-cast-trailer.png) | Desktop | 2880 × 1800 | 2.603 | 2.114 | 18.78% | Top cast portraits and on-demand trailer controls. |
| [cineverse-desktop-recommendations.png](cineverse-desktop-recommendations.png) | Desktop | 2880 × 1800 | 3.290 | 2.729 | 17.05% | Related movie cards and footer attribution. |
| [cineverse-mobile-movie-details.png](cineverse-mobile-movie-details.png) | Mobile / responsive | 2004 × 1716 | 0.848 | 0.610 | 28.05% | Responsive movie information and production metadata. |
| [cineverse-desktop-login.png](cineverse-desktop-login.png) | Desktop | 2880 × 1532 | 0.118 | 0.102 | 13.92% | Empty login form beside the olive welcome panel. |
| [cineverse-desktop-register.png](cineverse-desktop-register.png) | Desktop | 2880 × 1530 | 0.113 | 0.096 | 14.96% | Empty registration form with matching editorial styling. |
| [cineverse-desktop-favorites.png](cineverse-desktop-favorites.png) | Desktop | 2880 × 1800 | 3.161 | 2.639 | 16.49% | Saved movies with selected favorite controls. |
| [Cineverse_Mobile_Favorites.png](Cineverse_Mobile_Favorites.png) | Mobile / responsive | 2004 × 1716 | 2.247 | 1.622 | 27.84% | Saved movie grid in the responsive layout. |
| [cineverse-mobile-movie-collections.png](cineverse-mobile-movie-collections.png) | Mobile / responsive | 2048 × 2576 | 4.513 | 3.251 | 27.95% | Responsive popular and now-playing collection grids. |
| [cineverse-mobile-navigation.png](cineverse-mobile-navigation.png) | Mobile / responsive | 1504 × 1288 | 0.853 | 0.552 | 35.25% | Expanded navigation disclosure with search and menu links. |

## Image Validation — 2026-11-11

- **14/14 decoded successfully** using the Windows image decoder, including a complete pixel read. PNG signatures, chunk boundaries, CRCs, and IEND markers passed inspection.
- **No exact duplicates:** file SHA-256 hashes and decoded-pixel hashes are all distinct. Similar desktop/responsive views are intentional comparisons, not duplicate files.
- All fourteen originals were visually reviewed for caption accuracy and exposed credentials. No passwords, API keys, session/reset tokens, private connection strings, personal email addresses, or cloud dashboards were observed. Some captures display the account name; it remains visible for the owner's publication review.
- No PNG text/EXIF metadata chunks (`tEXt`, `iTXt`, `zTXt`, `eXIf`) were found. This is not a forensic guarantee that all possible information is absent from image pixels.
- Login/Register captures have empty fields. TMDB attribution is visible in the supplied authentication/recommendations captures and remains in the root README.
- Every gallery image uses a real file and preserves exact filename case for GitHub/Linux compatibility. No profile screenshot is present; none is invented or implied by this inventory.

## Lossless Optimization — 2026-11-11

| Metric | Before | After |
| --- | --- | --- |
| Total PNG bytes | 26,789,085 | 20,921,554 |
| Total size | 25.55 MiB | 19.95 MiB |
| Largest file | 4.513 MiB | 3.251 MiB |
| Files above the 2 MiB review threshold | 6 | 5 |

**Saved: 5,867,531 bytes (21.90%). All 14 files qualified for replacement.** The retention rule was to keep the original if the best lossless candidate saved less than 5%; no file needed that fallback. Per-file savings range from 13.92% to 35.25%.

An offline temporary Node.js v22.23.4 / zlib 1.3.1-e00f703 helper tried PNG row filters and high-compression DEFLATE strategies. Every alpha sample in these images was fully opaque, so the redundant alpha channel could be represented implicitly without changing any reconstructed RGBA value. No palette quantization, resolution change, crop, color-depth reduction, color adjustment, metadata stripping or content edit was used. Existing color/physical-resolution chunks were preserved byte-for-byte. The allowed opaque-alpha representation and lossless row filtering are defined in the [W3C PNG specification](https://www.w3.org/TR/png-3/).

Each candidate passed PNG structure/CRC validation and exact decoded-RGBA equality against its original. An independent Windows decoder then read every pixel of both versions and confirmed equal dimensions and pixel hashes for all fourteen images. Only validated candidates were copied into the repository, then checked against their candidate file hashes. Filenames and gallery paths did not change. Backups, candidate files and temporary helpers remain outside the repository and are excluded from this release; no dependency or application source file was added.

Five optimized files still exceed the **2 MiB advisory budget**:

- `cineverse-desktop-cast-trailer.png` — 2.114 MiB.
- `cineverse-desktop-favorites.png` — 2.639 MiB.
- `cineverse-desktop-movie-collections.png` — 2.352 MiB.
- `cineverse-desktop-recommendations.png` — 2.729 MiB.
- `cineverse-mobile-movie-collections.png` — 3.251 MiB.

The budget is a review aid, not a claimed GitHub limit. The gallery remains relatively heavy on a slow connection; two-column display does not itself reduce downloaded bytes. These are lossless originals at their original resolution. No JPEG/WebP conversion or additional lossy reduction was applied.

## Portfolio Commit Scope

The authorized release allowlist is **17 files**: the root `README.md`, this inventory, `docs/portfolio-demo-guide.md`, and the fourteen PNG files listed above. The demo guide is included because the README links to it. Stage these explicit paths only, never the whole working tree.

Exclude `.agents/`, `skills-lock.json`, Neon provisioning/contract drafts, real environment files, credentials, logs, caches and build output. Screenshot checks do not establish a live deployment, completed video demo, WCAG certification, or fresh application regression result. Application tests were not rerun for this image/documentation-only update.

See the [demo guide](../portfolio-demo-guide.md) for recording preparation. The video is still pending; existing architecture, testing history and deployment limitations are retained.

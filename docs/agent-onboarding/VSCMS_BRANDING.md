# VSCMS branding

Updated locally on 2026-09-16 at the user's request. Production deployment is not included.

## Assets and visible names

The source icon is https://vshowcards.com/assets/images/favicon.ico. A local copy lives at `packages/twenty-front/public/images/vscms.ico`; PNG exports alongside it support app logos, Apple touch icons and the web app manifest. Preserve the source aspect ratio (146 x 117) rather than stretching it to a square.

The application name is **VSCMS**. Browser titles, metadata, manifest, default sign-in/onboarding logos, connection screens, MCP setup, API descriptions, assistant prompts and product copy use this name. Workspace names and customer records remain independent of the application brand.

Internal package names, imports, configuration keys, CLI commands and upstream legal/vendor documents retain their original names. Renaming those mechanically can break the application or misrepresent a legal agreement. Existing translated catalogs are not regenerated; new message IDs fall back to English pending translation.

Email template branding is updated but no emails were sent. Its logo references the supplied public ICO URL; compatibility across email clients is not verified. Before enabling outbound email, host the PNG export at a public HTTPS URL and use it in the email Logo component.

## Verification and future maintenance

- Frontend, backend and email TypeScript checks passed. The initial backend check reported missing email declarations; emitting them after the email build resolved it.
- Branding-related frontend tests cover page-title fallback, activity-author fallback and MCP setup links (14 tests).
- Scoped frontend/backend lint and email Vite build were run.
- Backend type checking requires email declarations after the email Vite build (which clears its output directory). Emit declarations with `tsgo -p packages/twenty-emails/tsconfig.lib.json --noEmit false --emitDeclarationOnly --outDir /workspace/packages/twenty-emails/dist --rootDir /workspace/packages/twenty-emails/src --composite false --incremental false`, then run `tsc-alias` for that output directory before checking the backend.
- Local Docker runs compiled backend files. Compile changed backend files and restart the development app to apply backend branding. Frontend assets are served by Vite.
- Check the browser favicon, sign-in logo and title after a hard refresh. Browsers can cache favicons separately from page assets.
- Runtime verified: favicon HTTP 200 (53,882 bytes), manifest names VSCMS, backend health HTTP 200, MCP server card title VSCMS CRM, and rendered Companies page title `All Companies - Companies | VSCMS`. Automatic sync remained paused with no active runs. Development cold startup took several minutes.

Do not treat this branding task as authorization to deploy, rename database entities, change account details or send emails.

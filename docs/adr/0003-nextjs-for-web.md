# ADR-0003: Next.js for the web console

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

`apps/web` is the operations console: dense tables of products, inventory, purchase orders and
orders with search, filters, sort and cursor pagination; multi-step forms (create PO, receive
partially, confirm order); a dashboard fed by analytics REST/GraphQL; and live updates over
Socket.IO (phase 8). Users are authenticated operators, so SEO is irrelevant, but first-load
speed, predictable caching and a clean auth story matter.

The browser talks only to the gateway origin (ADR-0007), so the web app must work behind the
same Nginx as the APIs with no CORS. The refresh token is an httpOnly `SameSite=Strict` cookie
scoped to the auth path (ROADMAP risk); the access token must never be persisted in
`localStorage`. Forms should validate with the same zod schemas the services use (ADR-0001).

## Decision

- **Next.js 16 App Router with React 19.** Server Components render the shell and initial list
  pages close to the data; Client Components handle interactive tables, forms and sockets.
  Route groups separate `(auth)` from `(console)`; layouts hold org switcher and navigation.
- **TanStack Query** for all client-side server state: query keys include `organizationId`
  so switching tenants can never show a cached page from the previous org; mutations invalidate
  precise keys (confirming an order invalidates `['orders', orgId]` and
  `['inventory', orgId]`); socket events call `queryClient.invalidateQueries` rather than
  maintaining a second client cache.
- **Tailwind CSS 4** with design tokens defined as CSS variables in `@theme`, plus a small
  in-house component set (`Button`, `Input`, `DataTable`, `Dialog`, `Badge`) built on
  accessible headless primitives.
- **zod + react-hook-form** using schemas from `packages/contracts`.

## Alternatives considered

- **Vite + React SPA.** Simpler mental model and no server runtime, but loses streaming server
  rendering, route-level code splitting conventions and server-side access-token handling; the
  console would ship an empty shell and a waterfall of fetches.
- **Remix / React Router framework mode.** Strong loader/action model; rejected mainly for
  ecosystem breadth and because the team's existing depth is in the App Router.
- **Redux Toolkit / RTK Query instead of TanStack Query.** Viable, but most state here is server
  state; a global client store adds ceremony without a problem to solve.
- **Bootstrap (evaluated, not adopted).** Considered for its ready-made tables, forms and
  modals. Rejected because its global Reboot stylesheet and Tailwind's Preflight both reset
  base elements and fight over margins, `box-sizing`, form controls and line-height; and its
  utility classes (`p-3`, `d-flex`, `text-center`, `border`, `rounded`) overlap or collide with
  Tailwind names but mean different things. Running both would create two competing
  design-token systems (Bootstrap Sass variables vs Tailwind `@theme` variables) and make every
  spacing or color change a two-place edit. Tailwind plus a handful of in-house components
  gives one token source and a smaller CSS payload.
- **Full component libraries (MUI, Ant Design).** Fast to start, but heavy runtime styling,
  hard-to-override theming and a look that fights the design tokens.

## Tradeoffs

- App Router caching and the server/client boundary are subtle; data that must be fresh per
  tenant is marked dynamic, and client code never assumes server-fetched data is live.
- In-house components cost time up front (accessibility, focus management) that a library
  would have provided.
- Next.js adds a Node runtime to deploy and scale, unlike a static SPA on S3.

## Consequences

**Positive**

- One design-token system; utility-first CSS keeps styles colocated and dead CSS purged.
- Forms and APIs share validation, so a client-accepted payload is server-accepted.
- Tenant-keyed query caching makes cross-org UI leakage structurally unlikely.

**Negative**

- Engineers must reason about Server vs Client Components and hydration.
- React 19 / Next 16 are recent; some third-party components lag.

## Failure, scaling, security and operational implications

- **Failure:** API errors surface through the shared error envelope with `requestId` shown to
  the user for support; TanStack Query retries only idempotent GETs.
- **Scaling:** the web app is stateless behind the gateway/CloudFront; static assets are
  immutable, hashed and CDN cached.
- **Security:** no tokens in web storage; strict CSP from the gateway; React escaping by default,
  `dangerouslySetInnerHTML` banned by lint.
- **Operational:** web is routed as the gateway's catch-all, so it deploys independently of APIs.

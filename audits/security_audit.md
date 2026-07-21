# Application Security Audit

Date: 2026-07-21  
Scope: Next.js 16 / React 19 application code, API routes, session handling, push notification flow, service worker, deployment workflow, configuration, and npm dependency tree.

## Executive summary

The application has **no critical findings**, **2 high-severity findings**, **4 medium-severity findings**, and **2 low-severity findings**.

The most important issue is that the application trusts a plaintext cookie as proof of user identity. A caller can choose another numeric user ID and access or modify that user's favorites and push-subscription state. This was verified safely at runtime: a request without a cookie redirected to `/login`, while a request with a fabricated `fest_user=1:...` cookie returned the authenticated home page.

The push-subscription flow also accepts an arbitrary endpoint and later makes a server-side HTTPS request to it. Combined with the weak identity boundary, this creates a practical server-side request forgery and denial-of-service path when the notification job processes a due performance.

### Authorization design assumption

The application intentionally has one user role and no administrator or role hierarchy. This audit does **not** flag that design. Findings concern whether one user can impersonate or alter another user's state. The current name-only entry flow is treated as potentially intentional; if user names are deliberately non-secret, shared pseudonyms with no privacy or ownership guarantees, that risk should be documented explicitly. It does not make trusting a caller-edited numeric user ID safe.

## Methodology and limitations

- Reviewed every request-facing route, authentication helper, database call, client network call, service-worker handler, application configuration file, and deployment workflow in the repository.
- Searched for injection sinks, dynamic code execution, unsafe redirects, client-side secret use, credential storage, CORS, caching, file access, subprocess execution, and server-side outbound requests.
- Ran `npm audit` against the complete and production-only dependency trees; both reported zero known vulnerabilities.
- Performed non-mutating local runtime checks for authentication enforcement, forged-cookie acceptance, security headers, and cross-origin request rejection.
- Infrastructure outside this repository—such as CDN/WAF rules, production response headers, TLS termination, database permissions, secret-manager configuration, and platform rate limits—was not available. Findings identify where such controls could change the result.

## High severity

### REF-SEC-001 — User identity is unauthenticated and the session cookie is forgeable

- **Rule ID:** NEXT-AUTH-001, NEXT-SESS-002
- **Severity:** High
- **Location:** `lib/auth.ts:10-29` (`getUser`, `sessionCookie`); `app/api/login/route.ts:19-36` (`POST`); `app/api/favorites/route.ts:5-29`; `app/api/push/subscribe/route.ts:5-35`
- **Evidence:**

  ```ts
  const id = Number(raw.slice(0, sep));
  const name = decodeURIComponent(raw.slice(sep + 1));
  return { id, name };
  ```

  ```ts
  value: `${user.id}:${encodeURIComponent(user.name)}`,
  ```

  The login route also issues a session for any existing account based only on a submitted name:

  ```ts
  SELECT id, name FROM users WHERE lower(name) = lower(${name})
  // ...
  res.cookies.set(sessionCookie(user));
  ```

  Safe runtime verification returned `307` for `/` without a cookie and `200` for `/` with a fabricated `fest_user=1:forged-audit-user` cookie. The server did not verify a signature, opaque session record, user existence, or possession of a credential.
- **Impact:** An unauthenticated caller can select another user ID, read that user's favorite list, add or remove favorites, register push endpoints against the user, or delete known endpoints. The impact is limited by the application's single-role feature set, but it fully breaks isolation between users.
- **Fix:** Replace the cookie payload with a cryptographically random, opaque session identifier stored server-side, or use an authenticated and expiring session library. If returning to an existing name must be supported, require proof of ownership such as a passkey, magic link, password, or separately issued recovery secret. Validate the session against a server-side user/session record on every protected route. Follow the current [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication), which recommends encrypted or server-stored sessions and secure cookie options.
- **Mitigation:** At minimum, sign the user ID and expiry using a dedicated server secret, reject invalid/expired signatures, and verify that the user still exists. This prevents direct cookie editing but does not solve the name-only account-claiming behavior.
- **False positive notes:** If all names and preferences are intentionally public, mutable shared pseudonyms rather than accounts, confidentiality and account ownership may be out of scope. In that case, remove “authentication” expectations from the product model and document that anyone can assume any name. Numeric cookie tampering should still be removed because it bypasses application-level invariants.

### REF-SEC-002 — Arbitrary push endpoints create an outbound request/SSRF primitive

- **Rule ID:** NEXT-SSRF-001, NEXT-INPUT-001, NEXT-DOS-001
- **Severity:** High
- **Location:** `app/api/push/subscribe/route.ts:9-21` (`POST`); `app/api/cron/notify/route.ts:21-33,39-62` (`GET` notification loop)
- **Evidence:** The subscription route only checks whether three fields are truthy, then stores the caller-controlled endpoint and keys:

  ```ts
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "Bad subscription" }, { status: 400 });
  }
  // ...
  VALUES (${user.id}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
  ```

  The cron route later passes that stored endpoint to `webpush.sendNotification(...)` without a destination check or timeout. The installed `web-push` implementation parses the endpoint hostname and sends an `https.request` to it.
- **Impact:** A user can cause the server to make an HTTPS POST to an attacker-selected public or internal hostname when a favorited performance becomes due. This can probe reachable services, send traffic from the application's trusted network position, and stall the sequential notification job because no request timeout is configured. REF-SEC-001 makes the endpoint accessible without a trustworthy user session.
- **Fix:** Strictly validate the complete subscription schema and length limits. Restrict endpoints to `https:` and to an explicit set of supported push-service origins where feasible. Otherwise, resolve and validate the destination at send time, blocking loopback, private, link-local, multicast, metadata, and other special-use IPv4/IPv6 ranges, including after DNS resolution. Pass a short timeout to `sendNotification`, limit redirects if the library supports them, and cap subscriptions per user. OWASP recommends allowlisting where possible and treating denylists as a last resort in its [SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
- **Mitigation:** Move notification delivery to a network-isolated worker with no access to internal services or cloud metadata, enforce outbound firewall rules, and process sends with bounded concurrency and per-request deadlines.
- **False positive notes:** Real Web Push endpoints are caller-supplied capability URLs, so arbitrary host support may be a functional requirement. That does not remove the need for protocol, IP-range, DNS, timeout, size, and quota controls. Exploitation of the scheduled path requires a due favorited performance, but the job runs every five minutes during festival week.

## Medium severity

### REF-SEC-003 — Cron authentication can fail open when its secret is missing

- **Rule ID:** NEXT-AUTH-001, NEXT-DOS-001
- **Severity:** Medium
- **Location:** `app/api/cron/notify/route.ts:13-17` (`GET`)
- **Evidence:**

  ```ts
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```

  If `CRON_SECRET` is absent while the other VAPID configuration is present, the literal header `Authorization: Bearer undefined` passes this check. Configuration is asserted rather than validated at startup.
- **Impact:** A deployment mistake can expose the notification job publicly, allowing repeated push sends/cleanup attempts and amplifying REF-SEC-002 and resource exhaustion. The route also performs state changes via `GET`, which is contrary to safe-method semantics.
- **Fix:** Validate all required server secrets during startup and fail deployment when any are absent or too weak. Reject before comparison unless the configured secret is a non-empty value. Use `POST` for the job trigger and compare fixed-length secret digests with a timing-safe function.
- **Mitigation:** Restrict the route at the hosting/edge layer to the automation source, rotate the cron secret periodically, and alert on repeated authentication failures or unexpected invocation rates.
- **False positive notes:** If the hosting platform guarantees a non-empty `CRON_SECRET` and independently authenticates the route, the fail-open branch is unreachable in production. That guarantee is not visible in this repository.

### REF-SEC-004 — Cookie-authenticated state-changing routes lack explicit CSRF/origin enforcement

- **Rule ID:** NEXT-CSRF-001, REACT-CSRF-001
- **Severity:** Medium
- **Location:** `app/api/login/route.ts:7-36`; `app/api/logout/route.ts:4-7`; `app/api/favorites/route.ts:5-30`; `app/api/push/subscribe/route.ts:5-36`; client calls in `components/LoginForm.tsx:18-22`, `components/Timetable.tsx:66-70,83-85`, and `components/PushToggle.tsx:40-65`
- **Evidence:** None of the handlers validates `Origin`, `Referer`, Fetch Metadata, a CSRF token, or an application-specific custom header. They also parse JSON without requiring `Content-Type: application/json`. A safe runtime request with `Origin: https://attacker.example`, `Content-Type: text/plain`, a fabricated cookie, and invalid data reached handler validation and returned `400` rather than being rejected as cross-origin.
- **Impact:** `SameSite=Lax` blocks many conventional cross-site POSTs, but it is the only visible CSRF control. Same-site hostile subdomains, legacy clients, deployment changes, and login/logout CSRF remain residual risks. Successful attacks can alter favorites or push-subscription state under the victim's session.
- **Fix:** Centrally reject state-changing requests whose `Origin` does not exactly match the configured application origin. Optionally enforce `Sec-Fetch-Site: same-origin` with Origin/Referer fallback and add a CSRF token or required custom header. Require the expected JSON content type. OWASP documents these layered controls and the limits of SameSite-only protection in its [CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- **Mitigation:** Keep cookies host-only and `SameSite=Lax` or `Strict`; avoid hosting untrusted applications on sibling subdomains.
- **False positive notes:** SameSite alone can be reasonable only under narrow conditions, including full control of all same-site hosts and explicit Origin/Referer verification. Those deployment conditions are not documented here.

### REF-SEC-005 — Session cookie lacks the production `Secure` attribute and has a long lifetime

- **Rule ID:** NEXT-SESS-001, NEXT-SESS-002
- **Severity:** Medium
- **Location:** `lib/auth.ts:22-30` (`sessionCookie`)
- **Evidence:** The cookie is `HttpOnly`, `SameSite=Lax`, host-only, and path-scoped correctly, but it has no `secure` option and lasts 90 days:

  ```ts
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
  ```
- **Impact:** If the origin is ever reachable over plaintext HTTP, the browser can transmit the session cookie without TLS. A captured cookie remains usable for up to 90 days and there is no server-side revocation or rotation. REF-SEC-001 currently makes theft unnecessary, but this remains important after session integrity is fixed.
- **Fix:** Set `secure: true` in production, or use an explicit environment-controlled secure-cookie setting for HTTP-only local development. Prefer a `__Host-` cookie name, shorten the lifetime, rotate sessions at login, and support server-side revocation. Next.js documents `Secure`, `HttpOnly`, `SameSite`, expiry, and path as recommended [session cookie options](https://nextjs.org/docs/app/guides/authentication).
- **Mitigation:** Enforce HTTPS at the hosting layer and ensure no HTTP origin serves the application. Do not enable HSTS without a separate deployment review.
- **False positive notes:** A platform may redirect all HTTP traffic before application handling, but a cookie without `Secure` can still be included in the initial plaintext request before a redirect.

### REF-SEC-006 — Abuse-prone endpoints have no visible rate limits, quotas, or complete size validation

- **Rule ID:** NEXT-DOS-001, NEXT-INPUT-001
- **Severity:** Medium
- **Location:** `app/api/login/route.ts:7-32`; `app/api/favorites/route.ts:5-29`; `app/api/push/subscribe/route.ts:5-35`; `app/api/cron/notify/route.ts:39-82`
- **Evidence:** Login can create database rows without throttling; push endpoints, keys, and request-body size have no type or length bounds; there is no per-user subscription quota; the cron job sends sequentially across all due rows. No application or deployment rate-limit configuration is present in the repository.
- **Impact:** Attackers can consume database storage, create large notification workloads, increase outbound traffic, and delay or stall the cron process. Weak identity controls make per-user limits ineffective until REF-SEC-001 is fixed.
- **Fix:** Add edge and application-level rate limits for login/account creation, favorite changes, subscription changes, and cron invocation. Apply strict JSON schemas and byte/character limits, cap subscriptions per verified user, and process the cron job with bounded concurrency and timeouts.
- **Mitigation:** Add database column limits and uniqueness constraints, statement timeouts, outbound request limits, and monitoring for unusual account/subscription growth.
- **False positive notes:** Platform-level throttling or database constraints may already exist but are not visible in the repository. Verify them before closing this finding.

## Low severity

### REF-SEC-007 — Baseline browser security headers are not configured in the application

- **Rule ID:** NEXT-HEADERS-001, NEXT-CSP-001, REACT-HEADERS-001
- **Severity:** Low
- **Location:** `next.config.ts:1-5`; runtime response for `/login`
- **Evidence:** `next.config.ts` is empty. A local runtime response included `X-Powered-By: Next.js` but did not include a Content Security Policy, `X-Content-Type-Options`, clickjacking protection, `Referrer-Policy`, or `Permissions-Policy`.
- **Impact:** The browser lacks defense-in-depth against future XSS, framing/clickjacking, MIME confusion, and unnecessary capability access. No current untrusted HTML sink was found, which limits immediate exploitability.
- **Fix:** Configure global headers in `next.config.ts` or at the edge: a tested CSP, `X-Content-Type-Options: nosniff`, CSP `frame-ancestors` (and optionally `X-Frame-Options` for legacy coverage), `Referrer-Policy`, and a minimal `Permissions-Policy`. Disable the powered-by header. Next.js supports central response headers through its [`headers` configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).
- **Mitigation:** Set and verify equivalent headers at the CDN/hosting layer, including error and API responses.
- **False positive notes:** Production infrastructure may already add these headers. The local runtime check cannot verify edge/CDN behavior; confirm the deployed response before remediation.

### REF-SEC-008 — Only one environment-file variant is ignored

- **Rule ID:** NEXT-SECRETS-001
- **Severity:** Low
- **Location:** `.gitignore:1-5`
- **Evidence:** `.gitignore` excludes `.env.local` but not `.env`, `.env.development`, `.env.production`, `.env.*.local`, or similarly named secret files. No tracked environment file or secret-bearing key file was found in the current tree or matching Git history paths.
- **Impact:** A developer may accidentally commit credentials using another standard Next.js environment filename in the future.
- **Fix:** Ignore `.env*` broadly, with an explicit exception such as `!.env.example` for a value-free template. Keep real values in the deployment secret manager.
- **Mitigation:** Add secret scanning and protected push checks in CI and the Git host.
- **False positive notes:** Team policy may prohibit all other environment filenames, but that policy is not documented or mechanically enforced here.

## Positive controls observed

- SQL statements use Neon's tagged template API with parameter interpolation; no string-built SQL injection path was found.
- No `dangerouslySetInnerHTML`, direct DOM HTML injection, dynamic code execution, subprocess execution, filesystem access, untrusted redirect, permissive CORS, or client-side token storage was found.
- User-specific pages are dynamically rendered, and protected pages call `getUser()` before reading user favorites.
- React's normal escaping is used for names, biographies, search text, and schedule data.
- The service worker does not cache authenticated pages or API responses; the application-generated notification URL is currently fixed to `/`.
- Server secrets are referenced from environment variables. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is appropriately public; the VAPID private key, database URL, and cron secret are not referenced by client components.
- `.env.local` is ignored, and no tracked environment or key file was found.
- The npm lockfile is present. Full and production-only `npm audit` checks reported zero known vulnerable packages on the audit date.

## Recommended remediation order

1. Replace the forgeable/name-only identity boundary with an explicit pseudonymous-session or authenticated-account design (REF-SEC-001).
2. Restrict, validate, time-bound, and isolate Web Push destinations (REF-SEC-002).
3. Make cron configuration fail closed and change the trigger to authenticated `POST` (REF-SEC-003).
4. Add centralized CSRF/origin enforcement and harden the session cookie (REF-SEC-004 and REF-SEC-005).
5. Add schemas, quotas, rate limits, and bounded notification processing (REF-SEC-006).
6. Add response headers and broader secret-file protections (REF-SEC-007 and REF-SEC-008).


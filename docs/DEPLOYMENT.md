# Deployment

The app is a folder of static files (`react-client/build`): HTML, JavaScript, the WebAssembly
scanner and the venue data. Anything that serves static files over **https** can host it. https is
required: browsers only give camera and motion-sensor access to secure pages.

## Build

```bash
cd react-client
npm ci
npm test
npm run build
```

Build settings (environment variables):

| Variable | Meaning | Default |
|---|---|---|
| `PUBLIC_URL` | Path the app is served from, e.g. `/navigator` | `/` (root of the domain) |
| `VITE_OPERATOR_NAME` | Company named on the privacy page as operating the service | none: page says "demonstration" |
| `VITE_OPERATOR_CONTACT` | Email shown for privacy questions | none |

Requires Node 22. The toolchain is Vite, React 18 and Vitest; `npm audit` reports no findings in
runtime dependencies (the remaining ones are in the lint tooling, which is not shipped).

## Hosting in the EU on your own domain

For a customer in Italy the site should be served from an EU location, under a domain you or the
customer control, and without third-party requests. `deploy/` contains a container image that does
this:

```bash
docker build -f deploy/Dockerfile -t indoor-navigation \
  --build-arg VITE_OPERATOR_NAME="Your company S.r.l." \
  --build-arg VITE_OPERATOR_CONTACT="privacy@example.com" .
docker run -p 8080:8080 indoor-navigation
```

Run the image on any container service in an EU region and put your domain with a TLS certificate
in front of it. Italian and EU providers that work for this include Aruba Cloud, Seeweb, OVHcloud,
Scaleway and Hetzner; the EU regions of the large clouds work as well. Without containers, upload
`react-client/build` to any web server and copy the rules from `deploy/nginx.conf`.

What `deploy/nginx.conf` sets up, and why:

- **Single-page fallback:** paths such as `/qrScanner/3` or `/privacy` open the app.
- **No access log.** The privacy notice says nothing is kept about visitors. Turn logging on only as
  agreed with the data protection officer, and update the notice.
- **Content-Security-Policy:** scripts and data only from the site itself. Images are also allowed
  from other https hosts so a venue can show product photos; restrict this to your own image host.
- **Permissions-Policy:** camera and motion sensors for this site only; microphone and geolocation
  off.
- **Caching:** build files and published venue versions are cached forever; `index.html` and
  `venues/index.json` are always revalidated, so new releases and new data arrive at once.

The browser tests (`npm run test:e2e`) serve the build with the same security headers, read from
`deploy/nginx.conf`, so a policy that would block the app fails the tests. The container image and
the nginx configuration themselves have not been run in this repository's test environment: build
and smoke-test the image before pointing a domain at it.

## Before going live for a customer

- [ ] Domain and certificate under the operator's control; hosting region in the EU
- [ ] `VITE_OPERATOR_NAME` and `VITE_OPERATOR_CONTACT` set; privacy page reviewed by the operator's
      data protection officer (the text in the app describes what the code does, it is not legal
      advice)
- [ ] The demonstration venues removed from `venues-src/` (the Carrefour demo loads product photos
      from a third party)
- [ ] Product images served from the operator's own host; image rule in the policy tightened
- [ ] Markers generated with the production address
      (`node scripts/generate-markers.js --venue <retailer>/<store> --base https://your.domain`)
- [ ] Tested on real iPhones and Android phones in the store

## The public demo

The demo is still published to GitHub Pages by `.github/workflows/deploy-pages.yml` on every push to
the default branch. GitHub Pages is hosted outside the EU and is fine for a demonstration, not for a
customer installation. `vercel.json` remains for deploying the demo to Vercel.

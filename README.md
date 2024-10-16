# Nostr Notification Feed

A script for Cloudflare Worker to make ATOM feed for Nostr notifications.

Deployed at [nosfeed.n-mado.workers.dev](https://nosfeed.n-mado.workers.dev).

## Usage

Subscribe to `https://nosfeed.n-mado.workers.dev/npub1xxxxxxxxxxxxxx` for `npub1xxxxxxxxxxxxxx`'s notification.

## Deploy

1. Install denoflare of master branch, if you haven't already.
   ```
   deno install --unstable-worker-options --allow-read --allow-net --allow-env --allow-run --name denoflare --force https://raw.githubusercontent.com/skymethod/denoflare/refs/heads/master/cli/cli.ts
   ```
2. ```
   mv .denoflare-example .denoflare
   ```
3. Fill in the `accountId` and `apiToken` in `.denoflare`.
4. Deploy.
   ```
   denoflare push nosfeed --bundle backend=esbuild
   ```

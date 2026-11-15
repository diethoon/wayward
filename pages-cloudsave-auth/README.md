# Wayward CloudSave — GitHub Pages file:// auth source

This directory contains the static-only PC file:// authentication page source intended for:

- Repository: jeiky224/jeiky224.github.io
- Target directory: cloud/
- Public page: https://jeiky224.github.io/cloud/file-auth.html

## Files

Copy these files without renaming:

- file-auth.html → cloud/file-auth.html
- file-auth.js → cloud/file-auth.js
- file-auth.css → cloud/file-auth.css

The destination already has cloud/config.js; preserve it. The page reads its public OAuth Web Client ID from window.WAYWARD_GOOGLE_CLIENT_ID. No client secret is used or included.

## Runtime protocol

1. The game opens the fixed HTTPS URL synchronously from the user's CloudSave click.
2. The game transfers one fresh MessageChannel port to that exact Pages origin.
3. The page accepts only one initialization message from its actual opener WindowProxy, with a single transferred port, the wayward-cloudsave app id, and 48-hex nonce/request/attempt values. It also requires an opaque sender origin as a file-context classification; that value is not treated as caller identity.
4. The page mints a separate 48-hex session id and returns it over the private port.
5. The user confirms that they initiated this request from Wayward and manually clicks the Google connect button. GIS state is a fresh random value and must exactly match the callback. The drive.appdata scope is verified.
6. The access token is sent only over the transferred MessagePort. The page waits for the game's result acknowledgement, sends an acknowledgement-received message, then clears the session and closes.

The file origin is opaque and shared by unrelated local files. Neither Origin: null nor the app id can prove that the local file is an unmodified Wayward build. The UI discloses this and asks the user to verify that they initiated the request. The MessageChannel binds the result to the exact opener window and one-time request/session; it does not provide code signing.

## Security constraints

- No external auth relay, backend, Worker, local listener, PC Launcher, or Remote Host dependency.
- No token or nonce in the page URL, query, fragment, localStorage, sessionStorage, or logs.
- No postMessage('*'); the game sends the transferred port only to the exact Pages HTTPS origin.
- The file page never sends tokens through window.opener.postMessage; it uses the transferred port only.
- Duplicate initialization, unexpected message shape, mismatched app id/nonce/request/attempt/session, bad GIS state/scope, stale/closed sessions and acknowledgement timeout fail closed.
- The HTTPS game's existing direct GIS adapter is unchanged.

## Deployment and verification

The Pages deployment workflow in jeiky224/jeiky224.github.io currently deploys the repository root from main. Copy the three files above into its cloud/ directory and let that existing Pages workflow deploy them. Preserve cloud/auth.html, cloud/auth.js, cloud/auth.css, cloud/config.js and cloud/drive.js.

The source branch test suite checks the static protocol contracts and the game's MessageChannel handshake. It does not replace a real-browser run against the deployed Pages URL, a real Google account consent, or a real Drive save/list/load/delete run.

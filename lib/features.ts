/**
 * Live frames load a running site inside the board. In a browser, most sites refuse to be framed
 * (X-Frame-Options / frame-ancestors), so they stay off until the desktop app, which can show any site.
 * The code paths are kept; flip this to bring them back.
 */
export const LIVE_FRAMES = false

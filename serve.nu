# ghostty-web-nu: server-rendered terminal projection.
#
# The browser is not a VT emulator. It renders an HTML cell grid whose
# state is held server-side by wezterm-term (in http-nu's pty subsystem).
# Keystrokes POST to /pty/input; the server advances the terminal and the
# new screen is morphed into the client via Datastar SSE patches.
#
# Run:
#   http-nu :5002 ~/ghostty-web-nu/serve.nu --watch
#
# Override the spawned program with GHOSTTY_WEB_NU_CMD, e.g.
#   GHOSTTY_WEB_NU_CMD=bash http-nu :5002 ~/ghostty-web-nu/serve.nu

const STATIC = (path self | path dirname | path join "www")

{|req|
  let cmd = $env.GHOSTTY_WEB_NU_CMD? | default "nu"
  let body = $in

  match [$req.method, $req.path] {
    [POST, "/pty/create"] => {
      let cfg = $body | from json
      let sid = if $cmd == "nu" {
        pty open --embedded --cols ($cfg.cols? | default 80) --rows ($cfg.rows? | default 24)
      } else {
        pty open $cmd --cols ($cfg.cols? | default 80) --rows ($cfg.rows? | default 24)
      }
      {sid: $sid}
    }

    # Belt-and-braces: http-nu's Rust fast-path handles POST /pty/input
    # before the closure ever runs. This arm only matches if the fast-path
    # is disabled or bypassed; leaving it here keeps `serve.nu` self-
    # describing.
    [POST, "/pty/input"] => {
      $body | pty write $req.query.sid
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [POST, "/pty/resize"] => {
      let cfg = $body | from json
      pty resize $req.query.sid $cfg.cols $cfg.rows
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [GET, "/pty/view"] => {
      pty view $req.query.sid
      | metadata set --content-type "text/event-stream"
    }

    [POST, "/pty/close"] => {
      pty close $req.query.sid
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [GET, "/favicon.ico"] => {
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    _ => {
      let path = if $req.path == "/" { "/index.html" } else { $req.path }
      .static $STATIC $path
    }
  }
}

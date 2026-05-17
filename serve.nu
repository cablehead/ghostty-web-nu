# ghostty-web-nu: ghostty-web frontend wired to http-nu's `pty` commands.
#
# Run:
#   http-nu :3001 ~/ghostty-web-nu/serve.nu
#
# Override the spawned program with GHOSTTY_WEB_NU_CMD, e.g.
#   GHOSTTY_WEB_NU_CMD=claude http-nu :3001 ~/ghostty-web-nu/serve.nu

const STATIC = (path self | path dirname | path join "www")

{|req|
  let cmd = $env.GHOSTTY_WEB_NU_CMD? | default "nu"
  let body = $in

  match [$req.method, $req.path] {
    [POST, "/pty/create"] => {
      let cfg = $body | from json
      let sid = pty open $cmd --cols ($cfg.cols? | default 80) --rows ($cfg.rows? | default 24)
      {sid: $sid}
    }

    [POST, "/pty/input"] => {
      $body | pty write $req.query.sid
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [POST, "/pty/resize"] => {
      let cfg = $body | from json
      pty resize $req.query.sid $cfg.cols $cfg.rows
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [GET, "/pty/stream"] => {
      pty stream $req.query.sid --sse
      | metadata set --content-type "text/event-stream"
    }

    _ => {
      let path = if $req.path == "/" { "/index.html" } else { $req.path }
      .static $STATIC $path
    }
  }
}

# ghostty-web-nu sessions: 2-pane multi-pty UI.
#
# Run:
#   http-nu :5003 ~/ghostty-web-nu/serve-sessions.nu
#
# Override the spawned program with GHOSTTY_WEB_NU_CMD (default "nu" embedded).
#
# Endpoints are identical to the single-pane serve.nu; the difference is
# entirely in the static HTML (www/sessions.html) which manages many live
# ghostty-web instances at once.

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
      {sid: $sid, cmd: $cmd}
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

    [POST, "/pty/delete"] => {
      pty close $req.query.sid
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    _ => {
      let path = if $req.path == "/" { "/sessions.html" } else { $req.path }
      .static $STATIC $path
    }
  }
}

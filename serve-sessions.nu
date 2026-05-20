# ghostty-web-nu sessions: server-projected 2-pane UI.
#
# Run:
#   http-nu :5003 ~/ghostty-web-nu/serve-sessions.nu
#
# Endpoints:
#   GET  /                  -> static sessions.html shell
#   GET  /sse?connId=...    -> projected UX state stream (datastar patches)
#   POST /nav               -> publish selected sid on nav.events bus topic
#   POST /pty/create        -> mint a new pty + return sid
#   POST /pty/close?sid=... -> destroy pty
#   POST /pty/input?sid=... -> raw input bytes to pty stdin
#   POST /pty/resize?sid=...-> resize pty (cols, rows in JSON body)
#   GET  /pty/stream?sid=...-> base64 SSE of pty output bytes

use http-nu/datastar *

const STATIC = (path self | path dirname | path join "www")

# Render the left-pane session list as plain HTML. Returns a string suitable
# for `to datastar-patch-elements`.
def render-list [ptys: list, selected: string]: nothing -> string {
  let items = $ptys | each {|p|
    let label = $p.meta.label? | default $"nu ($p.cols)x($p.rows)"
    let cls = if $p.sid == $selected { "selected" } else { "" }
    # @post('/nav') sends all $signals as JSON. We set $sid (the target)
    # before posting so the server knows which session to select.
    let onclick = $"$sid = '($p.sid)'; @post\('/nav'\)"
    $"<li class='($cls)'><button type='button' data-on-click=\"($onclick)\">($label)<small>($p.sid | str substring 0..8)</small></button></li>"
  } | str join ""
  $"<aside id='sessions-list'><header>Sessions</header><ul>($items)</ul></aside>"
}

{|req|
  let body = $in
  match [$req.method, $req.path] {

    [GET, "/"] => {
      .static $STATIC "/sessions.html"
    }

    [GET, "/sse"] => {
      let conn_id = $req.query.connId? | default (random uuid)

      # Bootstrap: pick first pty as selected; if none, spawn one.
      let bootstrap = (pty list)
      let initial_sid = if ($bootstrap | is-empty) {
        pty open --embedded
      } else {
        $bootstrap | first | get sid
      }

      # Build a single stream: a synthetic init event first, then bus events
      # tagged by kind. (Using `prepend` rather than `append` so we don't
      # block on the bus before yielding the init -- append's input side is
      # eagerly drained by `interleave`'s schedulers, which would never
      # yield until something hits the bus.)
      (interleave
        { .bus sub "pty.events" | each {|e| {kind: "pty", val: $e.value}} }
        { .bus sub "nav.events"
            | where {|e| ($e.value.connId? | default "") == $conn_id}
            | each {|e| {kind: "nav", val: $e.value}} })
      | prepend {kind: "init", val: {}}
      | generate {|ev, state|
          let new_sel = if $ev.kind == "nav" { $ev.val.sid } else { $state.sel }
          let list_patch = (render-list (pty list) $new_sel
            | to datastar-patch-elements --selector "#sessions-list")
          let need_signal = ($ev.kind == "init") or ($new_sel != $state.sel)
          let signal_patch = if $need_signal {
            ({selectedSid: $new_sel, connId: $conn_id} | to datastar-patch-signals)
          } else { null }
          let out = if $signal_patch == null { [$list_patch] } else { [$signal_patch, $list_patch] }
          {out: $out, next: {sel: $new_sel}}
        } {sel: $initial_sid}
      | flatten
      | to sse
      | metadata set --content-type "text/event-stream"
    }

    [POST, "/nav"] => {
      let signals = $body | from datastar-signals $req
      {
        connId: ($signals.connId? | default "")
        sid: ($signals.sid? | default "")
      } | .bus pub "nav.events"
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [POST, "/pty/create"] => {
      let cfg = $body | from json
      let cmd = $env.GHOSTTY_WEB_NU_CMD? | default "nu"
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

    [POST, "/pty/close"] => {
      pty close $req.query.sid
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    _ => {
      let path = if $req.path == "/" { "/sessions.html" } else { $req.path }
      .static $STATIC $path
    }
  }
}

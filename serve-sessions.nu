# ghostty-web-nu sessions: server-projected 2-pane UI.
#
# Run:
#   http-nu --datastar :5003 ~/ghostty-web-nu/serve-sessions.nu
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
# for `to datastar-patch-elements`. Dimensions live in the bottom-right meta
# corner of the focused pane (driven by the $focusedDims signal), not the
# sidebar labels.
def render-list [ptys: list, selected: string]: nothing -> string {
  let items = $ptys | each {|p|
    let label = $p.meta.label? | default "nu"
    let cls = if $p.sid == $selected { "selected" } else { "" }
    # @post('/nav') sends all $signals as JSON. We set $sid (the target)
    # before posting so the server knows which session to select.
    let onclick = $"$sid = '($p.sid)'; @post\('/nav'\)"
    $"<li class='($cls)'><button type='button' data-on:click=\"($onclick)\">($label)<small>($p.sid | str substring 0..8)</small></button></li>"
  } | str join ""
  $"<aside id='sessions-list'><header>Sessions <button type='button' class='new-btn' data-on:click=\"@post\('/pty/new'\)\" title='New session'>+</button></header><ul>($items)</ul></aside>"
}

# Look up the focused session's "cols x rows" string. Returns "" when no
# session is selected (or the sid has gone away). Used to drive the
# $focusedDims signal that the bottom-right meta corner mirrors.
def focused-dims [ptys: list, selected: string]: nothing -> string {
  if $selected == "" { return "" }
  let p = $ptys | where sid == $selected | first
  if $p == null { "" } else { $"($p.cols)x($p.rows)" }
}

{|req|
  let body = $in
  match [$req.method, $req.path] {

    [GET, "/"] => {
      {datastar_js_path: $DATASTAR_JS_PATH} | .mj ($STATIC | path join "sessions.html")
    }

    [GET, "/sse"] => {
      # Datastar packs all signals into ?datastar={...} on GETs. Reconnects
      # (visibility-driven on v1.0+) replay current signal state, so we can
      # trust $signals.selectedSid to reflect the user's last selection.
      let signals = ("" | from datastar-signals $req)
      let prior_conn = ($signals.connId? | default "")
      let conn_id = if $prior_conn == "" { random uuid } else { $prior_conn }
      let requested_sid = ($signals.selectedSid? | default "")

      # Bootstrap: honor the client's selection if the sid still exists;
      # otherwise pick the first live pty, spawning one if none exist.
      # GHOSTTY_WEB_NU_CMD matches the path /pty/new takes.
      let bootstrap = (pty list)
      let live_sids = ($bootstrap | get sid)
      let cmd = $env.GHOSTTY_WEB_NU_CMD? | default "nu"
      let initial_sid = if ($bootstrap | is-empty) {
        if $cmd == "nu" { pty open --embedded } else { pty open $cmd }
      } else if ($requested_sid in $live_sids) {
        $requested_sid
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
          let live = (pty list)
          let live_sids = $live | get sid
          # 1. Nav explicitly requested -- honor it.
          # 2. Otherwise, if our currently-selected sid disappeared (close /
          #    death), fall back to the first remaining sid (or "" for none).
          let new_sel = if $ev.kind == "nav" {
            $ev.val.sid
          } else if ($state.sel in $live_sids) {
            $state.sel
          } else {
            $live | get sid? | get 0? | default ""
          }
          let new_dims = (focused-dims $live $new_sel)
          let list_patch = (render-list $live $new_sel
            | to datastar-patch-elements --selector "#sessions-list")
          let need_sel = ($ev.kind == "init") or ($new_sel != $state.sel)
          let sel_patch = if $need_sel {
            ({selectedSid: $new_sel, connId: $conn_id} | to datastar-patch-signals)
          } else { null }
          # Emit the focused-dims signal only when it actually changes so the
          # wire stays quiet during selection-only churn.
          let need_dims = ($ev.kind == "init") or ($new_dims != $state.dims)
          let dims_patch = if $need_dims {
            ({focusedDims: $new_dims} | to datastar-patch-signals)
          } else { null }
          let out = ([$sel_patch $dims_patch $list_patch] | where {|x| $x != null})
          {out: $out, next: {sel: $new_sel, dims: $new_dims}}
        } {sel: $initial_sid, dims: ""}
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

    [POST, "/pty/new"] => {
      # Spawn an embedded nu pty and publish a nav.events for the requesting
      # connection so the new session becomes the selected one. The
      # `pty open` itself publishes `pty.events {event: created}` so every
      # connected /sse sees the new row appear in the list.
      let signals = $body | from datastar-signals $req
      let cmd = $env.GHOSTTY_WEB_NU_CMD? | default "nu"
      let sid = if $cmd == "nu" {
        pty open --embedded
      } else {
        pty open $cmd
      }
      {connId: ($signals.connId? | default ""), sid: $sid} | .bus pub "nav.events"
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

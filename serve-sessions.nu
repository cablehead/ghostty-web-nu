# ghostty-web-nu sessions: server-projected 2-pane UI.
#
# Run:
#   http-nu --datastar :5003 ~/ghostty-web-nu/serve-sessions.nu
#
# Endpoints:
#   GET  /                  -> static sessions.html shell
#   GET  /sse?connId=...    -> projected UX state stream (datastar patches)
#   POST /nav               -> publish selected sid on nav.events bus topic
#   POST /title             -> set the server-wide window title (signal: title)
#   POST /pty/create        -> mint a new pty + return sid
#   POST /pty/new           -> spawn a pty for the calling tab and select it
#   POST /pty/label         -> set the selected pty's label (meta.label)
#   POST /pty/close?sid=... -> destroy pty
#   POST /pty/input?sid=... -> raw input bytes to pty stdin
#   POST /pty/resize?sid=...-> resize pty (cols, rows in JSON body)
#   GET  /pty/stream?sid=...-> base64 SSE of pty output bytes

use http-nu/datastar *

const STATIC = (path self | path dirname | path join "www")

# One title per http-nu instance, shown in every tab's <title>. Held in
# http-nu's in-memory SQLite (`stor`) so it survives SSE reconnects within a
# server run; cleared on restart. First read seeds a random adj-noun so the
# three-tabs-at-three-hosts case starts out distinguishable without any user
# action.
const TITLE_ADJ = [calm bold brave bright crisp eager fierce gentle happy keen lucky merry quiet swift wild]
const TITLE_NOUN = [otter sparrow fox heron stag panda lynx hare badger marten falcon ferret weasel mink]

def ensure-title-table []: nothing -> nothing {
  let exists = (stor open
    | query db "select name from sqlite_master where type='table' and name='title'"
    | length) > 0
  if not $exists {
    stor create -t title -c {val: str} | ignore
    let t = $"($TITLE_ADJ | shuffle | first)-($TITLE_NOUN | shuffle | first)"
    stor insert -t title -d {val: $t} | ignore
  }
}

def load-title []: nothing -> string {
  ensure-title-table
  stor open | query db "select val from title limit 1" | get 0.val
}

def save-title [new: string]: nothing -> nothing {
  ensure-title-table
  stor update -t title -u {val: $new} | ignore
}

# Render the left-pane session list as plain HTML. Returns a string suitable
# for `to datastar-patch-elements`. Dimensions live in the bottom-right meta
# corner of the focused pane (driven by the $focusedDims signal), not the
# sidebar labels.
def render-list [ptys: list, selected: string]: nothing -> string {
  # Sort by most recent input activity. `pty list` seeds last_input_ms to
  # session creation time and bumps it on every /pty/input write, so a
  # freshly-spawned tab opens at the top and the tab you most recently
  # typed in floats up. Re-renders only fire when `pty.events` ticks
  # (created/closed/resized/meta/touched) or nav happens, so the list
  # doesn't shuffle mid-keystroke; the "touched" event is emitted from
  # the Rust side only when a bump actually moves a sid to the top.
  let items = $ptys | sort-by last_input_ms -r | each {|p|
    let label = $p.meta.label? | default "nu"
    let cls = if $p.sid == $selected { "selected" } else { "" }
    # @post('/nav') sends all $signals as JSON. We set $sid (the target)
    # before posting so the server knows which session to select.
    let onclick = $"$sid = '($p.sid)'; @post\('/nav'\)"
    let onclose = $"@post\('/pty/close?sid=($p.sid)'\)"
    $"<li class='($cls)'><button type='button' class='row' data-on:click=\"($onclick)\">($label)<small>($p.sid | str substring 0..8)</small></button><button type='button' class='close' data-on:click=\"($onclose)\" title='Close'>×</button></li>"
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
      {datastar_js_path: $DATASTAR_JS_PATH, title: (load-title)}
        | .mj ($STATIC | path join "sessions.html")
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
            | each {|e| {kind: "nav", val: $e.value}} }
        { .bus sub "title.events"
            | where {|e| ($e.value.connId? | default "") != $conn_id}
            | each {|e| {kind: "title", val: $e.value}} })
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
          let new_title = if $ev.kind == "title" { $ev.val.title } else { $state.title }
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
          # $title is the one-per-server window title. title.events is filtered
          # above so the typer's own connection doesn't get an echo back into
          # a focused <input>. Init seeds the signal so reconnects pick up the
          # current /tmp value.
          let need_title = ($ev.kind == "init") or ($new_title != $state.title)
          let title_patch = if $need_title {
            ({title: $new_title} | to datastar-patch-signals)
          } else { null }
          let out = ([$sel_patch $dims_patch $title_patch $list_patch] | where {|x| $x != null})
          {out: $out, next: {sel: $new_sel, dims: $new_dims, title: $new_title}}
        } {sel: $initial_sid, dims: "", title: (load-title)}
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

    [POST, "/title"] => {
      # Set the per-server window title. Persist via `stor` so SSE reconnects
      # in the same server run see the right value; broadcast via
      # title.events so other tabs update document.title live. title.events
      # carries the originating connId; the /sse subscription filters out
      # matches so the typer doesn't get its own echo clobbering a focused
      # <input>.
      let signals = $body | from datastar-signals $req
      let new = ($signals.title? | default "" | str trim)
      save-title $new
      {connId: ($signals.connId? | default ""), title: $new} | .bus pub "title.events"
      null | metadata set { merge {'http.response': {status: 204}} }
    }

    [POST, "/pty/label"] => {
      # Rename a pty's left-pane label. The label lives in the pty session's
      # meta map; `pty meta set` mutates it and publishes a `pty.events {event:
      # meta}` ping, which the /sse handler already re-renders the list on.
      # No connId filtering needed -- the list is server-projected (button
      # text), not an input the typer is focused on.
      let signals = $body | from datastar-signals $req
      let sid = ($signals.selectedSid? | default "")
      let new = ($signals.label? | default "" | str trim)
      if $sid != "" {
        pty meta set $sid "label" $new
      }
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

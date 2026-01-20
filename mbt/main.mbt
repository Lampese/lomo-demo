///|
using @lomo_types {type LoroValue, type LoroError}

///|
using @lomo {type LoroDoc, type Subscription}

///|
let docs : Array[LoroDoc] = []

///|
let texts : Array[@container.TextHandler] = []

///|
let pending_updates : Array[Array[Bytes]] = []

///|
let subs : Array[Subscription] = []

///|
fn valid_doc_id(id : Int) -> Bool {
  id >= 0 && id < docs.length()
}

///|
fn log_error(ctx : String, err : LoroError) -> Unit {
  println("\{ctx}: \{err}")
}

///|
pub fn create_doc(peer_id : Int) -> Int {
  let doc_id = docs.length()
  let doc = LoroDoc::new()
  doc.set_peer_id(peer_id.to_uint64())
  let text = doc.get_text("body")
  let queue = []
  let sub = doc.subscribe_local_update(bytes => {
    queue.push(bytes)
    true
  })
  docs.push(doc)
  texts.push(text)
  pending_updates.push(queue)
  subs.push(sub)
  doc_id
}

///|
pub fn apply_edit_utf16(
  doc_id : Int,
  start : Int,
  delete_len : Int,
  insert_text : String,
) -> Bool {
  if !valid_doc_id(doc_id) {
    return false
  }
  let doc = docs[doc_id]
  let text = texts[doc_id]
  if delete_len > 0 {
    match doc.text_delete_utf16(text, start, delete_len) {
      Ok(_) => ()
      Err(err) => {
        log_error("delete failed", err)
        return false
      }
    }
  }
  if insert_text.length() > 0 {
    match doc.text_insert_utf16(text, start, insert_text) {
      Ok(_) => ()
      Err(err) => {
        log_error("insert failed", err)
        return false
      }
    }
  }
  true
}

///|
pub fn mark_utf16(doc_id : Int, start : Int, len : Int, key : String) -> Bool {
  if !valid_doc_id(doc_id) {
    return false
  }
  if len <= 0 {
    return true
  }
  let doc = docs[doc_id]
  let text = texts[doc_id]
  match doc.text_mark_utf16(text, start, len, key, LoroValue::Bool(true)) {
    Ok(_) => true
    Err(err) => {
      log_error("mark failed", err)
      false
    }
  }
}

///|
pub fn unmark_utf16(doc_id : Int, start : Int, len : Int, key : String) -> Bool {
  if !valid_doc_id(doc_id) {
    return false
  }
  if len <= 0 {
    return true
  }
  let doc = docs[doc_id]
  let text = texts[doc_id]
  match doc.text_unmark_utf16(text, start, len, key) {
    Ok(_) => true
    Err(err) => {
      log_error("unmark failed", err)
      false
    }
  }
}

///|
pub fn get_text(doc_id : Int) -> String {
  if !valid_doc_id(doc_id) {
    return ""
  }
  let doc = docs[doc_id]
  let text = texts[doc_id]
  match doc.text_to_string(text) {
    Ok(value) => value
    Err(err) => {
      log_error("get_text failed", err)
      ""
    }
  }
}

///|
pub fn render_html(doc_id : Int) -> String {
  if !valid_doc_id(doc_id) {
    return ""
  }
  let doc = docs[doc_id]
  let text = texts[doc_id]
  match doc.text_to_delta(text) {
    Ok(delta) => delta_to_html(delta)
    Err(err) => {
      log_error("render failed", err)
      ""
    }
  }
}

///|
pub fn drain_updates(doc_id : Int) -> Array[Bytes] {
  if !valid_doc_id(doc_id) {
    return []
  }
  let out = pending_updates[doc_id].copy()
  pending_updates[doc_id].clear()
  out
}

///|
pub fn apply_updates(doc_id : Int, updates : Array[Bytes]) -> Bool {
  if !valid_doc_id(doc_id) {
    return false
  }
  let doc = docs[doc_id]
  for update in updates {
    match doc.import_updates(update) {
      Ok(_) => ()
      Err(err) => {
        log_error("import failed", err)
        return false
      }
    }
  }
  true
}

///|

///|
fn escape_html(text : String) -> String {
  let sb = StringBuilder::new()
  for ch in text {
    match ch {
      '&' => sb.write_string("&amp;")
      '<' => sb.write_string("&lt;")
      '>' => sb.write_string("&gt;")
      '"' => sb.write_string("&quot;")
      _ => sb.write_char(ch)
    }
  }
  sb.to_string()
}

///|
fn delta_to_html(deltas : Array[LoroValue]) -> String {
  let sb = StringBuilder::new()
  for item in deltas {
    match item {
      Map(map) =>
        match map.get("insert") {
          Some(String(text)) => {
            let empty : Map[String, LoroValue] = {}
            let attrs = match map.get("attributes") {
              Some(Map(value)) => value
              _ => empty
            }
            let mut chunk = escape_html(text)
            let attr_enabled = (key : String) => attrs.get(key)
              is Some(Bool(true))
            let wrap_tag = (tag, content) => "<\{tag}>\{content}</\{tag}>"
            if attr_enabled("code") {
              chunk = wrap_tag("code", chunk)
            }
            if attr_enabled("bold") {
              chunk = wrap_tag("strong", chunk)
            }
            if attr_enabled("italic") {
              chunk = wrap_tag("em", chunk)
            }
            if attr_enabled("underline") {
              chunk = wrap_tag("u", chunk)
            }
            sb.write_string(chunk)
          }
          _ => ()
        }
      _ => ()
    }
  }
  sb.to_string()
}

"""
Patchright browser session routed through a static-IP proxy, exposed as
LangChain tools for a Deep Agent.

One persistent browser/page is shared across tool calls so the agent can
navigate, click, type and read like a person would.
"""

from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

from langchain_core.tools import tool

from . import decider
from patchright.async_api import (
    Browser,
    BrowserContext,
    ElementHandle,
    Frame,
    Locator,
    Page,
    Playwright,
    Route,
    TimeoutError as PWTimeout,
    async_playwright,
)

MAX_CHARS = int(os.getenv("BROWSER_MAX_CHARS", "8000"))
NAV_TIMEOUT_MS = int(os.getenv("BROWSER_NAV_TIMEOUT_MS", "45000"))
MAX_ELEMENTS = int(os.getenv("BROWSER_MAX_ELEMENTS", "80"))
# How long solve_turnstile waits for the Cloudflare checkbox before deciding there is none.
TURNSTILE_TIMEOUT_MS = int(os.getenv("BROWSER_TURNSTILE_TIMEOUT_MS", "15000"))
TURNSTILE_IFRAME = 'iframe[src*="challenges.cloudflare.com"]'
# How long a page read waits for the DOM to stop changing: `quiet` ms without a
# mutation, at most `max` ms. BROWSER_FAST_WAITS=true shortens these, drops the
# networkidle wait in `browse`, and makes `scroll` / `type_text` return the page so
# the model needs no extra read_current_page call.
FAST_WAITS = os.getenv("BROWSER_FAST_WAITS", "false").lower() == "true"
SETTLE_QUIET_MS = int(os.getenv("BROWSER_SETTLE_QUIET_MS", "300" if FAST_WAITS else "500"))
SETTLE_MAX_MS = int(os.getenv("BROWSER_SETTLE_MAX_MS", "1500" if FAST_WAITS else "2500"))
# With DECIDER_PAGE_GATE=true (and DECIDER_MODEL set), a decision model looks at every
# page the browser lands on and handles "still loading" / "covered by a popup" /
# "sign-in wall" before the main model sees it.
PAGE_GATE = os.getenv("DECIDER_PAGE_GATE", "false").lower() == "true"
# How a page read shows interactive elements: "list" (the page text, then a numbered
# list of elements) or "inline" (each element numbered where it sits in the text,
# elements on screen first, lines marked above / in / below the visible area).
SNAPSHOT_MODE = os.getenv("BROWSER_SNAPSHOT", "list").lower()
# Iframes whose elements are listed too (sign-in buttons, embedded widgets), and how
# many elements each may add on top of MAX_ELEMENTS.
MAX_FRAMES = 8
MAX_FRAME_ELEMENTS = 15
# CAPTCHA widgets are never indexed, so they can't be clicked by number; the agent
# must use solve_turnstile or manual_captcha_handoff.
CAPTCHA_FRAME_HOSTS = ("challenges.cloudflare.com", "hcaptcha.com", "recaptcha.net",
                       "arkoselabs.com", "funcaptcha.com")
# Chromium profile folder: cookies, logins, localStorage, IndexedDB and cache are
# kept here, so the browser remembers everything across runs. Empty = forget on exit.
PROFILE_DIR = os.getenv("BROWSER_PROFILE_DIR", "browser_profile")
# Largest file download_file will save.
DOWNLOAD_MAX_MB = float(os.getenv("DOWNLOAD_MAX_MB", "50"))
# Search engine behind web_search: "bing" (default) or "duckduckgo"; the other is the fallback.
SEARCH_ENGINE = os.getenv("SEARCH_ENGINE", "bing").lower()
# Language the search tab asks for. Bing returns unrelated results to some system
# locales, so this defaults to English. Empty = the browser's own language.
SEARCH_LANGUAGE = os.getenv("SEARCH_LANGUAGE", "en-US")

# Used by public_ip(); always reachable, even with an ALLOWED_DOMAINS list.
IP_SERVICES = [
    ("https://api.ipify.org?format=json", lambda t: json.loads(t)["ip"]),
    ("https://ifconfig.me/ip", str.strip),
    ("https://icanhazip.com", str.strip),
]
IP_SERVICE_HOSTS = {urlparse(url).hostname for url, _ in IP_SERVICES}
# `[12] button "Next"` in a page read, in the list or inline in the text.
_ELEMENT_DESC = re.compile(r'\[(\d+)\] ([\w ]+?) "([^"]*)"')

# What counts as an interactive element, and how one is described (role, label,
# state), shared by the element list and the inline snapshot below.
_ELEMENT_HELPERS_JS = r"""
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, '
    + '[role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], '
    + '[role=switch], [role=slider], [role=combobox], [role=option], [draggable=true], '
    + '[contenteditable=""], [contenteditable=true], [onclick]';
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const isToggle = (el) => el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el.type || '').toLowerCase());
  // Styled checkboxes often hide the real input behind a visible label.
  const usable = (el) => !el.disabled
    && (visible(el) || (isToggle(el) && el.labels && el.labels[0] && visible(el.labels[0])));
  // `short`: for an element wrapping a lot of content (a whole card in a link), take
  // the label from aria-label/title or the first words, since the content follows.
  const describe = (el, short) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const toggle = isToggle(el);
    const label0 = el.labels && el.labels[0];
    const role = el.getAttribute('role')
      || (tag === 'a' ? 'link' : toggle ? type : tag === 'input' ? (type || 'text') + ' input' : tag);
    // Never read a password back; button inputs show their caption.
    const buttonValue = tag === 'input' && ['submit', 'button', 'reset'].includes(type) ? el.value : '';
    const text = short ? (el.innerText || '').trim().split('\n')[0].slice(0, 60) : el.innerText;
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => (id && document.getElementById(id) || {}).innerText || '').join(' ');
    // Icon-only controls: the icon's own title / alt / aria-label.
    const icon = el.querySelector('[aria-label], [title], img[alt], svg title');
    const iconLabel = icon ? (icon.getAttribute('aria-label') || icon.getAttribute('title')
      || icon.getAttribute('alt') || icon.textContent || '') : '';
    let label = el.getAttribute('aria-label') || by || (label0 ? label0.innerText : '')
      || (tag === 'select' ? '' : text) || buttonValue
      || el.getAttribute('placeholder') || el.getAttribute('title')
      || el.getAttribute('name') || el.getAttribute('alt') || iconLabel || '';
    if (!label && tag === 'a') label = el.getAttribute('href') || '';
    label = label.trim().replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 80);
    let state = '';
    const aria = el.getAttribute('aria-checked');
    if (toggle) state = el.checked ? ' [checked]' : ' [unchecked]';
    else if (aria !== null) state = aria === 'true' ? ' [checked]' : ' [unchecked]';
    else if (tag === 'select') {
      const opt = el.options[el.selectedIndex];
      state = ` = "${opt ? opt.text.trim() : ''}" (${el.options.length} options)`;
    } else if ((tag === 'input' && !['password', 'submit', 'button', 'reset', 'file'].includes(type))
               || tag === 'textarea') {
      if (el.value) state = ` = "${el.value.slice(0, 40)}"`;
    }
    if (el.getAttribute('aria-expanded') === 'true') state += ' [expanded]';
    if (el.getAttribute('draggable') === 'true') state += ' [draggable]';
    return {role, label, desc: `${role} "${label}"${state}`};
  };
"""

# Tags every visible interactive element with data-agent-id="N" and describes it,
# including its state (checked, selected option, current text).
# Numbers are reassigned on every call, so they are only valid until the next read.
# Runs once per frame; `start` continues the numbering from the frames before it.
_INDEX_ELEMENTS_JS = """
([limit, start]) => {""" + _ELEMENT_HELPERS_JS + """
  document.querySelectorAll('[data-agent-id]').forEach(e => e.removeAttribute('data-agent-id'));
  const out = [];
  let n = start;
  for (const el of document.querySelectorAll(SEL)) {
    if (!usable(el)) continue;
    n += 1;
    el.setAttribute('data-agent-id', String(n));
    out.push(`[${n}] ${describe(el, false).desc}`);
    if (out.length >= limit) break;
  }
  return out;
}
"""

# Finds the element a page read described as `role "label"` again and gives it back
# its number, for when the site re-rendered it after the read (Gmail redraws inbox
# rows), so the old data-agent-id is gone. True if exactly one element matches.
# What an element is, for the task policy (policy.py): its tag and type, a label,
# and the form it belongs to with that form's method and field types.
_DESCRIBE_JS = r"""
el => {
  const tag = el.tagName.toLowerCase();
  const form = el.form || el.closest('form');
  const fieldType = e => e.tagName.toLowerCase() === 'input'
    ? (e.getAttribute('type') || 'text').toLowerCase() : e.tagName.toLowerCase();
  return {
    tag,
    type: (el.getAttribute('type') || '').toLowerCase(),
    role: (el.getAttribute('role') || '').toLowerCase(),
    label: (el.getAttribute('aria-label') || el.innerText || el.value
            || el.getAttribute('title') || el.getAttribute('placeholder') || '')
           .trim().replace(/\s+/g, ' ').slice(0, 80),
    in_form: !!form,
    form_method: form ? (form.getAttribute('method') || 'get').toLowerCase() : '',
    form_role: form ? (form.getAttribute('role') || '').toLowerCase() : '',
    form_fields: form ? Array.from(form.elements).map(fieldType) : [],
  };
}
"""

_REFIND_JS = r"""
([n, role, label]) => {""" + _ELEMENT_HELPERS_JS + r"""
  const found = [...document.querySelectorAll(SEL)].filter(el => usable(el)
    && [false, true].some(short => { const d = describe(el, short); return d.role === role && d.label === label; }));
  if (found.length !== 1) return false;
  found[0].setAttribute('data-agent-id', String(n));
  return true;
}
"""

# The page as text with each interactive element numbered where it sits, e.g.
#   - Acme Corp: Invoice #4411 10:32 [14] button "Archive" [15] button "Delete"
# so the model sees which row a button belongs to. Elements in or near the viewport
# get numbers first; the rest are numbered while `limit` lasts and otherwise shown as
# plain text. Over `maxChars`, lines in view are kept first, then below, then above.
# Lines are tagged above / in / below the visible area; an open dialog or popup (a
# Gmail compose window) comes before all of them. Repeated links (same text and
# address) are numbered once, and repeated identical lines dropped.
_INLINE_SNAPSHOT_JS = r"""
([limit, start, maxChars]) => {""" + _ELEMENT_HELPERS_JS + r"""
  document.querySelectorAll('[data-agent-id]').forEach(e => e.removeAttribute('data-agent-id'));
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD', 'IFRAME', 'FRAME',
    'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'PICTURE', 'IMG', 'MAP', 'LINK', 'META']);
  const vh = window.innerHeight;
  const deadline = performance.now() + 1500;
  const lines = [];        // {segs: [string | {c: candidate index}], y}
  const cands = [];        // {el, desc, label, big, y}
  const links = new Set();
  const DIALOG = '[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]';
  let inDialog = 0;
  let cur = {segs: [], y: null, dlg: false};
  const breakLine = (prefix = '') => {
    if (cur.segs.length) lines.push(cur);
    cur = {segs: prefix ? [prefix] : [], y: null, dlg: inDialog > 0};
  };
  const add = (seg, y) => {
    if (cur.y === null && y !== null) cur.y = y;
    cur.segs.push(seg);
  };
  const textY = (node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    const b = r.getBoundingClientRect();
    return b.width || b.height ? b.top : null;
  };
  // `flat`: inside a short row, where nothing starts a new line. `hidden`: under
  // visibility:hidden, whose children can still be visible (Gmail's compose window).
  const walk = (node, inRow, flat, hidden) => {
    for (const child of node.childNodes) {
      if (performance.now() > deadline) return;
      if (child.nodeType === 3) {
        const t = child.nodeValue.replace(/\s+/g, ' ');
        if (hidden || !t.trim()) { if (t) cur.segs.push(' '); continue; }
        add(t, cur.y === null ? textY(child) : null);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const tag = el.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (tag === 'BR') { if (flat) cur.segs.push(' '); else breakLine(); continue; }
      const st = getComputedStyle(el);
      // A hidden checkbox still counts when its visible label operates it.
      if (st.display === 'none' && !(isToggle(el) && usable(el))) continue;
      const hid = st.visibility !== 'visible';
      const d = st.display;
      const cell = d === 'table-cell';
      const block = !inRow && !cell && !d.startsWith('inline') && d !== 'contents';
      const heading = !flat && /^H[1-6]$/.test(tag);
      const item = !flat && tag === 'LI';
      const brk = !flat && (heading || item || block);
      if (heading) breakLine('#'.repeat(+tag[1]) + ' ');
      else if (item) breakLine('- ');
      else if (brk) breakLine();
      else if (inRow || cell || block) cur.segs.push(' ');
      // Children of a flex row or table row sit side by side; a short row (one
      // result, one email) goes on a single line whatever is inside it.
      const row = d === 'table-row' || (/flex/.test(d) && !st.flexDirection.startsWith('column'));
      const dialog = el.matches(DIALOG);
      // A dialog lays out on its own, even inside a "short row" wrapper.
      const flatHere = !dialog && (flat || (row && (el.innerText || '').length <= 300));
      if (dialog) { inDialog += 1; breakLine(); }
      if (el.matches(SEL) && usable(el)) {
        const r = el.getBoundingClientRect();
        const text = el.innerText || '';
        const container = !['INPUT', 'SELECT', 'TEXTAREA'].includes(tag);
        const big = container && (text.length > 150 || !!el.querySelector(SEL));
        const {label, desc} = describe(el, big);
        const href = tag === 'A' ? el.getAttribute('href') : null;
        if (href && !big && links.has(href + '\n' + label)) {
          add(label, r.top);                       // same link again: text only
        } else {
          if (href) links.add(href + '\n' + label);
          cands.push({el, desc, label, big, y: r.top, dlg: inDialog > 0});
          add({c: cands.length - 1}, r.top);
          if (big) walk(el, row, flatHere, hid);
        }
      } else {
        walk(el, row, flatHere, hid);
      }
      if (dialog) { breakLine(); inDialog -= 1; cur.dlg = inDialog > 0; }
      if (brk) breakLine();
      else if (cell) cur.segs.push(' |');
    }
  };
  walk(document.body, false, false, false);
  breakLine();

  const zone = (y) => y === null ? null : y < -5 ? 'above' : y > vh ? 'below' : 'in';
  const dist = (c) => c.dlg ? -1 : c.y === null ? 1e9 : c.y < 0 ? -c.y : c.y > vh ? c.y - vh : 0;
  // Numbers go to elements in a dialog first, then in view, then the nearest ones.
  const order = cands.map((c, i) => i).sort((a, b) => dist(cands[a]) - dist(cands[b]) || a - b);
  const numbered = new Set(order.slice(0, limit));

  let lastLabel = '';
  const render = (line) => line.segs.map(s => {
      if (typeof s === 'string') {
        if (s.trim() && s.trim() === lastLabel) return ' ';   // a label's own text again
        if (s.trim()) lastLabel = '';
        return s;
      }
      const c = cands[s.c];
      lastLabel = c.label;
      return numbered.has(s.c) ? ` [#${s.c}] ${c.desc} ` : (c.big ? '' : c.label);
    }).join('').replace(/\s+/g, ' ').replace(/\|( \|)+/g, '|')
    .replace(/^[ |]+|[ |]+$/g, '').replace(/^([-#]+ )[ |]+/, '$1').trim();
  const out = [];
  let lastZone = 'in', prev = null;
  for (const line of lines) {
    const text = render(line);
    if (!text || /^[-#]+$/.test(text) || text === prev) continue;
    prev = text;
    if (line.dlg) { out.push({text, zone: 'dialog'}); continue; }
    out.push({text, zone: zone(line.y) || lastZone});
    lastZone = out[out.length - 1].zone;
  }

  // Fit maxChars: dialogs, lines in view, then below (top down), then above (nearest first).
  const keep = new Set();
  let used = 0;
  const take = (i) => {
    if (keep.has(i) || used + out[i].text.length + 1 > maxChars) return false;
    keep.add(i); used += out[i].text.length + 1; return true;
  };
  const idx = out.map((l, i) => i);
  idx.filter(i => out[i].zone === 'dialog').forEach(take);
  idx.filter(i => out[i].zone === 'in').forEach(take);
  idx.filter(i => out[i].zone === 'below').forEach(take);
  idx.filter(i => out[i].zone === 'above').reverse().forEach(take);

  // Number the elements that made it in, in reading order.
  const ids = new Map();
  let n = start;
  const result = [];
  const MARK = {dialog: '--- open dialog / popup (on top of the page) ---',
                above: '--- above the visible area ---', in: '--- visible area ---',
                below: '--- below the visible area (numbered elements still work without scrolling) ---'};
  let shownZone = null, skipped = 0;
  for (let i = 0; i < out.length; i++) {
    if (!keep.has(i)) { skipped += out[i].text.length; continue; }
    if (skipped) { result.push(`...[${skipped} chars skipped]`); skipped = 0; }
    const z = out[i].zone;
    if (z !== shownZone && !(shownZone === null && z === 'in')) result.push(MARK[z]);
    shownZone = z;
    result.push(out[i].text.replace(/\[#(\d+)\]/g, (m, c) => {
      if (!ids.has(c)) {
        n += 1;
        ids.set(c, n);
        cands[+c].el.setAttribute('data-agent-id', String(n));
      }
      return `[${ids.get(c)}]`;
    }));
  }
  if (skipped) result.push(`...[${skipped} chars skipped]`);
  const unlisted = cands.length - ids.size;
  return {text: result.join('\n'), count: n - start, unlisted,
          timedOut: performance.now() > deadline};
}
"""

# Resolves once the DOM has gone `quiet` ms without changes (or after `max` ms), so
# widgets that render a moment after load (sign-in buttons, results) are in the read.
# Attribute changes are ignored so CSS animations don't keep it waiting.
_SETTLE_JS = """
([quiet, max]) => new Promise(resolve => {
  let timer, cap;
  const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
  obs.observe(document, {childList: true, subtree: true, characterData: true});
  timer = setTimeout(done, quiet);
  cap = setTimeout(done, max);
})
"""


# Finds the biggest group of repeated sibling elements (cards, results, rows) and
# returns each as title / url / text. `selector` overrides the guess: it may match
# the items themselves or their parent.
_EXTRACT_ITEMS_JS = r"""
([selector, limit, textLimit]) => {
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const text = (e) => (e ? (e.innerText || '') : '').replace(/\s+/g, ' ').trim();
  const rough = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();  // no layout cost
  const sig = (e) => e.tagName + '.' + (e.classList[0] || '');
  const HEAD = 'h1,h2,h3,h4,h5,h6,[role=heading]';
  const describe = (e) => !e ? '' : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
    + (e.classList[0] ? '.' + e.classList[0] : '');
  let items;
  if (selector) {
    const matches = [...document.querySelectorAll(selector)];
    if (!matches.length) return { error: 'nothing matches ' + selector };
    items = matches.length >= 2 ? matches : [...matches[0].children];
  } else {
    let best = null;
    const scope = document.querySelector('main, [role=main]') || document.body;
    for (const parent of [scope, ...scope.querySelectorAll('*')]) {
      if (parent.children.length < 3 || parent.closest('nav, header, footer, select')) continue;
      const groups = {};
      for (const c of parent.children) {
        if (!visible(c) || rough(c).length < 15) continue;
        (groups[sig(c)] ||= []).push(c);
      }
      for (const g of Object.values(groups)) {
        if (g.length < 3) continue;
        const avg = g.reduce((s, e) => s + Math.min(rough(e).length, 400), 0) / g.length;
        const share = (sel) => g.filter(e => e.matches(sel) || e.querySelector(sel)).length / g.length;
        const score = g.length * Math.log(avg + 1) * (1 + share('a[href]'))
          * (1 + share(HEAD + ',[class*="title" i]'));
        if (!best || score > best.score) best = { score, items: g };
      }
    }
    items = best ? best.items : [];
  }
  const out = [];
  for (const e of items.slice(0, limit)) {
    const links = (e.matches('a[href]') ? [e] : [...e.querySelectorAll('a[href]')])
      .filter(a => !a.href.startsWith('javascript:'));
    const heading = e.querySelector(HEAD);
    // The item's main link: the one around or inside its heading, else the one with most text.
    let main = heading && (heading.closest('a[href]') || heading.querySelector('a[href]'));
    if (!main) main = [...e.querySelectorAll('[class*="title" i] a[href]')].find(a => text(a));
    if (!main) main = links.reduce((b, a) => (!b || text(a).length > text(b).length ? a : b), null);
    let title = text(heading) || text(main);
    if (!title) {
      const t = [...e.querySelectorAll('[class*="title" i],strong,b')].find(x => text(x).length > 3);
      title = text(t);
    }
    const full = main && main.getAttribute('title');
    if (full && full.length > title.length && /(\.\.\.|…)$/.test(title)) title = full;
    const body = text(e);
    const item = { title: (title || body.slice(0, 80)).slice(0, 200), text: body.slice(0, textLimit) };
    if (main) item.url = main.href;
    const img = e.querySelector('img[alt]');
    if (img && img.alt.trim()) item.image_alt = img.alt.trim().slice(0, 120);
    out.push(item);
  }
  return { count: items.length, items: out, container: describe(items[0] && items[0].parentElement) };
}
"""

# One round of popup dismissal: click the single safest button inside an overlay.
# Order: refuse optional cookies, turn down a promotion, close, acknowledge a notice,
# and accept cookies only as a last resort. Reject and accept buttons are only used
# inside cookie/consent banners, and OK-style buttons only when they are a notice's
# only button, so ordinary dialogs (confirm purchase, accept invite) are never answered.
_DISMISS_OVERLAYS_JS = r"""
() => {
  const visible = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const label = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || '')
    .replace(/\s+/g, ' ').trim();
  const CONSENT_NAME = /cookie|consent|gdpr|onetrust|didomi|cookiebot|truste|usercentrics|quantcast|osano|\bcmp\b/i;
  const CONSENT_TEXT = /\bcookies?\b|consent|gdpr|personal data|tracking/i;
  const BUTTONS = 'button, a, [role=button], input[type=button], input[type=submit], summary';
  const cls = (p) => p.id + ' ' + (typeof p.className === 'string' ? p.className : '');
  // The overlay a button belongs to: nearest dialog, fixed/sticky box or consent container.
  const overlayOf = (e) => {
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'fixed' || s.position === 'sticky' || CONSENT_NAME.test(cls(p))
          || p.matches('[role=dialog], [role=alertdialog], [aria-modal=true], dialog')) return p;
    }
    return null;
  };
  const isConsent = (box) => {
    for (let p = box; p && p !== document.body; p = p.parentElement) {
      if (CONSENT_NAME.test(cls(p))) return true;
      const t = p.innerText || '';
      if (t.length > 5000) break;
      if (CONSENT_TEXT.test(t)) return true;
    }
    return false;
  };
  const tiers = [
    { re: /^((reject|decline|refuse|deny|disagree)( all)?( (optional |non-essential )?cookies)?|(only |use |allow )?(strictly )?(necessary|essential|required)( cookies)?( only)?|continue without (accepting|agreeing)|do not (accept|consent))\.?$/i, consent: true },
    { re: /^(no,? thanks|no thank you|not now|maybe later|skip)\.?$/i },
    { re: /^((close|dismiss)( (this )?(dialog|banner|popup|modal|message|notice|window|ad))?|×|✕|✖|x)$/i },
    { re: /^(ok|okay|got it|understood|i understand)[.!]?$/i, alone: true },
    { re: /^((accept|allow|agree|i agree|i accept|consent)( all)?( cookies)?|accept (&|and) (close|continue)|yes,? i agree)\.?$/i, consent: true },
  ];
  // Well-known consent managers, where the button text varies by language.
  const known = { 0: ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline',
      '#didomi-notice-disagree-button', '.fc-cta-do-not-consent', '.osano-cm-deny', '.cc-deny'],
    4: ['#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#didomi-notice-agree-button', '.fc-cta-consent', '.osano-cm-accept', '.cc-allow', '#truste-consent-button'] };
  const buttons = [...document.querySelectorAll(BUTTONS)].filter(visible);
  for (let t = 0; t < tiers.length; t++) {
    for (const sel of known[t] || []) {
      const e = document.querySelector(sel);
      if (e && visible(e)) { e.click(); return { clicked: label(e) || sel }; }
    }
    const tier = tiers[t];
    for (const e of buttons) {
      const l = label(e);
      if (l.length > 40 || !tier.re.test(l)) continue;
      const box = overlayOf(e);
      if (!box) continue;
      if (tier.consent && !isConsent(box)) continue;
      if (tier.alone && [...box.querySelectorAll(BUTTONS)].filter(visible).length !== 1) continue;
      e.click();
      return { clicked: l };
    }
  }
  return {};
}
"""

# Last resort: hide fixed overlays that cover a fifth of the viewport or more (and
# any open dialog), and undo the scroll lock sites apply while a modal is open.
_HIDE_OVERLAYS_JS = r"""
() => {
  const vw = innerWidth, vh = innerHeight;
  const total = (document.body.innerText || '').length || 1;
  const hidden = [];
  for (const e of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(e);
    const dialog = e.matches('[role=dialog], [aria-modal=true], dialog[open]');
    if (!dialog && s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if ((w * h) / (vw * vh) < 0.2) continue;                 // small sticky bars stay
    if ((e.innerText || '').length > total * 0.5) continue;  // that is the page itself
    e.style.setProperty('display', 'none', 'important');
    hidden.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList[0] ? '.' + e.classList[0] : ''));
  }
  let unlocked = false;
  for (const el of [document.documentElement, document.body]) {
    const s = getComputedStyle(el);
    if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
      el.style.setProperty('overflow', 'auto', 'important');
      unlocked = true;
    }
  }
  return { hidden, unlocked };
}
"""

# web_search: results page URL and a parser returning [{title, url, snippet}].
_SEARCH_ENGINES = {
    "bing": (
        "https://www.bing.com/search?q={q}",
        "li.b_algo",
        """() => [...document.querySelectorAll('li.b_algo')].map(r => {
             const a = r.querySelector('h2 a'), s = r.querySelector('.b_caption p, p');
             return a ? {title: a.innerText || a.textContent, url: a.href, snippet: s ? (s.innerText || s.textContent) : ''} : null;
           }).filter(Boolean)""",
    ),
    "duckduckgo": (
        "https://html.duckduckgo.com/html/?q={q}",
        ".result",
        """() => [...document.querySelectorAll('.result:not(.result--ad)')].map(r => {
             const a = r.querySelector('a.result__a'), s = r.querySelector('.result__snippet');
             return a ? {title: a.innerText || a.textContent, url: a.href, snippet: s ? (s.innerText || s.textContent) : ''} : null;
           }).filter(Boolean)""",
    ),
}


def _clean(text: str, limit: int = MAX_CHARS) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    if len(text) > limit:
        text = text[:limit] + f"\n\n...[truncated, {len(text) - limit} more chars]"
    return text


def _parse_domains(raw: str | None) -> list[str]:
    return [d.strip().lower().lstrip(".") for d in (raw or "").split(",") if d.strip()]


class BrowserSession:
    """A single Chromium instance whose traffic exits through your static IP."""

    def __init__(
        self,
        proxy: dict | None = None,
        expected_ip: str | None = None,
        headless: bool = True,
        timezone_id: str | None = None,
        locale: str | None = None,
        allow_any_ip: bool = False,
        allowed_domains: list[str] | None = None,
        vision: bool = False,
        profile_dir: str | None = None,
    ):
        self.proxy = proxy
        self.profile_dir = profile_dir  # None: a throwaway in-memory profile
        self.expected_ip = expected_ip
        self.allow_any_ip = allow_any_ip
        self.allowed_domains = allowed_domains or []
        self.vision = vision
        self.headless = headless
        self.timezone_id = timezone_id
        self.locale = locale
        self._pw: Playwright | None = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        # Tabs opened by the site (target=_blank, window.open) since the last check.
        self._opened: list[Page] = []
        # Navigations stopped by ALLOWED_DOMAINS since the last page read.
        self.blocked: list[str] = []
        # Element number -> the frame it was tagged in, from the last page read.
        self.element_frames: dict[str, Frame] = {}
        # number -> (role, label) from the last page read, to find a re-rendered element.
        self.element_descs: dict[str, tuple[str, str]] = {}
        # Adopted tab -> the tab that was current when it opened, to return to on close.
        self._return_to: dict[Page, Page] = {}
        # Set when the current tab (a sign-in popup, say) closed itself.
        self.popup_closed = False
        # Serialize page access; every tool works on the same tab.
        self.lock = asyncio.Lock()
        # Fixed waits the tools spent, as (name, seconds); StepTimer reads and
        # attributes them to tool calls.
        self.waits: list[tuple[str, float]] = []
        self.fast_waits = FAST_WAITS
        self.page_gate = PAGE_GATE
        self.decider_stats = decider.Stats()  # the gate's calls in this session
        self.snapshot_mode = SNAPSHOT_MODE
        # (url, digest) of the previous page read, to notice an unchanged page.
        self._last_read: tuple[str, int] | None = None
        # async (target or None) -> dict | None, set by make_browser_tools: what the
        # element a tool call targets is (None: the focused element). PolicyGuard uses it.
        self.describe_element = None

    @classmethod
    def from_env(cls) -> "BrowserSession":
        return cls(**cls._env_kwargs())

    @classmethod
    def from_config(cls, config: dict) -> "BrowserSession":
        """A session for one user or task: keys in `config` (proxy, expected_ip,
        profile_dir, allowed_domains, ...) replace the .env value; the rest
        (timezone, locale, vision, ...) still come from .env. A key set to None
        means "none", e.g. profile_dir=None is a throwaway profile."""
        kwargs = cls._env_kwargs()
        unknown = set(config) - set(kwargs)
        if unknown:
            raise TypeError(f"unknown BrowserSession settings: {sorted(unknown)}")
        kwargs.update(config)
        return cls(**kwargs)

    @staticmethod
    def _env_kwargs() -> dict:
        proxy = None
        server = os.getenv("PROXY_SERVER")  # e.g. http://203.0.113.10:8080
        if server:
            proxy = {"server": server}
            if os.getenv("PROXY_USERNAME"):
                proxy["username"] = os.getenv("PROXY_USERNAME")
                proxy["password"] = os.getenv("PROXY_PASSWORD", "")
        return dict(
            proxy=proxy,
            expected_ip=os.getenv("STATIC_IP") or None,
            headless=os.getenv("HEADLESS", "true").lower() != "false",
            timezone_id=os.getenv("BROWSER_TIMEZONE") or None,
            locale=os.getenv("BROWSER_LOCALE") or None,
            allow_any_ip=os.getenv("ALLOW_ANY_EXIT_IP", "false").lower() == "true",
            allowed_domains=_parse_domains(os.getenv("ALLOWED_DOMAINS")),
            vision=os.getenv("VISION", "false").lower() == "true",
            profile_dir=PROFILE_DIR or None,
        )

    def url_allowed(self, url: str) -> bool:
        """True if ALLOWED_DOMAINS is empty or the URL's host is on it (or a subdomain)."""
        if not self.allowed_domains:
            return True
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return True  # about:blank, data:, etc. never leave the machine
        host = (parsed.hostname or "").lower()
        if host in IP_SERVICE_HOSTS:
            return True
        return any(host == d or host.endswith("." + d) for d in self.allowed_domains)

    async def _guard_navigation(self, route: Route) -> None:
        request = route.request
        if request.is_navigation_request() and not self.url_allowed(request.url):
            self.blocked.append(request.url)
            await route.abort("blockedbyclient")
        else:
            await route.continue_()

    async def start(self) -> None:
        self._pw = await async_playwright().start()
        launch = {
            "headless": self.headless,
            # Stop WebRTC from exposing the machine's real IP around the proxy.
            "args": [
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                "--webrtc-ip-handling-policy=disable_non_proxied_udp",
            ],
        }
        if self.proxy:
            launch["proxy"] = self.proxy

        if self.headless:
            ctx = {"viewport": {"width": 1366, "height": 900}}
        else:
            # A visible window: let the page follow the real window size. A fixed
            # viewport bigger than the window pushes content (Gmail's sidebar, the
            # compose box) off-screen.
            launch["args"].append("--start-maximized")
            ctx = {"no_viewport": True}
        if self.timezone_id:
            ctx["timezone_id"] = self.timezone_id  # match the proxy's location
        if self.locale:
            ctx["locale"] = self.locale

        if self.profile_dir:
            # A persistent context writes the whole profile (cookies, logins,
            # localStorage, IndexedDB, cache, service workers) to disk as it goes, so
            # closing the browser or the process loses nothing. It is also the launch
            # mode Patchright recommends for staying undetected.
            Path(self.profile_dir).mkdir(parents=True, exist_ok=True)
            self.context = await self._pw.chromium.launch_persistent_context(
                self.profile_dir, **launch, **ctx)
            self.browser = None  # owned by the context; context.close() shuts Chromium
        else:
            self.browser = await self._pw.chromium.launch(**launch)
            self.context = await self.browser.new_context(**ctx)

        self.context.set_default_navigation_timeout(NAV_TIMEOUT_MS)
        self.context.set_default_timeout(15000)
        if self.allowed_domains:
            # Covers clicks, redirects and scripts too, not just `browse`.
            await self.context.route("**/*", self._guard_navigation)
        # A persistent context opens with one blank tab already; reuse it.
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        self.context.on("page", lambda page: self._opened.append(page))
        await self._restore_session_cookies()

    def _cookie_file(self) -> Path | None:
        return Path(self.profile_dir) / "session_cookies.json" if self.profile_dir else None

    async def _restore_session_cookies(self) -> None:
        """Put back the cookies saved by stop(). The profile keeps cookies that have an
        expiry date, but Chromium drops session cookies (no expiry, used by many
        logins) when it closes; saving them ourselves keeps logins alive."""
        path = self._cookie_file()
        if not path or not path.exists():
            return
        try:
            cookies = json.loads(path.read_text(encoding="utf-8"))
            if cookies:
                await self.context.add_cookies(cookies)
        except Exception:
            pass  # a corrupt file only means those cookies are lost

    async def _save_session_cookies(self) -> None:
        path = self._cookie_file()
        if not path or not self.context:
            return
        try:
            cookies = await self.context.cookies()
            path.write_text(json.dumps(cookies), encoding="utf-8")
        except Exception:
            pass

    def tabs(self) -> list[Page]:
        return [p for p in self.context.pages if not p.is_closed()]

    async def own_page(self) -> Page:
        """A tab of our own (an IP check, an evaluator's verification page), not one
        the site opened: adopt_new_tab must never switch the agent to it."""
        page = await self.context.new_page()
        if page in self._opened:
            self._opened.remove(page)
        return page

    async def close_own_page(self, page: Page | None) -> None:
        if page is None:
            return
        if page in self._opened:
            self._opened.remove(page)
        if not page.is_closed():
            await page.close()

    async def settle_gmail_sends(self) -> None:
        """Wait for any Gmail send still in its Undo window to go out. Leaving or
        closing the tab first cancels the email."""
        for page in self.tabs():
            await wait_for_gmail_send(page)

    async def adopt_new_tab(self) -> bool:
        """Switch to the newest tab the site opened, if any. Returns True if switched."""
        new = [p for p in self._opened if not p.is_closed()]
        self._opened.clear()
        if not new:
            return False
        self._return_to[new[-1]] = self.page
        new[-1].on("close", self._on_close)
        self.page = new[-1]
        await self.page.bring_to_front()
        try:
            await self.page.wait_for_load_state("domcontentloaded", timeout=10000)
        except PWTimeout:
            pass
        return True

    def _on_close(self, page: Page) -> None:
        """A popup we followed closed (e.g. after a Google sign-in): go back to the tab
        that opened it, or to the last open tab."""
        back = self._return_to.pop(page, None)
        if page is not self.page:
            return
        if back is None or back.is_closed():
            tabs = self.tabs()
            back = tabs[-1] if tabs else None
        if back is None:
            return  # no tabs left; close_tab opens a new one
        self.page = back
        self.popup_closed = True
        self.element_frames.clear()

    async def public_ip(self) -> str:
        """Ask an external service which IP our browser traffic exits from."""
        page = await self.own_page()
        errors = []
        try:
            for url, parse in IP_SERVICES:
                try:
                    await page.goto(url, timeout=20000)
                    return parse(await page.inner_text("body"))
                except Exception as e:
                    errors.append(f"{url}: {e.__class__.__name__}")
            raise RuntimeError("Could not determine exit IP: " + "; ".join(errors))
        finally:
            await self.close_own_page(page)

    async def verify_ip(self) -> str:
        """Fail closed: refuse to run if traffic isn't leaving from STATIC_IP."""
        ip = await self.public_ip()
        if not self.expected_ip:
            if self.allow_any_ip:
                return ip
            raise RuntimeError(
                f"STATIC_IP is not set (browser exit IP is {ip}). Set STATIC_IP, "
                "or ALLOW_ANY_EXIT_IP=true to run without the check. Aborting."
            )
        if ip != self.expected_ip:
            raise RuntimeError(
                f"Browser exit IP is {ip}, expected {self.expected_ip}. "
                "Check PROXY_SERVER / credentials. Aborting."
            )
        return ip

    async def stop(self) -> None:
        """Safe to call after a start() that failed part way."""
        if self.context:
            await self.settle_gmail_sends()
            await self._save_session_cookies()
        # Closing the context first flushes site data to the profile folder.
        for closer in (self.context, self.browser):
            try:
                if closer:
                    await closer.close()
            except Exception:
                pass
        if self._pw:
            await self._pw.stop()


async def wait_for_gmail_send(page: Page, max_s: float = 40) -> None:
    """Gmail holds a sent email for its Undo window (up to 30 s) and cancels it if
    the tab is left or closed first. Wait until the "Undo" / "Sending" toast is gone."""
    if page.is_closed() or (urlparse(page.url).hostname or "") != "mail.google.com":
        return
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_s
    while loop.time() < deadline:
        try:
            body = await page.inner_text("body", timeout=3000)
        except Exception:
            return  # the tab navigated or closed: nothing left to wait for
        if not re.search(r"\bUndo\b|\bSending\b", body):
            break
        await asyncio.sleep(1)
    await asyncio.sleep(2)  # let the send request itself finish


def _decode_search_url(url: str) -> str:
    """Turn a search engine's redirect link into the real destination."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    qs = parse_qs(parsed.query)
    if host.endswith("duckduckgo.com") and qs.get("uddg"):
        return qs["uddg"][0]
    if host.endswith("bing.com") and parsed.path.startswith("/ck/") and qs.get("u"):
        raw = qs["u"][0]  # "a1" + base64url of the destination
        if raw.startswith("a1"):
            try:
                return base64.urlsafe_b64decode(raw[2:] + "=" * (-len(raw[2:]) % 4)).decode()
            except Exception:
                pass
    return url


def _safe_filename(name: str, fallback: str = "download") -> str:
    name = unquote(name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\- ]+", "_", name).strip(" ._")
    return name[:120] or fallback


def _filename_from_response(headers: dict, url: str, content_type: str) -> str:
    """File name from Content-Disposition, else the URL path, else the media type."""
    disposition = headers.get("content-disposition", "")
    m = (re.search(r"filename\*=utf-8''([^;]+)", disposition, re.IGNORECASE)
         or re.search(r'filename="?([^";]+)"?', disposition))
    name = _safe_filename(m.group(1) if m else Path(urlparse(url).path).name)
    if "." not in name:
        name += mimetypes.guess_extension(content_type.split(";")[0].strip()) or ""
    return name


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for i in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{i}{path.suffix}")
        if not candidate.exists():
            return candidate
    return path


def _fmt_size(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f} MB"
    return f"{n / 1000:.0f} KB" if n >= 1000 else f"{n} B"


def _parse_pages(spec: str, total: int) -> list[int]:
    """'1-3,7' -> [1, 2, 3, 7], clipped to the document; [] when nothing is selected."""
    pages: set[int] = set()
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            if a.isdigit() and (b.isdigit() or not b):
                pages.update(range(int(a), int(b or total) + 1))
        elif part.isdigit():
            pages.add(int(part))
    return sorted(p for p in pages if 1 <= p <= total)


def _describe_pages(pages: list[int]) -> str:
    """[1, 2, 3, 7] -> '1-3, 7'."""
    parts, start, prev = [], pages[0], pages[0]
    for p in pages[1:] + [None]:
        if p is not None and p == prev + 1:
            prev = p
            continue
        parts.append(str(start) if start == prev else f"{start}-{prev}")
        start = prev = p
    return ", ".join(parts)


def _pdf_text(path: Path, pages: str, max_chars: int) -> str:
    from pypdf import PdfReader  # only read_pdf needs it

    reader = PdfReader(str(path))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            return f"{path.name} is password-protected and cannot be read."
    total = len(reader.pages)
    wanted = _parse_pages(pages, total)
    if pages.strip() and not wanted:
        return f"{path.name} has {total} page(s); '{pages}' selects none of them."
    parts, used, chars, empty = [], [], 0, 0
    for n in wanted or range(1, total + 1):
        text = (reader.pages[n - 1].extract_text() or "").strip()
        empty += not text
        parts.append(f"--- page {n} ---\n{text or '(no text on this page; it may be a scanned image)'}")
        used.append(n)
        chars += len(text)
        if not wanted and chars >= max_chars:
            break
    head = f"{path.name}: {total} page(s)"
    if used and (wanted or used[-1] < total):
        head += f", showing page(s) {_describe_pages(used)}"
    if used and empty == len(used):
        head += ". No text layer found: this is probably a scanned PDF, which read_pdf cannot read"
    return head + "\n\n" + _clean("\n\n".join(parts), max_chars)


async def _race(locators: list[Locator], timeout: int) -> int | None:
    """Wait until any of `locators` is visible; return the index of the first one.

    Each locator gets its own wait so an error in one (a timeout, or a strict-mode
    violation on a multi-match) only drops that candidate instead of ending the
    race. Returns None when none turned visible within `timeout` ms. On a tie the
    lowest index wins, so callers put the most urgent locator first.
    """
    tasks = {
        asyncio.ensure_future(loc.wait_for(state="visible", timeout=timeout)): i
        for i, loc in enumerate(locators)
    }
    winner: int | None = None
    try:
        pending = set(tasks)
        while pending and winner is None:
            finished, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            ok = [tasks[t] for t in finished if t.exception() is None]
            if ok:
                winner = min(ok)
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return winner


async def _click_if_present(locator: Locator, *, timeout: int = 5000) -> bool:
    """Click `locator`; False if it detached or the click failed.

    The Turnstile widget can pass and tear its checkbox down between the moment we
    saw it and the click, so a failed click just means there is nothing left to do.
    """
    try:
        await locator.click(timeout=timeout)
        return True
    except Exception:
        return False


def make_browser_tools(
    session: BrowserSession,
    screenshot_dir: str = "screenshots",
    files_dir: str = "workspace",
    ask_human=None,
):
    """Build LangChain tools bound to one BrowserSession. `upload_file` can only
    read files inside `files_dir` (the agent's workspace). `ask_human(kind,
    question, options)` (see human.py) replaces the terminal prompt for steps that
    need a person, such as manual_captcha_handoff."""

    Path(screenshot_dir).mkdir(parents=True, exist_ok=True)

    async def _page_text(page: Page) -> str:
        """Prefer the page's main content; fall back to the whole body."""
        for sel in ("main", "[role=main]", "article"):
            try:
                el = page.locator(sel).first
                if await el.count():
                    text = await el.inner_text(timeout=3000)
                    if len(text.strip()) > 200:
                        return text
            except Exception:
                pass
        try:
            return await page.inner_text("body")
        except Exception:
            return ""

    async def _visible_frames(page: Page) -> list[tuple[Frame, ElementHandle]]:
        """Child frames whose <iframe> is visible on the page, with that element.
        Hidden ones (trackers, ads) are skipped."""
        out = []
        for frame in page.frames[1:]:
            if frame.is_detached() or frame.url in ("", "about:blank"):
                continue
            try:
                el = await frame.frame_element()
                box = await el.bounding_box()
                if not box or box["width"] < 2 or box["height"] < 2 or not await el.is_visible():
                    continue
            except Exception:
                continue
            out.append((frame, el))
            if len(out) >= MAX_FRAMES:
                break
        return out

    def _is_captcha(url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        if any(host == h or host.endswith("." + h) for h in CAPTCHA_FRAME_HOSTS):
            return True
        return "/recaptcha/" in url

    async def _elements(page: Page, start: int | None = None) -> str:
        """Number the interactive elements of the page and of its visible iframes
        (where "Sign in with Google" buttons live). With `start`, the page's own
        elements are already numbered (inline snapshot) and only frames are listed."""
        session.element_frames.clear()
        items = []
        if start is None:
            try:
                items = list(await page.evaluate(_INDEX_ELEMENTS_JS, [MAX_ELEMENTS, 0]) or [])
            except Exception:
                pass
        n = start if start is not None else len(items)
        frames = await _visible_frames(page)

        async def loaded(frame: Frame) -> None:
            try:
                await frame.wait_for_load_state("domcontentloaded", timeout=1500)
            except Exception:
                pass

        # One wait for all frames instead of up to 1.5 s each in turn.
        if frames:
            await _wait("frames", asyncio.gather(
                *(loaded(f) for f, _el in frames if not _is_captcha(f.url))))
        for frame, el in frames:
            where = urlparse(frame.url).hostname or "inline"
            if _is_captcha(frame.url):
                items.append(f"(CAPTCHA frame from {where}: not listed; see the CAPTCHA rules)")
                continue
            try:
                found = await asyncio.wait_for(
                    frame.evaluate(_INDEX_ELEMENTS_JS, [MAX_FRAME_ELEMENTS, n]), 2)
            except Exception:
                found = []
            if found:
                for k in range(n + 1, n + len(found) + 1):
                    session.element_frames[str(k)] = frame
                items += [f"{line} (in frame {where})" for line in found]
                n += len(found)
                continue
            # Nothing readable inside (still loading, or it refused us): offer the
            # iframe itself, so a click lands in its middle.
            try:
                await el.evaluate("(e, n) => e.setAttribute('data-agent-id', n)", str(n + 1))
                title = (await el.get_attribute("title") or "").strip()[:80]
            except Exception:
                continue
            n += 1
            session.element_frames[str(n)] = frame.parent_frame or page.main_frame
            items.append(f'[{n}] iframe "{title or where}"')
        if not items:
            return ""
        if start is not None:
            return "\n\nInteractive elements inside frames:\n" + "\n".join(items)
        return "\n\nInteractive elements (pass the number as `element` to the tools):\n" + "\n".join(items)

    async def _inline(page: Page, max_chars: int) -> tuple[str, int] | None:
        """The page text with elements numbered in place, and how many were numbered;
        None if the page could not be walked (the caller falls back to the list)."""
        try:
            r = await page.evaluate(_INLINE_SNAPSHOT_JS, [MAX_ELEMENTS, 0, max_chars])
        except Exception:
            return None
        text = ("(Interactive elements are numbered where they appear, like "
                '[12] button "Next"; pass the number as `element` to the tools.)\n\n' + r["text"])
        if r["unlisted"]:
            text += (f"\n\n({r['unlisted']} more interactive elements far from the visible "
                     "area are not numbered; scroll to them and read the page again.)")
        return text, r["count"]

    async def _snapshot(page: Page, status: int | None = None, max_chars: int = MAX_CHARS,
                        full_page: bool = False, unchanged_ok: bool = False) -> str:
        """The page as the model sees it. With `unchanged_ok` (reads that follow an
        action, in fast mode) a page identical to the previous read is reported as
        unchanged, with its element list but without repeating the text."""
        if page.is_closed():
            page = session.page  # the tab closed while we waited; read where we are now
        title = await page.title()
        inline = await _inline(page, max_chars) if session.snapshot_mode == "inline" else None
        if inline is not None:
            body = ""
        elif full_page:
            body = await page.inner_text("body")
        else:
            body = await _page_text(page)
        head = f"URL: {page.url}\nTitle: {title}"
        if status is not None:
            head += f"\nHTTP status: {status}"
        if session.blocked:
            hosts = ", ".join(sorted({urlparse(u).hostname or u for u in session.blocked}))
            session.blocked.clear()
            head = (f"Blocked: navigation to {hosts} was stopped because it is not in "
                    "ALLOWED_DOMAINS. Use go_back to return.\n") + head
        if session.popup_closed:
            session.popup_closed = False
            head = "(The popup tab closed; you are back on the tab that opened it.)\n" + head
        if inline is not None:
            text = inline[0]
            elements = await _elements(page, start=inline[1])
        else:
            text = _clean(body, max_chars)
            elements = await _elements(page)
        session.element_descs = {n: (role, label) for n, role, label in
                                 _ELEMENT_DESC.findall(text + elements)}
        digest = hash((text, elements))
        same = session._last_read == (page.url, digest)
        session._last_read = (page.url, digest)
        if same and unchanged_ok and session.fast_waits:
            return f"{head}\n\n(Page unchanged since the previous read.){elements}"
        return f"{head}\n\n{text}{elements}"

    async def _wait(name: str, awaitable):
        """Run a wait and record how long it took, for the timing report."""
        t0 = time.monotonic()
        try:
            return await awaitable
        finally:
            session.waits.append((name, time.monotonic() - t0))

    async def _after_action(page: Page, note: str = "") -> str:
        """Let the page settle, follow a new tab if one opened, and return a snapshot."""
        try:
            await _wait("load", page.wait_for_load_state("domcontentloaded", timeout=10000))
        except Exception:
            pass  # a timeout, or the action closed this tab (a finished sign-in popup)
        # Give a popup time to appear (the second adopt_new_tab below catches late ones).
        await _wait("popup", asyncio.sleep(0.1 if session.fast_waits else 0.3))
        adopted = await session.adopt_new_tab()
        await _settle(session.page)
        # Some popups (Google sign-in) open a moment later, while the page settles.
        if await session.adopt_new_tab():
            adopted = True
            await _settle(session.page)
        if adopted:
            note = (note + "\n" if note else "") + "(Opened in a new tab; now on that tab.)"
        text = await _gate(session.page, await _snapshot(session.page, unchanged_ok=True))
        return (note + "\n" if note else "") + text

    async def _settle(page: Page, quiet_ms: int = SETTLE_QUIET_MS, max_ms: int = SETTLE_MAX_MS) -> None:
        """Wait until the page stops changing, at most `max_ms`."""
        try:
            await _wait("settle", asyncio.wait_for(
                page.evaluate(_SETTLE_JS, [quiet_ms, max_ms]), max_ms / 1000 + 2))
        except Exception:
            pass  # navigated away or closed mid-wait; the snapshot copes

    async def _gate(page: Page, text: str) -> str:
        """With the decider page gate on, deal with the states the main model would
        otherwise spend a whole round trip on: wait a little longer for a page that
        is still loading, close an overlay that covers the content, and say plainly
        when a page is a sign-in wall or bot check. Every branch only re-reads or
        annotates; nothing here acts on the page's content."""
        if not session.page_gate or not decider.enabled():
            return text
        state = await _wait("decider", decider.page_state(text, stats=session.decider_stats))
        if state == "still_loading":
            await _settle(page, max_ms=2000)
            return "(Waited for the page to finish loading.)\n" + await _snapshot(page)
        if state == "overlay_covering":
            note = await _dismiss(page)
            if note:
                return note + "\n" + await _snapshot(page)
        if state == "bot_check_or_signin":
            return ("(This looks like a sign-in wall, CAPTCHA or access block. Stop and "
                    "report it rather than trying to get around it.)\n" + text)
        return text

    def _by_number(page: Page, target: str | int) -> Locator | None:
        """Locator for an element number from the last page read, or None."""
        n = str(target).strip().lstrip("[").rstrip("]")
        if isinstance(target, int) or n.isdigit():
            frame = session.element_frames.get(n)
            if frame is None or frame.is_detached() or frame.page is not page:
                frame = page.main_frame
            return frame.locator(f'[data-agent-id="{n}"]').first
        return None

    async def _locate(page: Page, target: str | int, roles: tuple[str, ...] = ("link", "button"),
                      allow_hidden: bool = False) -> tuple[Locator | None, str]:
        """Find an element by number, CSS selector, or visible text / label.
        Returns (locator, "") or (None, error message for the model)."""
        loc = _by_number(page, target)
        if loc is not None:
            if await loc.count():
                return loc, ""
            n = str(target).strip("[] ")
            desc = session.element_descs.get(n)
            if desc and n not in session.element_frames:
                try:
                    if await page.evaluate(_REFIND_JS, [n, *desc]):
                        return loc, ""
                except Exception:
                    pass
            return None, (f"No element [{target}] on this page. Numbers change after every "
                          "page read; call read_current_page for fresh ones.")
        target = str(target)
        # The page first, then its visible iframes (e.g. a "Sign in with Google" button).
        scopes = [page.main_frame] + [f for f, _ in await _visible_frames(page)
                                      if not _is_captcha(f.url)]
        candidates = []
        for scope in scopes:
            if re.match(r"^[#.\[]|^[a-z]+[#.\[:]", target):
                candidates.append(scope.locator(target))
            else:
                candidates += [scope.get_by_role(r, name=target) for r in roles] + [
                    scope.get_by_label(target),
                    scope.get_by_placeholder(target),
                    scope.get_by_text(target, exact=False),
                ]
        fallback = None
        for c in candidates:
            try:
                count = min(await c.count(), 10)
            except Exception:
                continue  # e.g. an invalid CSS selector
            for i in range(count):
                if await c.nth(i).is_visible():
                    return c.nth(i), ""
                fallback = fallback or c.nth(i)
        if allow_hidden and fallback is not None:
            return fallback, ""
        return None, (f"No visible element matching '{target}'. Use an element number "
                      "from read_current_page, or a CSS selector.")

    async def _center(loc: Locator) -> tuple[float, float] | None:
        await loc.scroll_into_view_if_needed()
        box = await loc.bounding_box()
        if not box:
            return None
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def _workspace_path(file_path: str) -> tuple[Path | None, str]:
        """Resolve a workspace-relative path, refusing anything outside `files_dir`."""
        root = Path(files_dir).resolve()
        path = (root / str(file_path).strip().lstrip("/\\")).resolve()
        if not path.is_relative_to(root):
            return None, "Only files inside the workspace can be used."
        return path, ""

    def _relative(path: Path) -> str:
        return path.relative_to(Path(files_dir).resolve()).as_posix()

    async def _evaluate(page: Page, js: str, arg=None):
        """page.evaluate that survives a navigation triggered by the previous step."""
        try:
            return await page.evaluate(js, arg)
        except Exception:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
            return await page.evaluate(js, arg)

    def _too_big(size: int) -> str:
        return f"File is {_fmt_size(size)}, above the DOWNLOAD_MAX_MB limit of {DOWNLOAD_MAX_MB:g} MB."

    async def _fetch(url: str, limit: int) -> tuple[bytes | None, str, str, str]:
        """GET `url` with the browser's cookies and proxy (so the static IP applies),
        checking every redirect hop against ALLOWED_DOMAINS.
        Returns (body, file name, content type, error message)."""
        for _ in range(10):
            if not session.url_allowed(url):
                return None, "", "", f"Blocked: {urlparse(url).hostname} is not in ALLOWED_DOMAINS."
            resp = await session.context.request.get(url, timeout=NAV_TIMEOUT_MS, max_redirects=0)
            try:
                location = resp.headers.get("location")
                if 300 <= resp.status < 400 and location:
                    url = urljoin(url, location)
                    continue
                if resp.status >= 400:
                    return None, "", "", f"Download failed: HTTP {resp.status} for {url}."
                length = resp.headers.get("content-length", "")
                if length.isdigit() and int(length) > limit:
                    return None, "", "", _too_big(int(length))
                body = await resp.body()
                headers = resp.headers
            finally:
                await resp.dispose()
            if len(body) > limit:
                return None, "", "", _too_big(len(body))
            content_type = headers.get("content-type", "")
            return body, _filename_from_response(headers, url, content_type), content_type, ""
        return None, "", "", f"Download failed: too many redirects from {url}."

    def _target(save_as: str, suggested: str) -> tuple[Path | None, str]:
        """Where a download goes: `save_as` if given, else a unique name in the workspace."""
        path, err = _workspace_path(save_as.strip() or _safe_filename(suggested))
        if path is None:
            return None, err
        if path.is_dir():
            path = path / _safe_filename(suggested)
        path.parent.mkdir(parents=True, exist_ok=True)
        return (path if save_as.strip() else _unique_path(path)), ""

    # ---- navigation and reading -------------------------------------------------

    @tool
    async def browse(url: str) -> str:
        """Open a URL in the browser and return the page title, visible text and a
        numbered list of interactive elements. Use full URLs including https://."""
        if not session.url_allowed(url):
            return f"Blocked: {urlparse(url).hostname} is not in ALLOWED_DOMAINS."
        async with session.lock:
            try:
                resp = await session.page.goto(url, wait_until="domcontentloaded")
                if resp and "application/pdf" in resp.headers.get("content-type", "").lower():
                    return (f"{url} is a PDF file, not a web page. Save it with "
                            f'download_file(url="{url}") and read it with read_pdf.')
                if not session.fast_waits:
                    try:
                        await _wait("networkidle",
                                    session.page.wait_for_load_state("networkidle", timeout=8000))
                    except PWTimeout:
                        pass  # many sites never go idle; content is usually there
                await _settle(session.page)
                return await _gate(session.page,
                                   await _snapshot(session.page, resp.status if resp else None))
            except Exception as e:
                if "Download is starting" in str(e):
                    return (f"{url} is a file download, not a web page. Save it with "
                            f'download_file(url="{url}"), then read it with read_pdf or the file tools.')
                return f"Failed to open {url}: {type(e).__name__}: {e}"

    @tool
    async def read_current_page(max_chars: int = MAX_CHARS, full_page: bool = False) -> str:
        """Re-read the current page (e.g. after scrolling): text plus a fresh numbered
        list of interactive elements with their state. By default returns the main
        content; set full_page=True to include menus, headers and footers."""
        async with session.lock:
            try:
                return await _snapshot(session.page, max_chars=max_chars, full_page=full_page)
            except Exception as e:
                return f"Could not read the page: {type(e).__name__}: {e}"

    @tool
    async def find_on_page(text: str, max_matches: int = 5) -> str:
        """Search the whole current page for one or more terms (case-insensitive) in a
        single pass. Pass several terms comma-separated, e.g. "price, refund policy,
        contact" to check which of them exist: the result says how many matches each
        term has, whether all were found, and up to `max_matches` snippets per term
        with surrounding context. Scrolls to the first match. Useful for long pages
        whose text was truncated."""
        terms: list[str] = []
        for t in text.split(","):
            t = t.strip()
            if t and t.lower() not in (x.lower() for x in terms):
                terms.append(t)
        if not terms:
            return "Give at least one term to search for (comma-separated for several)."
        async with session.lock:
            page = session.page
            try:
                body = _clean(await page.inner_text("body"), limit=10**7)
            except Exception as e:
                return f"Could not read the page: {type(e).__name__}: {e}"
            # One alternation regex, longest terms first so "price list" wins over "price".
            order = sorted(range(len(terms)), key=lambda i: -len(terms[i]))
            pattern = re.compile(
                "|".join(f"(?P<t{i}>{re.escape(terms[i])})" for i in order), re.IGNORECASE)
            counts = [0] * len(terms)
            snippets: list[list[str]] = [[] for _ in terms]
            first = None
            for m in pattern.finditer(body):
                i = int(m.lastgroup[1:])
                counts[i] += 1
                first = first or m.group(0)
                if len(snippets[i]) < max_matches:
                    start, end = max(0, m.start() - 150), min(len(body), m.end() + 150)
                    snippets[i].append(f"...{body[start:end].strip()}...")
            if first:
                try:
                    await page.get_by_text(first, exact=False).first.scroll_into_view_if_needed(timeout=3000)
                except Exception:
                    pass

            if len(terms) == 1:
                if not counts[0]:
                    return f"'{terms[0]}' was not found on this page."
                more = f" (showing {max_matches})" if counts[0] > max_matches else ""
                return (f"{counts[0]} match(es) for '{terms[0]}'{more}:\n\n"
                        + "\n\n".join(f"{n}. {s}" for n, s in enumerate(snippets[0], 1)))

            found = sum(1 for c in counts if c)
            lines = [f"Found {found} of {len(terms)} terms "
                     f"({'all present' if found == len(terms) else 'not all present'}):"]
            for t, c in zip(terms, counts):
                lines.append(f"- '{t}': {f'{c} match(es)' if c else 'NOT FOUND'}")
            for t, c, snips in zip(terms, counts, snippets):
                if not c:
                    continue
                more = f" (showing {max_matches})" if c > max_matches else ""
                lines.append(f"\n'{t}'{more}:")
                lines.extend(f"{n}. {s}" for n, s in enumerate(snips, 1))
            return "\n".join(lines)

    @tool
    async def list_links(contains: str = "", limit: int = 60) -> str:
        """List links on the current page as 'text -> href'. Optionally filter by a
        substring in the link text or URL."""
        async with session.lock:
            try:
                links = await session.page.eval_on_selector_all(
                    "a[href]",
                    "els => els.map(a => [a.innerText.trim().slice(0, 120), a.href])",
                )
            except Exception as e:
                return f"Could not list links: {type(e).__name__}: {e}"
            needle = contains.lower()
            out, seen = [], set()
            for text, href in links:
                if href in seen or href.startswith("javascript:"):
                    continue
                if needle and needle not in text.lower() and needle not in href.lower():
                    continue
                seen.add(href)
                out.append(f"{text or '(no text)'} -> {href}")
                if len(out) >= limit:
                    break
            return "\n".join(out) or "No matching links."

    @tool
    async def scroll(direction: str = "down", element: str | int | None = None) -> str:
        """Scroll the page: direction 'down' / 'up' (one screen) or 'top' / 'bottom'.
        Or pass `element` to scroll that element into view. Loads lazy content."""
        async with session.lock:
            page = session.page
            try:
                if element is not None:
                    loc, err = await _locate(page, element)
                    if loc is None:
                        return err
                    await loc.scroll_into_view_if_needed()
                elif direction in ("top", "bottom"):
                    y = "0" if direction == "top" else "document.body.scrollHeight"
                    await page.evaluate(f"window.scrollTo(0, {y})")
                else:
                    await page.mouse.wheel(0, 900 if direction == "down" else -900)
                if session.fast_waits:
                    await _settle(page, quiet_ms=200, max_ms=600)
                    return "Scrolled.\n" + await _snapshot(page, unchanged_ok=True)
                await _wait("scroll", page.wait_for_timeout(800))
            except Exception as e:
                return f"Could not scroll: {type(e).__name__}: {e}"
            return "Scrolled. Call read_current_page to see the content."

    @tool
    async def wait_for(text: str = "", seconds: float = 3) -> str:
        """Wait for something to finish loading. With `text`, waits until that text
        appears on the page (up to `seconds`, max 30); otherwise just waits `seconds`.
        Returns the page afterwards."""
        async with session.lock:
            page = session.page
            seconds = max(0.0, min(float(seconds), 30.0))
            note = ""
            try:
                if text:
                    try:
                        await page.get_by_text(text, exact=False).first.wait_for(
                            state="visible", timeout=seconds * 1000)
                        note = f"'{text}' appeared."
                    except PWTimeout:
                        note = f"'{text}' did not appear within {seconds:g}s."
                else:
                    await page.wait_for_timeout(seconds * 1000)
                return note + ("\n" if note else "") + await _snapshot(page)
            except Exception as e:
                return f"Could not wait: {type(e).__name__}: {e}"

    @tool
    async def go_back() -> str:
        """Go back to the previous page."""
        async with session.lock:
            try:
                await session.page.go_back()
                return await _snapshot(session.page)
            except Exception as e:
                return f"Could not go back: {type(e).__name__}: {e}"

    # ---- interacting -------------------------------------------------------------

    @tool
    async def click(element: str | int) -> str:
        """Click an element. Best: the element's number from the latest page read
        (e.g. 12). Also accepts visible text (e.g. 'Next page') or a CSS selector
        (e.g. 'button#submit'). Returns the resulting page."""
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element)
                if loc is None:
                    return err
                await loc.click()
                return await _after_action(page)
            except Exception as e:
                return f"Could not click '{element}': {type(e).__name__}: {e}"

    @tool
    async def type_text(element: str | int, text: str, press_enter: bool = False,
                        clear: bool = True, slowly: bool = False) -> str:
        """Type into an input, textarea or editable area. `element` is best given as
        its number from the latest page read; a CSS selector, placeholder or label
        text also works. `clear=False` appends to the existing text. `slowly=True`
        types key by key, for fields that react to each keystroke (autocomplete,
        search suggestions). `press_enter=True` submits (e.g. a search box)."""
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element, roles=("textbox", "searchbox", "combobox"))
                if loc is None:
                    return err
                if slowly or not clear:
                    if clear:
                        await loc.fill("")
                    else:
                        await loc.click()
                        await page.keyboard.press("End")
                    await loc.press_sequentially(text, delay=40)
                else:
                    await loc.fill(text)
                if press_enter:
                    await loc.press("Enter")
                    return await _after_action(page)
                if session.fast_waits:
                    await _settle(page, quiet_ms=200, max_ms=800)
                    return (f"Typed into '{element}'.\n"
                            + await _snapshot(page, max_chars=2500, unchanged_ok=True))
                return (f"Typed into '{element}'. If suggestions or validation messages "
                        "appeared, call read_current_page to see them.")
            except Exception as e:
                return f"Could not type into '{element}': {type(e).__name__}: {e}"

    @tool
    async def set_checkbox(element: str | int, checked: bool = True) -> str:
        """Tick (checked=True) or untick (checked=False) a checkbox, toggle switch or
        radio button. `element` is its number from the latest page read, or its
        label text. Does nothing if it is already in that state."""
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element, roles=("checkbox", "radio", "switch"),
                                         allow_hidden=True)
                if loc is None:
                    return err
                # A match on label text finds the <label>; read the state of its input.
                state_js = """e => {
                    const t = e.tagName === 'LABEL' && e.control ? e.control : e;
                    return t.matches('input[type=checkbox], input[type=radio]')
                        ? t.checked : t.getAttribute('aria-checked') === 'true';
                }"""
                if await loc.evaluate(state_js) != checked:
                    if await loc.is_visible():
                        await loc.click()
                    else:
                        # Hidden native input behind a styled label: click it directly.
                        await loc.dispatch_event("click")
                    await page.wait_for_timeout(200)
                now = await loc.evaluate(state_js)
                word = "checked" if now else "unchecked"
                if now != checked:
                    return (f"'{element}' is still {word}. It may be disabled, or the site "
                            "uses a custom control: try clicking its label instead.")
                return f"'{element}' is now {word}."
            except Exception as e:
                return f"Could not set '{element}': {type(e).__name__}: {e}"

    @tool
    async def manual_captcha_handoff() -> str:
        """Pause for a person to complete a CAPTCHA in the visible browser.
        Does not interact with or verify the CAPTCHA. Requires HEADLESS=false."""
        if session.headless:
            return ("The browser is headless, so a person cannot interact with it. "
                    "Restart with HEADLESS=false, then call this tool again.")
        if ask_human is not None:
            page_url = session.page.url if session.page and not session.page.is_closed() else ""
            answer = ask_human(
                "captcha",
                f"Complete the CAPTCHA in the browser window ({page_url}), then answer "
                "'done', or 'give up' to stop.", ["done", "give up"])
            if "give up" in str(answer).lower():
                return "The user gave up on the CAPTCHA. Stop and report that the site is blocked."
            return ("The user says the CAPTCHA is done. Completion was not verified; "
                    "read the page and stop if the challenge remains.")
        try:
            await asyncio.to_thread(
                input,
                "Complete the CAPTCHA manually in Chromium, then press Enter here "
                "(or Ctrl+C to stop): ",
            )
        except EOFError:
            return "No user confirmation was received; CAPTCHA handoff was not completed."
        return ("User acknowledged the manual handoff. CAPTCHA completion was not "
                "verified; read the page and stop if the challenge remains.")

    @tool
    async def solve_turnstile(wait_for_text: str = "", seconds: float = TURNSTILE_TIMEOUT_MS / 1000) -> str:
        """Clear a Cloudflare Turnstile check ("Verify you are human" with a single
        checkbox) by clicking its checkbox as soon as it appears. Only for Turnstile;
        for image puzzles or other CAPTCHAs use `manual_captcha_handoff`.

        Turnstile often passes on its own, so with `wait_for_text` (text expected on
        the page once the check is over) the tool returns as soon as either the
        checkbox or that text shows up. Without it, it waits up to `seconds` (max 60)
        for the checkbox and treats "never appeared" as already passed. Returns the
        page afterwards."""
        async with session.lock:
            page = session.page
            timeout = int(max(1.0, min(float(seconds), 60.0)) * 1000)
            # .first on both: Cloudflare can inject several challenge iframes, and an
            # unpinned multi-match raises a strict-mode error instead of resolving.
            checkbox = page.frame_locator(TURNSTILE_IFRAME).first.get_by_role("checkbox").first
            try:
                if not await page.locator(TURNSTILE_IFRAME).count():
                    return "No Cloudflare Turnstile widget on this page." + chr(10) + await _snapshot(page)

                candidates = [checkbox]
                if wait_for_text:
                    candidates.append(page.get_by_text(wait_for_text, exact=False).first)
                winner = await _race(candidates, timeout)

                if winner is None:
                    note = ("The Turnstile checkbox never became visible, so the check was "
                            "treated as already passed.")
                elif winner == 0:
                    if await _click_if_present(checkbox):
                        note = "Clicked the Turnstile checkbox."
                        # Give the widget a moment to verify and the page time to move on.
                        try:
                            await checkbox.wait_for(state="hidden", timeout=10000)
                        except PWTimeout:
                            note += " The checkbox is still showing; the check may have failed."
                    else:
                        note = "The Turnstile checkbox disappeared before it could be clicked (passed on its own)."
                else:
                    note = f"'{wait_for_text}' appeared, so there was no challenge to solve."
                return await _after_action(page, note)
            except Exception as e:
                return f"Could not handle the Turnstile check: {type(e).__name__}: {e}"

    @tool
    async def select_option(element: str | int, option: str) -> str:
        """Choose an option in a dropdown (<select>). `option` is the visible option
        text or its value. For custom (non-<select>) dropdowns, click the dropdown to
        open it and then click the option instead."""
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element, roles=("combobox", "listbox"))
                if loc is None:
                    return err
                tag = await loc.evaluate("e => e.tagName.toLowerCase()")
                if tag != "select":
                    return (f"'{element}' is a <{tag}>, not a native dropdown. Click it to "
                            "open the list, read the page, then click the option.")
                options = await loc.evaluate(
                    "e => Array.from(e.options).map(o => [o.text.trim(), o.value])")
                match = next((v for t, v in options if t == option or v == option), None)
                if match is None:
                    match = next((v for t, v in options if option.lower() in t.lower()), None)
                if match is None:
                    listed = "\n".join(f"- {t} (value: {v})" for t, v in options[:50])
                    return f"No option '{option}' in '{element}'. Available options:\n{listed}"
                await loc.select_option(value=match)
                return await _after_action(page, f"Selected '{option}' in '{element}'.")
            except Exception as e:
                return f"Could not select in '{element}': {type(e).__name__}: {e}"

    @tool
    async def hover(element: str | int) -> str:
        """Move the mouse over an element, e.g. to open a hover menu or show a
        tooltip. Returns the page afterwards."""
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element)
                if loc is None:
                    return err
                await loc.hover()
                await _wait("hover", page.wait_for_timeout(500))
                return await _snapshot(page, unchanged_ok=True)
            except Exception as e:
                return f"Could not hover '{element}': {type(e).__name__}: {e}"

    @tool
    async def drag(source: str | int, target: str | int | None = None,
                   dx: int = 0, dy: int = 0) -> str:
        """Drag an element and drop it onto another element (`target`), or move it
        by an offset in pixels (`dx`, `dy`), e.g. for sliders or reordering lists.
        Elements are best given as numbers from the latest page read."""
        async with session.lock:
            page = session.page
            try:
                src, err = await _locate(page, source)
                if src is None:
                    return err
                start = await _center(src)
                if start is None:
                    return f"'{source}' has no position on screen."
                if target is not None:
                    dst, err = await _locate(page, target)
                    if dst is None:
                        return err
                    end = await _center(dst)
                    start = await _center(src)  # scrolling to the target may move the source
                    if end is None or start is None:
                        return "Could not find both elements on screen."
                elif dx or dy:
                    end = (start[0] + dx, start[1] + dy)
                else:
                    return "Give a `target` element or a `dx`/`dy` offset."
                # Move in small steps: many drag-and-drop libraries ignore jumps.
                await page.mouse.move(*start)
                await page.mouse.down()
                await page.mouse.move(start[0] + 5, start[1] + 5, steps=3)
                await page.mouse.move(*end, steps=20)
                await page.mouse.up()
                return await _after_action(page, f"Dragged '{source}'.")
            except Exception as e:
                return f"Could not drag '{source}': {type(e).__name__}: {e}"

    @tool
    async def press_key(key: str, element: str | int | None = None) -> str:
        """Press a key or shortcut, e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown',
        'PageDown', 'Control+A'. With `element`, focuses that element first.
        Useful for closing popups (Escape) and picking autocomplete suggestions
        (ArrowDown then Enter)."""
        async with session.lock:
            page = session.page
            try:
                if element is not None:
                    loc, err = await _locate(page, element)
                    if loc is None:
                        return err
                    await loc.press(key)
                else:
                    await page.keyboard.press(key)
                return await _after_action(page, f"Pressed {key}.")
            except Exception as e:
                return f"Could not press '{key}': {type(e).__name__}: {e}"

    @tool
    async def upload_file(element: str | int, file_path: str) -> str:
        """Attach a file from your workspace to a file input or upload button.
        `file_path` is a path in your workspace (as used by the file tools)."""
        path, err = _workspace_path(file_path)
        if path is None:
            return err
        if not path.is_file():
            return f"No file at '{file_path}' in the workspace."
        async with session.lock:
            page = session.page
            try:
                loc, err = await _locate(page, element, allow_hidden=True)
                if loc is None:
                    return err
                if await loc.evaluate("e => e.matches('input[type=file]')"):
                    await loc.set_input_files(str(path))
                else:
                    # An upload button that opens the system file picker.
                    async with page.expect_file_chooser(timeout=5000) as chooser:
                        await loc.click()
                    await (await chooser.value).set_files(str(path))
                return await _after_action(page, f"Attached {path.name}.")
            except PWTimeout:
                return f"'{element}' did not open a file picker. Look for a file input or another upload button."
            except Exception as e:
                return f"Could not upload to '{element}': {type(e).__name__}: {e}"

    # ---- searching, extracting and files ------------------------------------------

    @tool
    async def web_search(query: str, max_results: int = 8) -> str:
        """Search the web and get results as title, URL and snippet. Use it when you
        need a page but have no URL, then `browse` the result you want."""
        engines = [SEARCH_ENGINE] + [e for e in _SEARCH_ENGINES if e != SEARCH_ENGINE]
        max_results = max(1, min(int(max_results), 20))
        problems = []
        async with session.lock:
            for engine in engines:
                if engine not in _SEARCH_ENGINES:
                    continue
                url, selector, parse = _SEARCH_ENGINES[engine]
                url = url.format(q=quote_plus(query))
                if not session.url_allowed(url):
                    problems.append(f"{urlparse(url).hostname} is not in ALLOWED_DOMAINS")
                    continue
                # A side tab, so the agent's current page stays where it is.
                page = await session.context.new_page()
                try:
                    if SEARCH_LANGUAGE:
                        primary = SEARCH_LANGUAGE.split("-")[0]
                        await page.set_extra_http_headers(
                            {"Accept-Language": f"{SEARCH_LANGUAGE},{primary};q=0.9"})
                    resp = await page.goto(url, wait_until="domcontentloaded")
                    if resp and resp.status >= 400:
                        problems.append(f"{engine} refused the request (HTTP {resp.status})")
                        continue
                    try:  # Bing may redirect once more before showing results
                        await page.locator(selector).first.wait_for(state="attached", timeout=8000)
                    except PWTimeout:
                        pass
                    results = [r for r in await _evaluate(page, parse) if r.get("url")][:max_results]
                    if results:
                        lines = []
                        for i, r in enumerate(results, 1):
                            line = f"{i}. {r['title'].strip()}\n   {_decode_search_url(r['url'])}"
                            snippet = _clean(r.get("snippet") or "", 300)
                            lines.append(line + (f"\n   {snippet}" if snippet else ""))
                        return f"Top {len(results)} results for '{query}' ({engine}):\n\n" + "\n\n".join(lines)
                    body = (await page.inner_text("body"))[:3000].lower()
                    bot_check = any(w in body for w in ("captcha", "unusual traffic", "are you a robot",
                                                        "verify you are human", "not a bot"))
                    problems.append(f"{engine} showed a bot check" if bot_check else f"{engine} returned no results")
                except Exception as e:
                    problems.append(f"{engine} failed: {type(e).__name__}: {e}")
                finally:
                    await page.close()
        return (f"Search for '{query}' failed: " + "; ".join(problems)
                + ". Try other words, or browse a relevant site and use its own search.")

    @tool
    async def extract_items(container: str = "", limit: int = 30, save_as: str = "",
                            text_chars: int = 300) -> str:
        """Pull the repeated items off a listing page (search results, products,
        articles, job posts, table rows) as title, URL and text in one call. The
        biggest repeated block is detected automatically; pass `container` (a CSS
        selector for the items or their parent) to choose another. `save_as` also
        writes every item as JSON to that file in your workspace, so a long list
        never has to pass through you."""
        async with session.lock:
            page = session.page
            try:
                limit = max(1, min(int(limit), 500 if save_as else 100))
                data = await page.evaluate(_EXTRACT_ITEMS_JS, [container, limit, max(50, int(text_chars))])
            except Exception as e:
                return f"Could not extract items: {type(e).__name__}: {e}"
        if data.get("error"):
            return f"Could not extract items: {data['error']}."
        items = data.get("items") or []
        if not items:
            return ("No repeated items found on this page. Pass `container` with a CSS selector "
                    "for the list, or use read_current_page.")
        head = f"{data['count']} items found in <{data['container']}>"
        if data["count"] > len(items):
            head += f", showing {len(items)}"
        head += ":"
        if save_as:
            path, err = _workspace_path(save_as)
            if path is None:
                return err
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
            head += f"\nSaved all {len(items)} items as JSON to {_relative(path)}."
        lines = []
        for i, item in enumerate(items, 1):
            line = f"{i}. {item['title']}"
            if item.get("url"):
                line += f"\n   {item['url']}"
            if item.get("text") and item["text"] != item["title"]:
                line += f"\n   {item['text']}"
            lines.append(line)
        # Not _clean(): it would collapse the indentation under each item.
        text = head + "\n\n" + "\n\n".join(lines)
        cap = MAX_CHARS * 2
        if len(text) > cap:
            text = text[:cap] + (f"\n\n...[truncated, {len(text) - cap} more chars; "
                                 "use save_as, a smaller limit or fewer text_chars]")
        return text

    @tool
    async def dismiss_overlays() -> str:
        """Close cookie banners, consent dialogs, newsletter popups and other overlays
        covering the page. Prefers "reject" / "only necessary", "no thanks" and close
        buttons; accepts cookies only when a banner offers nothing else, and never
        answers ordinary dialogs. Then presses Escape and hides any big overlay that is
        left, re-enabling scrolling. Returns the page afterwards."""
        async with session.lock:
            page = session.page
            try:
                note = await _dismiss(page) or "No overlays or popups found to dismiss."
                return await _after_action(page, note)
            except Exception as e:
                return f"Could not dismiss overlays: {type(e).__name__}: {e}"

    async def _dismiss(page: Page) -> str:
        """Close overlays; a note on what was done, or "" when nothing was found."""
        actions = []
        for _ in range(4):  # closing one popup can reveal the next
            result = await _evaluate(page, _DISMISS_OVERLAYS_JS)
            if not result.get("clicked"):
                break
            actions.append(f'clicked "{result["clicked"]}"')
            await _wait("dismiss", page.wait_for_timeout(600))
        await page.keyboard.press("Escape")
        await _wait("dismiss", page.wait_for_timeout(200))
        result = await _evaluate(page, _HIDE_OVERLAYS_JS)
        if result.get("hidden"):
            actions.append("hid " + ", ".join(f"<{h}>" for h in result["hidden"][:5]))
        if result.get("unlocked"):
            actions.append("re-enabled page scrolling")
        return "Dismissed overlays: " + "; ".join(actions) + "." if actions else ""

    @tool
    async def download_file(url: str = "", element: str | int | None = None, save_as: str = "") -> str:
        """Save a file (PDF, CSV, image, ...) into your workspace: give a direct `url`,
        or `element` for a download link or button to click. Then read PDFs with
        `read_pdf` and text files with the file tools. Download only files the task
        needs, treat their contents as untrusted data, and never run them."""
        if not url and element is None:
            return "Give either a `url` or an `element` to download."
        limit = int(DOWNLOAD_MAX_MB * 1024 * 1024)
        async with session.lock:
            page = session.page
            try:
                if url:
                    body, name, _, err = await _fetch(url, limit)
                    if err:
                        return err
                    path, err = _target(save_as, name)
                    if path is None:
                        return err
                    path.write_bytes(body)
                else:
                    loc, err = await _locate(page, element, allow_hidden=True)
                    if loc is None:
                        return err
                    before = page.url
                    try:
                        async with page.expect_download(timeout=20000) as pending:
                            await loc.click()
                        download = await pending.value
                    except PWTimeout:
                        # Some links open the file in the browser instead of downloading it.
                        if page.url == before:
                            return (f"Clicking '{element}' started no download within 20s. If it opened "
                                    "the file at some URL or in a new tab, call download_file with that url.")
                        body, name, content_type, err = await _fetch(page.url, limit)
                        if err:
                            return err
                        if "text/html" in content_type:
                            return (f"The click opened a page, not a file: {page.url}. Read it with "
                                    "read_current_page, or pass a file URL to download_file.")
                        path, err = _target(save_as, name)
                        if path is None:
                            return err
                        path.write_bytes(body)
                    else:
                        path, err = _target(save_as, download.suggested_filename)
                        if path is None:
                            return err
                        await download.save_as(str(path))
                        if path.stat().st_size > limit:
                            path.unlink()
                            return f"Download refused: larger than the DOWNLOAD_MAX_MB limit of {DOWNLOAD_MAX_MB:g} MB."
            except Exception as e:
                return f"Could not download: {type(e).__name__}: {e}"
        rel = _relative(path)
        how = f'read_pdf("{rel}")' if path.suffix.lower() == ".pdf" else "the file tools"
        return f"Saved {rel} ({_fmt_size(path.stat().st_size)}) to the workspace. Read it with {how}."

    @tool
    async def read_pdf(file_path: str, pages: str = "", max_chars: int = MAX_CHARS) -> str:
        """Read the text of a PDF in your workspace (for example one saved with
        `download_file`). `pages` picks pages, 1-based, like "1-3,7"; by default pages
        are read from the start until `max_chars` is reached. Scanned PDFs without a
        text layer return little or no text."""
        path, err = _workspace_path(file_path)
        if path is None:
            return err
        if not path.is_file():
            return f"No file at '{file_path}' in the workspace."
        try:
            return await asyncio.to_thread(_pdf_text, path, pages, max(500, int(max_chars)))
        except Exception as e:
            return f"Could not read {path.name}: {type(e).__name__}: {e}"

    # ---- tabs --------------------------------------------------------------------

    @tool
    async def list_tabs() -> str:
        """List open browser tabs; the current one is marked with *."""
        async with session.lock:
            lines = []
            for i, p in enumerate(session.tabs()):
                mark = "*" if p is session.page else " "
                try:
                    title = await p.title()
                except Exception:
                    title = ""
                lines.append(f"{mark}[{i}] {title or '(no title)'} - {p.url}")
            return "\n".join(lines) or "No open tabs."

    @tool
    async def switch_tab(index: int) -> str:
        """Switch to another tab by its number from list_tabs."""
        async with session.lock:
            tabs = session.tabs()
            if not 0 <= index < len(tabs):
                return f"No tab [{index}]; there are {len(tabs)} tab(s)."
            session.page = tabs[index]
            await session.page.bring_to_front()
            return await _snapshot(session.page)

    @tool
    async def close_tab() -> str:
        """Close the current tab and go back to the previous one."""
        async with session.lock:
            try:
                await session.page.close()
            except Exception:
                pass
            session.popup_closed = False  # we closed it ourselves; no need to say so
            if session.page.is_closed():  # else the close handler went back to its opener
                tabs = session.tabs()
                session.page = tabs[-1] if tabs else await session.context.new_page()
            await session.page.bring_to_front()
            return "Closed the tab.\n" + await _snapshot(session.page)

    # ---- other -------------------------------------------------------------------

    @tool
    async def screenshot(name: str = "page") -> str | list:
        """Save a full-page screenshot of the current page to disk. When vision is
        enabled, you also get to see the visible part of the page."""
        async with session.lock:
            safe = re.sub(r"[^\w-]", "_", name)[:60] or "page"
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
            path = Path(screenshot_dir) / f"{safe}-{stamp}.png"
            try:
                await session.page.screenshot(path=str(path), full_page=True)
                note = f"Saved screenshot to {path}"
                if not session.vision:
                    return (note + " for the user. You cannot view it (vision is off); "
                            "use read_current_page to check the page instead.")
                # The viewport only, as JPEG, to keep the image small for the model.
                shot = await session.page.screenshot(type="jpeg", quality=60)
            except Exception as e:
                return f"Could not take a screenshot: {type(e).__name__}: {e}"
            data = base64.b64encode(shot).decode()
            return [
                {"type": "text", "text": note + " (image shows the visible viewport)"},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}},
            ]

    @tool
    async def check_exit_ip() -> str:
        """Report the public IP address the browser is browsing from."""
        async with session.lock:
            try:
                ip = await session.public_ip()
            except Exception as e:
                return f"Could not check the exit IP: {e}"
            note = ""
            if session.expected_ip:
                note = " (matches STATIC_IP)" if ip == session.expected_ip else " (DOES NOT match STATIC_IP!)"
            return f"Browser exit IP: {ip}{note}"

    async def describe_element(target: str | int | None) -> dict | None:
        """_DESCRIBE_JS for the element `target` names (as the tools would find it),
        or the focused element when target is None; None if there is no such element."""
        async with session.lock:
            page = session.page
            if page is None or page.is_closed():
                return None
            try:
                if target is None:
                    handle = await page.evaluate_handle("document.activeElement")
                    el = handle.as_element()
                    return await el.evaluate(_DESCRIBE_JS) if el else None
                loc, err = await _locate(page, target, roles=("button", "link", "textbox",
                                                              "searchbox", "combobox"))
                if loc is None:
                    return None
                return await loc.evaluate(_DESCRIBE_JS, timeout=3000)
            except Exception:
                return None

    session.describe_element = describe_element

    return [
        browse,
        web_search,
        read_current_page,
        find_on_page,
        list_links,
        extract_items,
        scroll,
        wait_for,
        go_back,
        click,
        type_text,
        set_checkbox,
        manual_captcha_handoff,
        solve_turnstile,
        select_option,
        hover,
        drag,
        press_key,
        dismiss_overlays,
        upload_file,
        download_file,
        read_pdf,
        list_tabs,
        switch_tab,
        close_tab,
        screenshot,
        check_exit_ip,
    ]

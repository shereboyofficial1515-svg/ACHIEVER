/* ACHIEVER public pages: menu, documentation search, table of contents,
   and signed-in helpers on the Support and Delete Data pages. No tracking. */
(function () {
  'use strict';
  var API = (window.ACHIEVER_API || '') + '/api';

  // Year in footer
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  // Mobile menu
  var btn = document.querySelector('.menu-button');
  var nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    });
  }

  // Table of contents: highlight the section in view
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && byId[en.target.id]) {
          tocLinks.forEach(function (a) { a.classList.remove('active'); });
          byId[en.target.id].classList.add('active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // Documentation search -------------------------------------------------------------
  var input = document.getElementById('doc-search');
  var results = document.getElementById('doc-search-results');
  if (input && results) {
    var SYNONYMS = {
      otp: 'code verification sms', code: 'otp verification', pin: 'password', login: 'sign in', signin: 'sign in', logon: 'sign in',
      delete: 'deletion remove close', refund: 'refunds reversal duplicate', kyc: 'verification identity level', ajo: 'osusu', esusu: 'osusu',
      fraud: 'suspicious unauthorised dispute', phone: 'phone number sms', email: 'email address', pay: 'payment', money: 'payment payout',
    };
    var index = [];
    document.querySelectorAll('.content [data-doc]').forEach(function (sec) {
      var h = sec.querySelector('h2, h3');
      index.push({ id: sec.id, title: h ? h.textContent : sec.id, text: (sec.textContent || '').replace(/\s+/g, ' ').toLowerCase(), keywords: (sec.getAttribute('data-keywords') || '').toLowerCase() });
    });
    var run = function () {
      var q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) return;
      var terms = q.split(/\s+/);
      terms.slice().forEach(function (t) { if (SYNONYMS[t]) terms = terms.concat(SYNONYMS[t].split(' ')); });
      var scored = index.map(function (s) {
        var score = 0;
        if (s.title.toLowerCase().indexOf(q) !== -1) score += 12;
        if (s.keywords.indexOf(q) !== -1) score += 8;
        if (s.text.indexOf(q) !== -1) score += 6;
        terms.forEach(function (t) {
          if (t.length < 2) return;
          if (s.title.toLowerCase().indexOf(t) !== -1) score += 4;
          if (s.keywords.indexOf(t) !== -1) score += 3;
          if (s.text.indexOf(t) !== -1) score += 1;
        });
        return { s: s, score: score };
      }).filter(function (r) { return r.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
      if (!scored.length) {
        results.innerHTML = '<li><a href="/support.html">No matching help found. Contact support →</a></li>';
        return;
      }
      scored.forEach(function (r) {
        var i = r.s.text.indexOf(terms[0]);
        var snippet = i > -1 ? r.s.text.slice(Math.max(0, i - 50), i + 90) : r.s.text.slice(0, 120);
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + r.s.id;
        var strong = document.createElement('strong'); strong.textContent = r.s.title;
        var span = document.createElement('span'); span.textContent = '…' + snippet + '…';
        a.appendChild(strong); a.appendChild(span);
        a.addEventListener('click', function () { results.innerHTML = ''; });
        li.appendChild(a); results.appendChild(li);
      });
    };
    input.addEventListener('input', run);
    var params = new URLSearchParams(location.search);
    if (params.get('q')) { input.value = params.get('q'); run(); }
  }

  // Helpers for signed-in features ---------------------------------------------------------
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var go = function (token) {
      if (token) headers['X-CSRF-Token'] = token;
      return fetch(API + path, { method: method, credentials: 'include', headers: headers, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
    };
    if (method === 'GET') return go();
    return fetch(API + '/auth/csrf', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (j) { return go(j.data && j.data.csrfToken); });
  }
  function el(id) { return document.getElementById(id); }
  function show(id, on) { var e = el(id); if (e) e.hidden = !on; }
  function text(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Support page: ticket creation and lookup for signed-in users
  if (el('support-auth')) {
    api('GET', '/auth/me').then(function (res) {
      if (!res.ok || !res.body.data) { show('support-signed-out', true); return; }
      show('support-signed-in', true);
      el('support-user').textContent = res.body.data.fullName || 'your account';
      api('GET', '/support/tickets?pageSize=10').then(function (t) {
        var list = el('ticket-list');
        var items = (t.body && t.body.data) || [];
        list.innerHTML = items.length ? items.map(function (c) {
          return '<li><a href="/app/support/' + text(c.id) + '"><strong>' + text(c.caseNumber || c.reference) + '</strong> — ' + text(c.subject) + ' <span class="badge">' + text(String(c.status).replace(/_/g, ' ')) + '</span></a></li>';
        }).join('') : '<li>You have no support cases yet.</li>';
      });
    });
    var form = el('ticket-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = el('ticket-result');
      out.className = 'status'; out.textContent = 'Sending…';
      var data = { category: form.category.value, subject: form.subject.value.trim(), description: form.description.value.trim() };
      api('POST', '/support/tickets', data).then(function (res) {
        if (res.ok) {
          out.className = 'status ok';
          out.innerHTML = 'Case <strong>' + text(res.body.data.caseNumber) + '</strong> opened. <a href="/app/support/' + text(res.body.data.id) + '">Add evidence or follow it in the app</a>.';
          form.reset();
        } else {
          var fields = res.body.error && res.body.error.details && res.body.error.details.fields;
          out.className = 'status err';
          out.textContent = fields ? Object.keys(fields).map(function (k) { return k + ': ' + fields[k]; }).join(' · ') : (res.body.message || 'Could not open the case. Please try again.');
        }
      });
    });
  }

  // Delete Data page: show request status and allow cancellation
  if (el('deletion-status')) {
    var render = function () {
      api('GET', '/privacy/deletion-requests').then(function (res) {
        if (res.status === 401 || res.status === 403) { show('deletion-signed-out', true); show('deletion-signed-in', false); return; }
        show('deletion-signed-in', true);
        var items = (res.body && res.body.data) || [];
        var box = el('deletion-list');
        box.innerHTML = items.length ? items.map(function (r) {
          return '<li><strong>' + (r.type === 'account' ? 'Account deletion' : 'Personal data deletion') + '</strong> <span class="badge">' + text(r.status.replace(/_/g, ' ')) + '</span><br><span class="small muted">Requested ' + text(new Date(r.createdAt).toLocaleString()) + (r.canCancel ? ' · can be cancelled until ' + text(new Date(r.cancellableUntil).toLocaleString()) : '') + '</span>' +
            (r.canCancel ? ' <button class="btn btn-ghost" data-cancel="' + text(r.id) + '" type="button">Cancel request</button>' : '') + '</li>';
        }).join('') : '<li>You have no deletion requests.</li>';
        box.querySelectorAll('[data-cancel]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            api('POST', '/privacy/deletion-requests/' + b.getAttribute('data-cancel') + '/cancel').then(render);
          });
        });
      });
    };
    render();
  }
})();

/* =========================================================
   Accounts (email + password) and cloud sync — Supabase
   Settings live in config.js. No extra libraries needed:
   this talks to Supabase's REST API with fetch().
   ========================================================= */
'use strict';

const Auth = (() => {
  const cfg = window.FITLOG_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = String(cfg.supabaseKey || '');
  const SESSION_KEY = 'fitlog.session';
  const configured = /^https:\/\//.test(BASE) && !BASE.includes('YOUR_') && KEY.length > 20 && !KEY.includes('YOUR_');

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }

  function store(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function fromToken(t, user) {
    const u = user || t.user;
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (Number(t.expires_in) || 3600),
      user: u ? { id: u.id, email: u.email } : null,
    };
  }

  const MESSAGES = {
    'Invalid login credentials': 'Wrong email or password.',
    'User already registered': 'This email already has an account — log in instead.',
    'Email not confirmed': 'Please confirm your email first — check your inbox (and spam).',
    'Password should be at least 6 characters.': 'Password must be at least 6 characters.',
  };
  function friendly(data, status) {
    const msg = (data && (data.error_description || data.msg || data.message || data.error)) || `Something went wrong (${status}).`;
    if (status === 429) return 'Too many tries — wait a minute and try again.';
    return MESSAGES[msg] || msg;
  }

  async function call(path, { method = 'POST', body, token, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          apikey: KEY,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('No internet connection.');
      err.offline = true;
      throw err;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const err = new Error(friendly(data, res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const here = () => location.origin + location.pathname;

  /** Returns a fresh access token, refreshing it if needed. null = offline / not logged in. */
  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try {
      const d = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
      store(fromToken(d, d.user || session.user));
      return session.access_token;
    } catch (e) {
      if (e.offline) return null;
      store(null); // refresh token no longer valid → must log in again
      const err = new Error('Your session expired — please log in again.');
      err.expired = true;
      throw err;
    }
  }

  return {
    configured,
    get user() { return session && session.user; },

    async signUp(email, password) {
      const d = await call('/auth/v1/signup?redirect_to=' + encodeURIComponent(here()), { body: { email, password } });
      // If "Confirm email" is off in Supabase, we get a session straight away
      if (d && d.access_token) { store(fromToken(d)); return { loggedIn: true }; }
      return { loggedIn: false };
    },

    async signIn(email, password) {
      const d = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
      store(fromToken(d));
    },

    async signOut() {
      const t = session && session.access_token;
      store(null);
      if (t) { try { await call('/auth/v1/logout', { token: t }); } catch (e) { /* already logged out locally */ } }
    },

    async recover(email) {
      await call('/auth/v1/recover?redirect_to=' + encodeURIComponent(here()), { body: { email } });
    },

    async updatePassword(password) {
      const t = await token();
      if (!t) throw new Error('No internet connection.');
      await call('/auth/v1/user', { method: 'PUT', token: t, body: { password } });
    },

    /** Handles the link from a confirmation / password-reset email (#access_token=... in the URL). */
    async handleRedirect() {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const clean = () => history.replaceState(null, '', location.pathname + location.search);
      if (hash.get('error_description')) {
        clean();
        return { error: hash.get('error_description').replace(/\+/g, ' ') };
      }
      const access = hash.get('access_token');
      if (!access) return null;
      clean();
      try {
        const user = await call('/auth/v1/user', { method: 'GET', token: access });
        store(fromToken({ access_token: access, refresh_token: hash.get('refresh_token'), expires_in: hash.get('expires_in') }, user));
        return { type: hash.get('type') || 'login' };
      } catch (e) {
        return { error: 'This link has expired. Please try again.' };
      }
    },

    /** Deletes the account and all its cloud data (supabase-delete-account.sql). */
    async deleteAccount() {
      const t = await token();
      if (!t) throw new Error('You need internet to delete your account.');
      try {
        await call('/rest/v1/rpc/delete_my_account', { token: t, body: {} });
      } catch (e) {
        if (e.status === 404) throw new Error('Account deletion is not set up yet (run supabase-delete-account.sql in Supabase).');
        throw e;
      }
      store(null);
    },

    /* ----- cloud data (one row per user in the user_data table) ----- */

    /** undefined = offline, null = nothing saved in the cloud yet, otherwise { data, updated_at } */
    async pull() {
      const t = await token();
      if (!t) return undefined;
      const rows = await call(`/rest/v1/user_data?select=data,updated_at&user_id=eq.${session.user.id}`, { method: 'GET', token: t });
      return rows && rows.length ? rows[0] : null;
    },

    /** Saves the whole app data to the cloud. Returns false when offline. */
    async push(data) {
      const t = await token();
      if (!t) return false;
      await call('/rest/v1/user_data?on_conflict=user_id', {
        token: t,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: session.user.id, data, updated_at: new Date().toISOString() },
      });
      return true;
    },
  };
})();

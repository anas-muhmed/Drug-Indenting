// Attaches the logged-in user's JWT to every outgoing request, whether it
// goes through axios or the native fetch() — this codebase uses both
// inconsistently across components, so rather than editing every call site
// individually, this sets it up once, centrally, at app startup.
//
// Only the regular-user token ('token' in localStorage) is handled here.
// The admin portal (AdminDashboard.js) already funnels every request
// through its own adminHeaders() helper and sends its own Authorization
// header explicitly — this file never overwrites a header a caller already
// set, so the two don't conflict.

import axios from 'axios';

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const token = localStorage.getItem('token');
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return originalFetch(input, { ...init, headers });
};

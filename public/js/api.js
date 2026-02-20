// ===== API Client =====
const API = {
  base: '',
  token: localStorage.getItem('replyping_token'),

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('replyping_token', token);
    } else {
      localStorage.removeItem('replyping_token');
    }
  },

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(`${this.base}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },

  // Auth
  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.setToken(data.token);
    return data;
  },

  async register(email, password, name) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    this.setToken(data.token);
    return data;
  },

  async getMe() {
    return this.request('/api/auth/me');
  },

  // Todos
  async getTodos(status) {
    const q = status ? `?status=${status}` : '';
    return this.request(`/api/todos${q}`);
  },

  async getStats() {
    return this.request('/api/todos/stats');
  },

  async markDone(id) {
    return this.request(`/api/todos/${id}/done`, { method: 'PUT' });
  },

  async snooze(id, minutes) {
    return this.request(`/api/todos/${id}/snooze`, {
      method: 'PUT',
      body: JSON.stringify({ minutes })
    });
  },

  async unreply(id) {
    return this.request(`/api/todos/${id}/unreply`, { method: 'PUT' });
  },

  async addNote(id, note) {
    return this.request(`/api/todos/${id}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note })
    });
  },

  // Rules
  async getRules() {
    return this.request('/api/rules');
  },

  async updateRules(rules) {
    return this.request('/api/rules', {
      method: 'PUT',
      body: JSON.stringify(rules)
    });
  },

  // Notifications
  async getNotifications() {
    return this.request('/api/notifications');
  },

  async markNotificationRead(id) {
    return this.request(`/api/notifications/${id}/read`, { method: 'PUT' });
  },

  async markAllNotificationsRead() {
    return this.request('/api/notifications/read-all', { method: 'PUT' });
  },

  // Billing
  async getPlans() {
    return this.request('/api/billing/plans');
  },

  async getBillingStatus() {
    return this.request('/api/billing/status');
  },

  async createCheckout() {
    return this.request('/api/billing/checkout', { method: 'POST' });
  },

  async createPortal() {
    return this.request('/api/billing/portal', { method: 'POST' });
  },

  async demoUpgrade() {
    return this.request('/api/billing/demo-upgrade', { method: 'POST' });
  },

  // Reply
  async replyToTodo(id, message) {
    return this.request(`/api/todos/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  },

  async getChannelStatus() {
    return this.request('/api/todos/channel-status');
  },

  // Dev simulate
  async simulate(data) {
    return this.request('/api/dev/simulate', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};

// ===== ReplyPing SPA =====
const App = {
  currentScreen: 'inbox',
  currentTab: 'unreplied',
  user: null,
  stats: {},
  todos: [],
  rules: {},
  notifications: [],
  unreadCount: 0,
  notifPanelOpen: false,
  refreshInterval: null,

  // ===== INIT =====
  async init() {
    if (API.token) {
      try {
        const data = await API.getMe();
        this.user = data.user;
        this.renderApp();
        this.startPolling();
      } catch (e) {
        API.setToken(null);
        this.renderAuth('login');
      }
    } else {
      this.renderAuth('login');
    }
  },

  startPolling() {
    this.loadData();
    this.refreshInterval = setInterval(() => this.loadData(), 15000);
  },

  stopPolling() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  },

  async loadData() {
    try {
      const [statsData, todosData, notifData] = await Promise.all([
        API.getStats(),
        API.getTodos(this.currentTab),
        API.getNotifications()
      ]);
      this.stats = statsData;
      this.todos = todosData.todos;
      this.notifications = notifData.notifications;
      this.unreadCount = notifData.unread_count;
      this.updateUI();
    } catch (e) {
      console.error('Load data error:', e);
    }
  },

  updateUI() {
    // Update stats
    const el = (id) => document.getElementById(id);
    if (el('stat-unreplied')) el('stat-unreplied').textContent = this.stats.unreplied || 0;
    if (el('stat-overdue')) el('stat-overdue').textContent = this.stats.overdue || 0;
    if (el('stat-due-soon')) el('stat-due-soon').textContent = this.stats.dueSoon || 0;

    // Update notification badge
    const badge = el('notif-badge');
    if (badge) {
      badge.textContent = this.unreadCount;
      badge.style.display = this.unreadCount > 0 ? 'flex' : 'none';
    }

    // Update tab counts
    if (el('tab-count-unreplied')) el('tab-count-unreplied').textContent = this.stats.unreplied || 0;
    if (el('tab-count-snoozed')) el('tab-count-snoozed').textContent = this.stats.snoozed || 0;
    if (el('tab-count-done')) el('tab-count-done').textContent = this.stats.done || 0;

    // Re-render todo list only
    const listEl = el('todo-list');
    if (listEl) {
      listEl.innerHTML = this.renderTodoList();
      this.bindTodoActions();
    }
  },

  // ===== AUTH SCREENS =====
  renderAuth(mode) {
    const isLogin = mode === 'login';
    document.getElementById('app').innerHTML = `
      <div class="auth-screen">
        <div class="auth-logo">&#x1F514;</div>
        <div class="auth-title">ReplyPing</div>
        <div class="auth-subtitle">Never miss a customer message again</div>
        <form class="auth-form" id="auth-form">
          <div id="auth-error"></div>
          ${!isLogin ? `
            <div class="form-group">
              <label>Your Name</label>
              <input type="text" id="auth-name" placeholder="Jane Smith" autocomplete="name">
            </div>
          ` : ''}
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="auth-email" placeholder="you@business.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="auth-password" placeholder="${isLogin ? 'Enter password' : 'Min 6 characters'}" required autocomplete="${isLogin ? 'current-password' : 'new-password'}">
          </div>
          <button type="submit" class="btn btn-primary">${isLogin ? 'Sign In' : 'Create Account'}</button>
        </form>
        <div class="auth-switch">
          ${isLogin
            ? 'New here? <a id="switch-auth">Create an account</a>'
            : 'Already have an account? <a id="switch-auth">Sign in</a>'}
        </div>
        ${isLogin ? '<div style="margin-top:12px;font-size:12px;color:var(--text-muted)">Demo: demo@replyping.com / demo123</div>' : ''}
      </div>
    `;

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      const errEl = document.getElementById('auth-error');

      try {
        let data;
        if (isLogin) {
          data = await API.login(email, password);
        } else {
          const name = document.getElementById('auth-name').value;
          data = await API.register(email, password, name);
        }
        this.user = data.user;
        this.renderApp();
        this.startPolling();
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
      }
    });

    document.getElementById('switch-auth').addEventListener('click', () => {
      this.renderAuth(isLogin ? 'register' : 'login');
    });
  },

  // ===== MAIN APP =====
  renderApp() {
    document.getElementById('app').innerHTML = `
      ${this.renderHeader()}
      <div id="main-content">${this.renderCurrentScreen()}</div>
      ${this.renderBottomNav()}
      <div id="notif-panel" class="notif-panel"></div>
      <div id="toast-container"></div>
    `;
    this.bindNavigation();
    this.bindTodoActions();
  },

  renderHeader() {
    return `
      <header class="app-header">
        <div class="header-top">
          <div class="header-title">&#x1F514; ReplyPing</div>
          <div class="header-actions">
            <button class="header-btn" id="btn-notif" title="Notifications">
              &#x1F4E8;
              <span class="notification-badge" id="notif-badge" style="display:${this.unreadCount > 0 ? 'flex' : 'none'}">${this.unreadCount}</span>
            </button>
            <button class="header-btn" id="btn-logout" title="Log out">&#x23FB;</button>
          </div>
        </div>
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-number" id="stat-unreplied">${this.stats.unreplied || 0}</div>
            <div class="stat-label">Unreplied</div>
          </div>
          <div class="stat-card overdue">
            <div class="stat-number" id="stat-overdue">${this.stats.overdue || 0}</div>
            <div class="stat-label">Overdue</div>
          </div>
          <div class="stat-card due-soon">
            <div class="stat-number" id="stat-due-soon">${this.stats.dueSoon || 0}</div>
            <div class="stat-label">Due Soon</div>
          </div>
        </div>
      </header>
    `;
  },

  renderCurrentScreen() {
    switch (this.currentScreen) {
      case 'inbox': return this.renderInbox();
      case 'rules': return this.renderRulesScreen();
      case 'dev': return this.renderDevPanel();
      default: return this.renderInbox();
    }
  },

  // ===== INBOX =====
  renderInbox() {
    return `
      <div class="tabs">
        <button class="tab ${this.currentTab === 'unreplied' ? 'active' : ''}" data-tab="unreplied">
          &#x1F4E9; Unreplied <span class="tab-count" id="tab-count-unreplied">${this.stats.unreplied || 0}</span>
        </button>
        <button class="tab ${this.currentTab === 'snoozed' ? 'active' : ''}" data-tab="snoozed">
          &#x23F0; Snoozed <span class="tab-count" id="tab-count-snoozed">${this.stats.snoozed || 0}</span>
        </button>
        <button class="tab ${this.currentTab === 'done' ? 'active' : ''}" data-tab="done">
          &#x2705; Done <span class="tab-count" id="tab-count-done">${this.stats.done || 0}</span>
        </button>
      </div>
      <div class="todo-list" id="todo-list">
        ${this.renderTodoList()}
      </div>
    `;
  },

  renderTodoList() {
    if (this.todos.length === 0) {
      const messages = {
        unreplied: { icon: '&#x1F389;', title: 'All caught up!', text: 'No unreplied messages. Great job!' },
        snoozed: { icon: '&#x1F634;', title: 'Nothing snoozed', text: 'No snoozed messages right now.' },
        done: { icon: '&#x1F4CB;', title: 'No completed items', text: 'Completed replies will show here.' }
      };
      const m = messages[this.currentTab] || messages.unreplied;
      return `
        <div class="empty-state">
          <div class="empty-state-icon">${m.icon}</div>
          <div class="empty-state-title">${m.title}</div>
          <div class="empty-state-text">${m.text}</div>
        </div>
      `;
    }

    return this.todos.map(todo => this.renderTodoCard(todo)).join('');
  },

  renderTodoCard(todo) {
    const isOverdue = this.isTodoOverdue(todo);
    const channelIcon = todo.channel_type === 'instagram' ? '&#x1F4F7;' : '&#x1F4AC;';
    const timeAgo = this.timeAgo(todo.last_message_time);
    const channelClass = `channel-${todo.channel_type}`;

    let actions = '';
    if (todo.status === 'unreplied') {
      actions = `
        <button class="btn btn-sm btn-done" data-action="done" data-id="${todo.id}">&#x2713; Done</button>
        <div class="snooze-dropdown">
          <button class="btn btn-sm btn-snooze" data-action="snooze-toggle" data-id="${todo.id}">&#x23F0; Snooze</button>
          <div class="snooze-options" id="snooze-${todo.id}" style="display:none">
            <button class="snooze-option" data-action="snooze" data-id="${todo.id}" data-minutes="15">&#x23F1; 15 minutes</button>
            <button class="snooze-option" data-action="snooze" data-id="${todo.id}" data-minutes="60">&#x1F551; 1 hour</button>
            <button class="snooze-option" data-action="snooze" data-id="${todo.id}" data-minutes="eod">&#x1F31C; End of day</button>
          </div>
        </div>
        <button class="btn btn-sm btn-outline" data-action="note" data-id="${todo.id}">&#x1F4DD;</button>
        <button class="btn btn-sm btn-outline" data-action="open-channel" data-channel="${todo.channel_type}" title="Open ${todo.channel_type}">&#x1F517;</button>
      `;
    } else if (todo.status === 'snoozed') {
      actions = `
        <button class="btn btn-sm btn-done" data-action="done" data-id="${todo.id}">&#x2713; Done</button>
        <button class="btn btn-sm btn-outline" data-action="unreply" data-id="${todo.id}">&#x21A9; Wake Up</button>
        <button class="btn btn-sm btn-outline" data-action="note" data-id="${todo.id}">&#x1F4DD;</button>
      `;
    } else {
      actions = `
        <button class="btn btn-sm btn-outline" data-action="unreply" data-id="${todo.id}">&#x21A9; Reopen</button>
        <button class="btn btn-sm btn-outline" data-action="note" data-id="${todo.id}">&#x1F4DD;</button>
      `;
    }

    let snoozeBadge = '';
    if (todo.status === 'snoozed' && todo.snoozed_until) {
      snoozeBadge = `<div class="todo-snoozed-badge">&#x23F0; Snoozed until ${this.formatTime(todo.snoozed_until)}</div>`;
    }

    let noteHtml = '';
    if (todo.note) {
      noteHtml = `
        <div class="todo-note">
          <div class="todo-note-label">Note</div>
          ${this.escapeHtml(todo.note)}
        </div>
      `;
    }

    return `
      <div class="todo-card ${channelClass} ${isOverdue ? 'overdue' : ''}">
        <div class="todo-card-header">
          <div class="channel-icon ${todo.channel_type}">${channelIcon}</div>
          <div class="todo-contact">
            <div class="todo-contact-name">${this.escapeHtml(todo.contact_name)}</div>
            <div class="todo-contact-handle">@${this.escapeHtml(todo.contact_handle)} &middot; ${todo.channel_type}</div>
          </div>
          <div class="todo-time ${isOverdue ? 'overdue' : ''}">${timeAgo}</div>
        </div>
        ${snoozeBadge}
        <div class="todo-message">${this.escapeHtml(todo.last_message_preview)}</div>
        ${noteHtml}
        <div class="todo-actions">${actions}</div>
      </div>
    `;
  },

  // ===== RULES SCREEN =====
  renderRulesScreen() {
    return `
      <div class="screen" id="rules-screen">
        <div class="screen-title">&#x2699; Reminder Rules</div>
        <div class="loading"><div class="spinner"></div>Loading rules...</div>
      </div>
    `;
  },

  async loadAndRenderRules() {
    try {
      const data = await API.getRules();
      this.rules = data.rules;
      const screen = document.getElementById('rules-screen');
      if (!screen) return;

      const remindValues = [15, 30, 60];
      const isCustomRemind = !remindValues.includes(this.rules.remind_after_minutes);

      screen.innerHTML = `
        <div class="screen-title">&#x2699; Reminder Rules</div>
        <div class="settings-card">
          <div class="settings-card-title">&#x23F1; Remind After</div>
          <div class="chip-group" id="remind-chips">
            ${remindValues.map(v => `
              <button class="chip ${this.rules.remind_after_minutes === v ? 'active' : ''}" data-minutes="${v}">${v}m</button>
            `).join('')}
            <button class="chip ${isCustomRemind ? 'active' : ''}" data-minutes="custom">Custom</button>
          </div>
          ${isCustomRemind ? `
            <div class="form-group" style="margin-top:12px">
              <input type="number" id="custom-remind" value="${this.rules.remind_after_minutes}" min="1" max="1440" placeholder="Minutes" style="width:120px">
              <button class="btn btn-sm btn-primary" id="save-custom-remind" style="margin-left:8px;width:auto">Save</button>
            </div>
          ` : ''}
        </div>

        <div class="settings-card">
          <div class="settings-card-title">&#x1F4BC; Business Hours</div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Start Time</div>
            </div>
            <div class="setting-value">
              <input type="time" id="bh-start" value="${this.rules.business_hours_start || '09:00'}" style="padding:8px;border:2px solid var(--border);border-radius:6px;font-family:inherit">
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">End Time</div>
            </div>
            <div class="setting-value">
              <input type="time" id="bh-end" value="${this.rules.business_hours_end || '17:00'}" style="padding:8px;border:2px solid var(--border);border-radius:6px;font-family:inherit">
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Weekend Reminders</div>
              <div class="setting-desc">Send reminders on Sat & Sun</div>
            </div>
            <button class="toggle ${this.rules.weekend_enabled ? 'active' : ''}" id="weekend-toggle"></button>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">&#x1F6A8; Escalation</div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Escalate After (hours)</div>
              <div class="setting-desc">0 = disabled. Send urgent alert after X hours.</div>
            </div>
            <div class="setting-value">
              <input type="number" id="escalation-hours" value="${this.rules.escalation_hours || 0}" min="0" max="72" style="width:70px;padding:8px;border:2px solid var(--border);border-radius:6px;font-family:inherit;text-align:center">
            </div>
          </div>
        </div>

        <button class="btn btn-primary" id="save-rules" style="margin-top:8px">Save All Settings</button>
      `;

      this.bindRulesActions();
    } catch (e) {
      console.error('Load rules error:', e);
    }
  },

  bindRulesActions() {
    // Remind chips
    document.querySelectorAll('#remind-chips .chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const mins = chip.dataset.minutes;
        if (mins === 'custom') {
          this.rules.remind_after_minutes = this.rules.remind_after_minutes || 45;
          this.loadAndRenderRules();
          return;
        }
        try {
          await API.updateRules({ remind_after_minutes: parseInt(mins) });
          this.rules.remind_after_minutes = parseInt(mins);
          this.loadAndRenderRules();
          this.toast('Reminder time updated');
        } catch (e) { this.toast('Failed to update'); }
      });
    });

    // Custom remind save
    const saveCustom = document.getElementById('save-custom-remind');
    if (saveCustom) {
      saveCustom.addEventListener('click', async () => {
        const val = parseInt(document.getElementById('custom-remind').value);
        if (val > 0) {
          try {
            await API.updateRules({ remind_after_minutes: val });
            this.rules.remind_after_minutes = val;
            this.toast('Custom reminder time saved');
          } catch (e) { this.toast('Failed to update'); }
        }
      });
    }

    // Weekend toggle
    const weekendToggle = document.getElementById('weekend-toggle');
    if (weekendToggle) {
      weekendToggle.addEventListener('click', async () => {
        const newVal = !this.rules.weekend_enabled;
        try {
          await API.updateRules({ weekend_enabled: newVal });
          this.rules.weekend_enabled = newVal ? 1 : 0;
          weekendToggle.classList.toggle('active');
          this.toast(newVal ? 'Weekend reminders on' : 'Weekend reminders off');
        } catch (e) { this.toast('Failed to update'); }
      });
    }

    // Save all
    const saveAll = document.getElementById('save-rules');
    if (saveAll) {
      saveAll.addEventListener('click', async () => {
        try {
          const data = {
            business_hours_start: document.getElementById('bh-start').value,
            business_hours_end: document.getElementById('bh-end').value,
            escalation_hours: parseInt(document.getElementById('escalation-hours').value) || 0
          };
          await API.updateRules(data);
          this.toast('Settings saved!');
        } catch (e) { this.toast('Failed to save settings'); }
      });
    }
  },

  // ===== DEV PANEL =====
  renderDevPanel() {
    return `
      <div class="dev-panel">
        <div class="screen-title">&#x1F6E0; Developer Panel</div>

        <div class="dev-card">
          <div class="dev-card-title">&#x1F4E8; Quick Test Messages</div>
          <div class="dev-card-desc">Simulate inbound messages from customers</div>
          <div class="dev-buttons">
            <button class="btn btn-sm btn-ig" id="test-ig">&#x1F4F7; Instagram DM</button>
            <button class="btn btn-sm btn-wa" id="test-wa">&#x1F4AC; WhatsApp Msg</button>
          </div>
        </div>

        <div class="dev-card">
          <div class="dev-card-title">&#x1F3AF; Custom Test Message</div>
          <div class="dev-card-desc">Create a specific test message</div>
          <div class="form-group">
            <label>Channel</label>
            <select id="sim-channel">
              <option value="instagram">Instagram</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <div class="form-group">
            <label>Contact Name</label>
            <input type="text" id="sim-name" placeholder="Jane Smith">
          </div>
          <div class="form-group">
            <label>Contact Handle</label>
            <input type="text" id="sim-handle" placeholder="@janesmith or +15551234567">
          </div>
          <div class="form-group">
            <label>Message</label>
            <input type="text" id="sim-message" placeholder="Hi, I'd like to place an order...">
          </div>
          <div class="form-group">
            <label>Direction</label>
            <select id="sim-direction">
              <option value="inbound">Inbound (from customer)</option>
              <option value="outbound">Outbound (your reply)</option>
            </select>
          </div>
          <button class="btn btn-primary" id="sim-send">Send Test Message</button>
        </div>

        <div class="dev-card">
          <div class="dev-card-title">&#x1F4E1; Webhook URLs</div>
          <div class="dev-card-desc">Use these endpoints for real integrations</div>
          <div style="background:var(--bg);padding:12px;border-radius:8px;font-size:13px;font-family:monospace;margin-bottom:8px;word-break:break-all">
            POST ${window.location.origin}/webhooks/instagram
          </div>
          <div style="background:var(--bg);padding:12px;border-radius:8px;font-size:13px;font-family:monospace;word-break:break-all">
            POST ${window.location.origin}/webhooks/whatsapp
          </div>
        </div>
      </div>
    `;
  },

  bindDevActions() {
    const testIg = document.getElementById('test-ig');
    const testWa = document.getElementById('test-wa');
    const simSend = document.getElementById('sim-send');

    if (testIg) {
      testIg.addEventListener('click', async () => {
        const names = ['Sarah Miller', 'Alex Chen', 'Maria Garcia', 'James Wilson', 'Emma Davis'];
        const messages = [
          'Hi! I saw your product on my feed. Do you ship internationally?',
          'Hey, what are your business hours?',
          'I placed an order last week. Can you check the status?',
          'Love your work! Do you do custom orders?',
          'Quick question about your return policy?'
        ];
        const name = names[Math.floor(Math.random() * names.length)];
        const msg = messages[Math.floor(Math.random() * messages.length)];
        try {
          await API.simulate({
            channel: 'instagram',
            contact_name: name,
            contact_handle: name.toLowerCase().replace(' ', '_'),
            message: msg
          });
          this.toast(`Instagram DM from ${name}`);
          this.loadData();
        } catch (e) { this.toast('Failed to simulate'); }
      });
    }

    if (testWa) {
      testWa.addEventListener('click', async () => {
        const names = ['Mike Johnson', 'Priya Patel', 'Carlos Rivera', 'Lisa Wong', 'Tom Brown'];
        const messages = [
          'Hello, I want to order 5 units. What\'s the price?',
          'Can you send me the catalog?',
          'When will my delivery arrive?',
          'Is this item available in blue?',
          'Thanks for the info! I\'d like to proceed with the order.'
        ];
        const name = names[Math.floor(Math.random() * names.length)];
        const msg = messages[Math.floor(Math.random() * messages.length)];
        const phone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);
        try {
          await API.simulate({
            channel: 'whatsapp',
            contact_name: name,
            contact_handle: phone,
            message: msg
          });
          this.toast(`WhatsApp from ${name}`);
          this.loadData();
        } catch (e) { this.toast('Failed to simulate'); }
      });
    }

    if (simSend) {
      simSend.addEventListener('click', async () => {
        const channel = document.getElementById('sim-channel').value;
        const name = document.getElementById('sim-name').value || 'Test User';
        const handle = document.getElementById('sim-handle').value || 'test_user';
        const message = document.getElementById('sim-message').value || 'Test message';
        const direction = document.getElementById('sim-direction').value;
        try {
          await API.simulate({ channel, contact_name: name, contact_handle: handle, message, direction });
          this.toast(`${direction === 'outbound' ? 'Outbound' : 'Inbound'} ${channel} message sent`);
          this.loadData();
        } catch (e) { this.toast('Failed to simulate'); }
      });
    }
  },

  // ===== BOTTOM NAV =====
  renderBottomNav() {
    return `
      <nav class="bottom-nav">
        <button class="nav-item ${this.currentScreen === 'inbox' ? 'active' : ''}" data-screen="inbox">
          <span class="nav-icon">&#x1F4E5;</span>Inbox
        </button>
        <button class="nav-item ${this.currentScreen === 'rules' ? 'active' : ''}" data-screen="rules">
          <span class="nav-icon">&#x2699;</span>Rules
        </button>
        <button class="nav-item ${this.currentScreen === 'dev' ? 'active' : ''}" data-screen="dev">
          <span class="nav-icon">&#x1F6E0;</span>Dev
        </button>
      </nav>
    `;
  },

  // ===== NOTIFICATIONS PANEL =====
  renderNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="notif-header">
        <div class="notif-header-title">&#x1F514; Notifications</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-xs" id="mark-all-read" style="background:rgba(255,255,255,0.2);color:white;border:none;font-size:12px">Mark All Read</button>
          <button class="notif-close" id="close-notif">&times;</button>
        </div>
      </div>
      <div class="notif-list">
        ${this.notifications.length === 0
          ? '<div class="empty-state" style="padding:40px"><div class="empty-state-icon">&#x1F54A;</div><div class="empty-state-title">No notifications</div><div class="empty-state-text">You\'ll see reminders here</div></div>'
          : this.notifications.map(n => `
            <div class="notif-item ${n.read ? 'read' : 'unread'}" data-notif-id="${n.id}">
              <div class="notif-type ${n.type}">${n.type}</div>
              <div class="notif-title">${this.escapeHtml(n.title)}</div>
              <div class="notif-message">${this.escapeHtml(n.message)}</div>
              <div class="notif-time">${this.timeAgo(n.created_at)}</div>
            </div>
          `).join('')
        }
      </div>
    `;

    // Close button
    document.getElementById('close-notif').addEventListener('click', () => this.toggleNotifPanel());

    // Mark all read
    document.getElementById('mark-all-read').addEventListener('click', async () => {
      try {
        await API.markAllNotificationsRead();
        this.unreadCount = 0;
        this.notifications.forEach(n => n.read = 1);
        this.renderNotifPanel();
        this.updateUI();
      } catch (e) { console.error(e); }
    });

    // Click individual notification
    panel.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.notifId;
        try {
          await API.markNotificationRead(id);
          item.classList.remove('unread');
          item.classList.add('read');
          const n = this.notifications.find(n => n.id === id);
          if (n) n.read = 1;
          this.unreadCount = Math.max(0, this.unreadCount - 1);
          const badge = document.getElementById('notif-badge');
          if (badge) {
            badge.textContent = this.unreadCount;
            badge.style.display = this.unreadCount > 0 ? 'flex' : 'none';
          }
        } catch (e) { console.error(e); }
      });
    });
  },

  toggleNotifPanel() {
    this.notifPanelOpen = !this.notifPanelOpen;
    const panel = document.getElementById('notif-panel');
    if (panel) {
      if (this.notifPanelOpen) {
        this.renderNotifPanel();
        panel.classList.add('open');
      } else {
        panel.classList.remove('open');
      }
    }
  },

  // ===== NAVIGATION & BINDINGS =====
  bindNavigation() {
    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        this.currentScreen = item.dataset.screen;
        const content = document.getElementById('main-content');
        content.innerHTML = this.renderCurrentScreen();

        // Update nav active states
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Bind screen-specific actions
        if (this.currentScreen === 'rules') this.loadAndRenderRules();
        if (this.currentScreen === 'dev') this.bindDevActions();
        if (this.currentScreen === 'inbox') this.bindTodoActions();
      });
    });

    // Tabs
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) {
        this.currentTab = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadData();
      }
    });

    // Notifications
    document.getElementById('btn-notif')?.addEventListener('click', () => this.toggleNotifPanel());

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      this.stopPolling();
      API.setToken(null);
      this.user = null;
      this.renderAuth('login');
    });
  },

  bindTodoActions() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        switch (action) {
          case 'done':
            try {
              await API.markDone(id);
              this.toast('Marked as done!');
              this.loadData();
            } catch (e) { this.toast('Failed'); }
            break;

          case 'snooze-toggle':
            const dropdown = document.getElementById(`snooze-${id}`);
            if (dropdown) {
              const isVisible = dropdown.style.display !== 'none';
              // Hide all dropdowns first
              document.querySelectorAll('.snooze-options').forEach(d => d.style.display = 'none');
              dropdown.style.display = isVisible ? 'none' : 'block';
            }
            break;

          case 'snooze':
            try {
              await API.snooze(id, btn.dataset.minutes);
              this.toast(`Snoozed ${btn.dataset.minutes === 'eod' ? 'until end of day' : `for ${btn.dataset.minutes}m`}`);
              this.loadData();
            } catch (e) { this.toast('Failed'); }
            break;

          case 'unreply':
            try {
              await API.unreply(id);
              this.toast('Moved back to unreplied');
              this.loadData();
            } catch (e) { this.toast('Failed'); }
            break;

          case 'note':
            this.showNoteModal(id);
            break;

          case 'open-channel':
            const channel = btn.dataset.channel;
            if (channel === 'instagram') {
              window.open('https://www.instagram.com/direct/inbox/', '_blank');
            } else {
              window.open('https://web.whatsapp.com/', '_blank');
            }
            break;
        }
      });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.snooze-dropdown')) {
        document.querySelectorAll('.snooze-options').forEach(d => d.style.display = 'none');
      }
    });
  },

  showNoteModal(todoId) {
    const todo = this.todos.find(t => t.id === todoId);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">&#x1F4DD; Add Note</div>
        <textarea id="note-text" placeholder="Add a note about this conversation...">${todo?.note || ''}</textarea>
        <div class="modal-actions">
          <button class="btn btn-outline" id="note-cancel">Cancel</button>
          <button class="btn btn-primary" id="note-save">Save Note</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.getElementById('note-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('note-save').addEventListener('click', async () => {
      const note = document.getElementById('note-text').value;
      try {
        await API.addNote(todoId, note);
        overlay.remove();
        this.toast('Note saved');
        this.loadData();
      } catch (e) {
        this.toast('Failed to save note');
      }
    });

    // Focus textarea
    setTimeout(() => document.getElementById('note-text')?.focus(), 100);
  },

  // ===== HELPERS =====
  isTodoOverdue(todo) {
    if (todo.status !== 'unreplied') return false;
    const remindAfter = this.rules?.remind_after_minutes || 30;
    const msgTime = new Date(todo.last_message_time + 'Z');
    const now = new Date();
    const diffMs = now - msgTime;
    return diffMs > remindAfter * 60 * 1000;
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  toast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());

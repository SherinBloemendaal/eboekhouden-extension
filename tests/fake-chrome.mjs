// In-memory stand-in for the chrome.* APIs the service worker uses.

function area() {
  let data = {};
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async setAccessLevel() {},
    reset() {
      data = {};
    },
    dump() {
      return data;
    },
  };
}

export function createFakeChrome() {
  const listeners = { message: [], tabRemoved: [] };
  const fake = {
    jar: [],
    tabs: [],
    updates: [],
    created: [],
    sent: [],
    storage: { local: area(), session: area() },
    cookies: {
      async getAll({ domain }) {
        return structuredClone(fake.jar.filter((cookie) => cookie.domain.replace(/^\./, '').endsWith(domain)));
      },
      async remove({ url, name }) {
        const host = new URL(url).hostname;
        fake.jar = fake.jar.filter((cookie) => !(cookie.name === name && cookie.domain.replace(/^\./, '') === host));
      },
      async set(details) {
        const host = new URL(details.url).hostname;
        const cookie = {
          name: details.name,
          value: details.value,
          domain: details.domain ?? host,
          hostOnly: !details.domain,
          path: details.path,
          secure: details.secure,
          httpOnly: details.httpOnly,
          sameSite: details.sameSite,
          session: !details.expirationDate,
          expirationDate: details.expirationDate,
          storeId: details.storeId,
        };
        fake.jar = fake.jar.filter((existing) => !(existing.name === cookie.name && existing.domain === cookie.domain));
        fake.jar.push(cookie);
        return cookie;
      },
    },
    tabsApi: {
      async query(filter = {}) {
        // Only the two filters the service worker uses: the e-Boekhouden URL pattern and active.
        const matchesUrl = (tab) => !filter.url || /^https:\/\/([^/]+\.)?e-boekhouden\.nl\//.test(tab.url ?? '');
        const matchesActive = (tab) => filter.active === undefined || Boolean(tab.active) === filter.active;
        return structuredClone(fake.tabs.filter((tab) => matchesUrl(tab) && matchesActive(tab)));
      },
      async update(tabId, props) {
        fake.updates.push({ tabId, ...props });
      },
      async create(props) {
        fake.created.push(props);
        return { id: 99, ...props };
      },
      async sendMessage(tabId, message, options) {
        fake.sent.push({ tabId, message, options });
      },
      onRemoved: { addListener: (listener) => listeners.tabRemoved.push(listener) },
    },
    runtime: {
      id: 'ebs-test',
      onMessage: { addListener: (listener) => listeners.message.push(listener) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    dispatch(message, sender) {
      return new Promise((resolve) => {
        for (const listener of listeners.message) listener(message, sender, resolve);
      });
    },
    reset() {
      fake.jar = [];
      fake.tabs = [];
      fake.updates = [];
      fake.created = [];
      fake.sent = [];
      fake.storage.local.reset();
      fake.storage.session.reset();
    },
  };

  globalThis.chrome = {
    storage: fake.storage,
    cookies: fake.cookies,
    tabs: fake.tabsApi,
    runtime: fake.runtime,
  };
  return fake;
}

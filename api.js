// Provides a Promise-based WebExtensions API in Chrome and Firefox.
const extensionApi = (() => {
  const api = globalThis.browser || globalThis.chrome;

  if (!api) {
    throw new Error('WebExtensions API unavailable');
  }

  const usesPromiseApi = typeof globalThis.browser !== 'undefined';

  function invoke(target, method, ...args) {
    if (usesPromiseApi) {
      return target[method](...args);
    }

    return new Promise((resolve, reject) => {
      target[method](...args, (result) => {
        const error = api.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result);
      });
    });
  }

  return {
    runtime: api.runtime,
    storage: {
      sync: {
        get: (keys) => invoke(api.storage.sync, 'get', keys),
        set: (items) => invoke(api.storage.sync, 'set', items),
        remove: (keys) => invoke(api.storage.sync, 'remove', keys)
      }
    },
    tabs: {
      query: (queryInfo) => invoke(api.tabs, 'query', queryInfo),
      reload: (tabId) => invoke(api.tabs, 'reload', tabId)
    },
    scripting: {
      executeScript: (injection) => invoke(api.scripting, 'executeScript', injection)
    }
  };
})();

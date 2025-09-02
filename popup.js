// popup.js
class TimeManagerPopup {
  constructor() {
    this.defaultConfig = {
      // Nouveau modèle
      WEEKLY_BASE_HOURS: 42,
      WORKLOAD_PERCENT: 100,
      DAILY_WORK_HOURS: 8.4, // gardé pour compat/content.js

      WORKING_DAYS_PER_WEEK: 5,
      LANGUAGE: 'fr',
      ROWS_TO_CONVERT_TO_DAYS: [],
      ROWS_TO_REMOVE: [],
      LUNCH_BREAK: {
        START_HOUR: 11,
        END_HOUR: 14,
        MINIMUM_DURATION_MINUTES: 30
      }
    };
    this.rowNames = [];
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadConfiguration();
  }

  bindEvents() {
    document.getElementById('saveBtn')
      .addEventListener('click', () => this.saveConfiguration());
    document.getElementById('resetBtn')
      .addEventListener('click', () => this.resetConfiguration());
    document.getElementById('refreshRows')
      .addEventListener('click', () => this.refreshRowNames());

    const percentNum = document.getElementById('workloadPercentNumber');
    const workingDays = document.getElementById('workingDays');
    if (percentNum) percentNum.addEventListener('input', () => this.updateCalculatedDailyPreview());
    if (workingDays) workingDays.addEventListener('change', () => this.updateCalculatedDailyPreview());

    this.setupAutoSave();
  }

  setupAutoSave() {
    let autoSaveTimeout;
    document.addEventListener('input', (e) => {
      if (!e.target.matches('input, select, textarea')) return;
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        this.updateCalculatedDailyPreview();
        this.saveConfiguration();
      }, 1000);
    });
  }

  async refreshRowNames() {
    this.rowNames = await this.fetchRowNames();
    const cfg = this.getFormData(false);
    this.renderRowChecklist(cfg);
    this.renderConvertChecklist(cfg);
  }

  fetchRowNames() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab) return resolve([]);
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            func: () => {
              const cells = Array.from(document.querySelectorAll('tr[data-uid] td[role="gridcell"]'));
              const names = cells.map(td => (td.textContent || '').trim()).filter(Boolean);
              return Array.from(new Set(names));
            }
          },
          (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) {
              resolve([]);
            } else {
              resolve(results[0].result || []);
            }
          }
        );
      });
    });
  }

  renderRowChecklist(config) {
    const container = document.getElementById('rowsChecklist');
    if (!container) return;
    container.innerHTML = '';
    const names = Array.from(new Set([...(this.rowNames || []), ...(config.ROWS_TO_REMOVE || [])]));
    names.forEach(name => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = !config.ROWS_TO_REMOVE.includes(name);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' ' + name));
      container.appendChild(label);
    });
  }

  renderConvertChecklist(config) {
    const container = document.getElementById('convertRowsChecklist');
    if (!container) return;
    container.innerHTML = '';
    const names = Array.from(new Set([...(this.rowNames || []), ...(config.ROWS_TO_CONVERT_TO_DAYS || [])]));
    names.forEach(name => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = config.ROWS_TO_CONVERT_TO_DAYS.includes(name);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' ' + name));
      container.appendChild(label);
    });
  }

  loadConfiguration() {
    chrome.storage.sync.get(['timeManagerConfig'], async (result) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        this.rowNames = await this.fetchRowNames();
        this.populateForm(this.defaultConfig);
        this.showStatus('❌ Erreur de chargement', 'error');
        return;
      }

      const cfg = result.timeManagerConfig || { ...this.defaultConfig };
      // compat clés
      if (cfg.WEEKLY_BASE_HOURS == null) cfg.WEEKLY_BASE_HOURS = 42;
      if (cfg.WORKLOAD_PERCENT == null) cfg.WORKLOAD_PERCENT = 100;

      this.rowNames = await this.fetchRowNames();
      this.populateForm(cfg);
      this.showStatus('⚙️ Configuration chargée', 'info');
    });
  }

  populateForm(config) {
    const weeklyBase = document.getElementById('weeklyBaseHours');
    if (weeklyBase) weeklyBase.value = config.WEEKLY_BASE_HOURS ?? 42;

    const percentNum = document.getElementById('workloadPercentNumber');
    if (percentNum) percentNum.value = config.WORKLOAD_PERCENT ?? 100;

    document.getElementById('workingDays').value = config.WORKING_DAYS_PER_WEEK;
    document.getElementById('language').value = config.LANGUAGE;
    document.getElementById('lunchStart').value = config.LUNCH_BREAK.START_HOUR;
    document.getElementById('lunchEnd').value = config.LUNCH_BREAK.END_HOUR;
    document.getElementById('minPause').value = config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES;

    this.renderRowChecklist(config);
    this.renderConvertChecklist(config);

    this.updateCalculatedDailyPreview(config);
  }

  saveConfiguration() {
    const config = this.getFormData();
    const validation = this.validateConfiguration(config);
    if (!validation.isValid) {
      this.showStatus(validation.error, 'error');
      return;
    }

    chrome.storage.sync.set({ timeManagerConfig: config }, () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        this.showStatus('❌ Erreur de sauvegarde', 'error');
      } else {
        this.showStatus('✅ Configuration sauvegardée !', 'success');
        this.reloadActiveTab();
      }
    });
  }

  // === Calcul heures/jour à partir de 42h @ 100% et du pourcentage ===
  computeDailyFromPercent(cfg) {
    const weekly = (cfg.WEEKLY_BASE_HOURS ?? 42);
    const pct = Math.max(0, Math.min(100, (cfg.WORKLOAD_PERCENT ?? 100)));
    const days = Math.max(1, Math.min(7, parseInt(cfg.WORKING_DAYS_PER_WEEK ?? 5)));
    const daily = (weekly * (pct / 100)) / days;
    return Number.isFinite(daily) ? daily : 8.4;
  }

  updateCalculatedDailyPreview(cfg = null) {
    const data = cfg || this.getFormData(false);
    const daily = this.computeDailyFromPercent({
      WEEKLY_BASE_HOURS: data.WEEKLY_BASE_HOURS,
      WORKLOAD_PERCENT: data.WORKLOAD_PERCENT,
      WORKING_DAYS_PER_WEEK: data.WORKING_DAYS_PER_WEEK
    });
    const el = document.getElementById('calculatedDailyHours');
    if (el) el.value = daily.toFixed(2);
  }

  getFormData(useValidation = true) {
    const convertChecklist = document.querySelectorAll('#convertRowsChecklist input[type="checkbox"]');
    const rowsToConvert = Array.from(convertChecklist)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    const checklist = document.querySelectorAll('#rowsChecklist input[type="checkbox"]');
    const rowsToRemove = Array.from(checklist)
      .filter(cb => !cb.checked)
      .map(cb => cb.value);

    const weekly = parseFloat(document.getElementById('weeklyBaseHours')?.value) || 42;
    const percent = Math.max(0, Math.min(100, parseInt(document.getElementById('workloadPercentNumber')?.value) || 100));
    const workingDays = parseInt(document.getElementById('workingDays')?.value) || 5;

    const computedDaily = (weekly * (percent / 100)) / workingDays;

    const config = {
      WEEKLY_BASE_HOURS: weekly,
      WORKLOAD_PERCENT: percent,
      DAILY_WORK_HOURS: computedDaily,
      WORKING_DAYS_PER_WEEK: workingDays,
      LANGUAGE: document.getElementById('language')?.value || this.defaultConfig.LANGUAGE,
      LUNCH_BREAK: {
        START_HOUR: parseInt(document.getElementById('lunchStart')?.value) || this.defaultConfig.LUNCH_BREAK.START_HOUR,
        END_HOUR: parseInt(document.getElementById('lunchEnd')?.value) || this.defaultConfig.LUNCH_BREAK.END_HOUR,
        MINIMUM_DURATION_MINUTES: parseInt(document.getElementById('minPause')?.value) || this.defaultConfig.LUNCH_BREAK.MINIMUM_DURATION_MINUTES
      },
      ROWS_TO_CONVERT_TO_DAYS: rowsToConvert,
      ROWS_TO_REMOVE: rowsToRemove
    };

    if (!useValidation){return config} ;
    return config;
  }

  validateConfiguration(config) {
    if (config.DAILY_WORK_HOURS < 0 || config.DAILY_WORK_HOURS > 12) {
      return { isValid: false, error: 'Les heures par jour doivent être entre 0 et 12' };
    }
    if (config.WORKING_DAYS_PER_WEEK < 1 || config.WORKING_DAYS_PER_WEEK > 7) {
      return { isValid: false, error: 'Les jours par semaine doivent être entre 1 et 7' };
    }
    if (config.WORKLOAD_PERCENT < 0 || config.WORKLOAD_PERCENT > 100) {
      return { isValid: false, error: 'Le pourcentage doit être entre 0 et 100' };
    }
    if (config.LUNCH_BREAK.START_HOUR >= config.LUNCH_BREAK.END_HOUR) {
      return { isValid: false, error: 'L\'heure de début de pause doit être avant l\'heure de fin' };
    }
    if (config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES < 0 || config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES > 240) {
      return { isValid: false, error: 'La durée minimum de pause doit être entre 0 et 240 minutes' };
    }
    return { isValid: true };
  }

  resetConfiguration() {
    if (!confirm('Êtes-vous sûr de vouloir réinitialiser la configuration ?')) return;
    chrome.storage.sync.remove('timeManagerConfig', () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        this.showStatus('❌ Erreur de réinitialisation', 'error');
      } else {
        this.populateForm(this.defaultConfig);
        this.showStatus('🔄 Configuration réinitialisée', 'info');
      }
    });
  }

  reloadActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('launchpad.wd.pnet.ch')) {
        chrome.tabs.reload(tab.id);
      }
    });
  }

  showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type} status-fade-in`;
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TimeManagerPopup();
});

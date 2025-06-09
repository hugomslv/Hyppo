// popup.js
class TimeManagerPopup {
    constructor() {
        this.defaultConfig = {
            DAILY_WORK_HOURS: 8.4,
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

        this.translations = window.TRANSLATIONS['fr'];

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadConfiguration();
        this.applyTranslations();
    }

    bindEvents() {
        document.getElementById('saveBtn')
            .addEventListener('click', () => this.saveConfiguration());
        document.getElementById('resetBtn')
            .addEventListener('click', () => this.resetConfiguration());
        document.getElementById('refreshBtn')
            .addEventListener('click', () => this.reloadActiveTab());
        document.getElementById('language')
            .addEventListener('change', (e) => this.onLanguageChange(e));
        document.getElementById('addConvertRowBtn')
            .addEventListener('click', () => this.addItem('convertRows'));
        document.getElementById('addRemoveRowBtn')
            .addEventListener('click', () => this.addItem('removeRows'));
        this.setupAutoSave();
    }

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const keys = el.getAttribute('data-i18n').split('.');
            let txt = this.translations;
            keys.forEach(k => { if (txt) txt = txt[k]; });
            if (!txt) return;
            if (el.tagName === 'TITLE') {
                document.title = txt;
            } else {
                el.textContent = txt;
            }
        });
    }

    setupAutoSave() {
        const inputs = document.querySelectorAll('input, select, textarea');
        let autoSaveTimeout;
        inputs.forEach(input => {
            const handler = () => {
                clearTimeout(autoSaveTimeout);
                autoSaveTimeout = setTimeout(() => {
                    this.saveConfiguration();
                }, 1000);
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });
    }

    renderList(listId, items) {
        const list = document.getElementById(listId);
        list.innerHTML = '';
        items.forEach(text => this.addListItem(listId, text, true));
        this.setupAutoSave();
    }

    addListItem(listId, text, checked = true) {
        const list = document.getElementById(listId);
        const li = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        const span = document.createElement('span');
        span.textContent = text;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '✖';
        remove.className = 'small-btn';
        remove.addEventListener('click', () => {
            li.remove();
            this.saveConfiguration();
        });
        label.appendChild(checkbox);
        label.appendChild(span);
        li.appendChild(label);
        li.appendChild(remove);
        list.appendChild(li);
    }

    addItem(type) {
        const input = document.getElementById(type + 'Input');
        const value = input.value.trim();
        if (!value) return;
        this.addListItem(type + 'List', value, true);
        input.value = '';
        this.setupAutoSave();
    }

    getListData(listId) {
        const list = document.getElementById(listId);
        const arr = [];
        list.querySelectorAll('li').forEach(li => {
            const cb = li.querySelector('input[type="checkbox"]');
            const text = li.querySelector('span').textContent.trim();
            if (cb.checked && text) arr.push(text);
        });
        return arr;
    }

    onLanguageChange(event) {
        const select = event.target;
        this.translations = window.TRANSLATIONS[select.value] || this.translations;
        document.documentElement.lang = select.value;
        select.classList.add('lang-changed');
        setTimeout(() => select.classList.remove('lang-changed'), 1200);
        this.applyTranslations();
    }

    loadConfiguration() {
        chrome.storage.sync.get(['timeManagerConfig'], (result) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                this.populateForm(this.defaultConfig);
                this.showStatus('❌ Erreur de chargement', 'error');
            } else {
                const cfg = result.timeManagerConfig || this.defaultConfig;
                this.populateForm(cfg);
                this.translations = window.TRANSLATIONS[cfg.LANGUAGE] || this.translations;
                document.documentElement.lang = cfg.LANGUAGE;
                this.applyTranslations();
                const loadedMsg = this.translations.configLoaded || 'Configuration chargée';
                this.showStatus(`⚙️ ${loadedMsg}`, 'info');
            }
        });
    }

    populateForm(config) {
        document.getElementById('dailyHours').value = config.DAILY_WORK_HOURS;
        document.getElementById('workingDays').value = config.WORKING_DAYS_PER_WEEK;
        document.getElementById('language').value = config.LANGUAGE;
        document.getElementById('lunchStart').value = config.LUNCH_BREAK.START_HOUR;
        document.getElementById('lunchEnd').value = config.LUNCH_BREAK.END_HOUR;
        document.getElementById('minPause').value = config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES;
        this.renderList('convertRowsList', config.ROWS_TO_CONVERT_TO_DAYS || []);
        this.renderList('removeRowsList', config.ROWS_TO_REMOVE || []);
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
                this.translations = window.TRANSLATIONS[config.LANGUAGE] || this.translations;
                this.applyTranslations();
                const msg = this.translations.restartNotice || '';
                const saved = this.translations.configSaved || 'Configuration sauvegardée !';
                this.showStatus(`✅ ${saved} ${msg}`, 'success');
                this.reloadActiveTab();
            }
        });
    }

    getFormData() {
        return {
            DAILY_WORK_HOURS: parseFloat(document.getElementById('dailyHours').value) || this.defaultConfig.DAILY_WORK_HOURS,
            WORKING_DAYS_PER_WEEK: parseInt(document.getElementById('workingDays').value) || this.defaultConfig.WORKING_DAYS_PER_WEEK,
            LANGUAGE: document.getElementById('language').value || this.defaultConfig.LANGUAGE,
            LUNCH_BREAK: {
                START_HOUR: parseInt(document.getElementById('lunchStart').value) || this.defaultConfig.LUNCH_BREAK.START_HOUR,
                END_HOUR: parseInt(document.getElementById('lunchEnd').value) || this.defaultConfig.LUNCH_BREAK.END_HOUR,
                MINIMUM_DURATION_MINUTES: parseInt(document.getElementById('minPause').value) || this.defaultConfig.LUNCH_BREAK.MINIMUM_DURATION_MINUTES
            },
            ROWS_TO_CONVERT_TO_DAYS: this.getListData('convertRowsList'),
            ROWS_TO_REMOVE: this.getListData('removeRowsList')
        };
    }

    validateConfiguration(config) {
        if (config.DAILY_WORK_HOURS < 1 || config.DAILY_WORK_HOURS > 12) {
            return { isValid: false, error: 'Les heures par jour doivent être entre 1 et 12' };
        }
        if (config.WORKING_DAYS_PER_WEEK < 1 || config.WORKING_DAYS_PER_WEEK > 7) {
            return { isValid: false, error: 'Les jours par semaine doivent être entre 1 et 7' };
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
                this.translations = window.TRANSLATIONS[this.defaultConfig.LANGUAGE] || this.translations;
                document.documentElement.lang = this.defaultConfig.LANGUAGE;
                this.applyTranslations();
                const resetMsg = this.translations.configReset || 'Configuration réinitialisée';
                this.showStatus(`🔄 ${resetMsg}`, 'info');
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

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
        this.setupAutoSave();
    }

    setupAutoSave() {
        let autoSaveTimeout;
        document.addEventListener('input', (e) => {
            if (!e.target.matches('input, select, textarea')) return;
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => {
                this.saveConfiguration();
            }, 1000);
        });
    }

    async refreshRowNames() {
        this.rowNames = await this.fetchRowNames();
        this.renderRowChecklist(this.getFormData());
        this.renderConvertChecklist(this.getFormData());
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
                            const names = cells.map(td => td.textContent.trim()).filter(Boolean);
                            return Array.from(new Set(names));
                        }
                    },
                    (results) => {
                        if (chrome.runtime.lastError || !results || !results[0]) {
                            resolve([]);
                        } else {
                            resolve(results[0].result);
                        }
                    }
                );
            });
        });
    }

    renderRowChecklist(config) {
        const container = document.getElementById('rowsChecklist');
        container.innerHTML = '';
        const names = Array.from(new Set([...(this.rowNames || []), ...(config.ROWS_TO_REMOVE || [])]));
        names.forEach(name => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = name;
            checkbox.checked = !config.ROWS_TO_REMOVE.includes(name);
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(name));
            container.appendChild(label);
        });
    }

    renderConvertChecklist(config) {
        const container = document.getElementById('convertRowsChecklist');
        container.innerHTML = '';
        const names = Array.from(new Set([...(this.rowNames || []), ...(config.ROWS_TO_CONVERT_TO_DAYS || [])]));
        names.forEach(name => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = name;
            checkbox.checked = config.ROWS_TO_CONVERT_TO_DAYS.includes(name);
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(name));
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
            } else {
                const cfg = result.timeManagerConfig || this.defaultConfig;
                this.rowNames = await this.fetchRowNames();
                this.populateForm(cfg);
                this.showStatus('⚙️ Configuration chargée', 'info');
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
        this.renderRowChecklist(config);
        this.renderConvertChecklist(config);
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

    getFormData() {
        const convertChecklist = document.querySelectorAll('#convertRowsChecklist input[type="checkbox"]');
        const rowsToConvert = Array.from(convertChecklist)
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        const checklist = document.querySelectorAll('#rowsChecklist input[type="checkbox"]');
        const rowsToRemove = Array.from(checklist)
            .filter(cb => !cb.checked)
            .map(cb => cb.value);
        return {
            DAILY_WORK_HOURS: parseFloat(document.getElementById('dailyHours').value) || this.defaultConfig.DAILY_WORK_HOURS,
            WORKING_DAYS_PER_WEEK: parseInt(document.getElementById('workingDays').value) || this.defaultConfig.WORKING_DAYS_PER_WEEK,
            LANGUAGE: document.getElementById('language').value || this.defaultConfig.LANGUAGE,
            LUNCH_BREAK: {
                START_HOUR: parseInt(document.getElementById('lunchStart').value) || this.defaultConfig.LUNCH_BREAK.START_HOUR,
                END_HOUR: parseInt(document.getElementById('lunchEnd').value) || this.defaultConfig.LUNCH_BREAK.END_HOUR,
                MINIMUM_DURATION_MINUTES: parseInt(document.getElementById('minPause').value) || this.defaultConfig.LUNCH_BREAK.MINIMUM_DURATION_MINUTES
            },
            ROWS_TO_CONVERT_TO_DAYS: rowsToConvert,
            ROWS_TO_REMOVE: rowsToRemove
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

class SimpleTimeCalculator {
    constructor() {
        this.weekTotalMinutes = 0;
        this.bindEvents();
        this.addRow();
    }

    bindEvents() {
        document.getElementById('addLineBtn')?.addEventListener('click', () => this.addRow());
        document.getElementById('addDayToWeekBtn')?.addEventListener('click', () => this.addDayToWeek());
        document.getElementById('resetWeekBtn')?.addEventListener('click', () => this.resetWeek());
    }

    addRow() {
        const tbody = document.querySelector('#calcTable tbody');
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="time" class="start"></td>
            <td><input type="time" class="end"></td>
            <td><input type="number" class="pause" value="0" min="0" step="5"></td>
            <td><button type="button" class="remove-row">✖️</button></td>`;
        tr.querySelector('.remove-row').addEventListener('click', () => {
            tr.remove();
            this.updateDayTotal();
        });
        ['input', 'change'].forEach(evt => {
            tr.querySelectorAll('input').forEach(inp => inp.addEventListener(evt, () => this.updateDayTotal()));
        });
        tbody.appendChild(tr);
        this.updateDayTotal();
    }

    parseTimeToMinutes(value) {
        if (!value) return 0;
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
    }

    diffMinutes(start, end, pause) {
        let diff = end - start;
        if (diff < 0) diff += 1440;
        diff -= pause;
        return diff > 0 ? diff : 0;
    }

    updateDayTotal() {
        const tbody = document.querySelector('#calcTable tbody');
        let total = 0;
        tbody.querySelectorAll('tr').forEach(tr => {
            const start = this.parseTimeToMinutes(tr.querySelector('.start').value);
            const end = this.parseTimeToMinutes(tr.querySelector('.end').value);
            const pause = parseInt(tr.querySelector('.pause').value) || 0;
            total += this.diffMinutes(start, end, pause);
        });
        document.getElementById('dayTotal').textContent = this.formatTotals(total);
        return total;
    }

    formatTotals(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const dec = (mins / 60).toFixed(2).replace('.', ',');
        return `${h}:${m.toString().padStart(2,'0')} (${dec})`;
    }

    addDayToWeek() {
        this.weekTotalMinutes += this.updateDayTotal();
        this.updateWeekDisplay();
    }

    resetWeek() {
        this.weekTotalMinutes = 0;
        this.updateWeekDisplay();
    }

    updateWeekDisplay() {
        document.getElementById('weekTotal').textContent = this.formatTotals(this.weekTotalMinutes);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TimeManagerPopup();
    new SimpleTimeCalculator();
});

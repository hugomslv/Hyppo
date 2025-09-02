// content.js — Time Manager (singleton top-frame, iframes, overlay, observer)
(() => {
  // --- GARDE: ne lancer qu'une seule fois, dans la fenêtre top ---
  if (window.top && window.top !== window) return; // exécuter SEULEMENT dans le top-frame
  if (window.__TMX_RUNNING__) return;
  window.__TMX_RUNNING__ = true;

  console.log("[TimeManager] content script boot…");

  // ==========================
  // 0) Attente config + délai
  // ==========================
  const STARTUP_DELAY_MS = 4000; // délai sup pour laisser charger UI5
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let attempts = 0;
  const waitForConfig = async () => {
    while ((!window.TIME_MANAGER_CONFIG || !window.TRANSLATIONS) && attempts < 50) {
      await sleep(100);
      attempts++;
    }
    if (!window.TIME_MANAGER_CONFIG) {
      console.warn("[TimeManager] Config non chargée. Defaults locaux.");
      window.TIME_MANAGER_CONFIG = {
        DAILY_WORK_HOURS: 8.4,
        WORKING_DAYS_PER_WEEK: 5,
        LANGUAGE: 'fr',
        ROWS_TO_CONVERT_TO_DAYS: [],
        ROWS_TO_REMOVE: [],
        LUNCH_BREAK: { START_HOUR: 11, END_HOUR: 14, MINIMUM_DURATION_MINUTES: 30 }
      };
    }
    if (!window.TRANSLATIONS) {
      window.TRANSLATIONS = {
        fr: {
          welcome: "Heures dues par jour",
          workHours: "Temps traité aujourd'hui",
          timeRemaining: "Temps restant aujourd'hui",
          estimatedEnd: "Heure de fin estimée",
          pauseDetected: "Pause détectée",
          pauseAdded: "Pause ajoutée",
          yes: "Oui",
          no: "Non",
          none: "—",
          overtimeThisWeek: "Heures supp. cette semaine",
          remainingWeekTime: "Temps restant cette semaine"
        }
      };
    }
  };

  // Attente asynchrone de la page prête (polling + MutationObserver + timeout)
  async function waitForPageReady(checkFn, { pollMs = 300, timeoutMs = 30000 } = {}) {
    if (checkFn()) return true;

    let resolved = false;
    const obs = new MutationObserver(() => {
      if (!resolved && checkFn()) {
        resolved = true;
        try { obs.disconnect(); } catch (e) {}
      }
    });
    try { obs.observe(document, { childList: true, subtree: true }); } catch (e) {}

    const start = Date.now();
    while (!resolved && (Date.now() - start) < timeoutMs) {
      if (checkFn()) { resolved = true; break; }
      await sleep(pollMs);
    }
    try { obs.disconnect(); } catch (e) {}
    return resolved;
  }

  // ===========================================
  // 1) Helpers multi-frames (iframes inclus)
  // ===========================================
  function getAllFrames(win = window.top) {
    const frames = [win];
    for (let i = 0; i < win.frames.length; i++) {
      try {
        const f = win.frames[i];
        if (f.document) frames.push(...getAllFrames(f));
      } catch (e) { /* cross-origin → ignorer */ }
    }
    return frames;
  }

  function qsaAllFrames(selector) {
    const results = [];
    const frames = getAllFrames();
    frames.forEach((f, idx) => {
      try {
        const els = f.document.querySelectorAll(selector);
        els.forEach(el => results.push({ frame: f, el, frameIndex: idx }));
      } catch(e) {}
    });
    return results;
  }

  function findAnyTimeTableTbody() {
    const selectors = [
      "[id$='--gcontigent'] tbody",        // ID UI5 suffix plus robuste
      "#__xmlview2--gcontigent tbody",     // ancien
      "table[role='grid'] tbody",
      ".sapUiTableCnt table tbody",
      ".sapUiTable [role='grid'] tbody"
    ];
    for (const sel of selectors) {
      const matches = qsaAllFrames(sel);
      if (matches.length) {
        const { frame, el, frameIndex } = matches[0];
        console.log(`[TimeManager] tbody trouvé via "${sel}" dans frame #${frameIndex}`);
        return { frame, tbody: el };
      }
    }
    return null;
  }

  // ===================================
  // 2) Utilitaires temps/calculs
  // ===================================
  class TimeUtilities {
    constructor(config) { this.config = config; }
    parseTimeStringToMilliseconds(s) {
      if (!s || s === '-' ) return 0;
      const m = s.match(/([+\-])?\s*(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      const sign = m[1] === '-' ? -1 : 1;
      const h = parseInt(m[2], 10) || 0;
      const mm = parseInt(m[3], 10) || 0;
      return sign * ((h * 3600 + mm * 60) * 1000);
    }
    parseTimeStringToDate(s) {
      if (!s) return null;
      const m = s.match(/(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(m[1],10), parseInt(m[2],10), 0, 0);
    }
    parseTimeStringToHours(s) {
      if (!s || s === '-') return 0;
      const m = s.match(/(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      const h  = parseInt(m[1], 10) || 0;
      const mm = parseInt(m[2], 10) || 0;
      return h + mm / 60;
    }
    formatHoursToTimeString(hours) {
      const totalMinutes = Math.round(hours * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h}:${m.toString().padStart(2, '0')}`;
    }
    convertHoursToDays(hours) {
      const days = hours / this.config.DAILY_WORK_HOURS;
      return parseFloat(days.toFixed(2));
    }
    getCurrentDateFormatted() {
      return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    getMillisecondsInDay()  { return this.config.DAILY_WORK_HOURS * 3600000; }
    getMillisecondsInWeek() { return this.getMillisecondsInDay() * (this.config.WORKING_DAYS_PER_WEEK || 5); }
  }

  class PauseCalculator {
    constructor(config, timeUtils) { this.config = config; this.timeUtils = timeUtils; }
    calculatePauseAdjustment() {
      const entries = qsaAllFrames('.k-event-template')
        .map(x => x.el)
        .filter(el => el.innerHTML.includes('Horodatage'));
      let pauseDetected = false, pauseAdded = 0;
      for (let i = 1; i < entries.length; i += 2) {
        const start = this.timeUtils.parseTimeStringToDate(entries[i - 1].textContent.replace('Horodatage', '').trim());
        const end   = this.timeUtils.parseTimeStringToDate(entries[i].textContent.replace('Horodatage', '').trim());
        if (!start || !end) continue;
        if (this.isWorkingDuringLunchBreak(start, end)) {
          const info = this.calculateLunchBreakOverlap(start, end);
          pauseDetected = info.hasMinimumPause;
          pauseAdded    = info.timeToAdd;
          break;
        }
      }
      return { pauseDetected, pauseAdded };
    }
    isWorkingDuringLunchBreak(start, end) {
      return start.toDateString() === new Date().toDateString() &&
             start.getHours() <= this.config.LUNCH_BREAK.END_HOUR &&
             end.getHours()   >= this.config.LUNCH_BREAK.START_HOUR;
    }
    calculateLunchBreakOverlap(start, end) {
      const lunchStart = this.timeUtils.parseTimeStringToDate(`${this.config.LUNCH_BREAK.START_HOUR}:00`);
      const lunchEnd   = this.timeUtils.parseTimeStringToDate(`${this.config.LUNCH_BREAK.END_HOUR}:00`);
      const overlapStart = Math.max(start.getTime(), lunchStart.getTime());
      const overlapEnd   = Math.min(end.getTime(),   lunchEnd.getTime());
      const overlapMs    = Math.max(0, overlapEnd - overlapStart);
      const overlapMins  = overlapMs / 60000;
      const hasMinimumPause = overlapMins >= this.config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES;
      const toAdd = hasMinimumPause ? 0 : (this.config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES - overlapMins) * 60000;
      return { hasMinimumPause, timeToAdd: toAdd };
    }
  }

  class TimeCalculator {
    constructor(config, timeUtils) {
      this.config = config;
      this.timeUtils = timeUtils;
      this.pauseCalculator = new PauseCalculator(config, timeUtils);
    }
    calculateTodayWorkTime() {
      let totalToday = 0, totalWeek = 0;
      const sched  = this.calculateSchedulerTime(); totalToday += sched.today; totalWeek += sched.week;
      const events = this.calculateEventTime();     totalToday += events.today; totalWeek += events.week;
      const pause  = this.pauseCalculator.calculatePauseAdjustment();
      const dayTarget = this.timeUtils.getMillisecondsInDay();
      const remaining = Math.max(0, dayTarget - totalToday + pause.pauseAdded);
      return {
        totalWorked: totalToday,
        totalWorkedThisWeek: totalWeek,
        remainingTime: remaining,
        estimatedEndTime: this.calculateEstimatedEndTime(remaining),
        pauseDetected: pause.pauseDetected,
        pauseAdded: pause.pauseAdded
      };
    }
    calculateWeekWorkTime() {
      const todayData = this.calculateTodayWorkTime();
      const weekTarget = this.timeUtils.getMillisecondsInWeek();
      const remainingWeek = weekTarget - todayData.totalWorkedThisWeek;
      return {
        totalWorked: todayData.totalWorkedThisWeek,
        remainingTime: remainingWeek,
        isOvertime: remainingWeek < 0
      };
    }
    calculateSchedulerTime() {
      let today = 0, week = 0;
      const todayDate = this.timeUtils.getCurrentDateFormatted();
      const dayHeaders = qsaAllFrames('.k-scheduler-header-wrap .k-nav-day');
      dayHeaders.forEach(({ el }) => {
        const headerText  = el.querySelector('strong')?.textContent?.trim();
        const contentText = el.querySelector('div:last-child')?.textContent || '';
        const match = contentText.match(/Temps traité:\s*([0-9]{1,2}):(\d{2})/);
        if (match) {
          const ms = this.timeUtils.parseTimeStringToMilliseconds(`${match[1]}:${match[2]}`);
          week += ms;
          if (headerText && headerText.includes(todayDate)) today += ms;
        }
      });
      return { today, week };
    }
    calculateEventTime() {
      const entries = qsaAllFrames('.k-event-template')
        .map(x => x.el)
        .filter(el => el.innerHTML.includes('Horodatage'));
      let today = 0, week = 0;
      for (let i = 1; i < entries.length; i += 2) {
        const start = this.extractTimeFromEntry(entries[i - 1]);
        const end   = this.extractTimeFromEntry(entries[i]);
        if (start && end) { const diff = end - start; today += diff; week += diff; }
      }
      if (entries.length % 2 === 1) {
        const last = this.extractTimeFromEntry(entries[entries.length - 1]);
        if (last) { const diff = Date.now() - last.getTime(); today += diff; week += diff; }
      }
      return { today, week };
    }
    extractTimeFromEntry(entry) {
      const timeText = (entry.textContent || '').replace('Horodatage', '').trim();
      return this.timeUtils.parseTimeStringToDate(timeText);
    }
    calculateEstimatedEndTime(remainingMs) {
      if (remainingMs <= 0) return '—';
      const end = new Date(Date.now() + remainingMs);
      return end.toTimeString().slice(0,5);
    }
  }

  // ===================================
  // 3) Rendu tableau + overlay
  // ===================================
  class TableRenderer {
    constructor(translations, timeUtils) {
      this.translations = translations;
      this.timeUtils = timeUtils;
    }
    renderTimeTable(todayData, weekData) {
      const found = findAnyTimeTableTbody();
      if (!found) {
        console.log('[TimeManager] Tableau introuvable → overlay');
        this.renderOverlay(todayData, weekData);
        this.observeForTableAppear(todayData, weekData);
        return;
      }
      this.removeOverlay();
      const { frame, tbody } = found;
      const doc = frame.document;
      // nettoie nos anciennes lignes
      tbody.querySelectorAll('tr.tmx-row').forEach(tr => tr.remove());
      // injecte
      const rows = this.createTableRows(todayData, weekData);
      rows.forEach(html => {
        const tr = doc.createElement('tr');
        tr.className = 'tmx-row';
        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
      console.log('[TimeManager] Données ajoutées au tableau');
    }
    createTableRows(todayData, weekData) {
      const dailyHours = this.timeUtils.config.DAILY_WORK_HOURS;
      const rows = [];
      rows.push(this.createRow(this.translations.workHours, this.timeUtils.formatHoursToTimeString(todayData.totalWorked / 3600000)));
      rows.push(this.createRow(`${this.translations.timeRemaining} (${this.timeUtils.formatHoursToTimeString(dailyHours)})`,
        this.timeUtils.formatHoursToTimeString(Math.abs(todayData.remainingTime) / 3600000)));
      rows.push(this.createRow(this.translations.estimatedEnd, todayData.estimatedEndTime));
      rows.push(this.createRow(this.translations.pauseDetected, todayData.pauseDetected ? this.translations.yes : this.translations.no));
      rows.push(this.createRow(this.translations.pauseAdded,
        todayData.pauseAdded > 0 ? Math.floor(todayData.pauseAdded / 60000) + ' min' : this.translations.none));
      rows.push(this.createRow(weekData.isOvertime ? this.translations.overtimeThisWeek : this.translations.remainingWeekTime,
        this.timeUtils.formatHoursToTimeString(Math.abs(weekData.remainingTime) / 3600000)));
      return rows;
    }
    createRow(label, value) {
      return `<td role="gridcell" colspan="2">${label}</td><td role="gridcell" style="text-align:right;">${value}</td>`;
    }
    // Overlay si pas de tableau
    renderOverlay(todayData, weekData) {
      if (document.getElementById('tmx-overlay')) return;
      const card = document.createElement('div');
      card.id = 'tmx-overlay';
      Object.assign(card.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '999999',
        background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '12px 14px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        fontSize: '13px', minWidth: '240px', maxWidth: '320px'
      });
      const h = (label, value) =>
        `<div style="display:flex;justify-content:space-between;gap:8px;margin:4px 0;">
          <span>${label}</span><strong>${value}</strong>
        </div>`;
      card.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;">Time Manager</div>
        ${h(this.translations.workHours, this.timeUtils.formatHoursToTimeString(todayData.totalWorked / 3600000))}
        ${h(`${this.translations.timeRemaining} (${this.timeUtils.formatHoursToTimeString(this.timeUtils.config.DAILY_WORK_HOURS)})`,
           this.timeUtils.formatHoursToTimeString(Math.abs(todayData.remainingTime) / 3600000))}
        ${h(this.translations.estimatedEnd, todayData.estimatedEndTime)}
        ${h(this.translations.pauseDetected, todayData.pauseDetected ? this.translations.yes : this.translations.no)}
        ${h(this.translations.pauseAdded, todayData.pauseAdded > 0 ? Math.floor(todayData.pauseAdded / 60000) + ' min' : this.translations.none)}
        ${h(weekData.isOvertime ? this.translations.overtimeThisWeek : this.translations.remainingWeekTime,
           this.timeUtils.formatHoursToTimeString(Math.abs(weekData.remainingTime) / 3600000))}
      `;
      document.body.appendChild(card);
    }
    removeOverlay() { const el = document.getElementById('tmx-overlay'); if (el) el.remove(); }
    observeForTableAppear(todayData, weekData) {
      const observer = new MutationObserver(() => {
        if (findAnyTimeTableTbody()) {
          observer.disconnect();
          this.renderTimeTable(todayData, weekData);
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 30000);
    }
  }

  // ===================================
  // 4) Suppression / Conversion
  // ===================================
  class TableRowCleaner {
    removeSpecificRows(rowsToRemove) {
      if (!rowsToRemove || rowsToRemove.length === 0) return;
      const found = findAnyTimeTableTbody();
      const rootDoc = found ? found.frame.document : document;
      rootDoc.querySelectorAll('tr[data-uid]').forEach(row => {
        const cellText = row.querySelector("td[role='gridcell']")?.textContent?.trim();
        if (cellText && rowsToRemove.includes(cellText)) {
          row.remove();
          console.log(`[TimeManager] Ligne supprimée: ${cellText}`);
        }
      });
    }
  }
  class VacationConverter {
    constructor(config, timeUtils) { this.config = config; this.timeUtils = timeUtils; }
    convertHoursToDays(rowsToConvert) {
      if (!rowsToConvert || rowsToConvert.length === 0) return;
      const found = findAnyTimeTableTbody();
      const rootDoc = found ? found.frame.document : document;
      rootDoc.querySelectorAll('tr[data-uid]').forEach(row => {
        const cellText = row.querySelector("td[role='gridcell']")?.textContent?.trim();
        if (cellText && rowsToConvert.includes(cellText)) {
          this.processVacationRow(row, cellText);
        }
      });
    }
    processVacationRow(row, originalText) {
      const first  = row.querySelector('td:nth-child(1)');
      const second = row.querySelector('td:nth-child(2)');
      const third  = row.querySelector('td:nth-child(3)');
      const hoursText = second?.textContent?.trim();
      if (!first || !second || !third || !hoursText) return;
      const hours    = this.timeUtils.parseTimeStringToHours(hoursText);
      const days     = this.timeUtils.convertHoursToDays(hours);
      const fullDays = Math.floor(days);
      first.textContent  = 'Vacances (j)';
      second.textContent = days.toString();
      third.textContent  = fullDays.toString();
      console.log(`[TimeManager] Converti "${originalText}" -> ${hoursText} = ${days} j`);
    }
  }

  // ===================================
  // 5) Coloration des écarts
  // ===================================
  function colorSchedulerDiffs() {
    const daySpans = qsaAllFrames('.k-scheduler-table .k-nav-day, .k-scheduler-header-wrap .k-nav-day');
    daySpans.forEach(({ el }) => {
      const divs = el.querySelectorAll('div');
      if (divs.length < 2) return;
      const infoDiv = divs[1];
      const text = (infoDiv.innerText || '')
        .replace(/\u00A0|\u202F/g, ' ')
        .replace(/\u2212/g, '-');
      const match = text.match(/Écart[^:]*:\s*([+\-])?\s*(\d{1,2}):(\d{2})/);
      if (!match) return;
      const sign = (match[1] === '-') ? -1 : 1;
      const hours = parseInt(match[2], 10);
      const minutes = parseInt(match[3], 10);
      const totalMinutes = sign * (hours * 60 + minutes);
      infoDiv.style.color = totalMinutes < 0 ? 'red' : (totalMinutes === 0 ? 'grey' : 'green');
    });
  }

  // ===================================
  // 6) Extension
  // ===================================
  class TimeManagerExtension {
    constructor() {
      this.config       = window.TIME_MANAGER_CONFIG;
      const lang = this.config.LANGUAGE || 'fr';
      const dict = (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || window.TRANSLATIONS?.fr;
      this.translations = dict || window.TRANSLATIONS?.fr || {
        welcome: "Heures dues par jour",
        workHours: "Temps traité aujourd'hui",
        timeRemaining: "Temps restant aujourd'hui",
        estimatedEnd: "Heure de fin estimée",
        pauseDetected: "Pause détectée",
        pauseAdded: "Pause ajoutée",
        yes: "Oui",
        no: "Non",
        none: "—",
        overtimeThisWeek: "Heures supp. cette semaine",
        remainingWeekTime: "Temps restant cette semaine"
      };
      this.timeUtils    = new TimeUtilities(this.config);
      console.log("[TimeManager] init with config:", this.config);
      this.init();
      this.startAutoRefresh();
    }
    isTimeTrackingPageReady() {
      if (findAnyTimeTableTbody()) return true;
      const hasSched  = qsaAllFrames(".k-scheduler-table .k-nav-day, .k-scheduler-header-wrap .k-nav-day").length > 0;
      const hasEvents = qsaAllFrames(".k-event-template").length > 0;
      const hasText   = (document.body.innerText && /Heures dues|Temps traité/i.test(document.body.innerText));
      return hasSched || hasEvents || hasText;
    }
    async init() {
      const ready = await waitForPageReady(() => this.isTimeTrackingPageReady(), { pollMs: 300, timeoutMs: 30000 });
      if (!ready) {
        console.log("[TimeManager] Page pas prête après timeout. On réessaiera plus tard.");
        return;
      }
      this.processTimeData();
      this.cleanupTableRows();
      this.convertVacationRows();
      colorSchedulerDiffs();
    }
    startAutoRefresh() {
      setInterval(() => this.init(), 60000); // 60s
    }
    processTimeData() {
      const calculator = new TimeCalculator(this.config, this.timeUtils);
      const todayData = calculator.calculateTodayWorkTime();
      const weekData  = calculator.calculateWeekWorkTime();
      console.log("[TimeManager] === DEBUG ===");
      console.log("Travaillé aujourd'hui (h):", (todayData.totalWorked / 3600000).toFixed(2));
      console.log("Restant aujourd'hui  (h):", (todayData.remainingTime / 3600000).toFixed(2));
      console.log("Heure de fin estimée:", todayData.estimatedEndTime);
      console.log("==========================");
      new TableRenderer(this.translations, this.timeUtils).renderTimeTable(todayData, weekData);
    }
    cleanupTableRows() {
      new TableRowCleaner().removeSpecificRows(this.config.ROWS_TO_REMOVE || []);
    }
    convertVacationRows() {
      new VacationConverter(this.config, this.timeUtils).convertHoursToDays(this.config.ROWS_TO_CONVERT_TO_DAYS || []);
    }
  }

  // ===================================
  // 7) Boot unique
  // ===================================
  (async () => {
    await waitForConfig();
    await sleep(STARTUP_DELAY_MS);
    new TimeManagerExtension();
  })();
})();

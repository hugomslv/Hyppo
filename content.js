// content.js
setTimeout(async () => {
    // 1) Attendre que la configuration soit chargée
    let attempts = 0;
    while (!window.TIME_MANAGER_CONFIG && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (!window.TIME_MANAGER_CONFIG) {
      console.error('Configuration non chargée, utilisation de la configuration par défaut');
      return;
    }
  
    class TimeManagerExtension {
      constructor() {
        this.config       = window.TIME_MANAGER_CONFIG;
        this.translations = window.TRANSLATIONS[this.config.LANGUAGE || 'fr'];
        this.timeUtils    = new TimeUtilities(this.config);
  
        this.init();
        this.startAutoRefresh();
      }
  
      init() {
        if (!this.isTimeTrackingPageReady()) {
          console.log(`${this.translations.welcome} non trouvé. Attendez la connexion.`);
          return;
        }
        this.processTimeData();
        this.cleanupTableRows();
        this.convertVacationRows();
        this.colorSchedulerDiffs();
      }
  
      // Relance init() toutes les 60 000 ms pour mettre à jour
      startAutoRefresh() {
        setInterval(() => {
          this.init();
        }, 60000);
      }
  
      isTimeTrackingPageReady() {
        return document.body.innerText.includes(this.translations.welcome) ||
               !!document.querySelector("#__xmlview2--gcontigent");
      }
  
      processTimeData() {
        const calculator = new TimeCalculator(this.config, this.timeUtils);
        const todayData = calculator.calculateTodayWorkTime();
        const weekData  = calculator.calculateWeekWorkTime();
  
        // Debug
        console.log("=== DEBUG TIME CALCULATION ===");
        console.log("Temps travaillé aujourd'hui (heures):", (todayData.totalWorked / 3600000).toFixed(2));
        console.log("Temps restant aujourd'hui  (heures):", (todayData.remainingTime / 3600000).toFixed(2));
        console.log("Heure de fin estimée:", todayData.estimatedEndTime);
        console.log("==============================");
  
        this.displayTimeData(todayData, weekData);
      }
  
      displayTimeData(todayData, weekData) {
        const renderer = new TableRenderer(this.translations, this.timeUtils);
        renderer.renderTimeTable(todayData, weekData);
      }
  
      cleanupTableRows() {
        const rowsToRemove = this.config.ROWS_TO_REMOVE || [];
        if (rowsToRemove.length === 0) return;
  
        const cleaner = new TableRowCleaner();
        cleaner.removeSpecificRows(rowsToRemove);
      }
  
      convertVacationRows() {
        const rowsToConvert = this.config.ROWS_TO_CONVERT_TO_DAYS || [];
        if (rowsToConvert.length === 0) return;
  
        const converter = new VacationConverter(this.config, this.timeUtils);
        converter.convertHoursToDays(rowsToConvert);
      }
  
      colorSchedulerDiffs() {
        const daySpans = document.querySelectorAll('.k-scheduler-table .k-nav-day');
        daySpans.forEach(daySpan => {
          const divs = daySpan.querySelectorAll('div');
          if (divs.length < 2) return;
          const infoDiv = divs[1];
          const text = infoDiv.innerText;
          const match = text.match(/Écart.*:\s*([+-]?\d+):(\d{2})/);
          if (!match) return;
  
          const hoursStr = match[1];
          const minutes  = parseInt(match[2], 10);
          const hoursAbs = Math.abs(parseInt(hoursStr, 10));
          const sign     = hoursStr.trim().startsWith('-') ? -1 : 1;
          const totalMinutes = sign * (hoursAbs * 60 + minutes);
  
          let color;
          if (totalMinutes < 0) color = 'red';
          else if (totalMinutes === 0) color = 'grey';
          else color = 'green';
  
          infoDiv.style.color = color;
        });
      }
    }
  
    class TimeUtilities {
      constructor(config) {
        this.config = config;
      }
  
      parseTimeStringToMilliseconds(timeString) {
        if (!timeString || timeString === '-') return 0;
        const [hours, minutes] = timeString.split(':').map(Number);
        return (hours * 3600 + minutes * 60) * 1000;
      }
  
      parseTimeStringToDate(timeString) {
        const parts = timeString.split(':').map(Number);
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), ...parts);
      }

      // Convertit une chaîne "HH:MM" en nombre d'heures décimal
      parseTimeStringToHours(timeString) {
        if (!timeString || timeString === '-') return 0;
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours + (minutes || 0) / 60;
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
        return new Date().toLocaleDateString('fr-FR', {
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
        });
      }
  
      getMillisecondsInDay() {
        return this.config.DAILY_WORK_HOURS * 3600000;
      }
  
      getMillisecondsInWeek() {
        return this.getMillisecondsInDay() * this.config.WORKING_DAYS_PER_WEEK;
      }
    }
  
    class TimeCalculator {
      constructor(config, timeUtils) {
        this.config = config;
        this.timeUtils = timeUtils;
        this.pauseCalculator = new PauseCalculator(config, timeUtils);
      }
  
      calculateTodayWorkTime() {
        let totalToday = 0;
        let totalWeek = 0;
  
        const sched = this.calculateSchedulerTime();
        totalToday += sched.today;
        totalWeek += sched.week;
  
        const events = this.calculateEventTime();
        totalToday += events.today;
        totalWeek += events.week;
  
        const pause = this.pauseCalculator.calculatePauseAdjustment();
        const dayTarget = this.timeUtils.getMillisecondsInDay();
        const remaining = dayTarget - totalToday + pause.pauseAdded;
  
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
        let today = 0;
        let week = 0;
        const todayDate = this.timeUtils.getCurrentDateFormatted();
        const days = document.querySelectorAll('.k-scheduler-header-wrap .k-nav-day');
        days.forEach(day => {
          const headerText = day.querySelector('strong')?.textContent.trim();
          const contentText = day.querySelector('div:last-child')?.textContent;
          const match = contentText?.match(/Temps traité:\s*([0-9]{1,2}):(\d{2})/);
          if (match) {
            const ms = this.timeUtils.parseTimeStringToMilliseconds(`${match[1]}:${match[2]}`);
            week += ms;
            if (headerText && headerText.includes(todayDate)) {
              today += ms;
            }
          }
        });
        return { today, week };
      }
  
      calculateEventTime() {
        const entries = Array.from(document.querySelectorAll('.k-event-template'))
          .filter(el => el.innerHTML.includes('Horodatage'));
        let today = 0;
        let week = 0;
        for (let i = 1; i < entries.length; i += 2) {
          const start = this.extractTimeFromEntry(entries[i - 1]);
          const end = this.extractTimeFromEntry(entries[i]);
          if (start && end) {
            const diff = end.getTime() - start.getTime();
            today += diff;
            week += diff;
          }
        }
        if (entries.length % 2 === 1) {
          const last = this.extractTimeFromEntry(entries[entries.length - 1]);
          if (last) {
            const now = Date.now();
            const diff = now - last.getTime();
            today += diff;
            week += diff;
          }
        }
        return { today, week };
      }
  
      extractTimeFromEntry(entry) {
        const timeText = entry.innerHTML.replace('Horodatage', '').trim();
        return this.timeUtils.parseTimeStringToDate(timeText);
      }
  
      calculateEstimatedEndTime(remainingMs) {
        const end = new Date(Date.now() + remainingMs);
        return end.toTimeString().substr(0, 5);
      }
    }
  
    class PauseCalculator {
      constructor(config, timeUtils) {
        this.config = config;
        this.timeUtils = timeUtils;
      }
  
      calculatePauseAdjustment() {
        const entries = Array.from(document.querySelectorAll('.k-event-template'))
          .filter(el => el.innerHTML.includes('Horodatage'));
        let pauseDetected = false;
        let pauseAdded = 0;
        for (let i = 1; i < entries.length; i += 2) {
          const start = this.timeUtils.parseTimeStringToDate(
            entries[i - 1].innerHTML.replace('Horodatage', '').trim()
          );
          const end = this.timeUtils.parseTimeStringToDate(
            entries[i].innerHTML.replace('Horodatage', '').trim()
          );
          if (this.isWorkingDuringLunchBreak(start, end)) {
            const info = this.calculateLunchBreakOverlap(start, end);
            pauseDetected = info.hasMinimumPause;
            pauseAdded = info.timeToAdd;
            break;
          }
        }
        return { pauseDetected, pauseAdded };
      }
  
      isWorkingDuringLunchBreak(start, end) {
        return start.toDateString() === new Date().toDateString() &&
               start.getHours() <= this.config.LUNCH_BREAK.END_HOUR &&
               end.getHours() >= this.config.LUNCH_BREAK.START_HOUR;
      }
  
      calculateLunchBreakOverlap(start, end) {
        const lunchStart = this.timeUtils.parseTimeStringToDate(
          `${this.config.LUNCH_BREAK.START_HOUR}:00`
        );
        const lunchEnd = this.timeUtils.parseTimeStringToDate(
          `${this.config.LUNCH_BREAK.END_HOUR}:00`
        );
        const overlapStart = Math.max(start.getTime(), lunchStart.getTime());
        const overlapEnd = Math.min(end.getTime(), lunchEnd.getTime());
        const overlapMs = Math.max(0, overlapEnd - overlapStart);
        const overlapMins = overlapMs / 60000;
        const hasMinimumPause = overlapMins >= this.config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES;
        const toAdd = hasMinimumPause ? 0 : (this.config.LUNCH_BREAK.MINIMUM_DURATION_MINUTES - overlapMins) * 60000;
        return { hasMinimumPause, timeToAdd: toAdd };
      }
    }
  
    class TableRenderer {
      constructor(translations, timeUtils) {
        this.translations = translations;
        this.timeUtils = timeUtils;
      }
  
      renderTimeTable(todayData, weekData) {
        const tbody = document.querySelector('#__xmlview2--gcontigent tbody');
        if (!tbody) {
          console.log('Tableau introuvable !');
          return;
        }
        const rows = this.createTableRows(todayData, weekData);
        rows.forEach(html => {
          const tr = document.createElement('tr');
          tr.innerHTML = html;
          tbody.appendChild(tr);
        });
        console.log('Données ajoutées au tableau existant !');
      }
  
      createTableRows(todayData, weekData) {
        const dailyHours = this.timeUtils.config.DAILY_WORK_HOURS;
        const rows = [];
        rows.push(this.createRow(
          this.translations.workHours,
          this.timeUtils.formatHoursToTimeString(todayData.totalWorked / 3600000)
        ));
        rows.push(this.createRow(
          this.translations.timeRemaining + ' (' + this.timeUtils.formatHoursToTimeString(dailyHours) + ')',
          this.timeUtils.formatHoursToTimeString(Math.abs(todayData.remainingTime) / 3600000)
        ));
        rows.push(this.createRow(
          this.translations.estimatedEnd,
          todayData.estimatedEndTime
        ));
        rows.push(this.createRow(
          this.translations.pauseDetected,
          todayData.pauseDetected ? this.translations.yes : this.translations.no
        ));
        rows.push(this.createRow(
          this.translations.pauseAdded,
          todayData.pauseAdded > 0 ? Math.floor(todayData.pauseAdded / 60000) + ' minutes' : this.translations.none
        ));
        rows.push(this.createRow(
          weekData.isOvertime ? this.translations.overtimeThisWeek : this.translations.remainingWeekTime,
          this.timeUtils.formatHoursToTimeString(Math.abs(weekData.remainingTime) / 3600000)
        ));
        return rows;
      }
  
      createRow(label, value) {
        return `<tr role="row"><td role="gridcell" colspan="2">${label}</td>` +
               `<td role="gridcell" style="text-align:right;">${value}</td></tr>`;
      }
    }
  
    class TableRowCleaner {
      removeSpecificRows(rowsToRemove) {
        document.querySelectorAll('tr[data-uid]').forEach(row => {
          const cellText = row.querySelector("td[role='gridcell']")?.textContent.trim();
          if (cellText && rowsToRemove.includes(cellText)) {
            row.remove();
            console.log(`Ligne supprimée : ${cellText}`);
          }
        });
        document.querySelectorAll('th.k-header').forEach(th => {
          console.log(`Header supprimé : ${th.textContent.trim()}`);
          th.remove();
        });
      }
    }
  
    class VacationConverter {
      constructor(config, timeUtils) {
        this.config = config;
        this.timeUtils = timeUtils;
      }
  
      convertHoursToDays(rowsToConvert) {
        document.querySelectorAll('tr[data-uid]').forEach(row => {
          const cellText = row.querySelector("td[role='gridcell']")?.textContent.trim();
          if (cellText && rowsToConvert.includes(cellText)) {
            this.processVacationRow(row, cellText);
          }
        });
      }
  
      processVacationRow(row, originalText) {
        const first   = row.querySelector('td:nth-child(1)');
        const second  = row.querySelector('td:nth-child(2)');
        const third   = row.querySelector('td:nth-child(3)');
        const hoursText = second?.textContent.trim();
        if (!first || !second || !third || !hoursText) return;
  
        const hours    = this.timeUtils.parseTimeStringToHours(hoursText);
        const days     = this.timeUtils.convertHoursToDays(hours);
        const fullDays = Math.floor(days);
  
        first.textContent  = 'Vacances (j)';
        second.textContent = days.toString();
        third.textContent  = fullDays.toString();
  
        console.log(`Ligne modifiée : ${originalText} -> Heures: ${hoursText}, Jours: ${days}, Journées: ${fullDays}`);
      }
    }
  
    // Initialisation de l'extension
    new TimeManagerExtension();
  
  }, 4000);
  
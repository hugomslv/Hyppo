class TimeUtilities {
  constructor(config = { DAILY_WORK_HOURS: 8.4 }) {
    this.config = config;
  }

  parseTimeStringToMilliseconds(timeString) {
    if (!timeString || timeString === '-') return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours * 3600 + minutes * 60) * 1000;
  }

  // Convert "HH:MM" to decimal hours
  parseTimeStringToHours(timeString) {
    if (!timeString || timeString === '-') return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours + (minutes || 0) / 60;
  }

  convertHoursToDays(hours) {
    const days = hours / this.config.DAILY_WORK_HOURS;
    return parseFloat(days.toFixed(2));
  }
}

module.exports = TimeUtilities;

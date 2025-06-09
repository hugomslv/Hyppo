const TimeUtilities = require('../time_utils');

describe('TimeUtilities', () => {
  const utils = new TimeUtilities({ DAILY_WORK_HOURS: 8 });

  test('parseTimeStringToMilliseconds converts HH:MM string to milliseconds', () => {
    expect(utils.parseTimeStringToMilliseconds('02:30')).toBe(9000000);
    expect(utils.parseTimeStringToMilliseconds('-')).toBe(0);
  });

  test('parseTimeStringToHours converts HH:MM to decimal hours', () => {
    expect(utils.parseTimeStringToHours('2:30')).toBeCloseTo(2.5);
    expect(utils.parseTimeStringToHours('3')).toBeCloseTo(3);
    expect(utils.parseTimeStringToHours('-')).toBe(0);
  });

  test('convertHoursToDays converts hours to days based on DAILY_WORK_HOURS', () => {
    expect(utils.convertHoursToDays(16)).toBe(2);
    expect(utils.convertHoursToDays(12)).toBe(1.5);
  });
});

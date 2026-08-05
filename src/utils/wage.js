/**
 * Calculates tiered main wage and helper wage for a trainer on a specific date (YYYY-MM-DD).
 * The first 60 minutes of main training each day use main_wage_first_hour.
 * All minutes after the first 60 minutes on that day use main_wage_additional.
 * Helper wage uses a fixed helper_wage rate.
 */
export const calculateTrainerDailyWage = (mainSessions = [], helperSessions = []) => {
  const sortedMain = [...mainSessions].sort((a, b) => {
    const timeA = a.start_time || '00:00';
    const timeB = b.start_time || '00:00';
    return timeA.localeCompare(timeB);
  });

  let accumulatedMainMins = 0;
  let totalMainPay = 0;
  const mainBreakdown = {};

  sortedMain.forEach((session) => {
    const duration = session.duration_minutes || 0;
    const firstRate = typeof session.main_wage_first_hour === 'number' ? session.main_wage_first_hour : 0;
    const addRate = typeof session.main_wage_additional === 'number' ? session.main_wage_additional : firstRate;

    const prevMins = accumulatedMainMins;
    accumulatedMainMins += duration;

    const firstHourMins = Math.max(0, Math.min(60, accumulatedMainMins) - prevMins);
    const addMins = duration - firstHourMins;

    const sessionPay = (firstHourMins / 60) * firstRate + (addMins / 60) * addRate;
    totalMainPay += sessionPay;

    mainBreakdown[session.id] = {
      firstHourMins,
      addMins,
      firstRate,
      addRate,
      pay: sessionPay,
    };
  });

  let totalHelperPay = 0;
  const helperBreakdown = {};

  helperSessions.forEach((session) => {
    const duration = session.duration_minutes || 0;
    const wage = typeof session.helper_wage === 'number' ? session.helper_wage : 0;
    const sessionPay = (duration / 60) * wage;
    totalHelperPay += sessionPay;

    helperBreakdown[session.id] = {
      wage,
      pay: sessionPay,
    };
  });

  return {
    totalPay: totalMainPay + totalHelperPay,
    mainPay: totalMainPay,
    helperPay: totalHelperPay,
    mainBreakdown,
    helperBreakdown,
  };
};

import ExcelJS from 'exceljs';

export const createExportWorkbook = async (rows, hourlyWage, t, locale = 'de') => {
  const workbook = new ExcelJS.Workbook();

  // Gruppieren nach Trainer
  const trainers = {};
  rows.forEach((row) => {
    if (!trainers[row.trainer_name]) trainers[row.trainer_name] = [];
    trainers[row.trainer_name].push(row);
  });

  for (const [trainerName, logs] of Object.entries(trainers)) {
    const sheet = workbook.addWorksheet(trainerName.substring(0, 31)); // Max 31 Zeichen
    sheet.columns = [
      { header: t('EXCEL_HEADER_START'), key: 'start', width: 20 },
      { header: t('EXCEL_HEADER_END'), key: 'end', width: 20 },
      { header: t('EXCEL_HEADER_HALL'), key: 'hall', width: 20 },
      { header: t('EXCEL_HEADER_DURATION'), key: 'duration', width: 15 },
      { header: t('EXCEL_HEADER_PAY'), key: 'pay', width: 15 },
    ];

    let totalDuration = 0;
    let totalPay = 0;

    logs.forEach((log) => {
      const pay = log.duration_minutes ? (log.duration_minutes / 60) * hourlyWage : 0;
      sheet.addRow({
        start: new Date(log.start_timestamp + ' UTC').toLocaleString(locale),
        end: log.end_timestamp
          ? new Date(log.end_timestamp + ' UTC').toLocaleString(locale)
          : '...',
        hall: log.hall_name,
        duration: log.duration_minutes || 0,
        pay: pay.toFixed(2),
      });
      totalDuration += log.duration_minutes || 0;
      totalPay += pay;
    });

    sheet.addRow({});
    sheet.addRow({ hall: t('EXCEL_TOTAL'), duration: totalDuration, pay: totalPay.toFixed(2) });

    // Styling
    sheet.getRow(1).font = { bold: true };
    const lastRow = sheet.lastRow;
    lastRow.font = { bold: true };
  }

  return workbook;
};

export const createTrainerWorkbook = async (trainerName, rows, hourlyWage, t, locale = 'de') => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(trainerName.substring(0, 31));

  sheet.columns = [
    { header: t('EXCEL_HEADER_START'), key: 'start', width: 20 },
    { header: t('EXCEL_HEADER_END'), key: 'end', width: 20 },
    { header: t('EXCEL_HEADER_HALL'), key: 'hall', width: 20 },
    { header: t('EXCEL_HEADER_DURATION'), key: 'duration', width: 15 },
    { header: t('EXCEL_HEADER_PAY'), key: 'pay', width: 15 },
  ];

  let totalDuration = 0;
  let totalPay = 0;

  rows.forEach((log) => {
    const pay = log.duration_minutes ? (log.duration_minutes / 60) * hourlyWage : 0;
    sheet.addRow({
      start: new Date(log.start_timestamp + ' UTC').toLocaleString(locale),
      end: log.end_timestamp ? new Date(log.end_timestamp + ' UTC').toLocaleString(locale) : '...',
      hall: log.hall_name,
      duration: log.duration_minutes || 0,
      pay: pay.toFixed(2),
    });
    totalDuration += log.duration_minutes || 0;
    totalPay += pay;
  });

  sheet.addRow({});
  sheet.addRow({ hall: t('EXCEL_TOTAL'), duration: totalDuration, pay: totalPay.toFixed(2) });

  sheet.getRow(1).font = { bold: true };
  sheet.lastRow.font = { bold: true };

  return workbook;
};

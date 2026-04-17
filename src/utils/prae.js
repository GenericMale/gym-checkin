import carbone from 'carbone';
import JSZip from 'jszip';
import path from 'path';
import { promisify } from 'util';

const render = promisify(carbone.render);

const TEMPLATE_PATH = path.join(process.cwd(), 'resources', 'Pauschale_Reiseaufwandsentschaedigung.xlsx');

/**
 * Generiert die PRAE-Daten für einen Trainer für einen bestimmten Monat.
 */
export const preparePraeData = (trainerName, rows, hourlyWage, selectedMonth) => {
  const [year, month] = selectedMonth.split('-');

  const data = {
    trainerName: trainerName,
    month: month,
    year: year,
  };

  // Initialisiere Tage 1-31 mit 0
  for (let i = 1; i <= 31; i++) {
    data[`day${i}`] = 0;
  }

  // Gruppiere nach Tag und summiere die Vergütung
  rows.forEach((row) => {
    const date = new Date(row.start_timestamp + ' UTC');
    const day = date.getUTCDate();
    const pay = row.duration_minutes ? (row.duration_minutes / 60) * hourlyWage : 0;
    data[`day${day}`] += pay;
  });

  return data;
};

/**
 * Generiert ein einzelnes PRAE-Dokument als Buffer.
 */
export const generatePraeDocument = async (data) => {
  return await render(TEMPLATE_PATH, data);
};

/**
 * Generiert PRAE-Dokumente für alle Trainer und bündelt sie ggf. in einem ZIP.
 * @returns {Object} { buffer, filename, contentType }
 */
export const generateExport = async (rowsByTrainer, hourlyWage, selectedMonth) => {
  const trainers = Object.keys(rowsByTrainer);

  if (trainers.length === 1) {
    const trainerName = trainers[0];
    const data = preparePraeData(trainerName, rowsByTrainer[trainerName], hourlyWage, selectedMonth);
    const buffer = await generatePraeDocument(data);
    const filename = `PRAE_${trainerName.replace(/\s+/g, '_')}_${selectedMonth}.xlsx`;
    return {
      buffer,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  const zip = new JSZip();
  for (const trainerName of trainers) {
    const data = preparePraeData(trainerName, rowsByTrainer[trainerName], hourlyWage, selectedMonth);
    const buffer = await generatePraeDocument(data);
    zip.file(`PRAE_${trainerName.replace(/\s+/g, '_')}_${selectedMonth}.xlsx`, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    buffer: zipBuffer,
    filename: `PRAE_Export_${selectedMonth}.zip`,
    contentType: 'application/zip'
  };
};

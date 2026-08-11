import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import formatXml from 'xml-formatter';

const inputFile = process.argv[2];
const outputDir = path.join(process.cwd(), 'resources', 'PRAE');

if (!inputFile) {
  console.error("Usage: node scripts/unpack-prae.js <path-to-official-xlsx>");
  process.exit(1);
}

async function unpackPRAE() {
  console.log(`Unpacking and formatting ${inputFile}...`);
  const buffer = fs.readFileSync(inputFile);
  const zip = await JSZip.loadAsync(buffer);

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  for (const relativePath of Object.keys(zip.files)) {
    const file = zip.files[relativePath];
    const targetPath = path.join(outputDir, relativePath);

    if (file.dir) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    if (/\.(xml|rels|vml)$/i.test(relativePath)) {
      const rawXml = await file.async('string');

      let formattedXml;
      try {
        // Pretty-print the XML with 2-space indentation
        formattedXml = formatXml(rawXml, {
          indentation: '  ',
          collapseContent: true, // Keeps text inside <t>Hello</t> on a single line
          lineSeparator: '\n'
        });
      } catch (err) {
        // Fallback to raw XML if formatting fails on unusual VML syntax
        formattedXml = rawXml;
      }

      fs.writeFileSync(targetPath, formattedXml, 'utf8');
    } else {
      // Static binary files (images, fonts)
      const fileData = await file.async('nodebuffer');
      fs.writeFileSync(targetPath, fileData);
    }
  }

  console.log(`✅ Formatted and unpacked to: ${outputDir}`);
}

unpackPRAE().catch(console.error);

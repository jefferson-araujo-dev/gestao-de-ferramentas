import crypto from 'crypto';

const scripts = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

async function generateSRI() {
  console.log('🔒 Gerando hashes SRI seguras...\n');
  for (const url of scripts) {
    const response = await fetch(url);
    const data = await response.text();

    // Calcula o hash SHA-384
    const hash = crypto.createHash('sha384').update(data, 'utf8').digest('base64');
    console.log(
      `<script defer src="${url}" integrity="sha384-${hash}" crossorigin="anonymous"></script>`
    );
  }
}
generateSRI();

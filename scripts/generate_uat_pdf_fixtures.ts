import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

async function createCaseAPdf(outputDir: string): Promise<string> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  // A4 Page: 595.28 x 841.89 pt
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  // Green header bar
  page.drawRectangle({
    x: 0,
    y: height - 100,
    width,
    height: 100,
    color: rgb(0.08, 0.52, 0.24) // Panda green
  });

  page.drawText('Panda Supermarket - Jeddah', {
    x: 40,
    y: height - 50,
    size: 26,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  page.drawText('Weekly Promotional Offers - Fresh Savings', {
    x: 40,
    y: height - 80,
    size: 14,
    font: fontRegular,
    color: rgb(0.9, 0.98, 0.9)
  });

  // Validity Date Banner
  page.drawRectangle({
    x: 40,
    y: height - 160,
    width: width - 80,
    height: 45,
    color: rgb(0.95, 0.98, 0.94),
    borderColor: rgb(0.08, 0.52, 0.24),
    borderWidth: 1.5
  });

  page.drawText('Offers valid from 01/11/2026 to 15/11/2026', {
    x: 60,
    y: height - 142,
    size: 16,
    font: fontBold,
    color: rgb(0.08, 0.52, 0.24)
  });

  // Four sample offer cards
  const gridItems = [
    { name: 'Afia Corn Oil 2 x 1.5L', price: '29.95 SAR', oldPrice: '38.50 SAR', x: 45, y: height - 380 },
    { name: 'Abu Kass Basmati Rice 10kg', price: '68.95 SAR', oldPrice: '84.00 SAR', x: 305, y: height - 380 },
    { name: 'Almarai Fresh Milk 2L', price: '11.00 SAR', oldPrice: '13.50 SAR', x: 45, y: height - 600 },
    { name: 'Tide Washing Powder 5kg', price: '42.50 SAR', oldPrice: '59.00 SAR', x: 305, y: height - 600 }
  ];

  for (const item of gridItems) {
    page.drawRectangle({
      x: item.x,
      y: item.y,
      width: 240,
      height: 200,
      color: rgb(0.98, 0.98, 0.98),
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 1
    });

    page.drawRectangle({
      x: item.x + 10,
      y: item.y + 60,
      width: 220,
      height: 125,
      color: rgb(0.92, 0.94, 0.96)
    });

    page.drawText(item.name, {
      x: item.x + 15,
      y: item.y + 35,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1)
    });

    page.drawText(`Offer: ${item.price} (Was: ${item.oldPrice})`, {
      x: item.x + 15,
      y: item.y + 15,
      size: 11,
      font: fontRegular,
      color: rgb(0.8, 0.1, 0.1)
    });
  }

  // Footer
  page.drawText('All prices include 15% VAT. Valid while stocks last in all Panda Jeddah branches.', {
    x: 40,
    y: 30,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4)
  });

  const pdfBytes = await doc.save();
  const destPath = path.join(outputDir, 'Panda-Weekly-Offers-01Nov.pdf');
  fs.writeFileSync(destPath, pdfBytes);
  return destPath;
}

async function createCaseBPdf(outputDir: string): Promise<string> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const categories = [
    { title: 'Danube Supermarkets - Winter Food Festival', subtitle: 'Page 1: Fresh Produce & Bakery' },
    { title: 'Danube Supermarkets - Dairy & Chilled Foods', subtitle: 'Page 2: Imported Cheeses and Dairy' },
    { title: 'Danube Supermarkets - Oils, Grains & Rice', subtitle: 'Page 3: Premium Pantry Essentials' },
    { title: 'Danube Supermarkets - Home Care & Detergents', subtitle: 'Page 4: Laundry & Cleaning Supplies' },
    { title: 'Danube Supermarkets - Kitchen Appliances', subtitle: 'Page 5: Small Appliances & Cookware' }
  ];

  // Pages 1 to 5: Have selectable text, Danube branding, but NO validity dates anywhere!
  for (let i = 0; i < 5; i++) {
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    // Red Danube header bar
    page.drawRectangle({
      x: 0,
      y: height - 90,
      width,
      height: 90,
      color: rgb(0.75, 0.12, 0.15) // Danube red
    });

    page.drawText(categories[i].title, {
      x: 40,
      y: height - 50,
      size: 20,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    page.drawText(categories[i].subtitle, {
      x: 40,
      y: height - 75,
      size: 13,
      font: fontRegular,
      color: rgb(1, 0.9, 0.9)
    });

    page.drawText(`Promotional Page ${i + 1} of 6 - All Branches`, {
      x: 40,
      y: height - 120,
      size: 11,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4)
    });

    // Dummy product cells
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 45 + col * 260;
        const y = height - 350 - row * 220;
        page.drawRectangle({
          x,
          y,
          width: 240,
          height: 190,
          color: rgb(0.97, 0.97, 0.97),
          borderColor: rgb(0.85, 0.85, 0.85),
          borderWidth: 1
        });
        page.drawText(`Selected Danube Item P${i + 1}_R${row}_C${col}`, {
          x: x + 15,
          y: y + 30,
          size: 11,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2)
        });
        page.drawText(`Special Offer: ${(15.5 + row * 10 + col * 5).toFixed(2)} SAR`, {
          x: x + 15,
          y: y + 15,
          size: 10,
          font: fontRegular,
          color: rgb(0.7, 0.1, 0.1)
        });
      }
    }
  }

  // Page 6: Scanned / Rasterized Page (Image-only validity dates!)
  // In this page, we render an image containing the validity text and embed it as a raster PNG.
  // We do NOT call page.drawText for the validity dates, so no text layer exists!
  const page6 = doc.addPage([595.28, 841.89]);
  const { width, height } = page6.getSize();

  // Create rasterized banner image via sharp
  const scannedSvg = `
    <svg width="500" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="500" height="200" fill="#fdf2f2" stroke="#dc2626" stroke-width="2"/>
      <text x="30" y="45" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#991b1b">Danube Supermarkets - Customer Service</text>
      <text x="30" y="85" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#1e293b">Danube Catalog Offers Valid From 10/11/2026 until 20/11/2026</text>
      <text x="30" y="125" font-family="Arial, sans-serif" font-size="13" fill="#475569">All prices include VAT. Valid across all Danube branches in KSA.</text>
      <text x="30" y="160" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Toll Free: 800-244-2225 | www.danubeco.com</text>
    </svg>
  `;
  const scannedPngBuffer = await sharp(Buffer.from(scannedSvg)).png().toBuffer();
  const embeddedPng = await doc.embedPng(scannedPngBuffer);

  page6.drawImage(embeddedPng, {
    x: 47,
    y: height - 250,
    width: 500,
    height: 200
  });

  const pdfBytes = await doc.save();
  const destPath = path.join(outputDir, 'Danube-Biweekly-Nov2026.pdf');
  fs.writeFileSync(destPath, pdfBytes);
  return destPath;
}

async function createCaseCPdf(outputDir: string): Promise<string> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  // Pages 1-3:
  const pagesInfo = [
    { title: 'Al Wafa Supermarket - Monthly Mega Saver', dates: 'Valid from 05/11/2026 to 25/11/2026' },
    { title: 'Al Wafa Supermarket - Dairy & Beverages', dates: 'Catalog Validity: 05/11/2026 to 25/11/2026' },
    { title: 'Al Wafa Supermarket - Canned Food & Confectionery', dates: 'Catalog Validity: 05/11/2026 to 25/11/2026' }
  ];

  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    // Blue header
    page.drawRectangle({
      x: 0,
      y: height - 90,
      width,
      height: 90,
      color: rgb(0.1, 0.35, 0.65) // Al Wafa blue
    });

    page.drawText(pagesInfo[i].title, {
      x: 40,
      y: height - 50,
      size: 20,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    page.drawText(pagesInfo[i].dates, {
      x: 40,
      y: height - 75,
      size: 13,
      font: fontRegular,
      color: rgb(0.9, 0.95, 1)
    });
  }

  // Page 4: Mixed-Page Layout with 9 offers:
  // 8 general grocery offers + 1 fresh-meat weekend special with visible banner!
  const page4 = doc.addPage([595.28, 841.89]);
  const { width, height } = page4.getSize();

  // Header
  page4.drawRectangle({
    x: 0,
    y: height - 70,
    width,
    height: 70,
    color: rgb(0.1, 0.35, 0.65)
  });

  page4.drawText('Al Wafa Supermarket - Page 4 Special Selections', {
    x: 30,
    y: height - 42,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  // Weekend Fresh Meat Banner (Exception!)
  page4.drawRectangle({
    x: 25,
    y: height - 125,
    width: width - 50,
    height: 45,
    color: rgb(0.99, 0.92, 0.92),
    borderColor: rgb(0.85, 0.2, 0.2),
    borderWidth: 1.5
  });

  page4.drawText('Weekend Special Fresh Meat Offer: Valid only from 07 November 2026 to 09 November 2026', {
    x: 35,
    y: height - 100,
    size: 11,
    font: fontBold,
    color: rgb(0.85, 0.1, 0.1)
  });

  page4.drawText('All other 8 general grocery offers on this page remain valid until 25 November 2026', {
    x: 35,
    y: height - 116,
    size: 9,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4)
  });

  // 9 items in a 3x3 grid
  const items = [
    { id: 'p004_item001', name: 'Sunflower Oil 1.5L', price: '14.95 SAR', isMeat: false },
    { id: 'p004_item002', name: 'Basmati Rice 5kg', price: '34.50 SAR', isMeat: false },
    { id: 'p004_item003', name: 'White Sugar 10kg', price: '28.00 SAR', isMeat: false },
    { id: 'p004_item004', name: 'Tomato Paste 8x135g', price: '9.95 SAR', isMeat: false },
    { id: 'p004_item005', name: 'Instant Coffee 200g', price: '19.50 SAR', isMeat: false },
    { id: 'p004_item006', name: 'Wheat Flour 10kg', price: '18.00 SAR', isMeat: false },
    { id: 'p004_item007', name: 'Evaporated Milk 170g', price: '3.25 SAR', isMeat: false },
    { id: 'p004_item008', name: 'Table Salt 700g', price: '1.50 SAR', isMeat: false },
    { id: 'p004_item009', name: 'Fresh Australian Beef Ribeye 1kg', price: '49.95 SAR', isMeat: true }
  ];

  const colWidth = 175;
  const rowHeight = 220;

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const r = Math.floor(idx / 3);
    const c = idx % 3;
    const x = 25 + c * 182;
    const y = height - 140 - (r + 1) * rowHeight;

    page4.drawRectangle({
      x,
      y,
      width: colWidth,
      height: rowHeight - 15,
      color: it.isMeat ? rgb(1, 0.95, 0.95) : rgb(0.98, 0.98, 0.98),
      borderColor: it.isMeat ? rgb(0.85, 0.2, 0.2) : rgb(0.85, 0.85, 0.85),
      borderWidth: it.isMeat ? 1.5 : 1
    });

    if (it.isMeat) {
      page4.drawRectangle({
        x: x + 5,
        y: y + rowHeight - 35,
        width: colWidth - 10,
        height: 16,
        color: rgb(0.85, 0.2, 0.2)
      });
      page4.drawText('WEEKEND FRESH MEAT (07-09 NOV)', {
        x: x + 10,
        y: y + rowHeight - 31,
        size: 7.5,
        font: fontBold,
        color: rgb(1, 1, 1)
      });
    }

    page4.drawText(it.id, {
      x: x + 10,
      y: y + rowHeight - 50,
      size: 9,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3)
    });

    page4.drawText(it.name, {
      x: x + 10,
      y: y + 30,
      size: 9.5,
      font: fontBold,
      color: it.isMeat ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.1)
    });

    page4.drawText(`Price: ${it.price}`, {
      x: x + 10,
      y: y + 15,
      size: 9,
      font: fontRegular,
      color: rgb(0.2, 0.2, 0.2)
    });
  }

  const pdfBytes = await doc.save();
  const destPath = path.join(outputDir, 'AlWafa-Monthly-MegaSaver.pdf');
  fs.writeFileSync(destPath, pdfBytes);
  return destPath;
}

async function main() {
  console.log('Generating usable PDF fixtures for UAT...');
  const baseDir = path.join(process.cwd(), 'test-fixtures', 'uat_cases');

  const dirA = path.join(baseDir, 'case_a_standard');
  const dirB = path.join(baseDir, 'case_b_interior_dates');
  const dirC = path.join(baseDir, 'case_c_mixed_page');

  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  fs.mkdirSync(dirC, { recursive: true });

  const pathA = await createCaseAPdf(dirA);
  console.log(`Generated Case A PDF: ${pathA} (${fs.statSync(pathA).size} bytes)`);

  const pathB = await createCaseBPdf(dirB);
  console.log(`Generated Case B PDF: ${pathB} (${fs.statSync(pathB).size} bytes)`);

  const pathC = await createCaseCPdf(dirC);
  console.log(`Generated Case C PDF: ${pathC} (${fs.statSync(pathC).size} bytes)`);

  console.log('All UAT PDF fixtures generated successfully.');
}

main().catch(err => {
  console.error('Failed to generate UAT PDF fixtures:', err);
  process.exit(1);
});


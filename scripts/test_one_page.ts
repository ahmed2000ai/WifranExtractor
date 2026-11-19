import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import {
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  decodeLeafletPageExtraction
} from '../src/shared/schemas/leafletPageExtractionSchema';
import { calculateGeminiCost } from '../src/main/ocr/geminiPricingTable';

const apiKey = 'AIzaSyCo5pcKmvuaifVQrakyXRv50hkiNbDpAm4';

async function testOnePage() {
  console.log('Testing 1 live page (GOLDEN-P1) with Optimized Schema on Gemini 3.8 Flash...');
  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3.8-flash';

  const imgBuf = readFileSync('test-fixtures/page1_small.png');
  const jpegBuf = await sharp(imgBuf).jpeg({ quality: 92 }).toBuffer();
  const base64Image = jpegBuf.toString('base64');

  const systemInstruction = buildOptimizedPageExtractionSystemPrompt();
  const responseSchema = getLeafletPageGenAiSchema('optimized');

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: 'Analyze this promotional supermarket leaflet page. Extract all offers with exact 2D component bounding boxes.' }
        ]
      }
    ],
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: 'HIGH' },
      responseMimeType: 'application/json',
      responseSchema,
      serviceTier: 'standard'
    }
  });

  const durationMs = Date.now() - startTime;
  console.log(`Live call completed in ${durationMs}ms!`);
  const rawText = response.text || '';
  const parsed = JSON.parse(rawText);
  const decoded = decodeLeafletPageExtraction(parsed);

  console.log(`Extracted offers: ${decoded.offers.length} (Expected: 9)`);
  console.log('Usage Metadata:', response.usageMetadata);

  const meta = response.usageMetadata || {};
  const cost = calculateGeminiCost(
    {
      promptTokenCount: meta.promptTokenCount ?? 0,
      candidatesTokenCount: meta.candidatesTokenCount ?? 0,
      thoughtsTokenCount: meta.thoughtsTokenCount ?? 0
    },
    model,
    'standard'
  );

  console.log(`Calculated Cost: $${cost.totalCostUsd.toFixed(6)} USD`);

  // Sample offer 1
  const o1 = decoded.offers[0];
  console.log('Sample Offer #1:');
  console.log(`  Arabic: "${o1.arabic_title}"`);
  console.log(`  English: "${o1.english_title}"`);
  console.log(`  Promo Price: ${o1.promo_price}`);
  console.log(`  Original Price: ${o1.original_price}`);
  console.log(`  Size: ${o1.size_value}`);
  console.log(`  Graphic box:`, o1.components.product_graphic_box);
  console.log(`  Promo box:`, o1.components.promo_price_box);
}

testOnePage().catch(err => {
  console.error('Error on one page test:', err);
});


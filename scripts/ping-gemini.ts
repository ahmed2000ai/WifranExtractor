import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { GoogleGenAI } from '@google/genai';

loadDotenv({ path: join(process.cwd(), '.env.local') });
loadDotenv({ path: join(process.cwd(), '.env') });

async function ping() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('GEMINI_API_KEY present:', Boolean(apiKey), 'Length:', apiKey ? apiKey.length : 0);

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment');
  }

  const client = new GoogleGenAI({ apiKey });

  const modelsToTest = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  for (const model of modelsToTest) {
    try {
      console.log(`\nTesting model: "${model}"...`);
      const resp = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }]
      });
      console.log(`✓ Model "${model}" SUCCESS: response = "${resp.text?.trim()}"`);
    } catch (err: any) {
      console.log(`✗ Model "${model}" FAILED: ${err.message}`);
    }
  }
}

ping().catch(e => {
  console.error('Fatal ping error:', e);
  process.exit(1);
});

import { GoogleGenAI } from '@google/genai';

const apiKey = 'AIzaSyCo5pcKmvuaifVQrakyXRv50hkiNbDpAm4';

async function testModels() {
  const ai = new GoogleGenAI({ apiKey });
  for (const m of ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash']) {
    try {
      const res = await ai.models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: 'Say 1' }] }],
        config: { serviceTier: 'flex' }
      });
      console.log(`[OK] Model ${m} supports flex tier! Response: ${res.text?.trim()}`);
    } catch (err: any) {
      console.log(`[FAIL] Model ${m}: ${err.message}`);
    }
  }
}

testModels();

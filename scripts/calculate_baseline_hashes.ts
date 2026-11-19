import { createHash } from 'crypto';
import {
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt,
  buildMasterQualityPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import { getLeafletPageGenAiSchema } from '../src/shared/schemas/leafletPageExtractionSchema';

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

try {
  const legacyPrompt = buildLegacyPageExtractionSystemPrompt();
  const optPrompt = buildOptimizedPageExtractionSystemPrompt();
  const mqPrompt = buildMasterQualityPageExtractionSystemPrompt();

  const legacySchema = getLeafletPageGenAiSchema('legacy');
  const optSchema = getLeafletPageGenAiSchema('optimized');

  const legacyPromptHash = sha256(legacyPrompt);
  const optPromptHash = sha256(optPrompt);
  const mqPromptHash = sha256(mqPrompt);

  const legacySchemaJson = JSON.stringify(legacySchema);
  const optSchemaJson = JSON.stringify(optSchema);

  const legacySchemaHash = sha256(legacySchemaJson);
  const optSchemaHash = sha256(optSchemaJson);

  const result = {
    prompts: {
      legacy: {
        lengthChars: legacyPrompt.length,
        sha256: legacyPromptHash
      },
      optimized: {
        lengthChars: optPrompt.length,
        sha256: optPromptHash
      },
      master_quality: {
        lengthChars: mqPrompt.length,
        sha256: mqPromptHash
      }
    },
    schemas: {
      legacy: {
        lengthChars: legacySchemaJson.length,
        sha256: legacySchemaHash
      },
      optimized: {
        lengthChars: optSchemaJson.length,
        sha256: optSchemaHash
      }
    }
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err: any) {
  console.error('FAILED_TO_CALCULATE_HASHES:', err.message);
  process.exit(1);
}


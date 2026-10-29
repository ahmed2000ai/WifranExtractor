import { ipcMain } from 'electron';
import { sharedRev1PipelineService } from '../page-first/rev1PipelineService';
import { sharedExceptionsQueueService } from '../ml/exceptionsQueueService';
import { sharedTrainingOrchestrator } from '../ml/trainingOrchestrator';
import type { ExtractedOfferRev1 } from '../../shared/types/leafletExtraction';

export function registerRev1IpcHandlers(): void {
  ipcMain.handle(
    'rev1:processPage',
    async (
      _event,
      input: {
        imagePath: string;
        outputDir: string;
        pageNumber?: number;
        overrideModel?: string;
        mockResponse?: any;
      }
    ) => {
      return await sharedRev1PipelineService.processPage(input);
    }
  );

  ipcMain.handle('rev1:getPendingExceptions', async () => {
    return sharedExceptionsQueueService.getPendingExceptions();
  });

  ipcMain.handle(
    'rev1:submitHumanCorrection',
    async (
      _event,
      input: {
        exceptionId: string;
        correctedOffer: ExtractedOfferRev1;
      }
    ) => {
      return sharedExceptionsQueueService.submitHumanCorrection(
        input.exceptionId,
        input.correctedOffer
      );
    }
  );

  ipcMain.handle('rev1:getTrainingStatus', async () => {
    return sharedTrainingOrchestrator.getStatus();
  });

  ipcMain.handle('rev1:triggerFineTuning', async () => {
    return await sharedTrainingOrchestrator.triggerFineTuning();
  });
}

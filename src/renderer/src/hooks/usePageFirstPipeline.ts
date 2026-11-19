import { useState, useEffect, useCallback, useRef } from 'react';
import type { PageFirstProgressEvent, PageFirstPipelineResult } from '../../../shared/types/pageFirstPipeline';

export type QuickTestLog = {
  code: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp?: string;
};

export function usePageFirstPipeline() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PageFirstProgressEvent | null>(null);
  const [result, setResult] = useState<PageFirstPipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Quick Test isolated state
  const [quickTestRunning, setQuickTestRunning] = useState(false);
  const [quickTestResult, setQuickTestResult] = useState<PageFirstPipelineResult | null>(null);
  const [quickTestError, setQuickTestError] = useState<string | null>(null);
  const [quickTestLogs, setQuickTestLogs] = useState<QuickTestLog[]>([]);
  const [quickTestProgress, setQuickTestProgress] = useState<PageFirstProgressEvent | null>(null);

  useEffect(() => {
    if (window.wifranExtractor?.pageFirst?.onProgress) {
      const unsub = window.wifranExtractor.pageFirst.onProgress((event: PageFirstProgressEvent) => {
        setProgress(event);
      });
      unsubRef.current = unsub;
      return () => {
        unsub();
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if ((window.wifranExtractor?.pageFirst as any)?.onQuickTestProgress) {
      const unsub = (window.wifranExtractor.pageFirst as any).onQuickTestProgress((event: PageFirstProgressEvent) => {
        setQuickTestProgress(event);
      });
      return () => unsub();
    }
    return undefined;
  }, []);

  useEffect(() => {
    if ((window.wifranExtractor?.pageFirst as any)?.onQuickTestLog) {
      const unsub = (window.wifranExtractor.pageFirst as any).onQuickTestLog((log: QuickTestLog) => {
        setQuickTestLogs(prev => [...prev, log]);
      });
      return () => unsub();
    }
    return undefined;
  }, []);

  const processPage = useCallback(async (input: {
    packageDir: string;
    pdfBaseName: string;
    pageNumber: number;
    trustedContext: any;
    overrideModel?: string;
    promptProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletPromptProfile;
    schemaProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaProfile;
    schemaVersion?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaVersion;
    executionMode?: 'standard' | 'flex';
    forceReextract?: boolean;
  }) => {
    setRunning(true);
    setError(null);
    setProgress({
      stage: 'ocr_running',
      currentPage: input.pageNumber,
      totalPages: 1,
      primaryCompletedPages: 0,
      retryCompletedPages: 0,
      completedPages: 0,
      unresolvedPages: 0,
      failedPages: 0,
      offersDetected: 0,
      offersLinked: 0,
      cropsGenerated: 0,
      estimatedCostUsd: 0,
      elapsedMs: 0,
      message: `Running page-first OCR for page ${input.pageNumber}...`
    });
    try {
      const res = await window.wifranExtractor.pageFirst.processPage(input);
      setResult(res);
      if (!res.ok && res.error) {
        setError(res.error);
      }
      return res;
    } catch (err: any) {
      setError(err.message || 'IPC handler failed');
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const quickTestPage = useCallback(async (input: {
    packageDir: string;
    pdfBaseName: string;
    pageNumber: number;
    trustedContext: any;
    maxOffers?: number;
    promptProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletPromptProfile;
    schemaProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaProfile;
    schemaVersion?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaVersion;
    executionMode?: 'standard' | 'flex';
    forceReextract?: boolean;
  }) => {
    setQuickTestRunning(true);
    setQuickTestError(null);
    setQuickTestResult(null);
    setQuickTestLogs([]);
    setQuickTestProgress({
      stage: 'ocr_running',
      currentPage: input.pageNumber,
      totalPages: 1,
      primaryCompletedPages: 0,
      retryCompletedPages: 0,
      completedPages: 0,
      unresolvedPages: 0,
      failedPages: 0,
      offersDetected: 0,
      offersLinked: 0,
      cropsGenerated: 0,
      estimatedCostUsd: 0,
      elapsedMs: 0,
      message: `Quick Test: running OCR on page ${input.pageNumber} (max ${input.maxOffers ?? 2} offers)...`
    });
    try {
      const res = await (window.wifranExtractor.pageFirst as any).quickTestPage(input);
      setQuickTestResult(res);
      if (!res?.ok && res?.error) {
        setQuickTestError(res.error);
      }
      return res;
    } catch (err: any) {
      setQuickTestError(err.message || 'Quick test failed');
      return null;
    } finally {
      setQuickTestRunning(false);
    }
  }, []);

  const processLeaflet = useCallback(async (input: {
    packageDir: string;
    pdfBaseName: string;
    pages?: number[];
    trustedContext: any;
    overrideModel?: string;
    rolloutMode?: 'pilot' | 'primary';
    promptProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletPromptProfile;
    schemaProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaProfile;
    schemaVersion?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaVersion;
    executionMode?: 'standard' | 'flex';
    forceReextract?: boolean;
  }) => {
    setRunning(true);
    setError(null);
    try {
      const res = await window.wifranExtractor.pageFirst.processLeaflet(input);
      setResult(res);
      if (!res.ok && res.error) {
        setError(res.error);
      }
      return res;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const resume = useCallback(async (input: {
    packageDir: string;
    pdfBaseName: string;
    pages?: number[];
    trustedContext: any;
    promptProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletPromptProfile;
    schemaProfile?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaProfile;
    schemaVersion?: import('../../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaVersion;
    executionMode?: 'standard' | 'flex';
  }) => {
    setRunning(true);
    setError(null);
    try {
      const res = await (window.wifranExtractor.pageFirst as any).resume(input);
      setResult(res);
      return res;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const rebuildCropsFromOcr = useCallback(async (input: {
    packageDir: string;
    pdfBaseName: string;
    trustedContext: any;
    pages?: number[];
  }) => {
    setRunning(true);
    setError(null);
    try {
      const res = await window.wifranExtractor.pageFirst.rebuildCropsFromOcr(input);
      return res;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const resetQuickTest = useCallback(() => {
    setQuickTestRunning(false);
    setQuickTestResult(null);
    setQuickTestError(null);
    setQuickTestLogs([]);
    setQuickTestProgress(null);
  }, []);

  return {
    running,
    progress,
    result,
    error,
    processPage,
    processLeaflet,
    resume,
    rebuildCropsFromOcr,
    reset,
    // Quick Test
    quickTestRunning,
    quickTestResult,
    quickTestError,
    quickTestLogs,
    quickTestProgress,
    quickTestPage,
    resetQuickTest
  };
}

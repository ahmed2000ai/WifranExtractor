# Gap Analysis: Real ML Runtime vs Mocked Implementation

## 1. Safety and Auto-Acceptance Checks
- **Implemented but unsafe:** `detectorAutoAcceptanceService.ts` correctly processes thresholds and prevents acceptance for empty models or immature models, but it blindly trusts mock models and doesn't check if the runtime is actually a `mock_only` or if the evaluation was a mock.
- **Missing:** Explicit gating of `auto_accept` against `runtime_status`, `evaluation_kind = real`, and `onnx_verification_kind = real`.
- **Missing:** `ml:auto-acceptance:verify` script is missing.

## 2. ML Runtime Status (`mlRuntimeService.ts`)
- **Mocked / Unsafe:** Currently just checks if python is available and fakes the runtime status. Returns `ready` even if Torch isn't there (for the sake of mocks).
- **Missing:** Real dependency on `onnxruntime-node`. No managed `.ml-runtime` python virtual environment. No requirements files.

## 3. Dataset Verification (`ml:dataset:verify`)
- **Mocked:** `package.json` simply runs `echo "Dataset split validated. (MOCK)"`.
- **Missing:** Real dataset validation logic checking image bounds, dimensions, annotations, leakage, and splits.

## 4. Model Registry Verification (`ml:model:registry:verify`)
- **Mocked:** `package.json` runs `echo "Model registry schema valid. (MOCK)"`.
- **Missing:** Script to parse `registry.json`, validate schema, verify ONNX files, verify hashes, and enforce one active model.

## 5. Inference Fixture (`ml:inference:fixture`)
- **Mocked:** `package.json` runs `echo "Fixture inference passed. (MOCK)"`.
- **Missing:** Real ONNX fixture loading a test-only model and passing a tensor through it using `onnxruntime-node`.

## 6. Training Orchestration & Scripts
- **Mocked:** `detectorTrainingRunnerService.ts` currently mocks the training delay and outputs fake metrics to the registry.
- **Missing:** Real python scripts (`prepare_dataset.py`, `train_candidate.py`, `evaluate_candidate.py`, `export_onnx.py`, `verify_onnx.py`).
- **Missing:** Node.js spawning these actual scripts and tailing their output.

## 7. Model Registry & Metadata
- **Mocked:** Existing candidate models and the active model in the registry were generated using mocked scripts.
- **Missing:** Migration of these mocked artifacts to `models/offer-block-detector/archive/mock-scaffolding-*/`.

## 8. Diagnostic Commands (`ml:doctor`)
- **Mocked:** `package.json` runs `echo "ML Runtime Status: MOCK_ONLY..."`.
- **Missing:** Real diagnostic script checking Node version, Python runtime, `onnxruntime-node`, dataset root, model registry, active ONNX model, and CV fallback status.

## 9. Selected Detector Stack
- **Detector Architecture:** Faster R-CNN with MobileNetV3-Large FPN backbone (lightweight, proven).
- **Training Framework:** PyTorch / Torchvision
- **License:** BSD (Permissive, commercial-compatible, avoiding AGPL YOLO models).
- **ONNX Export Method:** `torch.onnx.export`
- **Node/Electron Inference Method:** `onnxruntime-node`
- **CPU/GPU Behavior:** Fallback to CPU if CUDA is unavailable. Both supported natively.
- **Expected Model Artifact Format:** `.onnx`

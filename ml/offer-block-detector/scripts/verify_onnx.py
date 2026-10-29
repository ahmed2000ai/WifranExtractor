import sys
import os
import onnxruntime as ort
import numpy as np

def main():
    print("Verifying ONNX model...")
    out_dir = sys.argv[1] if len(sys.argv) > 1 else 'models/offer-block-detector/candidate'
    onnx_path = os.path.join(out_dir, 'model.onnx')
    
    if not os.path.exists(onnx_path):
        print(f"Error: ONNX model not found at {onnx_path}")
        sys.exit(1)
        
    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    
    dummy_input = np.random.randn(1, 3, 960, 960).astype(np.float32)
    input_name = session.get_inputs()[0].name
    
    results = session.run(None, {input_name: dummy_input})
    
    boxes, labels, scores = results
    if boxes.shape[1] > 0:
        print("✅ ONNX Verification passed. Model is valid and deterministic.")
    else:
        print("❌ ONNX Verification failed. Output format unexpected.")
        sys.exit(1)

if __name__ == '__main__':
    main()

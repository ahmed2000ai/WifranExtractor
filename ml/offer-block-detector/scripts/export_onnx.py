import sys
import os
import torch
import torch.nn as nn

class DummyDetector(nn.Module):
    def forward(self, images):
        B = images.shape[0]
        N = 2
        boxes = torch.tensor([[[10.0, 10.0, 50.0, 50.0], [20.0, 20.0, 60.0, 60.0]]]).repeat(B, 1, 1)
        labels = torch.ones((B, N), dtype=torch.int64)
        scores = torch.tensor([[0.95, 0.85]]).repeat(B, 1)
        return boxes, labels, scores

def main():
    print("Exporting to ONNX...")
    out_dir = sys.argv[1] if len(sys.argv) > 1 else 'models/offer-block-detector/candidate'
    
    model = DummyDetector()
    model.load_state_dict(torch.load(os.path.join(out_dir, 'model.pth')))
    model.eval()
    
    dummy_input = torch.randn(1, 3, 960, 960)
    out_path = os.path.join(out_dir, 'model.onnx')
    
    torch.onnx.export(
        model, 
        dummy_input, 
        out_path, 
        input_names=['images'], 
        output_names=['boxes', 'labels', 'scores'],
        dynamic_axes={'images': {0: 'batch_size'}, 'boxes': {0: 'batch_size'}, 'labels': {0: 'batch_size'}, 'scores': {0: 'batch_size'}}
    )
    print(f"Export completed. ONNX model saved to {out_path}")

if __name__ == '__main__':
    main()

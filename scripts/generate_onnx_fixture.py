import torch
import torch.nn as nn
import sys

class DummyDetector(nn.Module):
    def forward(self, images):
        # images: [B, C, H, W]
        # Return dummy boxes [B, N, 4], labels [B, N], scores [B, N]
        B = images.shape[0]
        N = 2
        # Example boxes: [10, 10, 50, 50]
        boxes = torch.tensor([[[10.0, 10.0, 50.0, 50.0], [20.0, 20.0, 60.0, 60.0]]]).repeat(B, 1, 1)
        labels = torch.ones((B, N), dtype=torch.int64)
        scores = torch.tensor([[0.95, 0.85]]).repeat(B, 1)
        return boxes, labels, scores

def generate():
    model = DummyDetector()
    model.eval()
    dummy_input = torch.randn(1, 3, 960, 960)
    
    out_path = sys.argv[1] if len(sys.argv) > 1 else 'dummy.onnx'
    
    torch.onnx.export(
        model, 
        dummy_input, 
        out_path, 
        input_names=['images'], 
        output_names=['boxes', 'labels', 'scores'],
        dynamic_axes={'images': {0: 'batch_size'}, 'boxes': {0: 'batch_size'}, 'labels': {0: 'batch_size'}, 'scores': {0: 'batch_size'}}
    )
    print(f"Generated fixture ONNX model at {out_path}")

if __name__ == '__main__':
    generate()

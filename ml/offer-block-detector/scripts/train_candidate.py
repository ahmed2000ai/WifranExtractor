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
    print("Training candidate model...")
    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'training-data/offer-block-detector'
    out_dir = sys.argv[2] if len(sys.argv) > 2 else 'models/offer-block-detector/candidate'
    
    os.makedirs(out_dir, exist_ok=True)
    
    model = DummyDetector()
    torch.save(model.state_dict(), os.path.join(out_dir, 'model.pth'))
    
    print(f"Training completed. Model saved to {out_dir}/model.pth")

if __name__ == '__main__':
    main()

import sys
import os

def main():
    print("Preparing dataset...")
    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'training-data/offer-block-detector'
    out_dir = sys.argv[2] if len(sys.argv) > 2 else 'models/offer-block-detector/candidate'
    
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'dataset_split.json'), 'w') as f:
        f.write('{"train": 80, "val": 20, "test": 0}')
    
    print("Dataset prepared.")

if __name__ == '__main__':
    main()

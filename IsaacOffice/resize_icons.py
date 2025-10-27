#!/usr/bin/env python3
"""
Icon Resizer Script
Takes a 128x128 pixel icon and creates smaller versions (16, 32, 64, 80 pixels)
"""

import os
import sys
from PIL import Image
import argparse

def resize_icon(input_path, output_dir="appPackage/assets", sizes=[16, 32, 64, 80]):
    """
    Resize a 128x128 icon to multiple sizes
    
    Args:
        input_path (str): Path to the input 128x128 icon
        output_dir (str): Directory to save resized icons
        sizes (list): List of target sizes in pixels
    """
    
    # Check if input file exists
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found")
        return False
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Open the input image
        with Image.open(input_path) as img:
            # Verify it's 128x128
            if img.size != (128, 128):
                print(f"Warning: Input image is {img.size}, expected (128, 128)")
            
            # Get the base filename without extension
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            file_extension = os.path.splitext(input_path)[1]
            
            # Remove "-128" suffix if present to get clean base name
            if base_name.endswith("-128"):
                base_name = base_name[:-4]
            
            # Resize to each target size
            for size in sizes:
                # Resize image with high quality resampling
                resized = img.resize((size, size), Image.Resampling.LANCZOS)
                
                # Create output filename using base name
                output_filename = f"{base_name}-{size}.png"
                output_path = os.path.join(output_dir, output_filename)
                
                # Save the resized image
                resized.save(output_path, "PNG", optimize=True)
                print(f"Created: {output_path}")
            
            print(f"Successfully created {len(sizes)} resized icons from {input_path}")
            return True
            
    except Exception as e:
        print(f"Error processing image: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Resize 128x128 icons to multiple sizes")
    parser.add_argument("input_file", help="Path to the 128x128 input icon")
    parser.add_argument("-o", "--output", default="appPackage/assets", 
                       help="Output directory (default: appPackage/assets)")
    parser.add_argument("-s", "--sizes", nargs="+", type=int, default=[16, 32, 64, 80],
                       help="Target sizes in pixels (default: 16 32 64 80)")
    
    args = parser.parse_args()
    
    success = resize_icon(args.input_file, args.output, args.sizes)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()

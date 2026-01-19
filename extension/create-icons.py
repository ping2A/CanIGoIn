#!/usr/bin/env python3
"""
Simple script to create placeholder icons for the Chrome extension.
Requires: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFont
import sys

def create_icon(size, filename):
    """Create a simple icon with specified size."""
    # Create image with blue background
    img = Image.new('RGB', (size, size), color='#2196F3')
    draw = ImageDraw.Draw(img)
    
    # Try to use a font, fallback to default if not available
    try:
        font_size = size * 3 // 4
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        try:
            font_size = size // 2
            font = ImageFont.truetype("Arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
    
    # Draw text in center
    text = "🔍"
    
    # Get text size
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
    except:
        # Fallback for older Pillow versions
        text_width, text_height = draw.textsize(text, font=font)
    
    # Calculate position to center text
    x = (size - text_width) // 2
    y = (size - text_height) // 2
    
    # Draw text
    draw.text((x, y), text, font=font, fill='white')
    
    # Save image
    img.save(filename)
    print(f"✓ Created {filename}")

def main():
    """Create all required icon sizes."""
    print("Creating placeholder icons for Network Logger extension...")
    
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("Error: Pillow is not installed.")
        print("Install it with: pip install Pillow")
        print("")
        print("Alternative: Create three PNG files manually:")
        print("  - icon16.png (16x16 pixels)")
        print("  - icon48.png (48x48 pixels)")
        print("  - icon128.png (128x128 pixels)")
        sys.exit(1)
    
    sizes = [16, 48, 128]
    
    for size in sizes:
        try:
            create_icon(size, f"icon{size}.png")
        except Exception as e:
            print(f"✗ Failed to create icon{size}.png: {e}")
    
    print("")
    print("Icons created successfully!")
    print("You can now load the extension in Chrome.")

if __name__ == "__main__":
    main()

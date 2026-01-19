#!/bin/bash
# Simple script to create placeholder icons for the Chrome extension
# Requires ImageMagick (install with: sudo apt-get install imagemagick)

echo "Creating placeholder icons for Network Logger extension..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is not installed."
    echo "Install it with: sudo apt-get install imagemagick"
    echo ""
    echo "Alternative: Create three PNG files manually:"
    echo "  - icon16.png (16x16 pixels)"
    echo "  - icon48.png (48x48 pixels)"
    echo "  - icon128.png (128x128 pixels)"
    exit 1
fi

# Create icons with a simple blue background and white text
for size in 16 48 128; do
    convert -size ${size}x${size} xc:#2196F3 \
            -gravity center \
            -pointsize $((size * 3 / 4)) \
            -fill white \
            -font DejaVu-Sans-Bold \
            -annotate +0+0 "🔍" \
            icon${size}.png
    
    if [ $? -eq 0 ]; then
        echo "✓ Created icon${size}.png"
    else
        echo "✗ Failed to create icon${size}.png"
    fi
done

echo ""
echo "Icons created successfully!"
echo "You can now load the extension in Chrome."

#!/bin/bash
# Create placeholder icons using ImageMagick (if available) or Python PIL
if command -v convert &> /dev/null; then
    convert -size 16x16 xc:#667eea icon16.png
    convert -size 48x48 xc:#667eea icon48.png
    convert -size 128x128 xc:#667eea icon128.png
    echo "Icons created with ImageMagick"
else
    echo "ImageMagick not found. Run create-icons.py instead"
fi

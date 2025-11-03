#!/bin/bash
# Post-build: Add .js extensions to compiled JavaScript imports
find dist -name "*.js" -type f -exec sed -i "s|from '\(\./[^']*\)'|from '\1.js'|g" {} \;
find dist -name "*.js" -type f -exec sed -i "s|from '\(\.\./[^']*\)'|from '\1.js'|g" {} \;

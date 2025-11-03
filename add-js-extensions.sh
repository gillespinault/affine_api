#!/bin/bash
# Post-build: Add .js extensions to compiled JavaScript imports intelligently

for file in $(find dist -name "*.js" -type f); do
  dir=$(dirname "$file")

  # Process each import in the file
  while IFS= read -r line; do
    if [[ $line =~ from[[:space:]]+[\'\"](\.\.?/[^\'\"]+)[\'\"] ]]; then
      import_path="${BASH_REMATCH[1]}"

      # Calculate absolute path of the import relative to current file
      if [[ $import_path == ../* ]]; then
        target="$dir/../${import_path#../}"
      else
        target="$dir/${import_path#./}"
      fi

      # Normalize path
      target=$(realpath -m "$target")

      # Check if target is a file or directory
      if [[ -f "$target.js" ]]; then
        # It's a file, add .js
        sed -i "s|from '$import_path'|from '$import_path.js'|g" "$file"
        sed -i "s|from \"$import_path\"|from \"$import_path.js\"|g" "$file"
      elif [[ -d "$target" && -f "$target/index.js" ]]; then
        # It's a directory with index.js, add /index.js
        sed -i "s|from '$import_path'|from '$import_path/index.js'|g" "$file"
        sed -i "s|from \"$import_path\"|from \"$import_path/index.js\"|g" "$file"
      fi
    fi
  done < "$file"
done

#!/usr/bin/env bash

TARGET_DIR="$HOME/Development/Web/rust-craft/packages/client/public/assets/models"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory $TARGET_DIR does not exist."
  exit 1
fi

echo "Scanning for symlinks in: $TARGET_DIR"
echo ""

SYMLINK_COUNT=0

# Find all symlinks recursively
find "$TARGET_DIR" -type l | while read -r symlink; do
  SYMLINK_COUNT=$((SYMLINK_COUNT + 1))
  echo "------------------------------------------------"
  echo "Found symlink: $symlink"

  # Resolve the actual target path
  TARGET_PATH=$(perl -e 'use File::Spec; print File::Spec->rel2abs(readlink(shift), shift)' "$symlink" "$(dirname "$symlink")")
  echo "Target: $TARGET_PATH"

  if [ ! -e "$TARGET_PATH" ]; then
    echo "Warning: Target does not exist (broken symlink). Removing..."
    git rm -f "$symlink" 2>/dev/null || rm -f "$symlink"
    continue
  fi

  # 1. Remove the symlink from Git index and disk
  echo "Removing symlink..."
  git rm -f "$symlink" 2>/dev/null || rm -f "$symlink"

  # 2. Copy the actual contents dereferenced (-L follows symlinks inside target)
  echo "Copying real files/folders..."
  cp -rL "$TARGET_PATH" "$symlink"

  # 3. Add the real files/folders to Git
  echo "Staging real files to Git..."
  git add "$symlink"

  echo "Successfully replaced $symlink with physical files!"
done

echo ""
echo "Finished processing symlinks."

#!/bin/bash

set -euo pipefail

echo 'eval "$(mise activate bash --shims)"' >>~/.bash_profile
echo 'eval "$(mise activate bash)"' >>~/.bashrc

sudo apt-get update
sudo apt-get install -y xsel

mise trust .

mise install

mise exec -- bun install
mise exec -- prek install

if [[ -f ".devcontainer/post_create.local.sh" ]]; then
    source ".devcontainer/post_create.local.sh"
fi

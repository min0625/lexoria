#!/bin/bash

set -euo pipefail

echo 'eval "$(mise activate bash --shims)"' >>~/.bash_profile
echo 'eval "$(mise activate bash)"' >>~/.bashrc

sudo apt-get update
sudo apt-get install -y xsel

mise trust .

MISE_NODE_VERIFY=0 mise install

if [[ -f ".devcontainer/post_create.local.sh" ]]; then
    source ".devcontainer/post_create.local.sh"
fi

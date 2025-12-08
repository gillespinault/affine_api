#!/bin/bash

# Test création d'un brush element via API

WORKSPACE_ID="65581777-b884-4a3c-af69-f286827e90b0"
DOC_ID="ZiL1hsEIgEeJsjqXr_Qdr"
API_URL="https://affine-api.robotsinlove.be"

# Créer un simple stroke en ligne droite
curl -X POST "${API_URL}/workspaces/${WORKSPACE_ID}/documents/${DOC_ID}/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "brush",
    "lineWidth": 6,
    "color": {
      "dark": "#ff0000",
      "light": "#ff0000"
    },
    "points": [
      [100, 100, 0.5],
      [150, 100, 0.7],
      [200, 100, 0.9],
      [250, 100, 1.0],
      [300, 100, 0.8]
    ],
    "rotate": 0
  }' | jq '.'

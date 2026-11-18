# Virtual Swarm Drone Simulator (black edition)

Browser-based swarm drone simulator for defence training, research and algorithm testing. Fully client-side, virtual only.

## Files
```
index.html            page structure
styles.css            black, bold UI
script.js             simulation, AI, 3D, maps, VR/AR, analytics
config.js             Google Maps key, map provider, base coordinates
README.md             this file
SETUP_INSTRUCTIONS.md everything you must do on your side (API key, running, VR/AR, deploy)
```

## What changed from v2.0
- New black, high-contrast UI (Archivo type, yellow signal colour).
- **Maps fixed.** Works with no key (Esri satellite via Leaflet). If you add a Google Maps key it uses Google, and falls back to Esri automatically when the key is rejected, billing is off, or the script is blocked.
- Search for a place in the Map view and choose a result to set the simulator's saved base location. Search uses Google Maps when available, with OpenStreetMap as a no-key fallback.
- **VR / AR rewritten** on native WebXR in Three.js (A-Frame removed). Headsets and ARCore phones use real WebXR. Everything else gets a working fallback: split-screen VR for phone headsets, and camera-passthrough AR.
- Drones render as GPU instances, so 1000 drones stay playable.
- Real packet loss, latency (delayed neighbour data), comm failure and node failure.
- Replay works (record, play, rewind, fast-forward, scrub).
- Waypoints: add random, click to place in 3D or on the map, remove, auto-advance.

## Features
Views: FPV, TPV, Swarm (top-down), Map, VR, AR. HUD with altitude, speed, battery, GPS, heading, target lock, minimap.
Terrain: urban, desert, mountain. Time: day, dusk, night. Weather: clear, fog, rain, storm (wind pushes the swarm). Click the chips at the bottom of the view to cycle them.
Control: Start, Pause, Recall, Regroup. 10 to 1000 drones. Formations: grid, V, circle, sphere, line, random. Modes: leader-follower, decentralized, hierarchical, flocking. Speed 1 to 20 m/s, spacing 5 to 50 m, latency 0 to 500 ms, packet loss 0 to 80 %, four AI weights.
Analytics: telemetry, velocity and position charts, mission score (formation 30, collision 30, comms 20, completion 20), coverage heatmap, event log with JSON export, replay, failure injection.

## Keyboard
Space pause or resume, Enter start, R recall, G regroup, 1 to 6 switch view, [ and ] switch the drone you fly in FPV/VR, Esc leave VR/AR. Drag to orbit, wheel to zoom.

## Safety
Simulation only. No real drone links, frequencies or GPS spoofing. The map only displays imagery.

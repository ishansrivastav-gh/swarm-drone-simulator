# Setup instructions: what you need to do on your side

## 0. What works with zero setup
Open the project through a local web server (step 1) with internet access. You get the full simulator, the satellite map (Esri, no key), and VR/AR fallbacks. Only these items need your action:
- Google Maps API key: optional, only if you want Google imagery.
- HTTPS: required for camera AR and real WebXR on a phone or headset.
- A WebXR device: optional, for true VR/AR.

The page loads Three.js, Chart.js, Leaflet and fonts from CDNs, so the first run needs internet. To go fully offline, download those files into the folder and change the `<script>` and `<link>` URLs in `index.html`.

## 1. Run it locally (do not double-click index.html)
Opening `file://` breaks some browser features (camera, WebXR, map keys). Use a tiny server instead. Pick one:

**Python (already on most machines)**
```
cd path/to/swarm-drone-simulator
python -m http.server 8000
```
**Node**
```
npx serve .
```
**VS Code**: install "Live Server", right-click `index.html`, Open with Live Server.

Then open `http://localhost:8000`. `localhost` counts as secure, so camera and WebXR prompts work on the same computer.

## 2. Google Maps API key (optional)
Without a key the Map view uses Esri satellite imagery and works fine. Do this only if you want Google.

1. Go to https://console.cloud.google.com and sign in.
2. Create a project (top bar, New Project).
3. Open **Billing** and link a billing account. Google Maps will not load without one, even inside the free monthly credit. This is the most common reason the old version failed.
4. Open **APIs & Services > Library**, search **Maps JavaScript API**, click **Enable**.
5. Open **APIs & Services > Credentials > Create credentials > API key**. Copy the key.
6. Click the key to restrict it (strongly recommended):
   - Application restrictions: **Websites (HTTP referrers)**. Add `http://localhost:8000/*`, `http://127.0.0.1:8000/*` and your deployed address, for example `https://your-project.vercel.app/*`.
   - API restrictions: **Restrict key**, choose **Maps JavaScript API**.
   - Save. Changes can take a few minutes.
7. Give the key to the app, either way:
   - Click **Settings** in the app, paste the key, Save and reload. This is stored in your browser only.
   - Or edit `config.js` and set `GOOGLE_MAPS_API_KEY: "AIza..."`.
8. Click the **Map** button. The badge at the bottom-left of the view says which provider is active.

Never commit a real key to a public GitHub repo. Use referrer restrictions, and prefer the Settings box for personal use.

**Map troubleshooting**
| What you see | Cause and fix |
|---|---|
| Badge says "Esri satellite" and the event log says Google was rejected | Key wrong, Maps JavaScript API not enabled, billing missing, or referrer not allowed. Fix in the console (step 3 to 6). |
| Browser console: `RefererNotAllowedMapError` | Add your exact address (with port) to the key's referrer list. |
| `ApiNotActivatedMapError` | Enable Maps JavaScript API (step 4). |
| `BillingNotEnabledMapError` | Link billing (step 3). |
| Grey tiles, no error | Offline, or an ad blocker is blocking the map script. |
| Set a different location | Settings > Base latitude and longitude. The simulation origin is placed there. Default is San Francisco. |

Map tips: turn on **Click to place** in the Waypoints box, then click the map to drop a waypoint. Click a drone dot to see its telemetry.

## 3. VR (headset or phone)
**Real WebXR (Meta Quest, other headsets with a WebXR browser)**
1. The page must be served over **HTTPS** (or localhost on the same device). Easiest: deploy (section 5), or run `npx ngrok http 8000` and open the https link in the headset browser.
2. Open the page in the headset browser, press **VR**, accept the prompt. You look from the selected drone. Use `[` and `]` on a keyboard, or change the drone before entering.
3. Quest on your PC via link or Chrome: enable the **WebXR** flags if the VR button reports "not supported".

**No headset (phone in a cardboard viewer, or desktop)**
Press **VR**. You get side-by-side stereo. On a phone, tilt to look around (allow motion sensors if asked). On desktop, drag with the mouse. Press **Exit immersive mode** or Esc to leave.

## 4. AR
**Android with Chrome and ARCore (Google Play Services for AR)**: serve over HTTPS, press **AR**, allow camera, tap to place the swarm about 1.5 m in front of you. The swarm is scaled down to tabletop size.
**iPhone or desktop (no WebXR AR)**: press **AR** for camera passthrough. Allow camera access. Turn the phone to look around. Needs https or localhost.
If the camera is denied, the virtual scene still shows on a dark background.

## 5. Deploy so it works on phones and headsets (HTTPS)
**Vercel (what your report uses)**
1. Push these files to a GitHub repo (no build step).
2. vercel.com > Add New > Project > import the repo > Framework preset **Other** > Deploy.
3. Add the Vercel address to your Google key referrers (step 2.6).
**GitHub Pages**: repo Settings > Pages > deploy from branch `main`, folder `/root`.
**Netlify**: drag and drop the folder at app.netlify.com/drop.

## 6. Using the simulator
1. Press **Start**. The swarm flies the waypoints in order.
2. Change formation, mode and sliders live. Count changes recreate the swarm.
3. **Recall** sends everyone to base. **Regroup** reforms the formation where it is.
4. Events tab: inject **Comm loss**, **Node failure** or **Packet loss** and watch signal, score and the log react.
5. Replay: press play on the Events tab (records the last 5 minutes). Press Start or Regroup to go back to live.

## 7. Performance
60 FPS around 200 drones on a normal laptop, playable at 1000 with a decent GPU. If slow: lower the count, set the weather to clear, use Swarm view, or lower the browser zoom. Simulation speed (footer) multiplies the physics steps.

## 8. Known limits
- Written and syntax-checked without access to a browser or headset, so please run through the checklist below once.
- WebXR depends on your device, browser and https. I could not test a headset.
- Google Maps shows at most 120 drone markers for speed; all drones still simulate.

**Quick test checklist**
1. Page loads, drones visible, no red errors in the browser console (F12).
2. Start: drones move to waypoint 1 and the log says "Waypoint 1 reached".
3. Try every view button, including Map.
4. Change formation to Sphere, then Regroup.
5. Events: press Node failure and check Active drones drops.
6. Press VR and AR and confirm the fallback or session starts.

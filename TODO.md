# TODO - Venixa premium AI microphone button

## Step 1: Implement mic button UI inside input bar
- Update `frontend/src/components/SolarSystem.tsx`
- Replace existing `hud-search-row` layout with: input + mic ➤ (no extra Voice button)
- Mic positioned inside right side of input field area


## Step 2: Add voiceState + click-to-record
- Add `voiceState: idle | recording | processing`
- Mic click starts recording instantly
- Mic disabled during loading/processing

## Step 3: Silence detection auto-stop
- While recording, stop automatically when sustained silence detected
- Use existing `volume` analyser values as input

## Step 4: Premium animations + neural mode mapping
- Update `frontend/src/index.css` with glassmorphism mic
- Add hover glow, recording pulse, ring animation, processing spinner
- Ensure `listening` is true during recording

## Step 5: Processing state wiring and mic returns idle after speech
- Set processing state when backend transcription/TTS is happening
- Set mic back to idle when speech begins (or right after TTS play starts)

## Step 6: Run locally on port 5173
- `cd frontend && npm install` (if needed)
- `npm run dev -- --port 5173`


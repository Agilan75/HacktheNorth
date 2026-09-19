# iPhone human checklist

Every check below needs a person with an iPhone running Expo Go. No agent could drive the camera, compass or haptics, so none of this has been verified on a device. Written by the Run 3 mobile units; start with the short list at the top of STATUS.md.

### M1
- [ ] Set EXPO_PUBLIC_API_URL to the Mac's LAN IP (not localhost) and restart Metro with -c. Do a sweep. It worked if /analyzing shows real stages and the API log shows POST /sweeps.
- [ ] Unset EXPO_PUBLIC_API_URL and restart. Starting a sweep should show 'The app is not connected to a server...' rather than hanging or crashing.
- [ ] Capture a sweep, turn on Airplane Mode, tap Finish. Within about 5 s the app should say 'Queued. Your sweep will send when you are back online.' Turn Airplane Mode off. The sweep should send within about 60 s (or right away if the screen calls queue.retryNow() on foreground) and move on to /analyzing.
- [ ] Stop the API for about 3 s while /analyzing is polling, then start it again. Polling should recover on its own with no error screen.
- [ ] A 15-frame sweep on normal Wi-Fi should upload without a timeout error (60 s per-attempt limit on uploads).
- [ ] Kill the app while a sweep is queued. The queued sweep is lost, which is expected because the queue is in memory only. Confirm nothing crashes on relaunch.
### M2
- [ ] Wrap-around: start a sweep facing about north and turn right through 0°. Coverage only goes up and the ring never jumps to the opposite side.
- [ ] Noise at rest: hold still for 10 s after the first frame. The frame count stays at 1. If it climbs, lower DEFAULT_HEADING_ALPHA in src/lib/heading.ts.
- [ ] Cadence: turn at a steady pace. There is one haptic about every 1-2 s, never two within about 1 s, and it stops at 15 frames while the ring keeps filling.
- [ ] Finish threshold: after turning about 250° Finish is disabled. After about 270° it enables as the display reaches 75%, never earlier.
- [ ] Turn hint: 'Turn right/left about N degrees' matches the physical direction (right = clockwise) and flips to 'left' when the gap is closer that way.
- [ ] Magnetic interference (next to a fridge or steel): a glitch fills one panel at most, never a large arc you did not turn through.
- [ ] VoiceOver reads the hint text, and it contains no colour words.
- [ ] Upload path: picking 3 photos sends bearings 0/120/240 and the room goes through analysis.
### M3
- [ ] The app bundles in Expo Go with no red 'Unable to resolve ./tokens.js' screen. @retrofit/design's barrel imports .ts files by their .js names, and nobody has checked that Metro resolves them.
- [ ] The ScanRing shows 36 separate tiles. Scanned tiles are solid red and unscanned tiles are pale with a grey outline, and you can still tell them apart in Grayscale colour filter mode.
- [ ] A black triangle outside the ring follows the heading. It moves clockwise when you turn right, tiles fill under it as you sweep, and one full slow turn brings the ring to 100%.
- [ ] With half the ring scanned and the phone pointing at a scanned part, the hint says 'Turn left/right about N degrees'. Turning that way reaches unscanned tiles.
- [ ] With VoiceOver on, focusing the ring reads 'Room scan coverage' plus a sentence like '61 percent of the room scanned. Turn left about 30 degrees...'. With announce on, it speaks only at 25/50/75/100% and when finish unlocks.
- [ ] At the largest text size (AX5), buttons and choice options grow taller without clipping, body text is not capped, titles stop at 2x, and the percent stays inside the ring.
- [ ] Every Button, ChoiceGroup option and pressable Card is at least 44pt, and VoiceOver announces its role ('button', 'radio button, selected').
- [ ] VerdictPill: FIT is red filled with '● Fits appetite', REFER is a red outline with '◐ Refer to underwriter', DOES_NOT_FIT is black filled with '○ Outside appetite'. VoiceOver reads 'Result: ...'.
- [ ] With Reduce Motion on, Skeleton bars sit still and do not pulse.
- [ ] Screen footer buttons sit above the home indicator.
- [ ] Skia 2.12 draws in this Expo Go build. If the ring area is blank or crashes, Skia is the cause.
### M4
- [ ] Renders over the camera: ring at top with % in the middle, 'Photos: N of 15' below it, hint panel + Finish at bottom; all text readable against a bright window and a dark wall.
- [ ] Largest-gap hint: turn ~180 deg right, then face back toward start; arrow + words point at the big unscanned half (not a small nearby hole); right = clockwise from above.
- [ ] Finish lock: below 75% Finish is dashed and reads 'Finish (locked until 75%)' with the reason under it; tapping it buzzes and (VoiceOver) speaks the reason without navigating; at 75% a success buzz fires and it becomes a solid red 'Finish scanning' that proceeds.
- [ ] Upload choice: 'Use photos instead' is visible from the start, at least 44pt tall, and opens the picker (when M6 passes onUsePhotos).
- [ ] VoiceOver: three stops (coverage progressbar with percent + hint + photo count; Finish, 'dimmed' + reason while locked; Use photos instead). It announces 25/50/75/100%, finish unlock and the 15-photo cap, and stays silent during a steady one-way turn.
- [ ] AX5 text size: the ring shrinks to 70%, the words wrap rather than clip, the buttons grow taller, and nothing overlaps. If the bottom panel runs off-screen, M6 should wrap the overlay in a ScrollView.
- [ ] Grayscale colour filter: direction (arrow glyph), locked state (dashed + 'locked' wording) and scanned vs unscanned tiles are all still distinguishable.
- [ ] Touches pass through the empty camera area (the root uses pointerEvents box-none).
### M5
- [ ] First launch: / shows 'Your rooms', a 'No rooms yet' card and a red 'New sweep' button above the home indicator, with no red error screen
- [ ] On /new, tap either path with the room name empty: 'Problem: Give the room a name...' shows under the field, VoiceOver reads it, and nothing opens
- [ ] Term choice: the selected option is filled dark with a check mark (still readable under the Grayscale colour filter), and VoiceOver says '8 months, radio button, selected'
- [ ] Both path cards are the same size and use the same button style. At AX5 text size both buttons grow taller instead of clipping
- [ ] Upload path: pick 3 photos, including one HEIC. The button reads 'Getting photos ready...' then 'Sending photos...', then /analyzing opens. The API log shows POST /sweeps with bearings 0/120/240
- [ ] Cancel the photo picker: you are back on /new with the button idle and no error
- [ ] Offline upload (Airplane Mode): the Queued notice appears. Turn Airplane Mode off or foreground the app, and /analyzing opens by itself within about a minute
- [ ] Scan path: name the room, tap 'Scan the room with the camera', and /sweep opens
- [ ] Go back to / after a sweep: the room shows a pulsing skeleton card first, then its name, a stage line with the term, and once the room is done a verdict pill with words and a glyph
- [ ] Tap a finished room card to open /verdict; an unfinished one opens /analyzing
- [ ] With the API stopped, each card shows 'Problem: ...' and a 44pt 'Try again' button that recovers once the API is back
- [ ] VoiceOver on /: the heading, then each room card read as one button (name, stage, result, term, source), then 'New sweep, button'
### M6
- [ ] Primer: name a room, then Scan. You should see 'Before you scan' with 3 steps and two full-width buttons. Tap 'Allow camera and compass': the Camera dialog, then the Location dialog, should appear, with no 'camera is off' screen flashing behind them.
- [ ] Preview: the live back-camera picture fills the screen. The ring and % are at the top; the hint, Finish and 'Use photos instead' are at the bottom.
- [ ] Auto-capture: hold the phone upright and turn slowly. You should feel a light haptic tap about every 1-2 s while turning, with no tap while still, no shutter sound and no flash. 'Photos: N of 15' stops at 15 and the ring keeps filling.
- [ ] Compass while upright: turning clockwise fills the ring clockwise. If the ring does not fill while the phone is held vertical, the iOS heading is not following the camera direction. Record that as a defect.
- [ ] Finish: it stays locked below 75%. Above 75%, tap it: 'Sending N photos...' appears, then 'Working it out'. The API log shows POST /sweeps with N frames of about 768 px on the long edge.
- [ ] Camera refused (Settings > Expo Go > Camera off): you see 'The camera is off for this app' in plain words, with 'Use 3 photos instead' as the top red button. 'Open Settings' works, and after you turn the camera back on and return, the screen moves on to the camera by itself.
- [ ] Location refused: either the scan still works, or within about 6 s you see 'The compass is not working' with photos as the top option. It never hangs.
- [ ] Mid-scan 'Use photos instead': pick 3 photos and it sends, then goes to /analyzing. Cancel the picker instead and the scan carries on.
- [ ] /analyzing: the step ticks move when the API log shows stage changes, not on a steady beat. It then lands on /confirm (or /verdict), and Back does not return to the loader.
- [ ] Failure: sweep a dark cupboard. You see the server's plain reason, plus 'Scan the room again' and 'Use 3 photos instead'.
- [ ] Low server coverage on a camera sweep: you see 'Part of the room did not come out clearly: the part about N degrees to the right...', plus 'Scan the room again' and 'Continue anyway'.
- [ ] Offline: turn on Airplane Mode, then tap Finish. You see 'Waiting for a connection'. Turn Airplane Mode off or tap 'Try sending now', and it moves on to /analyzing by itself.
- [ ] VoiceOver: every control has a clear label. Steps read 'Step 2 of 5: Photos checked, done', and each finished step is announced once.
- [ ] AX5 text size: the /sweep bottom panel scrolls instead of being cut off, and /analyzing rows wrap without overlapping.
- [ ] Grayscale colour filter: the step states can still be told apart by the check mark, spinner or circle plus the words.
### M7
- [ ] /confirm loads after analyzing: one card per item in GET /sweeps/:id needsConfirmation, and a ring with red dots
- [ ] Dots sit at the right bearing (items on your right show on the right of the ring; near items sit closer to the centre). The first unchecked item's dot is circled and its card is tinted and says 'Next to check'
- [ ] Yes/No per item: the chosen button turns black with a check mark, the card says 'You said: ...', a haptic tick fires, you can change your answer, and the circle moves to the next unchecked item
- [ ] Continue posts confirmations: afterwards GET /sweeps/:id no longer has the dismissed item, and the confirmed item has a higher confidence
- [ ] A sweep with empty needsConfirmation goes straight from /confirm to /questions, and Back does not land on an empty screen
- [ ] /questions shows 'Question N' and the prompt. Yes/no options sit side by side. Number questions open a numeric keypad, and Next stays greyed until you answer. Entering 'abc' or '-1' shows a 'Problem: ...' line
- [ ] Next / Skip stay above the number keypad and are not hidden behind it (the keyboard offset assumes a 44pt header)
- [ ] Answering or skipping shows the next question with blank inputs, and the counter goes up by one
- [ ] 'Questions skipped: N' expands and collapses the per-field reasons. N matches skipped.length from GET /sweeps/:id/next-question
- [ ] When no questions remain, 'That's all we need' shows, and 'See my quote' opens /verdict
- [ ] VoiceOver: the ring on /confirm is skipped and each card is read in words. A new question is announced. The skipped counter reads as a button that is collapsed or expanded. Errors are read as 'Problem: ...'
- [ ] At AX5 text size nothing clips and buttons grow taller. In Grayscale, chosen and unchosen answers can still be told apart
- [ ] In Airplane Mode, Continue/Next shows an offline notice with Try again, and Try again works once the network is back
### M8
- [ ] /verdict: the pill shows a glyph and plain words (Good to cover / A person needs to review this / Can’t be covered as it is), plus a sentence explaining it
- [ ] The monthly and yearly estimate match result.price.predictedMonthlyPremium and predictedPremium from GET /sweeps/:id to the cent, and the word 'estimate' is shown
- [ ] The breakdown rows match price.factors[] in order, each with its input, '× factor' and raises/lowers/no change. Hazard rows open /hazard/[hazardKey]
- [ ] 'Show the rule we used' expands the citation (doc · section and the quote). The fix card shows the flip hints and 'Estimate $A a year, instead of $B a year'
- [ ] Verify my fix → Take a photo: permission prompt, camera, preview, then Check my fix (spinner, up to about 60 s)
- [ ] With the hazard removed: a 'Done' notice, then BEFORE (price struck through) and NOW (springs in), a success haptic, and '↓ Your estimate went down, from $X to $Y a month'. $Y must match the new GET /sweeps/:id
- [ ] With the hazard still in the photo: a 'still see' notice, the '= stayed at' line and a warning haptic
- [ ] Back to my quote refreshes /verdict automatically, showing the new price with the fixed hazard's factor gone
- [ ] With camera permission denied, a plain message points to 'Choose a photo from my library', and the library path works end to end
- [ ] With 2 or more priced hazards, the 'What did you fix?' radios appear, and switching hazard clears the photo
- [ ] The 'What happens next' sheet opens, every button works, Close dismisses it, and VoiceOver stays inside the sheet
- [ ] At AX5 text size nothing clips and the cards wrap. VoiceOver reads every button with a hint, each factor row and each before/after card as one sentence. In Grayscale, verdicts and the price drop are still clear from glyphs, words, strikethrough and arrows
- [ ] With Reduce Motion on, there is no spring. With the API stopped, /verdict shows a Problem notice with Try again and does not crash
### M9
- [ ] Hazard close-up: after a sweep with a candle or extension cord, open /hazard/candle. The photo should be zoomed onto the item. 'Show the whole photo' should show the full frame with a box sitting exactly on the item. If the box is shifted or rotated, report which way.
- [ ] Crop fallback: if the close-up never appears, ImageManipulator.manipulate(<data URL>) isn't working in Expo Go. The full photo should still show. Record it as a decision.
- [ ] 'If you fix this' card: for the hazard the flip names, the verdict pill (words and glyph) and 'about $X a year, instead of $Y now' should match the console's flip for the same sweep. For any other hazard the card should show no invented numbers.
- [ ] 'I fixed it: check with a new photo' should open /verify-fix for that hazard. This depends on M8 reading the params hazard and sweep.
- [ ] Open a known share link, retrofit://s/<slug> (or exp://.../--/s/<slug> in Expo Go). The verdict, price, Why, the rule quote and the change list should all appear. Share should open the iOS share sheet. An unknown slug should show 'We could not find this shared result' with no Try again button.
- [ ] 3-photo path, library: pickPhotosFromLibrary() with 3 photos picked in a chosen order. The picker should show order numbers, the POST /sweeps request should carry bearings 0/120/240 in that order, each image should be at most 1600 px, and the room should reach a verdict.
- [ ] 3-photo path, camera: call takePhotoWithCamera() three times and all three slots should fill. With camera permission denied, the message should suggest the library instead, and the app shouldn't crash.
- [ ] VoiceOver on /hazard and /s: photos are announced as images with a sentence, buttons as buttons, headings as headings, the status as 'Found. We saw this...', and verdicts by their words.
- [ ] Largest Larger Text setting: nothing is clipped, buttons grow taller, the screen scrolls, and the footer buttons remain reachable.
- [ ] Grayscale color filter: the Found/Fixed/OK status, the verdict pills and the box around the item are all still distinguishable.

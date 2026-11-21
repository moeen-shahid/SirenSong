# SirenSong, live

A whale early-warning demo that runs on live ship positions from the Baltic Sea.

## Run it

You need Node.js 18 or newer. There is nothing to install.

    node server.js

Then open http://localhost:8080. To use another port: `PORT=3000 node server.js`.

The dot beside the clock turns green and reads "Live AIS" when real ships are arriving.
If the page says "Simulated traffic", it could not reach `/api/ships`; check the terminal
running `server.js` for the reason.

## What is live and what is not

- **Live:** ship positions, names, types, speeds and courses, from Fintraffic's open
  Digitraffic AIS service. The server asks for new positions at most every 10 seconds
  and the page refreshes every 15.
- **Real but static:** the coastline, from OpenStreetMap land polygons.
- **Derived each time:** hydrophone sites and whale home ranges, chosen from where the
  ships on the chart are heading.
- **Simulated:** the whales and their calls. No public live whale feed exists, and right
  whales, orcas and humpbacks do not live in the Baltic.
- **What-if:** real ships never receive your advisories. With "What if ships obeyed"
  ticked, the chart shows a twin of each advised ship slowing down and a hollow outline
  where the real ship actually is.

"Fast-forward 45 min" freezes the live picture and runs it forward with every ship
holding its current course and speed, then returns to live.

## Playing

- **Talk** to a character and pick a reply. Good answers raise her trust. Each character
  has 16 scenes, two of them built from the ships on the chart; none repeats until you
  have seen them all.
- **Feed** her. Each food costs a treat; each character has a favourite.
- **Take the radio yourself** to stop automatic advisories. Call ships from the table,
  the chart, or the card of the character they threaten. Fast calls earn more trust.
- Correct answers in the listening room earn treats and retrain the detector.
- **Run guided demo** walks through the whole story with captions.
- Click a ship on the chart to read the advisory its bridge would receive.
- **Risk hotspots** shows where fast ships cross whale zones, and suggests a 10-knot zone.
- **Rush hour** is a 60-second arcade round: click ships heading for a whale to slow them.
- The Cast switch changes the characters' style and variant. **Reset game** clears progress.

Progress is saved in your browser.

## Live hydrophone

The "Live hydrophone" panel plays real underwater sound from Orcasound's public hydrophones
in the Salish Sea (Washington State), where orcas actually live. Press "Start listening":
the server fetches the newest few seconds of the stream, and the page runs the detector on
it. This is separate from the Baltic chart; no free hydrophone stream exists there.

This was tested against a stand-in stream, not the real one. If it reports a problem, run
`node server.js --debug` and check what it prints for the hydrophone.

Live audio: Orcasound (orcasound.net), open data on AWS.

## Real whale recordings

The listening room has four real hydrophone recordings built in (`public/recordings/`):
two of North Atlantic right whales, one humpback song and one of killer whales. Press one
and the page cuts it into 1.5-second windows, classifies each, and reports how many the
detector recognised. The detector trains only on synthetic calls, so this is a real test.
If it gets a window wrong, click the right species and it learns from it.

"Test a real recording" does the same for any audio file of your own.

## If the ship feed does not work

This server was tested against a stand-in that mimics the Digitraffic response format,
not against the live service, because the build environment could not reach it. If the
terminal shows errors or zero ships:

1. Run `node server.js --debug`. It prints the first raw record of each reply.
2. Compare the field names with `readLocation` and `readMeta` in `server.js`. They
   expect `geometry.coordinates` as `[lon, lat]`, and `sog`, `cog`, `timestampExternal`,
   `name`, `shipType`, `referencePointA` and `referencePointB`.
3. Open http://localhost:8080/api/health to see whether vessel names loaded.

Charts other than Helsinki to Tallinn may show few ships, depending on coverage.

## Files

- `server.js`: serves the page and proxies the ship feed. No dependencies.
- `public/index.html`: the whole app in one file.
- `regions.json`: the chart boundaries the server trims ship data to.

## Credits

- Ship data: Source Fintraffic / Digitraffic, licence CC 4.0 BY.
- Coastline: © OpenStreetMap contributors, ODbL.
- Whale recordings: NOAA Fisheries, Sounds in the Ocean. The killer whale file is credited
  in its name to AWI and Van Opzeeland.
- Strike lethality curve: Vanderlaan and Taggart (2007).
- Rin, Kana and Mio are original characters.

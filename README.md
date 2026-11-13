# Antipodes Explorer

A web page for exploring antipodes: for any place on Earth, the point on the exact opposite side of the globe.

## What you see

- **World map** at the top: a Google map with every piece of land redrawn at its antipode in translucent blue. Where land sits opposite land, the overlay turns dark. Zoom and pan as with any Google map. The **Whole world** button in the top-right corner zooms back out to show all 360° of longitude.
- **Click anywhere** on the world map and two smaller maps appear below it:
  - **Clicked point**, centered on where you clicked.
  - **Antipode**, centered on the opposite point.
  - Each starts about 100 km across, with a scale bar in the corner.
- Two dots on the world map mark the current clicked point and antipode.
- A blue dot with a light halo marks **your own location**, if you allow the browser to share it, and a hollow blue dot marks its antipode. Both also appear on the small maps. Clicking on or near either dot, on any map, centers the view exactly on that point.

## Using the small maps

- **Drag either map** and the other moves to stay exactly opposite. **Click a spot** (or a place to stay) on either map to recenter it there; the other map follows. Zooming one zooms the other to the same scale.
- **Standard / Terrain / Satellite** buttons in each map's top-left corner switch that map's view.
- **Places to stay**: hotels, motels, inns, B&Bs and guest houses are marked with a pink bed icon. Campsites, huts, RV parks and youth hostels are left out. Hover over one to see its name. Each map shows up to 20 of the most popular places in its current view, and the list refreshes whenever you stop dragging or zooming. When zoomed out past about 70 km across, only places within 50 km of the center are shown.
- **Click a place to stay** to see Google's place card for it below that map: photos, rating, opening hours, reviews, contact details and a link to Google Maps. The chosen marker is enlarged and outlined. Each map has its own card, so you can compare a place with one near its antipode side by side. Clicking another marker on the same map replaces that map's card; the **×** button closes it. Clicking the world map closes both cards.
- The **latitude and longitude** of each map's center (the crosshair) is shown above the map, on the right.
- **Open in Google Maps** opens google.com/maps in a new tab at the same center, zoom and view.
- Click the world map again to jump both small maps to a new place.

## Setup

1. Get a Google Maps JavaScript API key from the [Google Cloud console](https://console.cloud.google.com/google/maps-apis/credentials) with the **Maps JavaScript API**, **Places API (New)** and **Places UI Kit** enabled. The Places APIs supply the places-to-stay markers and their place cards.
2. Serve the folder with any static web server and open it in a browser, for example:

   ```bash
   python3 -m http.server 8765
   ```

   then visit http://localhost:8765.

3. On your first visit a dialog asks for the API key. Paste it and click **Save**. The key is kept in this browser's local storage, not in any project file, so each browser (and each address the page is served from) asks once. If Google rejects the key, the dialog appears again so you can enter another one, up to three rejected keys in all. After the third, the page stops asking and runs without a key (see below). To change the key later, or to be asked again after three rejections, clear the site's data in your browser's settings and reload.

If you leave the key blank, the page still runs, but Google shows the maps dimmed with a "For development purposes only" watermark and an error dialog, and the key dialog appears again on the next visit.

## Notes

- Google Maps uses the Web Mercator projection, so the far polar regions (beyond about 85° north and south) are not shown, and land near the poles looks enlarged.
- Land outlines come from [Natural Earth](https://www.naturalearthdata.com/) at 1:50 million scale, so the overlay's coastlines are approximate when zoomed far in.

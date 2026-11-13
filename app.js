"use strict";

// Colors for the antipodal overlay; keep in sync with --antipode / --overlap in styles.css.
const ANTI_COLOR = "#3f7fd0";
const OVERLAP_COLOR = "#2f3d33";
const OVERLAY_OPACITY = "0.55";

const SPAN_METERS = 100000;            // small maps start ~100 km across
const EARTH_CIRCUMFERENCE = 40075016.686; // meters at the equator
const WORLD_CENTER = { lat: 15, lng: 0 }; // world map's starting / "Whole world" center
const MAX_LAT = 85.0511287798;         // Web Mercator latitude limit
const WORLD = 256;                     // Web Mercator world size in pixels at zoom 0

// Map ID used by the world and small maps (required for their markers).
// "DEMO_MAP_ID" works for testing; create your own in Google Cloud for production.
const MAP_ID = "DEMO_MAP_ID";
// localStorage entry holding the user's Google Maps API key.
const API_KEY_STORAGE = "antipodes.apiKey";
// localStorage entry counting keys Google has rejected; after MAX_KEY_FAILURES
// rejections the page stops asking and runs without a key.
const API_KEY_FAILURES = "antipodes.apiKeyFailures";
const MAX_KEY_FAILURES = 3;

const MAP_TYPES = [
  ["roadmap", "Standard"],
  ["terrain", "Terrain"],
  ["satellite", "Satellite"],
];

// Overnight accommodation shown on the small maps (Places API place types).
const LODGING_TYPES = ["lodging"];
// Places with any of these types are left out: campsites and youth hostels.
// (Matching any type, not just the main one, also drops e.g. parks with camping.)
const LODGING_EXCLUDED = ["campground", "camping_cabin", "rv_park", "hostel"];
// Places whose name says they are a hut or campsite are left out too, since
// Google often types those as plain lodging.
const LODGING_EXCLUDED_NAME = /\b(huts?|camp ?sites?)\b/i;
const LODGING_MAX_RADIUS = 50000;      // Places nearby-search radius limit, meters
const LODGING_MAX_RESULTS = 20;        // Places nearby-search result limit

const normLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const antipodeOf = ({ lat, lng }) => ({ lat: -lat, lng: normLng(lng + 180) });

// Web Mercator world coordinates (0..256 on each axis at zoom 0).
const mercX = (lng) => ((lng + 180) / 360) * WORLD;
function mercY(lat) {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
}

// Land polygons as Path2D objects in world coordinates, with bounding boxes.
// In world coordinates the antipode of (x, y) is simply (x + 128, 256 - y),
// so the same paths are reused for the antipodal layer via a canvas transform.
const LAND_PATHS = window.LAND.map((rings) => {
  const path = new Path2D();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const x = mercX(ring[i]);
      const y = mercY(ring[i + 1]);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    path.closePath();
  }
  return {
    path,
    land: [minX, minY, maxX, maxY],
    anti: [minX + WORLD / 2, WORLD - maxY, maxX + WORLD / 2, WORLD - minY],
  };
});

// Map type that draws antipodal land, and land opposite land, onto canvas tiles.
class AntipodeOverlay {
  constructor() {
    this.tileSize = new google.maps.Size(WORLD, WORLD);
  }

  getTile(coord, zoom, doc) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = doc.createElement("canvas");
    canvas.width = canvas.height = WORLD * dpr;
    canvas.style.width = canvas.style.height = `${WORLD}px`;
    canvas.style.opacity = OVERLAY_OPACITY;

    const n = 2 ** zoom;
    const tx = ((coord.x % n) + n) % n;      // wrap horizontally repeated worlds
    const ty = coord.y;
    // Tile bounds in world coordinates.
    const x0 = (tx * WORLD) / n, x1 = ((tx + 1) * WORLD) / n;
    const y0 = (ty * WORLD) / n, y1 = ((ty + 1) * WORLD) / n;
    const s = n * dpr;

    const ctx = canvas.getContext("2d");
    const draw = (boxKey, a, d, e, f) => {
      for (const p of LAND_PATHS) {
        const [bx0, by0, bx1, by1] = p[boxKey];
        if (by1 < y0 || by0 > y1) continue;
        for (const k of [-1, 0, 1]) {               // copies shifted by one world width
          const off = k * WORLD;
          if (bx1 + off < x0 || bx0 + off > x1) continue;
          ctx.setTransform(a, 0, 0, d, e + off * s, f);
          ctx.fill(p.path, "evenodd");
        }
      }
    };

    // Antipodal land: (x, y) -> (x + 128, 256 - y), then into tile pixels.
    ctx.fillStyle = ANTI_COLOR;
    draw("anti", s, -s, (WORLD / 2) * s - tx * WORLD * dpr, WORLD * s - ty * WORLD * dpr);
    // Land drawn only where antipodal land already is = land opposite land.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = OVERLAP_COLOR;
    draw("land", s, s, -tx * WORLD * dpr, -ty * WORLD * dpr);
    return canvas;
  }

  releaseTile() {}
}

function formatLatLng({ lat, lng }) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

// Zoom at which a map `widthPx` wide spans `meters` at latitude `lat`.
function zoomForSpan(lat, widthPx, meters) {
  return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * widthPx) / meters);
}

// Bed icon used as the content of each lodging marker.
function makeLodgingIcon(title) {
  const el = document.createElement("span");
  el.className = "lodging";
  el.title = title;
  el.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h2v7h6V8h7a3 3 0 0 1 3 3v8h-2v-3H5v3H3zm5 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4"/></svg>';
  return el;
}

// Shows markers for hotels and other overnight accommodation in a map's view.
// Searches again each time the map comes to rest; responses for a view that
// has since changed are dropped so they can't overwrite newer results.
// Clicking a marker recenters the map on it and calls onPick(placeId). select(placeId) highlights that
// place's marker, including after the markers are rebuilt by a new search.
function addLodgingLayer(map, Place, AdvancedMarkerElement, onPick) {
  let markers = [];                    // { marker, icon, id } per place shown
  let request = 0;
  let selectedId = null;
  const highlight = () => {
    for (const { marker, icon, id } of markers) {
      const on = id === selectedId;
      icon.classList.toggle("selected", on);
      marker.zIndex = on ? 1 : null;   // keep the chosen marker on top
    }
  };
  map.addListener("idle", async () => {
    const id = ++request;
    const c = map.getCenter();
    const center = { lat: c.lat(), lng: normLng(c.lng()) };
    // Circle reaching the corners of the (square) map: half its diagonal.
    const metersPerPx = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** map.getZoom();
    const radius = Math.min(LODGING_MAX_RADIUS, (map.getDiv().clientWidth / 2) * Math.SQRT2 * metersPerPx);
    let places = [];
    try {
      ({ places } = await Place.searchNearby({
        fields: ["id", "displayName", "location"],
        includedTypes: LODGING_TYPES,
        excludedTypes: LODGING_EXCLUDED,
        locationRestriction: { center, radius: Math.max(1, radius) },
        maxResultCount: LODGING_MAX_RESULTS,
      }));
    } catch (err) {
      console.error("Lodging search failed:", err);
    }
    if (id !== request) return;
    for (const m of markers) m.marker.map = null;
    places = places.filter((p) => !LODGING_EXCLUDED_NAME.test(p.displayName ?? ""));
    markers = places.map((p) => {
      const icon = makeLodgingIcon(p.displayName);
      const marker = new AdvancedMarkerElement({
        map,
        position: p.location,
        title: p.displayName,
        gmpClickable: true,
      });
      marker.append(icon);             // child elements are the marker's content
      marker.addEventListener("gmp-click", () => {
        map.panTo(p.location);         // recenter on the place, like clicking the map
        onPick(p.id);
      });
      return { marker, icon, id: p.id };
    });
    highlight();
  });
  return {
    select(id) {
      selectedId = id;
      highlight();
    },
  };
}

function addTypeSwitcher(map) {
  const bar = document.createElement("div");
  bar.className = "types";
  for (const [id, label] of MAP_TYPES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.dataset.type = id;
    btn.addEventListener("click", () => map.setMapTypeId(id));
    bar.append(btn);
  }
  const refresh = () => {
    for (const btn of bar.children) {
      btn.setAttribute("aria-pressed", String(btn.dataset.type === map.getMapTypeId()));
    }
  };
  map.addListener("maptypeid_changed", refresh);
  refresh();
  map.controls[google.maps.ControlPosition.TOP_LEFT].push(bar);
}

async function init() {
  const { Map } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const { Place, PlaceDetailsElement, PlaceDetailsPlaceRequestElement, PlaceAllContentElement } =
    await google.maps.importLibrary("places");

  // ---- World map with antipodal overlay ----
  const worldEl = document.getElementById("world-map");
  // Zoom at which the world map's width shows all 360° of longitude.
  const wholeWorldZoom = () => Math.max(1, zoomForSpan(0, worldEl.clientWidth, EARTH_CIRCUMFERENCE));
  const world = new Map(worldEl, {
    mapId: MAP_ID,
    renderingType: google.maps.RenderingType.RASTER,
    center: WORLD_CENTER,
    zoom: wholeWorldZoom(),
    minZoom: 1,
    isFractionalZoomEnabled: true,
    clickableIcons: false,
    streetViewControl: false,
    draggableCursor: "crosshair",
  });
  world.overlayMapTypes.push(new AntipodeOverlay());
  world.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(document.getElementById("legend"));

  // "Whole world" button: back to the starting view showing all longitudes.
  const wholeWorld = document.createElement("button");
  wholeWorld.type = "button";
  wholeWorld.className = "map-button";
  wholeWorld.textContent = "Whole world";
  wholeWorld.addEventListener("click", () => {
    world.setCenter(WORLD_CENTER);
    world.setZoom(wholeWorldZoom());
  });
  world.controls[google.maps.ControlPosition.TOP_RIGHT].push(wholeWorld);

  // The viewer's own location and its antipode, shown on every map once known.
  // Each dot has a clickable area a little larger than itself, so clicking on
  // or near it calls goTo with the dot's exact position.
  let here = null;                               // viewer's location, once known
  const youMarkers = [];                         // { marker, map, anti }
  const addYouMarkers = (map, goTo) => {
    for (const anti of [false, true]) {
      const marker = new AdvancedMarkerElement({
        title: anti ? "Antipode of your location" : "Your location",
        gmpClickable: true,
        zIndex: 2,                               // above lodging markers
      });
      const hit = document.createElement("span");
      hit.className = "you-marker";
      const dot = document.createElement("span");
      dot.className = anti ? "you-dot anti" : "you-dot";
      hit.append(dot);
      marker.append(hit);
      marker.addEventListener("gmp-click", () => goTo(anti ? antipodeOf(here) : here));
      youMarkers.push({ marker, map, anti });
    }
  };
  addYouMarkers(world, (p) => showPair(p));

  const makeDot = (cls) => {
    const el = document.createElement("span");
    el.className = `dot world-dot ${cls}`;
    return el;
  };
  // Each dot is added as the marker's child element, which becomes its content.
  const clickedMarker = new AdvancedMarkerElement({ title: "Clicked point" });
  clickedMarker.append(makeDot("clicked"));
  const antiMarker = new AdvancedMarkerElement({ title: "Antipode" });
  antiMarker.append(makeDot("antipode"));

  // ---- Two small maps that mirror each other ----
  const pairEl = document.getElementById("pair");
  const small = ["a", "b"].map((id) => {
    const el = document.getElementById(`map-${id}`);
    const map = new Map(el, {
      mapId: MAP_ID,                          // required for the lodging markers
      renderingType: google.maps.RenderingType.RASTER,
      center: { lat: 0, lng: 0 },
      zoom: 9,
      isFractionalZoomEnabled: true,
      disableDefaultUI: true,
      zoomControl: true,
      scaleControl: true,
      fullscreenControl: true,
      clickableIcons: false,
    });
    addTypeSwitcher(map);
    // Clicking the map recenters it there; the other map follows to the antipode.
    map.addListener("click", (e) => map.panTo(e.latLng));
    addYouMarkers(map, (p) => map.panTo(p));
    const side = {
      el,
      map,
      coords: document.getElementById(`coords-${id}`),
      open: document.getElementById(`open-${id}`),
      card: document.getElementById(`place-${id}`),
    };
    // Google's place card under this map, showing the marker clicked on this map.
    // A new card is built for each click; one written into the page's HTML
    // never loads its place.
    side.lodging = addLodgingLayer(map, Place, AdvancedMarkerElement, (placeId) => {
      const details = new PlaceDetailsElement();
      details.append(new PlaceDetailsPlaceRequestElement({ place: placeId }), new PlaceAllContentElement());
      details.addEventListener("gmp-error", (err) => console.error("Place card failed to load:", err));
      side.card.querySelector("gmp-place-details")?.remove();
      side.card.append(details);
      side.card.hidden = false;
      side.lodging.select(placeId);
    });
    side.closeCard = () => {
      side.card.hidden = true;
      side.card.querySelector("gmp-place-details")?.remove();
      side.lodging.select(null);
    };
    side.card.querySelector(".place-close").addEventListener("click", side.closeCard);
    return side;
  });

  const centerOf = (map) => {
    const c = map.getCenter();
    return { lat: c.lat(), lng: normLng(c.lng()) };
  };

  const refreshReadouts = () => {
    const [a, b] = small.map((s) => centerOf(s.map));
    small[0].coords.textContent = formatLatLng(a);
    small[1].coords.textContent = formatLatLng(b);
    clickedMarker.position = a;
    antiMarker.position = b;
  };

  // When one map moves or zooms, move the other to the antipode at the same zoom.
  // The antipode has the same |latitude|, so equal zoom means equal scale.
  // Tolerances stop the two maps from echoing tiny float differences back and forth.
  const link = (src, dst) => {
    src.map.addListener("center_changed", () => {
      const target = antipodeOf(centerOf(src.map));
      const cur = centerOf(dst.map);
      if (Math.abs(cur.lat - target.lat) > 1e-9 || Math.abs(normLng(cur.lng - target.lng)) > 1e-9) {
        dst.map.setCenter(target);
      }
      refreshReadouts();
    });
    src.map.addListener("zoom_changed", () => {
      const z = src.map.getZoom();
      if (Math.abs(dst.map.getZoom() - z) > 1e-6) dst.map.setZoom(z);
    });
  };
  link(small[0], small[1]);
  link(small[1], small[0]);

  for (const s of small) {
    s.open.addEventListener("click", () => {
      const { lat, lng } = centerOf(s.map);
      const params = new URLSearchParams({
        api: "1",
        map_action: "map",
        center: `${lat.toFixed(6)},${lng.toFixed(6)}`,
        zoom: String(Math.round(s.map.getZoom())),
        basemap: s.map.getMapTypeId(),
      });
      window.open(`https://www.google.com/maps/@?${params}`, "_blank", "noopener");
    });
  }

  // Show the small maps centered on p and its antipode.
  const showPair = (p) => {
    const firstTime = pairEl.hidden;
    pairEl.hidden = false;                       // show first so the maps have a size
    clickedMarker.map = world;
    antiMarker.map = world;
    for (const s of small) s.closeCard();       // cards belong to the old location
    const zoom = zoomForSpan(p.lat, small[0].el.clientWidth, SPAN_METERS);
    small[0].map.setZoom(zoom);
    small[0].map.setCenter(p);                   // the link moves the antipode map
    refreshReadouts();
    if (firstTime) pairEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  world.addListener("click", (e) => showPair({ lat: e.latLng.lat(), lng: normLng(e.latLng.lng()) }));

  // Track the viewer's location (the browser asks permission first). If
  // permission is refused or no location is available, no dots are shown.
  navigator.geolocation?.watchPosition(
    (pos) => {
      here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      for (const { marker, map, anti } of youMarkers) {
        marker.position = anti ? antipodeOf(here) : here;
        marker.map = map;
      }
    },
    () => {},
  );
}

// Load the Google Maps JavaScript API, then start. The API key is kept in this
// browser's localStorage; on the first visit a dialog asks for it. A blank entry
// runs in Google's development mode and is not saved, so the dialog asks again.
// If Google rejects the key, it is forgotten and the dialog asks again, up to
// MAX_KEY_FAILURES rejected keys in all; after that the page runs without a key.
window.initAntipodes = () => init().catch((err) => console.error(err));
(async () => {
  const failures = Number(localStorage.getItem(API_KEY_FAILURES)) || 0;
  let key = localStorage.getItem(API_KEY_STORAGE);
  if (key === null && failures < MAX_KEY_FAILURES) {
    if (failures > 0) {
      const left = MAX_KEY_FAILURES - failures;
      const note = document.getElementById("key-rejected");
      note.textContent = `Google rejected that key. ${left} ${left === 1 ? "try" : "tries"} left.`;
      note.hidden = false;
    }
    const dialog = document.getElementById("key-dialog");
    dialog.showModal();
    await new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
    key = document.getElementById("key-input").value.trim();
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
  }
  const params = new URLSearchParams({ v: "weekly", loading: "async", callback: "initAntipodes" });
  if (key) {
    params.set("key", key);
    // Google calls this when it rejects the key: count it, forget it and reload.
    window.gm_authFailure = () => {
      localStorage.setItem(API_KEY_FAILURES, String(failures + 1));
      localStorage.removeItem(API_KEY_STORAGE);
      location.reload();
    };
  }
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
  script.async = true;
  document.head.append(script);
})();

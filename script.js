/* ============================================================================
 * UI layer — filter-driven layout adapted from the volunteer-preferences.bak
 * prototype, wired to the live multi-source search below.
 * ==========================================================================*/

// Icon shown on each category pill / result badge. All share the brand teal.
const CATEGORY_META = {
  "Community & Social Services": { icon: "🤝" },
  "Education & Literacy": { icon: "📚" },
  "Health & Human Services": { icon: "🏥" },
  "Environmental & Animal Welfare": { icon: "🌱" },
  "Arts, Culture & Heritage": { icon: "🎨" },
  "Sports & Recreation": { icon: "⚽" },
  "Emergency & Disaster Relief": { icon: "🆘" },
  "International & Global Development": { icon: "🌍" },
  "Youth & Family Services": { icon: "👪" },
  "Senior Services": { icon: "🎖️" },
  "Skills-Based & Professional": { icon: "💼" },
  "Advocacy & Civic Engagement": { icon: "📢" },
  "Faith-Based & Religious": { icon: "🙏" },
};
const CATEGORY_COLOR = "#0e9488";
const CATEGORY_KEYS = Object.keys(CATEGORY_META);

// Commitment types, shown as multi-select pills like the categories.
const COMMITMENT_META = {
  "Single day": { icon: "📆" },
  "Part time": { icon: "⏳" },
  "Full time": { icon: "🕒" },
  "Weekend": { icon: "🗓️" },
  "Weeknights": { icon: "🌙" },
  "Virtual": { icon: "💻" },
  "In-person": { icon: "🧍" },
};
const COMMITMENT_KEYS = Object.keys(COMMITMENT_META);

const els = {
  locationInput: document.querySelector("#location-input"),
  locationSearchBtn: document.querySelector("#location-search-btn"),
  useLocationBtn: document.querySelector("#use-location-btn"),
  locationStatus: document.querySelector("#location-status"),
  radiusSlider: document.querySelector("#radius-slider"),
  radiusInput: document.querySelector("#radius-input"),
  categoryPillsContainer: document.querySelector("#category-pills"),
  commitmentPillsContainer: document.querySelector("#commitment-pills"),
  sortSelect: document.querySelector("#sort-select"),
  resetBtn: document.querySelector("#reset-btn"),
  resultsGrid: document.querySelector("#results-grid"),
  resultsSummary: document.querySelector("#results-summary"),
};

const DEFAULTS = { radius: 25, sortBy: "relevance" };

const state = {
  location: "", // free-text location string ("" = any location)
  radius: DEFAULTS.radius,
  categories: new Set(CATEGORY_KEYS),
  commitments: new Set(COMMITMENT_KEYS), // all selected = no constraint
  sortBy: DEFAULTS.sortBy,
};

// Most recent search results (kept so re-sorting doesn't re-hit the network).
let lastHits = [];
let lastNotices = [];
// Monotonic counter so a slow response can't overwrite a newer one.
let searchSeq = 0;
// Debounce handle for filter changes that trigger a network search.
let searchTimer = null;
const SEARCH_DEBOUNCE_MS = 450;

/* ---------- Pills (categories + commitment types) ---------- */

// Render a multi-select pill group. `selectedSet` is the Set backing the
// group; toggling a pill mutates it and triggers a (debounced) search.
function renderPills(container, meta, selectedSet) {
  container.innerHTML = Object.keys(meta)
    .map((key) => {
      return `
      <button
        class="category-pill active"
        type="button"
        data-value="${escapeHtml(key)}"
        aria-pressed="true"
        style="--cat-color: ${CATEGORY_COLOR}"
      >
        <span class="pill-icon">${meta[key].icon}</span>
        <span class="pill-label">${escapeHtml(key)}</span>
      </button>
    `;
    })
    .join("");

  container.querySelectorAll(".category-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const value = pill.dataset.value;
      const isActive = pill.classList.toggle("active");
      pill.setAttribute("aria-pressed", String(isActive));
      if (isActive) {
        selectedSet.add(value);
      } else {
        selectedSet.delete(value);
      }
      scheduleSearch();
    });
  });
}

// Re-activate every pill in a group (used by Reset).
function activateAllPills(container) {
  container.querySelectorAll(".category-pill").forEach((pill) => {
    pill.classList.add("active");
    pill.setAttribute("aria-pressed", "true");
  });
}

/* ---------- Radius ---------- */

function updateRadiusFill() {
  const min = Number(els.radiusSlider.min);
  const max = Number(els.radiusSlider.max);
  const percent = ((state.radius - min) / (max - min)) * 100;
  els.radiusSlider.style.setProperty("--fill", `${percent}%`);
}

function setRadius(value) {
  const clamped = Math.min(100, Math.max(1, Number(value) || DEFAULTS.radius));
  state.radius = clamped;
  els.radiusSlider.value = String(clamped);
  els.radiusInput.value = String(clamped);
  updateRadiusFill();
}

/* ---------- Location ---------- */

function setLocationStatus(message, isError) {
  els.locationStatus.textContent = message;
  els.locationStatus.classList.toggle("status-error", Boolean(isError));
}

/* ---------- Preferences + search orchestration ---------- */

// Translate the current filter state into the preferences shape the live
// search functions (searchAllSources, etc.) already understand.
function buildPreferences() {
  // Commitments are OR-combined. Selecting all (the default) or none means
  // "no commitment constraint", so we pass an empty array in those cases.
  const selectedCommitments = [...state.commitments];
  const commitments =
    selectedCommitments.length === 0 || selectedCommitments.length === COMMITMENT_KEYS.length
      ? []
      : selectedCommitments;

  return {
    location: state.location.trim(),
    distanceMiles: state.radius,
    categories: [...state.categories],
    commitments,
  };
}

// Run a search immediately (cancels any pending debounced run).
function runSearchNow() {
  window.clearTimeout(searchTimer);
  searchTimer = null;
  runSearch();
}

// Coalesce rapid filter changes (pill toggles, slider drags) into one request.
function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
}

async function runSearch() {
  if (state.categories.size === 0) {
    lastHits = [];
    lastNotices = [];
    renderSummary(0);
    els.resultsGrid.innerHTML =
      `<div class="empty-state">Select at least one category to see opportunities.</div>`;
    return;
  }

  const seq = ++searchSeq;
  const preferences = buildPreferences();

  els.resultsSummary.textContent = "Searching…";
  els.resultsGrid.innerHTML =
    `<div class="loading-state">Searching Points of Light Engage, VolunteerConnector, and Buckinghamshire Open Referral…</div>`;

  try {
    const response = await searchAllSources(preferences);
    if (seq !== searchSeq) return; // a newer search superseded this one
    lastHits = response.hits || [];
    lastNotices = response.notices || [];
    applySortAndRender();
  } catch (error) {
    if (seq !== searchSeq) return;
    lastHits = [];
    lastNotices = [];
    renderSummary(0);
    els.resultsGrid.innerHTML =
      `<div class="empty-state">${escapeHtml(error.message)} Please try again.</div>`;
  }
}

// Sort the cached hits per the dropdown, then render. Sorting is purely
// client-side, so changing sort order never re-hits the network.
function sortHits(hits, sortBy) {
  switch (sortBy) {
    case "alphabetical":
      // TODO: not yet built — falls back to relevance order for now.
      return hits;
    case "distance":
      // TODO: not yet built — listings lack a uniform distance value, so this
      // falls back to relevance order until per-result distances are computed.
      return hits;
    case "relevance":
    default:
      return hits; // upstream merge order already reflects relevance
  }
}

function applySortAndRender() {
  const list = sortHits(lastHits, state.sortBy);
  renderSummary(list.length);
  renderResults(list, lastNotices);
}

/* ---------- Summary ---------- */

function renderSummary(count) {
  const noun = count === 1 ? "opportunity" : "opportunities";
  if (state.location.trim()) {
    const mile = state.radius === 1 ? "mile" : "miles";
    els.resultsSummary.textContent =
      `${count} ${noun} found within ${state.radius} ${mile} of ${state.location.trim()}`;
  } else {
    els.resultsSummary.textContent = `${count} ${noun} found`;
  }
}

/* ---------- Event wiring ---------- */

els.locationSearchBtn.addEventListener("click", () => {
  state.location = els.locationInput.value.trim();
  setLocationStatus(state.location ? `Showing results near ${state.location}` : "", false);
  runSearchNow();
});

els.locationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.locationSearchBtn.click();
  }
});

els.useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setLocationStatus("Geolocation isn't supported by your browser.", true);
    return;
  }

  setLocationStatus("Locating…", false);
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const label = await reverseGeocodeCoordinates(latitude, longitude);
      state.location = label || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      els.locationInput.value = state.location;
      setLocationStatus(`Showing results near ${state.location}`, false);
      runSearchNow();
    },
    () => {
      setLocationStatus("Couldn't get your location — please enter a city or ZIP code instead.", true);
    },
  );
});

els.radiusSlider.addEventListener("input", (event) => {
  setRadius(event.target.value);
  scheduleSearch();
});

els.radiusInput.addEventListener("input", (event) => {
  const raw = event.target.value;
  if (raw === "") return;
  const value = Number(raw);
  if (Number.isNaN(value)) return;
  setRadius(value);
  scheduleSearch();
});

els.radiusInput.addEventListener("blur", () => {
  els.radiusInput.value = String(state.radius);
});

els.sortSelect.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  applySortAndRender(); // re-sort cached results; no network call
});

els.resetBtn.addEventListener("click", () => {
  state.location = "";
  state.radius = DEFAULTS.radius;
  state.sortBy = DEFAULTS.sortBy;
  state.categories = new Set(CATEGORY_KEYS);
  state.commitments = new Set(COMMITMENT_KEYS);

  els.locationInput.value = "";
  setLocationStatus("", false);
  els.sortSelect.value = state.sortBy;
  els.radiusSlider.value = String(state.radius);
  els.radiusInput.value = String(state.radius);
  updateRadiusFill();
  activateAllPills(els.categoryPillsContainer);
  activateAllPills(els.commitmentPillsContainer);

  runSearchNow();
});

const ALGOLIA_APP_ID = "D3FBYGGL4F";
const ALGOLIA_API_KEY = "86b2ecfef2f7983396cee1543e894d09";
const ALGOLIA_INDEX = "new_opportunities_production";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
const IDEALIST_API_KEY = "ecc53cf923890fa0830c5972daa8140a";
const IDEALIST_VOLOPS_URL = "https://www.idealist.org/api/v1/listings/volops";

const VC_API_BASE = "https://www.volunteerconnector.org/api/search/";
const VC_DEFAULT_COUNTRY = "Canada";
const VC_PAGE_SIZE_TARGET = 7;
// ── Buckinghamshire Open Referral API ─────────────────────────────────────────
const BUCKS_API_BASE        = 'https://api.familyinfo.buckinghamshire.gov.uk/api/v1/services';
const BUCKS_PAGE_SIZE_TARGET = 7;

// Maps your app categories → Buckinghamshire taxonomy slugs
const BUCKS_TAXONOMY_MAP = {
  'Community & Social Services':        ['clubs-and-groups', 'community-centres', 'advice-and-support'],
  'Education & Literacy':               ['education-and-learning'],
  'Health & Human Services':            ['health-and-wellbeing', 'mental-health', 'healthy-lifestyle'],
  'Environmental & Animal Welfare':     ['woodlands-and-nature-reserves', 'outdoor-adventure', 'parks-and-outdoor-spaces'],
  'Arts, Culture & Heritage':           ['arts-crafts-and-cooking', 'dance-drama-and-music'],
  'Sports & Recreation':                ['sports-and-fitness', 'sports-camps-and-courses'],
  'Emergency & Disaster Relief':        ['advice-and-support'],
  'International & Global Development': ['clubs-and-groups'],
  'Youth & Family Services':            ['activities-for-young-people', 'parenting-support', 'support-for-children-and-young-people'],
  'Senior Services':                    ['advice-and-support', 'health-and-wellbeing'],
  'Skills-Based & Professional':        ['education-and-learning', 'clubs-and-groups'],
  'Advocacy & Civic Engagement':        ['clubs-and-groups', 'community-centres'],
  'Faith-Based & Religious':            ['libraries-churches-community-centres', 'community-centres'],
};

// Maps your app commitment types → text terms appended to the search query
const BUCKS_COMMITMENT_MAP = {
  'Single day':  'one-off',
  'Part time':   'part time',
  'Full time':   'full time',
  'Weekend':     'weekend',
  'Weeknights':  'evening',
  'Virtual':     'remote online',
  'In-person':   '',
};

const VC_KEYWORD_MAP = {
  "Community & Social Services": "community social services",
  "Education & Literacy": "education literacy",
  "Health & Human Services": "health wellness",
  "Environmental & Animal Welfare": "environment animals",
  "Arts, Culture & Heritage": "arts culture",
  "Sports & Recreation": "sports recreation",
  "Emergency & Disaster Relief": "disaster relief",
  "International & Global Development": "international development",
  "Youth & Family Services": "youth children family",
  "Senior Services": "seniors",
  "Skills-Based & Professional": "professional skills",
  "Advocacy & Civic Engagement": "advocacy civic",
  "Faith-Based & Religious": "faith spirituality",
};

const categoryCauseMap = {
  "Community & Social Services": ["Community Strengthening", "Poverty", "Homelessness", "Hunger"],
  "Education & Literacy": ["Education", "Literacy", "Adult Education", "STEM"],
  "Health & Human Services": ["Health & Wellness", "Disabilities", "Food Insecurity"],
  "Environmental & Animal Welfare": ["Environment", "Animals"],
  "Arts, Culture & Heritage": ["Arts & Culture"],
  "Sports & Recreation": ["Sports & Recreation"],
  "Emergency & Disaster Relief": ["Disaster Response & Recovery", "Public Safety"],
  "International & Global Development": ["Immigrant & Refugee Services"],
  "Youth & Family Services": ["Children & Youth", "Family Services", "Mentoring"],
  "Senior Services": ["Seniors"],
  "Skills-Based & Professional": ["Technology", "Job Training & Employment"],
  "Advocacy & Civic Engagement": ["Civil Rights", "Community Strengthening"],
  "Faith-Based & Religious": ["Community Strengthening"],
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(value = "") {
  const documentFragment = new DOMParser().parseFromString(value, "text/html");
  return documentFragment.body.textContent || "";
}

function truncate(value, maxLength = 260) {
  const cleaned = stripHtml(value).replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}

// Region-specific sources (VolunteerConnector = Canada, Buckinghamshire = UK)
// are gated by the geocoded country code rather than string heuristics — string
// matching can't tell "Toronto, CA" (Canada) from "Los Angeles, CA" (California).
// Returns true when the source should run: the location resolved to `code`, or
// there's no resolved country at all (no location, or geocoding failed) — in
// which case we run the source as a best-effort fallback.
function countryAllows(preferences, code) {
  const resolved = preferences.geo && preferences.geo.countryCode;
  if (!resolved) {
    return true;
  }
  return resolved === code;
}

// Loose Canadian-postal-code test, used to decide whether the free-text location
// is suitable for VolunteerConnector's `pc` (postal code) parameter.
function isCanadianPostalCode(location) {
  return /[abceghjklmnprstvxy]\d[abceghjklmnprstvz][ -]?\d[abceghjklmnprstvz]\d/i.test(location || "");
}

function buildVolunteerConnectorKeywords(preferences) {
  const terms = preferences.categories.map(
    (category) => VC_KEYWORD_MAP[category] || category, // hybrid: mapped value, else raw label
  );

  const commitments = preferences.commitments || [];

  if (commitments.includes("Virtual")) {
    terms.push("remote");
  }

  if (commitments.includes("Weekend")) {
    terms.push("weekend");
  }

  return terms.join(" ");
}

const _geocodeCache = new Map();

async function geocodeLocation(location) {
  const key = location.trim().toLowerCase();
  if (_geocodeCache.has(key)) {
    return _geocodeCache.get(key);
  }

  // No country lock: a location like "Toronto" must resolve to its real place
  // (Toronto, Canada) rather than snapping to a US town of the same name.
  // addressdetails=1 gives us the country code, used to route regional sources.
  const params = new URLSearchParams({
    q: location,
    format: "json",
    addressdetails: "1",
    limit: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Unable to geocode location.");
  }

  const payload = await response.json();
  const place = payload[0];

  if (!place) {
    throw new Error("No location found for that location.");
  }

  const coords = {
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    countryCode: (place.address && place.address.country_code) || "", // ISO, lowercase
  };
  _geocodeCache.set(key, coords);
  return coords;
}

// The category → cause-area facet group (a nested array = OR in Algolia).
function buildCauseFacets(preferences) {
  const causeAreas = preferences.categories.flatMap((category) => categoryCauseMap[category] || []);
  const uniqueCauseAreas = [...new Set(causeAreas)];
  return uniqueCauseAreas.length > 0
    ? [uniqueCauseAreas.map((cause) => `concentrated_cause_areas:${cause}`)]
    : [];
}

function buildFacetFilters(preferences) {
  const filters = buildCauseFacets(preferences);

  // Facetable commitment types, OR-combined so picking several (e.g. Virtual +
  // In-person) widens rather than conflicts. A nested array = OR in Algolia.
  const commitments = preferences.commitments || [];
  const commitmentFacets = [];
  if (commitments.includes("Virtual")) commitmentFacets.push("presence:Remote");
  if (commitments.includes("In-person")) commitmentFacets.push("presence:In-Person");
  if (commitments.includes("Single day")) commitmentFacets.push("duration_kind:Event");

  if (commitmentFacets.length === 1) {
    filters.push(commitmentFacets[0]);
  } else if (commitmentFacets.length > 1) {
    filters.push(commitmentFacets);
  }

  return filters;
}

function buildSearchQuery(preferences) {
  const queryParts = [...preferences.categories];
  const commitments = preferences.commitments || [];

  if (commitments.includes("Weekend")) {
    queryParts.push("weekend");
  }

  if (commitments.includes("Weeknights")) {
    queryParts.push("evening weeknight");
  }

  if (commitments.includes("Part time")) {
    queryParts.push("part time flexible");
  }

  if (commitments.includes("Full time")) {
    queryParts.push("full time");
  }

  return queryParts.join(" ");
}

function getOrganization(opportunity) {
  return opportunity.organizations?.[0] || {};
}

function getLocalizedUrl(url) {
  if (!url) {
    return "";
  }

  if (typeof url === "string") {
    return url;
  }

  return url.en || url.es || url.pt || "";
}

function getContacts(opportunity) {
  const organization = getOrganization(opportunity);
  const contacts = [];

  if (opportunity.applyEmail) {
    contacts.push({
      label: opportunity.applyEmail,
      href: `mailto:${opportunity.applyEmail}`,
    });
  }

  if (opportunity.applyUrl) {
    contacts.push({
      label: "Application link",
      href: opportunity.applyUrl,
    });
  }

  if (organization.email) {
    contacts.push({
      label: organization.email,
      href: `mailto:${organization.email}`,
    });
  }

  if (organization.phone) {
    contacts.push({
      label: organization.phone,
      href: `tel:${organization.phone.replace(/[^\d+]/g, "")}`,
    });
  }

  const website = organization.organizationURL || organization.detailURL;
  if (website) {
    contacts.push({
      label: "Organization website",
      href: website,
    });
  }

  if (opportunity.detailURL) {
    contacts.push({
      label: "Registration link",
      href: opportunity.detailURL,
    });
  }

  return contacts;
}

function hasContactPath(opportunity) {
  return getContacts(opportunity).length > 0;
}

async function searchEngage(preferences) {
  const baseBody = {
    query: buildSearchQuery(preferences),
    hitsPerPage: 30,
    attributesToRetrieve: [
      "title",
      "description",
      "detailURL",
      "duration_kind",
      "duration_display",
      "presence",
      "locs",
      "organizations",
      "concentrated_cause_areas",
    ],
  };

  // No usable location (none given, or geocoding failed): fall back to a plain
  // facet search with no geo constraint.
  if (!preferences.location || !preferences.geo) {
    const filters = buildFacetFilters(preferences);
    return runEngageSearch({
      ...baseBody,
      ...(filters.length > 0 ? { facetFilters: filters } : {}),
    });
  }

  const aroundLatLng = `${preferences.geo.latitude}, ${preferences.geo.longitude}`;

  // In-person work is location-bound: only return listings within the chosen
  // radius (no widening — that's what was surfacing distant cities).
  const nearbyBody = {
    ...baseBody,
    aroundLatLng,
    aroundRadius: Math.round(preferences.distanceMiles * 1609),
    facetFilters: buildFacetFilters(preferences),
  };

  // Remote work isn't location-bound, so include remote listings regardless of
  // distance — unless the user restricted to In-person (without Virtual).
  const commitments = preferences.commitments || [];
  const remoteAcceptable = !commitments.includes("In-person") || commitments.includes("Virtual");

  const searches = [runEngageSearch(nearbyBody)];
  if (remoteAcceptable) {
    searches.push(
      runEngageSearch({
        ...baseBody,
        facetFilters: [...buildCauseFacets(preferences), "presence:Remote"],
      }),
    );
  }

  const responses = await Promise.all(searches);

  // Merge nearby + remote, de-duplicating across the two queries.
  const hits = [];
  const seen = new Set();
  for (const response of responses) {
    for (const hit of response.hits) {
      const key = hit.objectID || hit.detailURL || hit.title;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      hits.push(hit);
    }
  }

  return { total: hits.length, hits };
}

async function runEngageSearch(body) {
  const response = await fetch(ALGOLIA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": ALGOLIA_APP_ID,
      "X-Algolia-API-Key": ALGOLIA_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("Points of Light Engage search did not respond.");
  }

  const payload = await response.json();

  return {
    total: payload.nbHits || 0,
    hits: (payload.hits || []).filter(hasContactPath).slice(0, 10),
  };
}

async function normalizeVolunteerConnectorVolop(volop) {
  const audience = volop.audience || {};
  const regionLabel = Array.isArray(audience.regions) && audience.regions.length > 0
    ? audience.regions.join(", ")
    : "";
  let locationLabel = regionLabel;
  if (!regionLabel && Number.isFinite(audience.latitude) && Number.isFinite(audience.longitude)) {
    locationLabel = await reverseGeocodeCoordinates(audience.latitude, audience.longitude);
  }

  const presence = volop.remote_or_online
    ? "Remote"
    : audience.scope === "national"
    ? "Anywhere"
    : "In-Person";

  const organization = volop.organization
    ? [
        {
          name: volop.organization.name,
          organizationURL: volop.organization.url,
          logo: volop.organization.logo,
        },
      ]
    : [];

  return {
    source: "VolunteerConnector",
    title: volop.title,
    description: stripHtml(volop.description || ""),
    detailURL: volop.url,
    applyUrl: volop.url,
    presence,
    duration_kind: volop.duration || volop.dates || "",
    locs: locationLabel ? [{ geocode_string: locationLabel }] : [],
    organizations: organization,
  };
}

async function searchVolunteerConnector(preferences) {
  if (!countryAllows(preferences, "ca")) {
    return {
      total: 0,
      hits: [],
      notices: [],
    };
  }

  const params = new URLSearchParams({ format: "json" });
  const keywords = buildVolunteerConnectorKeywords(preferences);
  if (keywords) {
    params.set("keywords", keywords);
  }
  // `pc` expects a postal code; passing a city name (e.g. "Toronto, CA") returns
  // nothing, so only set it for an actual postal code and otherwise fall back to
  // a Canada-wide keyword search.
  if (isCanadianPostalCode(preferences.location)) {
    params.set("pc", preferences.location);
  }

  const response = await fetch(`${VC_API_BASE}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`VolunteerConnector search failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const hits = await Promise.all(
    (payload.results || [])
      .slice(0, VC_PAGE_SIZE_TARGET)
      .map(volop => normalizeVolunteerConnectorVolop(volop))
  );

  return {
    total: payload.count || 0,
    hits,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

const _reverseGeocodeCache = new Map();

async function reverseGeocodeCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';

  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (_reverseGeocodeCache.has(key)) return _reverseGeocodeCache.get(key);

  try {
    const params = new URLSearchParams({
      lat:            String(latitude),
      lon:            String(longitude),
      format:         'jsonv2',
      addressdetails: '1',
    });

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!response.ok) throw new Error(`Nominatim reverse geocode HTTP ${response.status}`);

    const payload = await response.json();
    const address = payload.address || {};

    const city     = address.city || address.town || address.village ||
                     address.hamlet || address.municipality || '';
    const state    = address.state || address.province || '';
    const postcode = address.postcode || '';
    const country  = address.country || '';

    const label = [city, state, postcode, country].filter(Boolean).join(', ');
    _reverseGeocodeCache.set(key, label);
    return label;

  } catch (err) {
    console.warn('VolunteerConnector reverse geocoding failed:', err);
    const fallback = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
    _reverseGeocodeCache.set(key, fallback);
    return fallback;
  }
}

async function fetchIdealistJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${IDEALIST_API_KEY}:`)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Idealist search failed with status ${response.status}.`);
  }

  return response.json();
}

function normalizeIdealistVolop(volop) {
  const detailURL = getLocalizedUrl(volop.url);
  const orgURL = getLocalizedUrl(volop.org?.url);
  const address = volop.address || volop.org?.address || {};
  const locationLabel = address.full
    || [address.city, address.stateCode || address.state, address.zipcode].filter(Boolean).join(", ");

  return {
    source: "Idealist",
    title: volop.name,
    description: volop.description || volop.applyText || "",
    detailURL,
    applyEmail: volop.applyEmail,
    applyUrl: volop.applyUrl || detailURL,
    duration_kind: volop.expectedTime || (volop.isRecurring ? "Recurring" : ""),
    presence: volop.locationType === "REMOTE" ? "Remote" : volop.locationType === "ONSITE" ? "In-Person" : volop.locationType,
    locs: locationLabel ? [{ geocode_string: locationLabel }] : [],
    organizations: [
      {
        name: volop.org?.name,
        organizationURL: orgURL,
      },
    ],
    areasOfFocus: volop.areasOfFocus || volop.org?.areasOfFocus || [],
    timesOfDay: volop.timesOfDay || [],
    expectedTime: volop.expectedTime || "",
  };
}

function normalizeBucksService(service) {
  const location = service.locations?.[0] || {};
  const org      = service.organizations?.[0] || {};

  const locationLabel = [
    location.address_1,
    location.city,
    location.postal_code,
  ].filter(Boolean).join(', ');

  const schedules = (service.regular_schedules || [])
    .map(s => [s.weekday, s.opens_at, s.closes_at].filter(Boolean).join(' '))
    .join('; ');

  // Build a best-effort contact URL — Bucks services often only have an org URL
  const detailURL = service.url || org.url || '';

  // Build a fallback contact from the Family Info Service directory listing
  const directoryURL = service.id
    ? `https://familyinfo.buckinghamshire.gov.uk/service/${service.id}`
    : '';

  return {
    source:        'Buckinghamshire Open Referral',
    title:         service.name || '',
    description:   stripHtml(service.description || ''),
    detailURL:     detailURL || directoryURL,
    applyUrl:      detailURL || directoryURL,
    presence:      'In-Person',
    duration_kind: schedules || '',
    locs:          locationLabel ? [{ geocode_string: locationLabel }] : [],
    organizations: [{
      name:            org.name || '',
      organizationURL: org.url  || directoryURL,
    }],
  };
}

async function searchBuckinghamshire(preferences) {
  // Buckinghamshire is a single UK county directory — only query it when the
  // location resolved to the UK (gb), so non-UK searches don't surface its
  // listings. No location / failed geocode falls through (best-effort sample).
  if (!countryAllows(preferences, "gb")) {
    return { total: 0, hits: [], notices: [] };
  }

  try {
    const textParts = ['volunteer'];

    if (preferences.categories.length > 0) {
      const categoryKeywords = preferences.categories
        .map(c => c.replace(/&/g, 'and').replace(/,/g, '').toLowerCase())
        .join(' ');
      textParts.push(categoryKeywords);
    }

    const commitmentTerms = (preferences.commitments || [])
      .map((c) => BUCKS_COMMITMENT_MAP[c] || '')
      .filter(Boolean);
    if (commitmentTerms.length) textParts.push(commitmentTerms.join(' '));

    const text = textParts.filter(Boolean).join(' ');

    const taxonomySlugs = [...new Set(
      preferences.categories.flatMap(c => BUCKS_TAXONOMY_MAP[c] || [])
    )];

    const searchTargets = taxonomySlugs.length > 0 ? taxonomySlugs : [null];
    const seen = new Set();
    const hits = [];

    for (const slug of searchTargets) {
      if (hits.length >= BUCKS_PAGE_SIZE_TARGET) break;

      const params = new URLSearchParams({
        text,
        per_page: String(BUCKS_PAGE_SIZE_TARGET * 2),
        page:     '1',
      });

      if (slug) params.set('taxonomy_id', slug);

      try {
        const response = await fetch(`${BUCKS_API_BASE}?${params.toString()}`);
        if (!response.ok) continue;

        const payload = await response.json();
        for (const service of (payload.content || [])) {
          if (seen.has(service.id)) continue;
          seen.add(service.id);

          const normalized = normalizeBucksService(service);
          if (hasContactPath(normalized)) {
            hits.push(normalized);
            if (hits.length >= BUCKS_PAGE_SIZE_TARGET) break;
          }
        }
      } catch (err) {
        console.warn('Buckinghamshire API fetch failed for slug:', slug, err);
      }
    }

    return {
      total:   hits.length,
      hits,
      notices: [],
    };

  } catch (err) {
    console.warn('Buckinghamshire search failed entirely:', err);
    return { total: 0, hits: [], notices: [] };
  }
}

function matchesIdealistPreferences(opportunity, preferences) {
  const haystack = [
    opportunity.title,
    opportunity.description,
    opportunity.presence,
    opportunity.duration_kind,
    ...(opportunity.areasOfFocus || []),
    ...(opportunity.timesOfDay || []),
  ]
    .join(" ")
    .toLowerCase();
  const categoryTerms = preferences.categories
    .flatMap((category) => [category, ...(categoryCauseMap[category] || [])])
    .map((term) => term.toLowerCase().replaceAll("&", "and"));
  const commitments = preferences.commitments || [];

  if (categoryTerms.length > 0) {
    const categoryMatched = categoryTerms.some((term) => haystack.includes(term.toLowerCase()));

    if (!categoryMatched) {
      return false;
    }
  }

  // OR semantics: keep the opportunity if it satisfies ANY selected commitment.
  // An empty array means no commitment constraint.
  if (commitments.length > 0) {
    const matchesAnyCommitment = commitments.some((commitment) => {
      switch (commitment) {
        case "Virtual":
          return opportunity.presence === "Remote";
        case "In-person":
          return opportunity.presence === "In-Person";
        case "Weekend":
          return haystack.includes("weekend");
        case "Weeknights":
          return haystack.includes("evening") || haystack.includes("weeknight");
        case "Full time":
          return haystack.includes("full");
        case "Part time":
          return haystack.includes("part") || haystack.includes("few_hours");
        default:
          return true; // "Single day"/unknown: no textual signal, don't exclude
      }
    });

    if (!matchesAnyCommitment) {
      return false;
    }
  }

  return true;
}

async function searchIdealist(preferences) {
  const payload = await fetchIdealistJson(IDEALIST_VOLOPS_URL);
  const volops = (payload.volops || []).filter((volop) => volop.isPublished !== false).slice(0, 25);
  const results = [];

  for (const volop of volops) {
    if (results.length >= 10) {
      break;
    }

    await wait(250);

    try {
      const detailPayload = await fetchIdealistJson(`${IDEALIST_VOLOPS_URL}/${volop.id}`);
      const normalized = normalizeIdealistVolop(detailPayload.volop);

      if (hasContactPath(normalized) && matchesIdealistPreferences(normalized, preferences)) {
        results.push(normalized);
      }
    } catch (error) {
      console.warn("Skipping Idealist opportunity", volop.id, error);
    }
  }

  return {
    total: payload.volops?.length || 0,
    hits: results,
  };
}

async function searchAllSources(preferences) {
  // Geocode once up front so every source shares the same resolved location and
  // country code (used to route VolunteerConnector/Buckinghamshire by country).
  let geo = null;
  if (preferences.location) {
    try {
      geo = await geocodeLocation(preferences.location);
    } catch (error) {
      geo = null; // sources fall back to their no-location / best-effort paths
    }
  }
  const enriched = { ...preferences, geo };

  const [engageResult, idealistResult, vcResult, bucksResult] = await Promise.allSettled([
    searchEngage(enriched),
    Promise.resolve({ total: 0, hits: [] }), // searchIdealist(enriched),
    searchVolunteerConnector(enriched),
    searchBuckinghamshire(enriched),
  ]);
  const notices = [];
  const buckets = [];

  if (engageResult.status === "fulfilled") {
    buckets.push(
      engageResult.value.hits
        .map((hit) => ({ ...hit, source: hit.source || "Points of Light Engage" }))
        .slice(0, VC_PAGE_SIZE_TARGET),
    );
  } else {
    notices.push(engageResult.reason.message);
  }

  if (idealistResult.status === "fulfilled") {
    buckets.push(idealistResult.value.hits.slice(0, VC_PAGE_SIZE_TARGET));
  } else {
    notices.push(idealistResult.reason.message);
  }

  if (vcResult.status === "fulfilled") {
    buckets.push(vcResult.value.hits);
    notices.push(...(vcResult.value.notices || []));
  } else {
    notices.push(vcResult.reason.message);
  }

  if (bucksResult.status === 'fulfilled') {
    buckets.push(bucksResult.value.hits);
    notices.push(...(bucksResult.value.notices || []));
  } else {
    notices.push(bucksResult.reason.message);
  }

  const hits = [];
  let added = true;
  while (added && hits.length < 20) {
    added = false;
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) {
        hits.push(next);
        added = true;
      }
      if (hits.length >= 20) {
        break;
      }
    }
  }

  return {
    total: hits.length,
    hits,
    notices,
  };
}

function presenceIcon(presence) {
  if (presence === "Remote") return "💻";
  if (presence === "Anywhere") return "🌐";
  return "📍";
}

function renderResults(list, notices = []) {
  if (state.categories.size === 0) {
    els.resultsGrid.innerHTML =
      `<div class="empty-state">Select at least one category to see opportunities.</div>`;
    return;
  }

  const noticeBanner = notices.length
    ? `<div class="results-notice">${notices.map(escapeHtml).join(" ")}</div>`
    : "";

  if (list.length === 0) {
    els.resultsGrid.innerHTML = `
      ${noticeBanner}
      <div class="empty-state">No opportunities match your filters. Try a wider radius or selecting more categories.</div>
    `;
    return;
  }

  els.resultsGrid.innerHTML =
    noticeBanner +
    list
      .map((opportunity) => {
        const organization = getOrganization(opportunity);
        const location = opportunity.locs?.[0]?.geocode_string || "";
        const presence = opportunity.presence || "";
        const duration = opportunity.duration_kind || "";
        const contacts = getContacts(opportunity);
        const primaryHref =
          opportunity.detailURL || opportunity.applyUrl || contacts[0]?.href || "";

        const orgLine = [organization.name, location].filter(Boolean).join(" · ");
        const metaItems = [
          duration ? `<span class="meta-item">📅 ${escapeHtml(duration)}</span>` : "",
          location ? `<span class="meta-item">📍 ${escapeHtml(location)}</span>` : "",
        ].join("");

        return `
      <article class="card">
        <div class="card-header">
          ${
            presence
              ? `<span class="badge" style="background-color: ${CATEGORY_COLOR}">${presenceIcon(presence)} ${escapeHtml(presence)}</span>`
              : ""
          }
          ${opportunity.source ? `<span class="source-tag">${escapeHtml(opportunity.source)}</span>` : ""}
        </div>
        <h3 class="card-title">${escapeHtml(opportunity.title)}</h3>
        ${orgLine ? `<p class="card-org">${escapeHtml(orgLine)}</p>` : ""}
        <p class="card-description">${escapeHtml(truncate(opportunity.description))}</p>
        <div class="card-meta">${metaItems}</div>
        <div class="card-actions">
          ${
            primaryHref
              ? `<a class="btn btn-primary" href="${escapeHtml(primaryHref)}" target="_blank" rel="noreferrer">View Details</a>`
              : ""
          }
        </div>
      </article>
    `;
      })
      .join("");
}

/* ---------- Init ---------- */

renderPills(els.categoryPillsContainer, CATEGORY_META, state.categories);
renderPills(els.commitmentPillsContainer, COMMITMENT_META, state.commitments);
setRadius(DEFAULTS.radius);
els.sortSelect.value = state.sortBy;
runSearchNow();
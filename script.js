const form = document.querySelector("#preferencesForm");
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
const engageSearchLink = document.querySelector("#engageSearchLink");
const distanceRange = document.querySelector("#distance");
const distanceNumber = document.querySelector("#distanceNumber");

const ALGOLIA_APP_ID = "D3FBYGGL4F";
const ALGOLIA_API_KEY = "86b2ecfef2f7983396cee1543e894d09";
const ALGOLIA_INDEX = "new_opportunities_production";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;

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

function syncDistance(value) {
  const boundedValue = Math.min(100, Math.max(1, Number(value) || 20));
  distanceRange.value = String(boundedValue);
  distanceNumber.value = String(boundedValue);
}

function normalizeDistanceInput() {
  syncDistance(distanceNumber.value);
}

distanceRange.addEventListener("input", (event) => {
  syncDistance(event.target.value);
});

distanceNumber.addEventListener("input", (event) => {
  if (event.target.value === "") {
    return;
  }

  const boundedValue = Math.min(100, Math.max(1, Number(event.target.value) || 20));
  distanceRange.value = String(boundedValue);
});

distanceNumber.addEventListener("blur", normalizeDistanceInput);

form.addEventListener("reset", () => {
  window.setTimeout(() => {
    syncDistance(20);
    summary.className = "summary-empty";
    summary.textContent = "Submit the form to preview the user preference payload.";
    results.className = "results-empty";
    results.textContent = "Save preferences to search matching opportunities.";
    engageSearchLink.href = "https://engage.pointsoflight.org/search";
  }, 0);
});

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

async function geocodeLocation(location) {
  const params = new URLSearchParams({
    q: location,
    countrycodes: "us",
    format: "json",
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

  return {
    latitude: Number(place.lat),
    longitude: Number(place.lon),
  };
}

function buildFacetFilters(preferences) {
  const filters = [];
  const causeAreas = preferences.categories.flatMap((category) => categoryCauseMap[category] || []);
  const uniqueCauseAreas = [...new Set(causeAreas)];

  if (uniqueCauseAreas.length > 0) {
    filters.push(uniqueCauseAreas.map((cause) => `concentrated_cause_areas:${cause}`));
  }

  if (preferences.timeCommitment === "Virtual") {
    filters.push("presence:Remote");
  }

  if (preferences.timeCommitment === "In-person") {
    filters.push("presence:In-Person");
  }

  if (preferences.timeCommitment === "Single day") {
    filters.push("duration_kind:Event");
  }

  return filters;
}

function buildSearchQuery(preferences) {
  const queryParts = [...preferences.categories];

  if (preferences.timeCommitment === "Weekend") {
    queryParts.push("weekend");
  }

  if (preferences.timeCommitment === "Weeknights") {
    queryParts.push("evening weeknight");
  }

  if (preferences.timeCommitment === "Part time") {
    queryParts.push("part time flexible");
  }

  if (preferences.timeCommitment === "Full time") {
    queryParts.push("full time");
  }

  return queryParts.join(" ");
}

function getOrganization(opportunity) {
  return opportunity.organizations?.[0] || {};
}

function getContacts(opportunity) {
  const organization = getOrganization(opportunity);
  const contacts = [];

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

  if (!preferences.location) {
    const filters = buildFacetFilters(preferences);
    return runEngageSearch({
      ...baseBody,
      ...(filters.length > 0 ? { facetFilters: filters } : {}),
    });
  }

  const { latitude, longitude } = await geocodeLocation(preferences.location);
  const attempts = [
    {
      ...baseBody,
      aroundLatLng: `${latitude}, ${longitude}`,
      aroundRadius: preferences.distanceMiles * 1609,
      facetFilters: buildFacetFilters(preferences),
    },
    {
      ...baseBody,
      aroundLatLng: `${latitude}, ${longitude}`,
      aroundRadius: Math.max(preferences.distanceMiles, 75) * 1609,
      facetFilters: buildFacetFilters(preferences).filter((filter) => typeof filter === "string"),
    },
    {
      ...baseBody,
      aroundLatLng: `${latitude}, ${longitude}`,
      aroundRadius: Math.max(preferences.distanceMiles, 150) * 1609,
    },
  ];

  for (const body of attempts) {
    const searchResponse = await runEngageSearch(body);

    if (searchResponse.hits.length > 0) {
      return searchResponse;
    }
  }

  return {
    total: 0,
    hits: [],
  };
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

function renderResults(searchResponse) {
  if (searchResponse.hits.length === 0) {
    results.className = "results-empty";
    results.textContent =
      "No matching listings with contact information or a registration link were returned. Try a wider distance or fewer filters.";
    return;
  }

  results.className = "results-list";
  results.innerHTML = searchResponse.hits
    .map((opportunity) => {
      const organization = getOrganization(opportunity);
      const location = opportunity.locs?.[0];
      const contacts = getContacts(opportunity);
      const meta = [
        organization.name,
        opportunity.presence,
        opportunity.duration_kind,
        location?.geocode_string,
      ].filter(Boolean);

      return `
        <article class="result-card">
          <div>
            <h3>${escapeHtml(opportunity.title)}</h3>
            <div class="result-meta">
              ${meta.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}
            </div>
          </div>
          <p>${escapeHtml(truncate(opportunity.description))}</p>
          <div class="contact-list" aria-label="Contact information">
            ${contacts
              .map(
                (contact) =>
                  `<a href="${escapeHtml(contact.href)}" target="_blank" rel="noreferrer">${escapeHtml(contact.label)}</a>`,
              )
              .join("")}
          </div>
          ${
            opportunity.detailURL
              ? `<div class="result-actions">
                  <a href="${escapeHtml(opportunity.detailURL)}" target="_blank" rel="noreferrer">View opportunity</a>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  normalizeDistanceInput();

  const data = new FormData(form);
  const categories = data.getAll("categories");

  const preferences = {
    location: String(data.get("location") || "").trim(),
    distanceMiles: Number(distanceNumber.value),
    categories,
    timeCommitment: data.get("commitment") || "",
  };

  summary.className = "";
  summary.innerHTML = `
    <dl class="summary-list">
      <div>
        <dt>Location</dt>
        <dd>${escapeHtml(preferences.location || "Any location")}</dd>
      </div>
      <div>
        <dt>Distance</dt>
        <dd>${escapeHtml(preferences.location ? `${preferences.distanceMiles} miles` : "Any distance")}</dd>
      </div>
      <div>
        <dt>Categories</dt>
        <dd>${escapeHtml(preferences.categories.length ? preferences.categories.join(", ") : "Any category")}</dd>
      </div>
      <div>
        <dt>Type of commitment</dt>
        <dd>${escapeHtml(preferences.timeCommitment || "Any commitment")}</dd>
      </div>
    </dl>
  `;

  console.log("Volunteer preferences", preferences);

  const searchQuery = buildSearchQuery(preferences);
  const searchParams = new URLSearchParams();

  if (searchQuery) {
    searchParams.set("keyword", searchQuery);
  }

  if (preferences.location) {
    searchParams.set("location", preferences.location);
  }

  engageSearchLink.href = searchParams.toString()
    ? `https://engage.pointsoflight.org/search?${searchParams.toString()}`
    : "https://engage.pointsoflight.org/search";

  results.className = "results-loading";
  results.textContent = "Searching Points of Light Engage...";

  try {
    const searchResponse = await searchEngage(preferences);
    renderResults(searchResponse);
  } catch (error) {
    results.className = "results-empty";
    results.textContent = `${error.message} You can still open the Engage search link above.`;
  }
});
